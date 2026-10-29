// Pieces shared by every backend adapter and the pages. Adapters import from here (not from index.ts),
// so there is no import cycle between index.ts and the adapters it loads.
import type { ErrorCode, QueueState, Status, Ticket } from './types.ts';

// cancelled: the visitor (or staff) withdrew the ticket before their turn
export const STATUSES: readonly Status[] = ['waiting', 'called', 'playing', 'done', 'noshow', 'cancelled'];

// Errors from any backend reach the pages as a QueueError with one of these codes, so pages never
// need to know about HTTP status numbers or a database's own error names.
export const ERROR_CODES: readonly ErrorCode[] = [
  'unauthenticated', // staff action without signing in / without the operator key
  'forbidden',       // signed in, but this account is not allowed to do it
  'rate-limited',    // too many registrations; try again shortly
  'invalid',         // bad nickname, bad status, malformed request
  'not-found',       // no such ticket
  'unavailable',     // can't reach the backend
];

export class QueueError extends Error {
  code: ErrorCode;
  constructor(code: string, message?: string, cause?: unknown) {
    super(message || code);
    this.name = 'QueueError';
    this.code = isErrorCode(code) ? code : 'unavailable';
    if (cause) this.cause = cause;
  }
}

export const isStatus = (s: unknown): s is Status => STATUSES.includes(s as Status);
const isErrorCode = (s: unknown): s is ErrorCode => ERROR_CODES.includes(s as ErrorCode);

// the message of anything thrown
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function sortQueue(tickets: Ticket[]): QueueState {
  const active = tickets.filter((t) => t.status === 'waiting' || t.status === 'called' || t.status === 'playing');
  active.sort((a, b) => a.number - b.number);
  return {
    serving: active.find((t) => t.status !== 'waiting') || null,
    waiting: active.filter((t) => t.status === 'waiting'),
    updatedAt: Date.now(),
  };
}

// How many waiting tickets are in front of this one.
export function aheadOf(ticket: Ticket | null, queue: QueueState): number {
  if (!ticket || ticket.status !== 'waiting') return 0;
  return queue.waiting.filter((t) => t.number < ticket.number).length;
}
