// The JSON queue store (server/store-json.ts): numbering, status changes, check-in, cancel, persistence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore } from '../../server/store-json.ts';
import type { Store } from '../../server/store.ts';

let dir: string;
let store: Store;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaceline-store-'));
  store = await openStore({ dataDir: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const add = (id: string, ownerHash: string | null = `h-${id}`) => store.create({ id, nickname: id, ownerHash, now: 1 });

describe('json store', () => {
  it('numbers tickets in order and lists the active ones', async () => {
    await add('a'); await add('b'); await add('c');
    expect((await store.list()).map((t) => t.number)).toEqual([1, 2, 3]);
    await store.setStatus('b', 'done', 2);
    expect((await store.active()).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('callNext calls the lowest waiting ticket, then null when none is left', async () => {
    await add('a'); await add('b');
    expect((await store.callNext(5))).toMatchObject({ id: 'a', status: 'called', updatedAt: 5 });
    expect((await store.callNext(6))?.id).toBe('b');
    expect(await store.callNext(7)).toBeNull();
  });

  it('setStatus on an unknown ticket → null', async () => expect(await store.setStatus('x', 'done', 1)).toBeNull());

  it('check-in: owner + fresh counter, then replay refused, tag counter kept per tag', async () => {
    await add('a'); await add('b');
    expect(await store.checkIn({ id: 'a', ownerHash: 'h-a', tagUid: 'T1', counter: 10, now: 50 })).toMatchObject({ status: 'accepted', ticket: { checkedInAt: 50 } });
    expect((await store.checkIn({ id: 'b', ownerHash: 'h-b', tagUid: 'T1', counter: 10, now: 51 })).reason).toBe('replayed');
    expect((await store.checkIn({ id: 'b', ownerHash: 'h-b', tagUid: 'T2', counter: 1, now: 52 })).status).toBe('accepted');
    expect((await store.checkIn({ id: 'a', ownerHash: 'h-a', tagUid: 'T1', counter: 11, now: 53 }))).toMatchObject({ status: 'already', ticket: { checkedInAt: 50 } });
  });

  it('a ticket without an owner hash can only be checked in by hand', async () => {
    await add('a', null);
    expect((await store.checkIn({ id: 'a', ownerHash: null, tagUid: 'T1', counter: 1, now: 1 })).reason).toBe('not-owner');
    expect((await store.checkIn({ id: 'a', manual: true, now: 2 })).status).toBe('accepted');
  });

  it('cancel: only the owner, only while waiting / called', async () => {
    await add('a'); await add('b');
    expect((await store.cancel({ id: 'a', ownerHash: 'nope', now: 1 })).reason).toBe('not-owner');
    expect(await store.cancel({ id: 'a', ownerHash: 'h-a', now: 2 })).toMatchObject({ status: 'cancelled', ticket: { status: 'cancelled' } });
    await store.setStatus('b', 'playing', 3);
    expect((await store.cancel({ id: 'b', ownerHash: 'h-b', now: 4 })).reason).toBe('closed');
  });

  it('keeps tickets, the next number and tag counters across a restart', async () => {
    await add('a');
    await store.checkIn({ id: 'a', ownerHash: 'h-a', tagUid: 'T1', counter: 7, now: 1 });
    const again = await openStore({ dataDir: dir });
    expect((await again.get('a'))?.checkedInAt).toBe(1);
    expect((await again.create({ id: 'b', nickname: 'b', now: 2 })).number).toBe(2);
    await again.create({ id: 'c', nickname: 'c', ownerHash: 'h-c', now: 3 });
    expect((await again.checkIn({ id: 'c', ownerHash: 'h-c', tagUid: 'T1', counter: 7, now: 4 })).reason).toBe('replayed');
  });

  it('starts empty from an unreadable file', async () => {
    fs.writeFileSync(path.join(dir, 'queue.json'), '{ not json');
    const s = await openStore({ dataDir: dir });
    expect(await s.list()).toEqual([]);
  });
});
