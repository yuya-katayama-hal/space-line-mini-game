// Queue API of the reception server (local backend, JSON store): tickets, SSE, call / status, static file safety,
// rate limit, persistence across a restart, operator key.
import fs from 'node:fs';
import path from 'node:path';
import { checker, startServer, sleep, tmpDir } from '../lib.mjs';

const t = checker('server API (json store)');
const DATA = tmpDir('api');
const PORT = 8201;
const BASE = `http://localhost:${PORT}`;
async function j(method, p, body, headers = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function sse(onState) {
  const ctrl = new AbortController();
  const r = await fetch(BASE + '/api/events', { signal: ctrl.signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) onState(JSON.parse(data.slice(6)));
        }
      }
    } catch {}
  })();
  return () => ctrl.abort();
}

let srv = await startServer({ port: PORT, env: { DATA_DIR: DATA } });
const info = await j('GET', '/api/info');
t.ok(info.status === 200 && info.data.mode === 'local' && info.data.registerUrl === `${BASE}/register/`, 'info', JSON.stringify(info.data));

const events = [];
const stopSse = await sse((m) => events.push(m));
await sleep(200);
t.ok(events.length === 1 && events[0].queue.waiting.length === 0, 'SSE sends initial state');

const tickets = [];
for (const n of ['そらとぶネコ', '  ロケット<b>  ', 'Mars🚀']) tickets.push((await j('POST', '/api/tickets', { nickname: n })).data);
t.ok(tickets.map((x) => x.number).join() === '1,2,3', 'numbers 1,2,3');
t.ok(tickets[1].nickname === 'ロケットb', 'nickname cleaned (markup stripped, trimmed)');
t.ok(tickets.every((x) => x.status === 'waiting' && typeof x.id === 'string' && typeof x.ownerToken === 'string' && !('ownerHash' in x)), 'all waiting, owner token returned, no owner hash exposed');
await sleep(200);
t.ok(events.length === 4 && events[3].queue.waiting.length === 3 && events[3].changed[0].number === 3, 'SSE pushed each create', `events=${events.length}`);

t.ok((await j('POST', '/api/tickets', { nickname: '   ' })).status === 400, 'empty nickname → 400');
const bad = await j('POST', '/api/tickets', '{not json');
t.ok(bad.status === 400 && /JSON/.test(bad.data.error), 'bad JSON → 400');
t.ok((await j('POST', '/api/tickets', JSON.stringify({ nickname: 'x'.repeat(5000) }))).status === 413, 'oversized body → 413');

const got = await j('GET', `/api/tickets/${tickets[0].id}`);
t.ok(got.status === 200 && got.data.number === 1 && !('ownerHash' in got.data) && !('ownerToken' in got.data), 'get ticket (no owner secrets)');
t.ok((await j('GET', '/api/tickets/nope')).status === 404, 'unknown ticket → 404');
t.ok((await j('GET', '/api/nothing')).status === 404, 'unknown API → 404');

const called = await j('POST', '/api/call-next');
t.ok(called.data.number === 1 && called.data.status === 'called', 'call-next → #1 called');
let q = (await j('GET', '/api/queue')).data;
t.ok(q.serving.number === 1 && q.waiting.map((x) => x.number).join() === '2,3', 'queue: serving #1, waiting 2,3');
t.ok((await j('POST', `/api/tickets/${tickets[0].id}/status`, { status: 'playing' })).data.status === 'playing', 'set playing');
t.ok((await j('POST', `/api/tickets/${tickets[0].id}/status`, { status: 'done' })).data.status === 'done', 'set done');
t.ok((await j('POST', `/api/tickets/${tickets[0].id}/status`, { status: 'bogus' })).status === 400, 'bad status → 400');
t.ok((await j('POST', '/api/call-next')).data.number === 2, 'call-next → #2');
t.ok((await j('POST', `/api/tickets/${tickets[1].id}/status`, { status: 'noshow' })).data.status === 'noshow', 'set noshow');
q = (await j('GET', '/api/queue')).data;
t.ok(q.serving === null && q.waiting.map((x) => x.number).join() === '3', 'queue: nobody serving, waiting 3');
await sleep(150);
const last = events[events.length - 1];
t.ok(last.changed[0].status === 'noshow' && last.queue.waiting.length === 1, 'SSE pushed status changes');

// cancel by the owner (token), refused for others
t.ok((await j('POST', `/api/tickets/${tickets[2].id}/cancel`, { ownerToken: tickets[0].ownerToken })).data.reason === 'not-owner', 'cancel with another ticket\'s token → not-owner');
t.ok((await j('POST', `/api/tickets/${tickets[2].id}/cancel`, { ownerToken: tickets[2].ownerToken })).data.status === 'cancelled', 'owner cancels → cancelled');
t.ok((await j('GET', '/api/queue')).data.waiting.length === 0, 'cancelled ticket left the queue');

// static file safety: only the mounted folders are reachable
for (const p of ['/data/queue.json', '/DATA/queue.json', '/data./queue.json', '/data/queue.json::$DATA', '/..%2fserver.mjs', '/server/server.mjs', '/package.json', '/firebase.json', '/node_modules/mariadb/package.json']) {
  const r = await fetch(BASE + p);
  t.ok(r.status === 403 || r.status === 404, `blocked ${p}`, `status=${r.status}`);
}
t.ok((await fetch(BASE + '/register/')).status === 200, '/register/ served');
const redir = await fetch(BASE + '/register', { redirect: 'manual' });
t.ok(redir.status === 301 && redir.headers.get('location') === '/register/', '/register redirects to /register/');
t.ok((await fetch(BASE + '/operator.html')).status === 200, '/operator.html served');
t.ok((await fetch(BASE + '/')).status === 200, '/ (booth) served');

let limited = false;
for (let i = 0; i < 12; i++) if ((await j('POST', '/api/tickets', { nickname: `r${i}` })).status === 429) { limited = true; break; }
t.ok(limited, 'rate limit kicks in (10 per minute per address)');

stopSse();
const before = (await j('GET', '/api/queue')).data;
await srv.stop();
t.ok(fs.existsSync(path.join(DATA, 'queue.json')) && !fs.readdirSync(DATA).some((f) => f.endsWith('.tmp')), 'queue.json written, no temp files left');
srv = await startServer({ port: PORT, env: { DATA_DIR: DATA } });
const after = (await j('GET', '/api/queue')).data;
t.ok(JSON.stringify(after.waiting.map((x) => x.number)) === JSON.stringify(before.waiting.map((x) => x.number)), 'queue survives restart');
const n = (await j('POST', '/api/tickets', { nickname: 'after restart' })).data;
t.ok(n.number === before.waiting[before.waiting.length - 1].number + 1, 'numbering continues after restart', `#${n.number}`);
await srv.stop();

srv = await startServer({ port: PORT, env: { DATA_DIR: tmpDir('api-key'), OPERATOR_KEY: 'sesame' } });
t.ok((await j('GET', '/api/info')).data.operatorKeyRequired === true, 'info reports operatorKeyRequired');
await j('POST', '/api/tickets', { nickname: 'visitor' });
t.ok((await j('POST', '/api/call-next')).status === 401, 'call-next without key → 401');
t.ok((await j('POST', '/api/call-next', undefined, { 'x-operator-key': 'wrong!' })).status === 401, 'wrong key → 401');
const withKey = await j('POST', '/api/call-next', undefined, { 'x-operator-key': 'sesame' });
t.ok(withKey.status === 200 && withKey.data.status === 'called', 'right key → called');
t.ok((await j('POST', `/api/tickets/${withKey.data.id}/status`, { status: 'done' })).status === 401, 'set-status without key → 401');
t.ok((await j('GET', '/api/tickets')).status === 401, 'list tickets without key → 401');
t.ok((await j('POST', '/api/tickets', { nickname: 'visitor2' })).status === 201, 'visitors still register without key');
await srv.stop();
t.done();
