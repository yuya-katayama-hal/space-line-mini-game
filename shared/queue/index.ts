// Registration queue client. Pages and the booth only ever use this file; which database sits behind it
// comes from the environment set in config.ts (ENVIRONMENT → ENVIRONMENTS[…].backend), and nothing else.
// The full interface and how to add a backend: docs/queue-backends.md. The types are in types.ts.
//
//   const q = await connectQueue();          // rejects within ~4 s if the backend can't be reached
//   q.environment / q.backend                // e.g. 'product' / 'firebase'
//   q.registerUrl                            // phone registration page (for the QR code), or null
//   q.auth                                   // staff sign-in: { method, required, user, signIn(secret?) }
//   q.createTicket(nickname) → Ticket        q.getTicket(id) → Ticket | null
//   q.watchTicket(id, cb) → unsubscribe      q.watchQueue(cb) → unsubscribe
//   q.callNext() → Ticket | null             q.setStatus(id, status) → Ticket
//   q.close()
//   Errors are QueueError { code }: see common.ts.
import { ENVIRONMENT, ENV } from './config.ts';
import { QueueError, errorMessage } from './common.ts';
import type { ConnectOptions, QueueClient, QueueConnection } from './types.ts';

export { STATUSES, ERROR_CODES, QueueError, sortQueue, aheadOf } from './common.ts';
export type * from './types.ts';

type Connect = (opts: ConnectOptions) => Promise<QueueConnection>;

// backend name → loader of its connect(opts) function. Add new databases here.
export const ADAPTERS: Record<string, () => Promise<Connect>> = {
  local: () => import('./local.ts').then((m) => m.connect),
  firebase: () => import('./firebase.ts').then((m) => m.connect),
};

// opts: { timeoutMs = 4000, baseUrl (local backend: server address, default this page's origin) }
export async function connectQueue(opts: { timeoutMs?: number; baseUrl?: string } = {}): Promise<QueueClient> {
  if (!ENV) throw new QueueError('invalid', `unknown environment "${ENVIRONMENT}" in shared/queue/config.ts`);
  const backend = ENV.backend;
  const load = ADAPTERS[backend];
  if (!load) throw new QueueError('invalid', `environment "${ENVIRONMENT}" uses unknown backend "${backend}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
  const timeoutMs = opts.timeoutMs ?? 4000;
  const connect = await load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueError('unavailable', `queue unreachable (no answer in ${timeoutMs} ms)`)), timeoutMs);
  });
  const pending = connect({ timeoutMs, baseUrl: opts.baseUrl, settings: ENV });
  try {
    const q = await Promise.race([pending, timeout]);
    return Object.assign(q, { environment: ENVIRONMENT, backend });
  } catch (err) {
    pending.then((q) => q.close(), () => {}); // if it connects after we gave up, don't leave it open
    throw err instanceof QueueError ? err : new QueueError('unavailable', errorMessage(err), err);
  } finally {
    clearTimeout(timer);
  }
}
