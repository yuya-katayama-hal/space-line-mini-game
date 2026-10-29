// The interface every queue store implements (server/README.md). Methods return the stored ticket including
// ownerHash; server.ts strips it before anything reaches a browser.
import type { RejectReason, Status, Ticket } from '../shared/queue/types.ts';

export interface StoredTicket extends Ticket {
  ownerHash: string | null; // sha256 of the owner token handed to the phone that registered
}

export interface CheckinInput {
  id: string;
  manual?: boolean;
  ownerHash?: string | null;
  tagUid?: string | null;
  counter?: number;
  now: number;
}

export interface StoreResult<S extends string> {
  status: S;
  reason?: RejectReason;
  ticket: StoredTicket | null;
}

export interface Store {
  name: string;
  active(): Promise<StoredTicket[]>; // waiting / called / playing, ascending number
  list(): Promise<StoredTicket[]>;   // every ticket, ascending number
  get(id: string): Promise<StoredTicket | null>;
  create(t: { id: string; nickname: string; ownerHash?: string | null; now: number }): Promise<StoredTicket>;
  setStatus(id: string, status: Status, now: number): Promise<StoredTicket | null>;
  callNext(now: number): Promise<StoredTicket | null>;
  checkIn(input: CheckinInput): Promise<StoreResult<'accepted' | 'already' | 'rejected'>>;
  cancel(input: { id: string; ownerHash?: string | null; now: number }): Promise<StoreResult<'cancelled' | 'rejected'>>;
  close(): Promise<void>;
}

export interface StoreOptions {
  dataDir: string;      // json store
  url?: string;         // mariadb store: MARIADB_URL
}

export type OpenStore = (opts: StoreOptions) => Promise<Store>;
