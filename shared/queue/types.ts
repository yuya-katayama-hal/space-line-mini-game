// The shapes every queue backend, the server and the pages agree on. See docs/queue-backends.md.

export type Status = 'waiting' | 'called' | 'playing' | 'done' | 'noshow' | 'cancelled';

export type ErrorCode = 'unauthenticated' | 'forbidden' | 'rate-limited' | 'invalid' | 'not-found' | 'unavailable';

// times are ms since 1970
export interface Ticket {
  id: string;
  number: number;
  nickname: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  checkedInAt: number | null;
}

// a newly created ticket on the local backend also carries the secret that proves its owner at check-in
export interface NewTicket extends Ticket {
  ownerToken?: string;
}

export interface QueueState {
  serving: Ticket | null;  // the called / playing visitor
  waiting: Ticket[];       // ascending number
  updatedAt: number;
}

// why a check-in or cancel was refused
export type RejectReason = 'malformed' | 'bad-picc' | 'bad-signature' | 'not-configured' | 'no-ticket' | 'not-owner' | 'closed' | 'replayed';

export interface CheckinResult {
  status: 'accepted' | 'already' | 'rejected' | 'pending'; // pending: the reception PC hasn't answered (yet)
  reason: RejectReason | null;
  ticket: Ticket | null;
}

export interface CancelResult {
  status: 'cancelled' | 'rejected';
  reason: RejectReason | null;
  ticket: Ticket | null;
}

export interface TapParams {
  picc: string;
  cmac: string;
  ownerToken?: string;
}

export type StaffProvider = 'google' | 'password';

export interface SignInOptions {
  provider?: StaffProvider;
  email?: string;
  password?: string;
}

// staff sign-in: 'none' (open server), 'key' (the server's OPERATOR_KEY), 'account' (Firebase accounts)
export interface QueueAuth {
  method: 'none' | 'key' | 'account';
  providers: StaffProvider[];
  readonly required: boolean;
  readonly user: string | null;
  readonly verified: boolean;
  // the operator key (key) or sign-in options (account)
  signIn(arg?: string | SignInOptions): Promise<void>;
  signOut(): Promise<void>;
  sendVerification?(): Promise<void>;
  refresh?(): Promise<void>;
  resetPassword?(email: string): Promise<void>;
}

export type Unsubscribe = () => void;

export interface QueueClient {
  environment: string;
  backend: string;
  registerUrl: string | null;
  storage: string | null;
  auth: QueueAuth;
  createTicket(nickname: string): Promise<NewTicket>;
  getTicket(id: string): Promise<Ticket | null>;
  watchTicket(id: string, cb: (ticket: Ticket | null) => void): Unsubscribe;
  watchQueue(cb: (queue: QueueState) => void): Unsubscribe;
  callNext(): Promise<Ticket | null>;
  setStatus(id: string, status: Status): Promise<Ticket | null>;
  checkIn(id: string, tap: TapParams): Promise<CheckinResult>;
  checkInManual(id: string): Promise<CheckinResult>;
  listTickets(): Promise<Ticket[]>;
  cancelTicket(id: string, opts?: { ownerToken?: string }): Promise<CancelResult>;
  close(): void;
}

// what an adapter's connect() returns; connectQueue() adds environment and backend
export type QueueConnection = Omit<QueueClient, 'environment' | 'backend'>;

export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

// one environment in config.ts
export interface EnvSettings {
  backend: string;
  registerUrl: string | null;
  firebase?: FirebaseSettings;
  staffSignIn?: StaffProvider[];
}

export interface ConnectOptions {
  timeoutMs: number;
  baseUrl?: string;
  operatorKey?: string;
  settings: EnvSettings;
}
