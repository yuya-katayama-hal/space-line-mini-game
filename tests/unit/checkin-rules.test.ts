// The shared check-in and cancel rules (server/checkin.ts), used by every store and the Firestore checker.
import { describe, expect, it } from 'vitest';
import { decideCancel, decideCheckIn } from '../../server/checkin.ts';
import type { Status } from '../../shared/queue/types.ts';

const ticket = (status: Status = 'waiting', checkedInAt: number | null = null) => ({ status, checkedInAt });

describe('decideCheckIn', () => {
  it('accepts the owner with a fresh tap and returns the new counter', () => {
    expect(decideCheckIn({ ticket: ticket(), ownerMatches: true, counter: 5, lastCounter: 4 })).toEqual({ status: 'accepted', lastCounter: 5 });
  });
  it('a tap on a tag never used before (lastCounter -1) is fresh', () => {
    expect(decideCheckIn({ ticket: ticket(), ownerMatches: true, counter: 0 }).status).toBe('accepted');
  });
  it('already checked in → already, and the counter still moves on', () => {
    expect(decideCheckIn({ ticket: ticket('called', 123), ownerMatches: true, counter: 9, lastCounter: 3 })).toEqual({ status: 'already', lastCounter: 9 });
  });
  it('no ticket → no-ticket', () => expect(decideCheckIn({ ticket: null, ownerMatches: true, counter: 1 }).reason).toBe('no-ticket'));
  it('another phone → not-owner (checked before the counter, so the tap is not used up)', () => {
    expect(decideCheckIn({ ticket: ticket(), ownerMatches: false, counter: 1, lastCounter: 5 })).toEqual({ status: 'rejected', reason: 'not-owner' });
  });
  it.each(['done', 'cancelled'] as const)('%s ticket → closed', (status) => {
    expect(decideCheckIn({ ticket: ticket(status), ownerMatches: true, counter: 9 }).reason).toBe('closed');
  });
  it.each(['called', 'playing', 'noshow'] as const)('%s ticket can still check in', (status) => {
    expect(decideCheckIn({ ticket: ticket(status), ownerMatches: true, counter: 9 }).status).toBe('accepted');
  });
  it.each([[4, 4], [3, 4]])('counter %i after %i → replayed', (counter, lastCounter) => {
    expect(decideCheckIn({ ticket: ticket(), ownerMatches: true, counter, lastCounter }).reason).toBe('replayed');
  });
  it('manual skips the owner and counter checks and leaves the tag alone', () => {
    expect(decideCheckIn({ ticket: ticket(), manual: true })).toEqual({ status: 'accepted' });
    expect(decideCheckIn({ ticket: ticket('waiting', 1), manual: true })).toEqual({ status: 'already' });
  });
  it('manual still refuses a finished ticket', () => expect(decideCheckIn({ ticket: ticket('done'), manual: true }).reason).toBe('closed'));
});

describe('decideCancel', () => {
  it.each(['waiting', 'called'] as const)('the owner can cancel while %s', (status) => {
    expect(decideCancel({ ticket: ticket(status), ownerMatches: true })).toEqual({ status: 'cancelled' });
  });
  it.each(['playing', 'done', 'noshow', 'cancelled'] as const)('not once %s', (status) => {
    expect(decideCancel({ ticket: ticket(status), ownerMatches: true })).toEqual({ status: 'rejected', reason: 'closed' });
  });
  it('someone else → not-owner', () => expect(decideCancel({ ticket: ticket(), ownerMatches: false }).reason).toBe('not-owner'));
  it('no ticket → no-ticket', () => expect(decideCancel({ ticket: null, ownerMatches: true }).reason).toBe('no-ticket'));
});
