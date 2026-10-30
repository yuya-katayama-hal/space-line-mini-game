// The rules for accepting an NFC check-in, shared by every queue store and by the Firestore checker,
// so the decision is the same whichever database holds the tickets.
//
// A tap is accepted only if
//   - the signature on the tag's URL is valid (checked before this, with verifySun in sdm.ts),
//   - it comes from the phone that created the ticket (ownerMatches),
//   - the ticket isn't finished or cancelled, and
//   - its tap counter is higher than the last one accepted from that tag, so a URL saved from an earlier tap
//     stops working as soon as any later tap has been used.
// Staff can check a visitor in by hand (manual), which skips the tag checks.
import type { RejectReason, Status } from '../shared/queue/types.ts';

// why a check-in was refused, as shown to the visitor / staff
export const REJECT_REASONS: readonly RejectReason[] = ['malformed', 'bad-picc', 'bad-signature', 'not-configured', 'no-ticket', 'not-owner', 'closed', 'replayed'];

// the parts of a ticket the rules look at (a stored ticket, or a Firestore document)
interface TicketLike {
  status: Status;
  checkedInAt?: number | null;
}

export interface CheckinDecision {
  status: 'accepted' | 'already' | 'rejected';
  reason?: RejectReason;
  lastCounter?: number; // new value to store for the tag
}

export function decideCheckIn({ ticket, manual = false, ownerMatches = false, counter = -1, lastCounter = -1 }: {
  ticket: TicketLike | null; manual?: boolean; ownerMatches?: boolean; counter?: number; lastCounter?: number;
}): CheckinDecision {
  if (!ticket) return { status: 'rejected', reason: 'no-ticket' };
  if (!manual && !ownerMatches) return { status: 'rejected', reason: 'not-owner' };
  if (ticket.status === 'done' || ticket.status === 'cancelled') return { status: 'rejected', reason: 'closed' };
  if (!manual && !(counter > lastCounter)) return { status: 'rejected', reason: 'replayed' };
  return { status: ticket.checkedInAt ? 'already' : 'accepted', ...(manual ? {} : { lastCounter: counter }) };
}

// A visitor may cancel their own ticket while it is still waiting or called (not once their turn has started).
// Staff cancel through setStatus.
export const CANCELLABLE: readonly Status[] = ['waiting', 'called'];

export interface CancelDecision {
  status: 'cancelled' | 'rejected';
  reason?: RejectReason;
}

export function decideCancel({ ticket, ownerMatches = false }: { ticket: TicketLike | null; ownerMatches?: boolean }): CancelDecision {
  if (!ticket) return { status: 'rejected', reason: 'no-ticket' };
  if (!ownerMatches) return { status: 'rejected', reason: 'not-owner' };
  if (!CANCELLABLE.includes(ticket.status)) return { status: 'rejected', reason: 'closed' };
  return { status: 'cancelled' };
}
