// Pieces shared by every backend adapter and the pages. Adapters import from here (not from index.js),
// so there is no import cycle between index.js and the adapters it loads.

// cancelled: the visitor (or staff) withdrew the ticket before their turn
export const STATUSES = ['waiting', 'called', 'playing', 'done', 'noshow', 'cancelled'];

// Errors from any backend reach the pages as a QueueError with one of these codes, so pages never
// need to know about HTTP status numbers or a database's own error names.
export const ERROR_CODES = [
  'unauthenticated', // staff action without signing in / without the operator key
  'forbidden',       // signed in, but this account is not allowed to do it
  'rate-limited',    // too many registrations; try again shortly
  'invalid',         // bad nickname, bad status, malformed request
  'not-found',       // no such ticket
  'unavailable',     // can't reach the backend
];

export class QueueError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'QueueError';
    this.code = ERROR_CODES.includes(code) ? code : 'unavailable';
    if (cause) this.cause = cause;
  }
}

export function sortQueue(tickets) {
  const active = tickets.filter((t) => t.status === 'waiting' || t.status === 'called' || t.status === 'playing');
  active.sort((a, b) => a.number - b.number);
  return {
    serving: active.find((t) => t.status !== 'waiting') || null,
    waiting: active.filter((t) => t.status === 'waiting'),
    updatedAt: Date.now(),
  };
}

// How many waiting tickets are in front of this one.
export function aheadOf(ticket, queue) {
  if (!ticket || ticket.status !== 'waiting') return 0;
  return queue.waiting.filter((t) => t.number < ticket.number).length;
}
