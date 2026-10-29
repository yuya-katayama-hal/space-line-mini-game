// Local queue backend: talks to server/server.ts (/api/ + server-sent events). Works offline on one PC or over the venue Wi-Fi.
import { cleanNickname } from './nickname.ts';
import { QueueError, errorMessage } from './common.ts';
import type { CancelResult, CheckinResult, ConnectOptions, NewTicket, QueueConnection, QueueState, Status, Ticket, Unsubscribe } from './types.ts';

// server answers → generic error codes (see common.ts)
const HTTP_CODES: Record<number, string> = { 400: 'invalid', 401: 'unauthenticated', 403: 'forbidden', 404: 'not-found', 413: 'invalid', 429: 'rate-limited' };

// what /api/info tells about the server
interface ServerInfo {
  mode: 'local';
  store: string;
  registerUrl: string;
  operatorKeyRequired: boolean;
  checkin: boolean;
}

type TicketWatcher = (ticket: Ticket | null) => void;
type QueueWatcher = (queue: QueueState) => void;

// opts.settings: this environment's entry in config.ts ENVIRONMENTS ({ registerUrl })
export async function connect(opts: Partial<ConnectOptions> = {}): Promise<QueueConnection> {
  const base = (opts.baseUrl || location.origin).replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.operatorKey) headers['x-operator-key'] = opts.operatorKey;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (err) {
      throw new QueueError('unavailable', `queue server unreachable: ${errorMessage(err)}`, err);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new QueueError(HTTP_CODES[res.status] || 'unavailable', (data && data.error) || `HTTP ${res.status}`);
    return data as T;
  }

  // the first request doubles as the connection check (connectQueue adds the overall timeout)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  let info: ServerInfo;
  try {
    const res = await fetch(`${base}/api/info`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`queue server answered HTTP ${res.status}`);
    info = await res.json();
  } finally {
    clearTimeout(t);
  }

  // one event stream shared by every watcher
  let queue: QueueState | null = null;
  const queueWatchers = new Set<QueueWatcher>();
  const ticketWatchers = new Map<string, Set<TicketWatcher>>();
  let es: EventSource | null = null, closed = false;

  function emitTicket(ticket: Ticket) {
    for (const cb of ticketWatchers.get(ticket.id) || []) cb(ticket);
  }
  function openStream() {
    if (es || closed) return;
    es = new EventSource(`${base}/api/events`);
    let dropped = false;
    es.addEventListener('state', (e) => {
      const msg: { queue: QueueState; changed: Ticket[] } = JSON.parse(e.data);
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

  const ticketPath = (id: string, action = '') => `/api/tickets/${encodeURIComponent(id)}${action}`;

  const api: QueueConnection = {
    registerUrl: (opts.settings && opts.settings.registerUrl) || info.registerUrl || null,
    storage: info.store || null, // where server.ts keeps the tickets (QUEUE_STORE): 'json', 'mariadb', …
    // staff prove themselves with the server's OPERATOR_KEY, if it has one
    auth: {
      method: info.operatorKeyRequired ? 'key' : 'none',
      get required() { return this.method === 'key' && !headers['x-operator-key']; },
      get user() { return null; },
      providers: [],
      verified: true,
      async signIn(key) { if (typeof key === 'string' && key) headers['x-operator-key'] = key; else delete headers['x-operator-key']; },
      async signOut() { delete headers['x-operator-key']; },
    },

    async createTicket(nickname) {
      const name = cleanNickname(nickname);
      if (!name) throw new QueueError('invalid', 'nickname required');
      return call<NewTicket>('POST', '/api/tickets', { nickname: name });
    },
    async getTicket(id) {
      try { return await call<Ticket>('GET', ticketPath(id)); } catch (err) {
        if (err instanceof QueueError && err.code === 'not-found') return null;
        throw err;
      }
    },
    watchTicket(id, cb): Unsubscribe {
      let set = ticketWatchers.get(id);
      if (!set) ticketWatchers.set(id, set = new Set());
      set.add(cb);
      openStream();
      api.getTicket(id).then(cb, () => {});
      return () => {
        const s = ticketWatchers.get(id);
        if (s) { s.delete(cb); if (!s.size) ticketWatchers.delete(id); }
      };
    },
    watchQueue(cb): Unsubscribe {
      queueWatchers.add(cb);
      openStream();
      if (queue) cb(queue);
      else call<QueueState>('GET', '/api/queue').then((q) => { if (!queue) { queue = q; } cb(queue); }, () => {});
      return () => { queueWatchers.delete(cb); };
    },
    callNext() { return call<Ticket | null>('POST', '/api/call-next'); },
    setStatus(id: string, status: Status) { return call<Ticket>('POST', ticketPath(id, '/status'), { status }); },
    // NFC check-in: the server checks the tag signature and answers right away
    checkIn(id, { picc, cmac, ownerToken }) {
      return call<CheckinResult>('POST', ticketPath(id, '/checkin'), { picc, cmac, ownerToken });
    },
    checkInManual(id) { return call<CheckinResult>('POST', ticketPath(id, '/checkin'), { manual: true }); },
    listTickets() { return call<Ticket[]>('GET', '/api/tickets'); },
    // a visitor withdraws their own ticket (staff use setStatus(id, 'cancelled'))
    cancelTicket(id, { ownerToken } = {}) { return call<CancelResult>('POST', ticketPath(id, '/cancel'), { ownerToken }); },
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
