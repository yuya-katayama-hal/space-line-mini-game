// Local queue backend: talks to server/server.mjs (/api/ + server-sent events). Works offline on one PC or over the venue Wi-Fi.
import { cleanNickname } from './nickname.js';
import { QueueError } from './common.js';

// server answers → generic error codes (see common.js)
const HTTP_CODES = { 400: 'invalid', 401: 'unauthenticated', 403: 'forbidden', 404: 'not-found', 413: 'invalid', 429: 'rate-limited' };

// opts.settings: this environment's entry in config.js ENVIRONMENTS ({ registerUrl })
export async function connect(opts = {}) {
  const base = (opts.baseUrl || location.origin).replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (opts.operatorKey) headers['x-operator-key'] = opts.operatorKey;

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (err) {
      throw new QueueError('unavailable', `queue server unreachable: ${err.message}`, err);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new QueueError(HTTP_CODES[res.status] || 'unavailable', (data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  // the first request doubles as the connection check (connectQueue adds the overall timeout)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  let info;
  try {
    const res = await fetch(`${base}/api/info`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`queue server answered HTTP ${res.status}`);
    info = await res.json();
  } finally {
    clearTimeout(t);
  }

  // one event stream shared by every watcher
  let queue = null;
  const queueWatchers = new Set();
  const ticketWatchers = new Map(); // id -> Set(cb)
  let es = null, closed = false;

  function emitTicket(ticket) {
    for (const cb of ticketWatchers.get(ticket.id) || []) cb(ticket);
  }
  function openStream() {
    if (es || closed) return;
    es = new EventSource(`${base}/api/events`);
    let dropped = false;
    es.addEventListener('state', (e) => {
      const msg = JSON.parse(e.data);
      queue = msg.queue;
      for (const cb of queueWatchers) cb(queue);
      for (const t of msg.changed) emitTicket(t);
      if (dropped) { // after a reconnect, re-read watched tickets in case we missed a change
        dropped = false;
        for (const id of ticketWatchers.keys()) api.getTicket(id).then((tk) => { for (const cb of ticketWatchers.get(id) || []) cb(tk); }, () => {});
      }
    });
    es.onerror = () => { dropped = true; }; // EventSource reconnects by itself (server sends retry: 2000)
  }

  const api = {
    registerUrl: (opts.settings && opts.settings.registerUrl) || info.registerUrl || null,
    storage: info.store || null, // where server.mjs keeps the tickets (QUEUE_STORE): 'json', 'mariadb', …
    // staff prove themselves with the server's OPERATOR_KEY, if it has one
    auth: {
      method: info.operatorKeyRequired ? 'key' : 'none',
      get required() { return this.method === 'key' && !headers['x-operator-key']; },
      get user() { return null; },
      providers: [],
      verified: true,
      async signIn(key) { if (key) headers['x-operator-key'] = key; else delete headers['x-operator-key']; },
      async signOut() { delete headers['x-operator-key']; },
    },

    async createTicket(nickname) {
      const name = cleanNickname(nickname);
      if (!name) throw new QueueError('invalid', 'nickname required');
      return call('POST', '/api/tickets', { nickname: name });
    },
    async getTicket(id) {
      try { return await call('GET', `/api/tickets/${encodeURIComponent(id)}`); } catch (err) {
        if (err.code === 'not-found') return null;
        throw err;
      }
    },
    watchTicket(id, cb) {
      if (!ticketWatchers.has(id)) ticketWatchers.set(id, new Set());
      ticketWatchers.get(id).add(cb);
      openStream();
      api.getTicket(id).then(cb, () => {});
      return () => {
        const set = ticketWatchers.get(id);
        if (set) { set.delete(cb); if (!set.size) ticketWatchers.delete(id); }
      };
    },
    watchQueue(cb) {
      queueWatchers.add(cb);
      openStream();
      if (queue) cb(queue);
      else call('GET', '/api/queue').then((q) => { if (!queue) { queue = q; } cb(queue); }, () => {});
      return () => queueWatchers.delete(cb);
    },
    callNext() { return call('POST', '/api/call-next'); },
    setStatus(id, status) { return call('POST', `/api/tickets/${encodeURIComponent(id)}/status`, { status }); },
    // NFC check-in: the server checks the tag signature and answers right away
    checkIn(id, { picc, cmac, ownerToken }) {
      return call('POST', `/api/tickets/${encodeURIComponent(id)}/checkin`, { picc, cmac, ownerToken });
    },
    checkInManual(id) { return call('POST', `/api/tickets/${encodeURIComponent(id)}/checkin`, { manual: true }); },
    listTickets() { return call('GET', '/api/tickets'); },
    close() {
      closed = true;
      if (es) es.close();
      es = null;
      queueWatchers.clear();
      ticketWatchers.clear();
    },
  };
  return api;
}
