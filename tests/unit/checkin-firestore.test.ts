// The Firebase check-in checker (server/checkin-firestore.ts) against an in-memory stand-in for Firestore.
// It covers the checker's own logic (order, rules, what it writes). The real Firestore, the security rules and the
// service-account sign-in still need the live test in docs/nfc-checkin.md.
import { afterEach, describe, expect, it } from 'vitest';
import { watchCheckins } from '../../server/checkin-firestore.ts';
import type { CheckerDb, DocRef, DocSnap, Tx } from '../../server/checkin-firestore.ts';
import { makeTap } from '../../tools/fake-tap.ts';

const keys = { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
const UID = '04A1B2C3D4E5F6';
type Data = Record<string, any>;
interface Listener { name: string; field: string; value: unknown; next: (qs: { docs: DocSnap[] }) => void }

// just enough of the Admin SDK's Firestore for the checker
class MockDb implements CheckerDb {
  docs = new Map<string, Data>();
  listeners = new Set<Listener>();
  ref(path: string): DocRef & { path: string } { return { path, id: path.split('/')[1], get: async () => this.snap(path) }; }
  snap(path: string): DocSnap {
    const d = this.docs.get(path);
    return { exists: !!d, id: path.split('/')[1], ref: this.ref(path), data: () => (d ? { ...d } : undefined), get: (f) => (d ? d[f] : undefined) };
  }
  collection(name: string) {
    return {
      doc: (id: string) => this.ref(`${name}/${id}`),
      where: (field: string, _op: '==', value: unknown) => ({
        onSnapshot: (next: Listener['next']) => {
          const l = { name, field, value, next };
          this.listeners.add(l);
          this.notify();
          return () => { this.listeners.delete(l); };
        },
      }),
    };
  }
  put(path: string, data: Data) { this.docs.set(path, data); this.notify(); }
  notify() {
    for (const l of this.listeners) {
      const docs = [...this.docs.entries()].filter(([p, d]) => p.startsWith(`${l.name}/`) && d[l.field] === l.value).map(([p]) => this.snap(p));
      queueMicrotask(() => l.next({ docs }));
    }
  }
  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const writes: (() => void)[] = [];
    const path = (ref: DocRef) => (ref as DocRef & { path: string }).path;
    const tx: Tx = {
      get: async (ref) => this.snap(path(ref)),
      set: (ref, d) => writes.push(() => this.docs.set(path(ref), { ...d })),
      update: (ref, d) => writes.push(() => this.docs.set(path(ref), { ...this.docs.get(path(ref)), ...d })),
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    this.notify();
    return out;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tap = (counter: number, k = keys) => makeTap({ uid: UID, counter, keys: k });

function setup() {
  const db = new MockDb();
  const ticket = (id: string, owner: string | null, extra: Data = {}) =>
    db.put(`tickets/${id}`, { number: 1, nickname: id, status: 'waiting', createdAt: 1, updatedAt: 1, ...(owner ? { owner } : {}), ...extra });
  ticket('t1', 'u1'); ticket('t2', 'u2'); ticket('t3', null); ticket('t4', 'u4'); ticket('t5', 'u5'); ticket('t6', 'u6', { status: 'done' });
  return db;
}

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

function start(db: MockDb) {
  const logs: string[] = [];
  const checker = watchCheckins(db, { keys, log: (m) => logs.push(m) });
  stop = checker.stop;
  let n = 0;
  // file a request and wait for the answer
  const step = async (fields: Data) => {
    const id = `r${++n}`;
    db.put(`checkins/${id}`, { status: 'pending', createdAt: n, ...fields });
    await sleep(20);
    await checker.idle();
    return db.docs.get(`checkins/${id}`)!;
  };
  return { checker, step, logs };
}

describe('Firestore check-in checker', () => {
  it('answers requests waiting at start oldest first', async () => {
    const db = setup();
    db.docs.set('checkins/r-late', { status: 'pending', createdAt: 200, ticketId: 't4', owner: 'u4', ...tap(20) });
    db.docs.set('checkins/r-early', { status: 'pending', createdAt: 100, ticketId: 't5', owner: 'u5', ...tap(15) });
    const { checker } = start(db);
    await sleep(50);
    await checker.idle();
    expect(db.docs.get('checkins/r-early')!.status).toBe('accepted'); // 15 first, so 20 is still higher
    expect(db.docs.get('checkins/r-late')!.status).toBe('accepted');
    expect(db.docs.get(`tags/${UID}`)!.lastCounter).toBe(20);
  });

  it('applies the rules and records what it decided', async () => {
    const db = setup();
    const { step } = start(db);
    let r = await step({ ticketId: 't1', owner: 'u1', ...tap(21) });
    expect(r).toMatchObject({ status: 'accepted', tagUid: UID, counter: 21 });
    expect(typeof db.docs.get('tickets/t1')!.checkedInAt).toBe('number');

    r = await step({ ticketId: 't2', owner: 'u2', ...tap(21) });
    expect(r).toMatchObject({ status: 'rejected', reason: 'replayed' }); // the same tap again, other phone

    r = await step({ ticketId: 't2', owner: 'u1', ...tap(22) });
    expect(r).toMatchObject({ status: 'rejected', reason: 'not-owner' });
    expect(db.docs.get(`tags/${UID}`)!.lastCounter).toBe(21); // the tap is not used up...
    r = await step({ ticketId: 't2', owner: 'u2', ...tap(22) });
    expect(r.status).toBe('accepted'); // ...so the real owner can still use it

    const first = db.docs.get('tickets/t1')!.checkedInAt;
    r = await step({ ticketId: 't1', owner: 'u1', ...tap(23) });
    expect(r.status).toBe('already');
    expect(db.docs.get('tickets/t1')!.checkedInAt).toBe(first);

    expect(await step({ ticketId: 't2', owner: 'u2', ...tap(30, { ...keys, fileReadKey: '42'.repeat(16) }) })).toMatchObject({ status: 'rejected', reason: 'bad-signature' });
    expect(await step({ ticketId: 't2', owner: 'u2', picc: 'zz', cmac: '00' })).toMatchObject({ status: 'rejected', reason: 'malformed' });
    expect(await step({ ticketId: 't6', owner: 'u6', ...tap(31) })).toMatchObject({ status: 'rejected', reason: 'closed' });
    expect(await step({ ticketId: 'nope', owner: 'u1', ...tap(32) })).toMatchObject({ status: 'rejected', reason: 'no-ticket' });
  });

  it('staff can check in by hand, without a tag or an owner', async () => {
    const db = setup();
    const { step } = start(db);
    expect((await step({ ticketId: 't3', manual: true, requestedBy: 'staff@example.com' })).status).toBe('accepted');
    expect(typeof db.docs.get('tickets/t3')!.checkedInAt).toBe('number');
    expect((await step({ ticketId: 't3', manual: true, requestedBy: 'staff@example.com' })).status).toBe('already');
  });

  it('only adds checkedInAt / updatedAt to tickets', async () => {
    const db = setup();
    const { step } = start(db);
    await step({ ticketId: 't1', owner: 'u1', ...tap(5) });
    expect(Object.keys(db.docs.get('tickets/t1')!).sort()).toEqual(['checkedInAt', 'createdAt', 'nickname', 'number', 'owner', 'status', 'updatedAt']);
  });
});
