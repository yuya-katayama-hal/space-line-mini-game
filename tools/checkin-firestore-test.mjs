// Tests the Firebase check-in checker (server/checkin-firestore.mjs) against an in-memory stand-in for Firestore:
//   node tools/checkin-firestore-test.mjs
// It covers the checker's own logic (order, rules, what it writes). The real Firestore, the security rules and the
// service-account sign-in still need the live test in docs/nfc-checkin.md.
import { watchCheckins } from '../server/checkin-firestore.mjs';
import { makeTap } from './fake-tap.mjs';

const keys = { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
const UID = '04A1B2C3D4E5F6';
let fails = 0;
const ok = (c, m, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x ? '  — ' + x : ''}`); if (!c) fails++; };

// just enough of the Admin SDK's Firestore for the checker
class MockDb {
  constructor() { this.docs = new Map(); this.listeners = new Set(); }
  ref(path) { const db = this; return { path, id: path.split('/')[1], get: async () => db.snap(path) }; }
  snap(path) {
    const d = this.docs.get(path);
    return { exists: !!d, id: path.split('/')[1], ref: this.ref(path), data: () => (d ? { ...d } : undefined), get: (f) => (d ? d[f] : undefined) };
  }
  collection(name) {
    const db = this;
    return {
      doc: (id) => db.ref(`${name}/${id}`),
      where: (field, op, value) => ({
        onSnapshot(next) {
          const l = { name, field, value, next };
          db.listeners.add(l);
          db.notify();
          return () => db.listeners.delete(l);
        },
      }),
    };
  }
  put(path, data) { this.docs.set(path, data); this.notify(); }
  notify() {
    for (const l of this.listeners) {
      const docs = [...this.docs.entries()].filter(([p, d]) => p.startsWith(`${l.name}/`) && d[l.field] === l.value).map(([p]) => this.snap(p));
      queueMicrotask(() => l.next({ docs }));
    }
  }
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => this.snap(ref.path),
      set: (ref, d) => writes.push(() => this.docs.set(ref.path, { ...d })),
      update: (ref, d) => writes.push(() => this.docs.set(ref.path, { ...this.docs.get(ref.path), ...d })),
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    this.notify();
    return out;
  }
}

const db = new MockDb();
const t = (id, owner, extra = {}) => db.put(`tickets/${id}`, { number: 1, nickname: id, status: 'waiting', createdAt: 1, updatedAt: 1, ...(owner ? { owner } : {}), ...extra });
t('t1', 'u1'); t('t2', 'u2'); t('t3', null); t('t4', 'u4'); t('t5', 'u5'); t('t6', 'u6', { status: 'done' });
let n = 0;
const req = (fields) => { const id = `r${++n}`; db.put(`checkins/${id}`, { status: 'pending', createdAt: n, ...fields }); return id; };
const result = (id) => db.docs.get(`checkins/${id}`);
const tap = (counter, k = keys) => makeTap({ uid: UID, counter, keys: k });

// two requests filed before the checker starts, newest first in the map: must be answered oldest first
const late = 'r-late', early = 'r-early';
db.docs.set(`checkins/${late}`, { status: 'pending', createdAt: 200, ticketId: 't4', owner: 'u4', ...tap(20) });
db.docs.set(`checkins/${early}`, { status: 'pending', createdAt: 100, ticketId: 't5', owner: 'u5', ...tap(15) });

const logs = [];
const checker = watchCheckins(db, { keys, log: (m) => logs.push(m) });
await new Promise((r) => setTimeout(r, 50));
await checker.idle();
ok(result(early).status === 'accepted' && result(late).status === 'accepted', 'requests waiting at start are answered oldest first (15 then 20)', `${result(early).status}/${result(late).status}`);
ok(db.docs.get(`tags/${UID}`).lastCounter === 20, 'tag counter is 20 after both');

const step = async (fields) => { const id = req(fields); await new Promise((r) => setTimeout(r, 20)); await checker.idle(); return result(id); };
let r = await step({ ticketId: 't1', owner: 'u1', ...tap(21) });
ok(r.status === 'accepted' && typeof db.docs.get('tickets/t1').checkedInAt === 'number' && r.tagUid === UID && r.counter === 21, 'owner + fresh tap → accepted, ticket.checkedInAt set, tag/counter recorded');
r = await step({ ticketId: 't2', owner: 'u2', ...tap(21) });
ok(r.status === 'rejected' && r.reason === 'replayed', 'the same tap again (other phone) → replayed');
r = await step({ ticketId: 't2', owner: 'u1', ...tap(22) });
ok(r.status === 'rejected' && r.reason === 'not-owner' && db.docs.get(`tags/${UID}`).lastCounter === 21, 'someone else\'s ticket → not-owner, and the tap is not used up');
r = await step({ ticketId: 't2', owner: 'u2', ...tap(22) });
ok(r.status === 'accepted', '... so the real owner can still use that tap');
r = await step({ ticketId: 't1', owner: 'u1', ...tap(23) });
ok(r.status === 'already' && db.docs.get('tickets/t1').checkedInAt < Date.now() + 1, 'checking in twice → already (first time kept)');
r = await step({ ticketId: 't2', owner: 'u2', ...tap(30, { ...keys, fileReadKey: '42'.repeat(16) }) });
ok(r.status === 'rejected' && r.reason === 'bad-signature', 'tap signed with another key → bad-signature');
r = await step({ ticketId: 't2', owner: 'u2', picc: 'zz', cmac: '00' });
ok(r.status === 'rejected' && r.reason === 'malformed', 'garbage → malformed');
r = await step({ ticketId: 't6', owner: 'u6', ...tap(31) });
ok(r.status === 'rejected' && r.reason === 'closed', 'finished ticket → closed');
r = await step({ ticketId: 'nope', owner: 'u1', ...tap(32) });
ok(r.status === 'rejected' && r.reason === 'no-ticket', 'unknown ticket → no-ticket');
r = await step({ ticketId: 't3', manual: true, requestedBy: 'staff@example.com' });
ok(r.status === 'accepted' && typeof db.docs.get('tickets/t3').checkedInAt === 'number', 'staff manual check-in (no tag, ticket without owner) → accepted');
r = await step({ ticketId: 't3', manual: true, requestedBy: 'staff@example.com' });
ok(r.status === 'already', 'manual again → already');
ok(Object.keys(db.docs.get('tickets/t1')).every((k) => ['number', 'nickname', 'status', 'createdAt', 'updatedAt', 'owner', 'checkedInAt'].includes(k)), 'checker only adds checkedInAt / updatedAt to tickets');

await checker.stop();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
