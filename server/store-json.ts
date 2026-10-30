// Queue store: a JSON file (data/queue.json). The default; needs nothing installed.
// Every store implements the same async interface (store.ts, server/README.md).
import fs from 'node:fs';
import path from 'node:path';
import { decideCheckIn, decideCancel } from './checkin.ts';
import type { Store, StoreOptions, StoredTicket } from './store.ts';

interface Db {
  next: number;
  tickets: StoredTicket[];
  tags: Record<string, number>; // NFC tag UID → last accepted tap counter
}

const isActive = (t: StoredTicket) => t.status === 'waiting' || t.status === 'called' || t.status === 'playing';
const byNumber = (a: StoredTicket, b: StoredTicket) => a.number - b.number;

export async function openStore({ dataDir }: StoreOptions): Promise<Store> {
  const file = path.join(dataDir, 'queue.json');
  const db = load();

  function load(): Db {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(d.next) && Array.isArray(d.tickets)) return { tags: {}, ...d };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('queue.json unreadable, starting empty:', (err as Error).message);
    }
    return { next: 1, tickets: [], tags: {} };
  }
  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
  }
  const find = (id: string) => db.tickets.find((t) => t.id === id) || null;
  const owns = (t: StoredTicket | null, ownerHash: string | null) => !!t && !!t.ownerHash && t.ownerHash === ownerHash;

  // Node runs one request at a time, so each method below is atomic without locks.
  const store: Store = {
    name: 'json',
    async active() { return db.tickets.filter(isActive).sort(byNumber); },
    async list() { return [...db.tickets].sort(byNumber); },
    async get(id) { return find(id); },
    async create({ id, nickname, ownerHash = null, now }) {
      const t: StoredTicket = { id, number: db.next++, nickname, status: 'waiting', createdAt: now, updatedAt: now, checkedInAt: null, ownerHash };
      db.tickets.push(t);
      save();
      return t;
    },
    async setStatus(id, status, now) {
      const t = find(id);
      if (!t) return null;
      t.status = status;
      t.updatedAt = now;
      save();
      return t;
    },
    async callNext(now) {
      const next = db.tickets.filter((t) => t.status === 'waiting').sort(byNumber)[0];
      return next ? store.setStatus(next.id, 'called', now) : null;
    },
    async checkIn({ id, manual = false, ownerHash = null, tagUid = null, counter = -1, now }) {
      const t = find(id);
      const last = tagUid && Number.isInteger(db.tags[tagUid]) ? db.tags[tagUid] : -1;
      const d = decideCheckIn({ ticket: t, manual, ownerMatches: owns(t, ownerHash), counter, lastCounter: last });
      if (d.status !== 'rejected' && t) {
        if (d.lastCounter !== undefined && tagUid) db.tags[tagUid] = d.lastCounter;
        if (!t.checkedInAt) { t.checkedInAt = now; t.updatedAt = now; }
        save();
      }
      return { status: d.status, reason: d.reason, ticket: t };
    },
    async cancel({ id, ownerHash = null, now }) {
      const t = find(id);
      const d = decideCancel({ ticket: t, ownerMatches: owns(t, ownerHash) });
      if (d.status === 'cancelled' && t) { t.status = 'cancelled'; t.updatedAt = now; save(); }
      return { status: d.status, reason: d.reason, ticket: t };
    },
    async close() {},
  };
  return store;
}
