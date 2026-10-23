// Registration queue client. Pages and the booth only ever use this file; which database sits behind it
// comes from the environment set in config.js (ENVIRONMENT → ENVIRONMENTS[…].backend), and nothing else.
// The full interface and how to add a backend: docs/queue-backends.md.
//
//   const q = await connectQueue();          // rejects within ~4 s if the backend can't be reached
//   q.environment / q.backend                // e.g. 'product' / 'firebase'
//   q.registerUrl                            // phone registration page (for the QR code), or null
//   q.auth                                   // staff sign-in: { method, required, user, signIn(secret?) }
//   q.createTicket(nickname) → Ticket        q.getTicket(id) → Ticket | null
//   q.watchTicket(id, cb) → unsubscribe      q.watchQueue(cb) → unsubscribe
//   q.callNext() → Ticket | null             q.setStatus(id, status) → Ticket
//   q.close()
//   Errors are QueueError { code }: see common.js.
import { ENVIRONMENT, ENV } from './config.js';

export { STATUSES, ERROR_CODES, QueueError, sortQueue, aheadOf } from './common.js';
import { QueueError } from './common.js';

// backend name → loader of its connect(opts) function. Add new databases here.
export const ADAPTERS = {
  local: () => import('./local.js').then((m) => m.connect),
  firebase: () => import('./firebase.js').then((m) => m.connect),
};

// opts: { timeoutMs = 4000, baseUrl (local backend: server address, default this page's origin) }
export async function connectQueue(opts = {}) {
  if (!ENV) throw new QueueError('invalid', `unknown environment "${ENVIRONMENT}" in js/queue/config.js`);
  const backend = ENV.backend;
  if (!ADAPTERS[backend]) throw new QueueError('invalid', `environment "${ENVIRONMENT}" uses unknown backend "${backend}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
  const timeoutMs = opts.timeoutMs ?? 4000;
  const connect = await ADAPTERS[backend]();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new QueueError('unavailable', `queue unreachable (no answer in ${timeoutMs} ms)`)), timeoutMs);
  });
  const pending = connect({ timeoutMs, baseUrl: opts.baseUrl, settings: ENV });
  try {
    const q = await Promise.race([pending, timeout]);
    q.environment = ENVIRONMENT;
    q.backend = backend;
    return q;
  } catch (err) {
    pending.then((q) => q.close(), () => {}); // if it connects after we gave up, don't leave it open
    throw err instanceof QueueError ? err : new QueueError('unavailable', err.message, err);
  } finally {
    clearTimeout(timer);
  }
}
