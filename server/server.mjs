// Server for the reception PC (npm start / start.bat).
// - Static files: the booth and operator page (reception/), the phone registration page and queue client
//   (hosting/, the same files Firebase Hosting publishes), and the few npm packages the pages load. Nothing else
//   in the project is reachable from a browser. Camera, ES modules and the MediaPipe wasm need http://localhost.
// - Queue API under /api/ (the "local" backend of js/queue/). Where the tickets are stored is the queue store,
//   picked with QUEUE_STORE (server/README.md); the API and the pages are the same for every store.
//
// Env:
//   PORT=8000           port
//   HOST=127.0.0.1      bind address. HOST=0.0.0.0 lets phones on the same Wi-Fi reach /register/ (npm run start:lan)
//   QUEUE_STORE=json    where tickets are stored: json (data/queue.json, default) | mariadb
//   DATA_DIR=./data     json store: where queue.json is kept
//   MARIADB_URL=...     mariadb store: mariadb://user:password@host:3306/database
//   OPERATOR_KEY=...    if set, call-next / set-status need the header  x-operator-key: <key>
//   REGISTER_URL=...    override the registration URL shown as a QR code
//   SPACELINE_SECRETS=  folder with the NFC tag keys and the Firebase service account (default: <home>/spaceline-secrets).
//                       Keep it outside the project folder. See docs/nfc-checkin.md.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySun } from './sdm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // the project folder
// Windows paths are case-insensitive, so compare lowercased there
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const OPERATOR_KEY = process.env.OPERATOR_KEY || '';
const MAX_BODY = 4096;
const MAX_ACTIVE = 500;              // waiting + called + playing tickets
const CREATE_LIMIT = { count: 10, perMs: 60_000 }; // tickets per IP per minute
const CHECKIN_LIMIT = { count: 30, perMs: 60_000 }; // check-in attempts per IP per minute
const STATUSES = ['waiting', 'called', 'playing', 'done', 'noshow', 'cancelled'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

// ---------- queue store ----------
// store name → module exporting openStore(options). Add new databases here (server/README.md).
const STORES = {
  json: () => import('./store-json.mjs'),
  mariadb: () => import('./store-mariadb.mjs'),
};
const STORE_NAME = process.env.QUEUE_STORE || 'json';
if (!STORES[STORE_NAME]) {
  console.error(`Unknown QUEUE_STORE "${STORE_NAME}" (known: ${Object.keys(STORES).join(', ')})`);
  process.exit(1);
}
let store;
try {
  store = await (await STORES[STORE_NAME]()).openStore({ dataDir: DATA_DIR, url: process.env.MARIADB_URL });
} catch (err) {
  console.error(`Can't open the "${STORE_NAME}" queue store: ${err.message}`);
  process.exit(1);
}

// ---------- secrets: NFC tag keys + Firebase service account (never inside the project folder) ----------
const SECRETS_DIR = path.resolve(process.env.SPACELINE_SECRETS || path.join(os.homedir(), 'spaceline-secrets'));
if (norm(SECRETS_DIR + path.sep).startsWith(norm(ROOT + path.sep))) {
  console.error(`The secrets folder ${SECRETS_DIR} is inside the project folder. Move it outside (docs/nfc-checkin.md).`);
  process.exit(1);
}
function readSecret(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SECRETS_DIR, name), 'utf8')); } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`${name} in ${SECRETS_DIR} is unreadable: ${err.message}`);
    return null;
  }
}
const hex32 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{32}$/.test(s);
let SDM_KEYS = readSecret('sdm-keys.json'); // { metaReadKey, fileReadKey }: the AES keys set on the NTAG 424 DNA tags
if (SDM_KEYS && !(hex32(SDM_KEYS.metaReadKey) && hex32(SDM_KEYS.fileReadKey))) {
  console.warn('sdm-keys.json needs metaReadKey and fileReadKey, 32 hex characters each. NFC check-in is off.');
  SDM_KEYS = null;
}

// ---------- the built pages and their environment (npm run build / build:dev) ----------
const DIST = path.resolve(ROOT, process.env.SPACELINE_DIST || 'dist');
let build;
try { build = JSON.parse(fs.readFileSync(path.join(DIST, 'build.json'), 'utf8')); } catch {
  console.error(`No build in ${DIST}. Run "npm run build" first (or "npm run build:dev" for the dev environment).`);
  process.exit(1);
}
const { ENVIRONMENTS } = await import(pathToFileURL(path.join(ROOT, 'shared/queue/config.js')).href);
const ENVIRONMENT = build.environment;
const ENV = ENVIRONMENTS[ENVIRONMENT];

// In the Firebase (product) environment, phones send check-in requests to Firestore and this PC answers them.
let checkinStatus = SDM_KEYS ? 'on (local queue API)' : 'off: no sdm-keys.json in the secrets folder';
if (ENV && ENV.backend === 'firebase') {
  const sa = readSecret('firebase-service-account.json');
  if (!SDM_KEYS) checkinStatus = 'off: no sdm-keys.json in the secrets folder';
  else if (!sa) checkinStatus = 'off: no firebase-service-account.json in the secrets folder';
  else if (sa.project_id !== ENV.firebase.projectId) checkinStatus = `off: the service account is for "${sa.project_id}", not "${ENV.firebase.projectId}"`;
  else {
    try {
      const { startFirestoreCheckin } = await import('./checkin-firestore.mjs');
      await startFirestoreCheckin({ serviceAccount: sa, keys: SDM_KEYS, log: (m) => console.log(`[NFC] ${m}`) });
      checkinStatus = `on (answering Firestore check-ins for ${sa.project_id})`;
    } catch (err) {
      checkinStatus = `off: ${err.message}`;
    }
  }
}
// Same rules as js/queue/nickname.js (the server has the final say).
// control, zero-width, bidi-override and BOM characters, built from code points
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');
function cleanNickname(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, 12).join('');
}

// what browsers may see of a ticket: everything except the owner secret's hash
const pub = (t) => {
  if (!t) return t;
  const { ownerHash, ...rest } = t;
  return { checkedInAt: null, ...rest };
};
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function queueState() {
  const active = (await store.active()).map(pub); // waiting / called / playing, ascending number
  return {
    serving: active.find((t) => t.status !== 'waiting') || null,
    waiting: active.filter((t) => t.status === 'waiting'),
    updatedAt: Date.now(),
  };
}

// ---------- server-sent events ----------
const clients = new Set();

// fire-and-forget after each change; a store error here must not crash the server
async function broadcast(changed = []) {
  try {
    const msg = `event: state\ndata: ${JSON.stringify({ queue: await queueState(), changed: changed.map(pub) })}\n\n`;
    for (const res of clients) res.write(msg);
  } catch (err) {
    console.error('broadcast failed:', err.message);
  }
}

setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20_000).unref();

// ---------- helpers ----------
function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { req.destroy(); return; } // absurd: just drop the connection
      if (size <= MAX_BODY) chunks.push(c);           // otherwise drain it so we can still answer 413
    });
    req.on('end', () => {
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { code: 413 })); return; }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('invalid JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

function isOperator(req) {
  if (!OPERATOR_KEY) return true; // prototype default: open
  const given = Buffer.from(String(req.headers['x-operator-key'] || ''));
  const want = Buffer.from(OPERATOR_KEY);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// at most limit.count calls per address in limit.perMs
function rateLimiter(limit) {
  const recent = new Map(); // ip -> [timestamps]
  return (ip) => {
    const now = Date.now();
    const list = (recent.get(ip) || []).filter((t) => now - t < limit.perMs);
    if (list.length >= limit.count) { recent.set(ip, list); return false; }
    list.push(now);
    recent.set(ip, list);
    return true;
  };
}
const allowCreate = rateLimiter(CREATE_LIMIT);
const allowCheckin = rateLimiter(CHECKIN_LIMIT);

// IPv4 LAN addresses, real adapters (Wi-Fi / Ethernet) before virtual ones (WSL, Hyper-V, VirtualBox…).
function lanInterfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  const virtual = (n) => /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|Loopback|Bluetooth/i.test(n);
  return out.sort((a, b) => virtual(a.name) - virtual(b.name));
}
const lanAddresses = () => lanInterfaces().map((i) => i.address);

function registerUrl() {
  if (process.env.REGISTER_URL) return process.env.REGISTER_URL;
  const lan = HOST === '0.0.0.0' ? lanAddresses()[0] : null;
  return `http://${lan || (HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST)}:${PORT}/register/`;
}

// ---------- API ----------
async function api(req, res, rel) {
  const m = req.method;
  if (rel === '/api/info' && m === 'GET') {
    return send(res, 200, { mode: 'local', store: store.name, registerUrl: registerUrl(), operatorKeyRequired: !!OPERATOR_KEY, checkin: !!SDM_KEYS });
  }
  if (rel === '/api/tickets' && m === 'GET') { // every ticket, for the operator page's records / CSV
    if (!isOperator(req)) return send(res, 401, { error: 'operator key required' });
    return send(res, 200, (await store.list()).map(pub));
  }
  if (rel === '/api/queue' && m === 'GET') return send(res, 200, await queueState());
  if (rel === '/api/events' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify({ queue: await queueState(), changed: [] })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (rel === '/api/tickets' && m === 'POST') {
    const body = await readJson(req);
    const nickname = cleanNickname(body.nickname);
    if (!nickname) return send(res, 400, { error: 'nickname required (1-12 characters)' });
    if (!allowCreate(req.socket.remoteAddress)) return send(res, 429, { error: 'too many registrations, try again in a minute' });
    if ((await queueState()).waiting.length >= MAX_ACTIVE) return send(res, 503, { error: 'queue is full' });
    // the owner token proves later (at NFC check-in) that a request comes from the phone that registered
    const ownerToken = crypto.randomBytes(18).toString('base64url');
    const t = await store.create({ id: crypto.randomBytes(9).toString('base64url'), nickname, ownerHash: sha256(ownerToken), now: Date.now() });
    broadcast([t]);
    return send(res, 201, { ...pub(t), ownerToken });
  }
  let mm = rel.match(/^\/api\/tickets\/([\w-]{1,40})$/);
  if (mm && m === 'GET') {
    const t = await store.get(mm[1]);
    return t ? send(res, 200, pub(t)) : send(res, 404, { error: 'ticket not found' });
  }
  if (rel === '/api/call-next' && m === 'POST') {
    if (!isOperator(req)) return send(res, 401, { error: 'operator key required' });
    const t = await store.callNext(Date.now());
    if (t) broadcast([t]);
    return send(res, 200, pub(t));
  }
  mm = rel.match(/^\/api\/tickets\/([\w-]{1,40})\/checkin$/);
  if (mm && m === 'POST') {
    // { picc, cmac, ownerToken } from the phone after an NFC tap, or { manual: true } from staff
    const body = await readJson(req);
    const now = Date.now();
    let r;
    if (body.manual === true) {
      if (!isOperator(req)) return send(res, 401, { error: 'operator key required' });
      r = await store.checkIn({ id: mm[1], manual: true, now });
    } else {
      if (!allowCheckin(req.socket.remoteAddress)) return send(res, 429, { error: 'too many check-in attempts, try again in a minute' });
      if (!SDM_KEYS) return send(res, 200, { status: 'rejected', reason: 'not-configured', ticket: null });
      const sun = verifySun({ picc: body.picc, cmac: body.cmac }, SDM_KEYS);
      if (!sun.ok) return send(res, 200, { status: 'rejected', reason: sun.reason, ticket: null });
      r = await store.checkIn({ id: mm[1], ownerHash: sha256(body.ownerToken || ''), tagUid: sun.uid, counter: sun.counter, now });
    }
    if (r.status !== 'rejected') broadcast([r.ticket]);
    return send(res, 200, { status: r.status, reason: r.reason || null, ticket: r.status === 'rejected' ? null : pub(r.ticket) });
  }
  mm = rel.match(/^\/api\/tickets\/([\w-]{1,40})\/cancel$/);
  if (mm && m === 'POST') {
    // { ownerToken }: a visitor withdrawing their own ticket (staff cancel with /status)
    if (!allowCheckin(req.socket.remoteAddress)) return send(res, 429, { error: 'too many attempts, try again in a minute' });
    const body = await readJson(req);
    const r = await store.cancel({ id: mm[1], ownerHash: sha256(body.ownerToken || ''), now: Date.now() });
    if (r.status === 'cancelled') broadcast([r.ticket]);
    return send(res, 200, { status: r.status, reason: r.reason || null, ticket: r.status === 'cancelled' ? pub(r.ticket) : null });
  }
  mm = rel.match(/^\/api\/tickets\/([\w-]{1,40})\/status$/);
  if (mm && m === 'POST') {
    if (!isOperator(req)) return send(res, 401, { error: 'operator key required' });
    const body = await readJson(req);
    if (!STATUSES.includes(body.status)) return send(res, 400, { error: `status must be one of ${STATUSES.join(', ')}` });
    const t = await store.setStatus(mm[1], body.status, Date.now());
    if (t) broadcast([t]);
    return t ? send(res, 200, pub(t)) : send(res, 404, { error: 'ticket not found' });
  }
  return send(res, 404, { error: 'unknown API' });
}

// ---------- static files ----------
// URL prefix → folder of the build. Only these are served (first match wins, so keep '/' last). The phone page
// has the same URL here as on Firebase Hosting, so it works unchanged in both places.
const MOUNTS = [
  ['/register/', 'hosting/register'],   // phone registration page (the same files Firebase Hosting publishes)
  ['/', 'reception'],                   // booth (/), operator page, contract test page (/tools/), MediaPipe, model
].map(([prefix, dir]) => [prefix, path.join(DIST, dir)]);

function serveStatic(req, res, rel) {
  if (MOUNTS.some(([prefix]) => prefix === rel + '/')) { res.writeHead(301, { Location: rel + '/' }).end(); return; } // /register → /register/
  if (rel.endsWith('/')) rel += 'index.html';
  // Windows ignores trailing dots/spaces and has ":stream" names; refuse them so tricks like /register./ can't alias folders
  if (rel.split('/').some((s) => s && (/[. ]$/.test(s) || s.includes(':') || s.includes('\\')))) { res.writeHead(403).end(); return; }
  const [prefix, dir] = MOUNTS.find(([p]) => rel.startsWith(p));
  const file = path.join(dir, rel.slice(prefix.length));
  const f = norm(file), data = norm(DATA_DIR);
  if (!f.startsWith(norm(dir) + path.sep) || f === data || f.startsWith(data + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: rel + '/' }).end(); return; }
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (!rel.startsWith('/api/')) { serveStatic(req, res, rel); return; }
  try {
    await api(req, res, rel);
  } catch (err) {
    if (!res.headersSent) send(res, err.code === 400 || err.code === 413 ? err.code : 500, { error: err.code ? err.message : 'server error' });
    if (!err.code) console.error(err);
  }
}).listen(PORT, HOST, () => {
  console.log(`SPACE LINE → http://localhost:${PORT}   (environment: ${ENVIRONMENT}, queue store: ${store.name})`);
  console.log(`NFC check-in       → ${checkinStatus}`);
  console.log(`Operator           → http://localhost:${PORT}/operator.html`);
  if (HOST === '0.0.0.0') {
    for (const { name, address } of lanInterfaces()) console.log(`Registration (LAN) → http://${address}:${PORT}/register/  [${name}]`);
    console.log(`QR code uses       → ${registerUrl()}  (set REGISTER_URL to pick another)`);
  } else {
    console.log(`Registration       → http://localhost:${PORT}/register/  (this PC only; use npm run start:lan for phones)`);
  }
  if (!OPERATOR_KEY) console.log('Note: OPERATOR_KEY is not set, so anyone who can reach this server can call / complete tickets.');
});
