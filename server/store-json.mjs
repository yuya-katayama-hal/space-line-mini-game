// Queue store: a JSON file (data/queue.json). The default; needs nothing installed.
// Every store implements the same async interface (see server/README.md):
//   name, active(), list(), get(id), create({ id, nickname, ownerHash, now }), setStatus(id, status, now),
//   callNext(now), checkIn({ id, manual, ownerHash, tagUid, counter, now }), cancel({ id, ownerHash, now }), close()
import fs from 'node:fs';
import path from 'node:path';
import { decideCheckIn, decideCancel } from './checkin.mjs';

const isActive = (t) => t.status === 'waiting' || t.status === 'called' || t.status === 'playing';

export async function openStore({ dataDir }) {
  const file = path.join(dataDir, 'queue.json');
  const db = load();

  function load() {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(d.next) && Array.isArray(d.tickets)) return { tags: {}, ...d };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('queue.json unreadable, starting empty:', err.message);
    }
    return { next: 1, tickets: [], tags: {} }; // tags: NFC tag UID → last accepted tap counter
  }
  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
  }
  const find = (id) => db.tickets.find((t) => t.id === id) || null;

  // Node runs one request at a time, so each method below is atomic without locks.
  return {
    name: 'json',
    async active() { return db.tickets.filter(isActive).sort((a, b) => a.number - b.number); },
    async list() { return [...db.tickets].sort((a, b) => a.number - b.number); },
    async get(id) { return find(id); },
    async create({ id, nickname, ownerHash = null, now }) {
      const t = { id, number: db.next++, nickname, status: 'waiting', createdAt: now, updatedAt: now, checkedInAt: null, ownerHash };
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
      const next = db.tickets.filter((t) => t.status === 'waiting').sort((a, b) => a.number - b.number)[0];
      return next ? this.setStatus(next.id, 'called', now) : null;
    },
    async checkIn({ id, manual = false, ownerHash = null, tagUid = null, counter = -1, now }) {
      const t = find(id);
      const last = tagUid && Number.isInteger(db.tags[tagUid]) ? db.tags[tagUid] : -1;
      const d = decideCheckIn({ ticket: t, manual, ownerMatches: !!t && !!t.ownerHash && t.ownerHash === ownerHash, counter, lastCounter: last });
      if (d.status !== 'rejected') {
        if (d.lastCounter !== undefined) db.tags[tagUid] = d.lastCounter;
        if (!t.checkedInAt) { t.checkedInAt = now; t.updatedAt = now; }
        save();
      }
      return { status: d.status, reason: d.reason, ticket: t };
    },
    async cancel({ id, ownerHash = null, now }) {
      const t = find(id);
      const d = decideCancel({ ticket: t, ownerMatches: !!t && !!t.ownerHash && t.ownerHash === ownerHash });
      if (d.status === 'cancelled') { t.status = 'cancelled'; t.updatedAt = now; save(); }
      return { status: d.status, reason: d.reason, ticket: t };
    },
    async close() {},
  };
}
