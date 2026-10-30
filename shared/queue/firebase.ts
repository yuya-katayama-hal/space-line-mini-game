// Firebase queue backend (Cloud Firestore). Implements the interface in docs/queue-backends.md.
// Live on project space-line-54818 (see firebase/README-firebase.md).
//
// Data:  tickets/{id}  { number, nickname, status, createdAt, updatedAt }     meta/counter { next }
//        meta/operators { emails: [...] }  (staff allowed to call / complete tickets; edited in the console)
// Visitors sign in anonymously (so the rules can require an auth'd caller to create a ticket).
// Staff and the booth sign in with Google; firebase/firestore.rules checks their email against meta/operators.
import type { DocumentSnapshot } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { cleanNickname } from './nickname.ts';
import { sortQueue, QueueError, isStatus } from './common.ts';
import type { CancelResult, CheckinResult, ConnectOptions, QueueConnection, RejectReason, SignInOptions, StaffProvider, Ticket, Unsubscribe } from './types.ts';

// Firebase error names → generic queue error codes (see common.ts)
const FIREBASE_CODES: Record<string, string> = {
  'unauthenticated': 'unauthenticated', 'popup-closed-by-user': 'unauthenticated', 'cancelled-popup-request': 'unauthenticated',
  // email + password sign-in
  'invalid-credential': 'unauthenticated', 'wrong-password': 'unauthenticated', 'user-not-found': 'unauthenticated',
  'invalid-email': 'invalid', 'missing-password': 'invalid', 'user-disabled': 'forbidden',
  'too-many-requests': 'rate-limited', 'operation-not-allowed': 'invalid', // provider not enabled in the console
  'not-found': 'not-found', 'invalid-argument': 'invalid', 'failed-precondition': 'invalid', 'resource-exhausted': 'rate-limited',
  'unavailable': 'unavailable', 'deadline-exceeded': 'unavailable', 'network-request-failed': 'unavailable',
};

// a check-in request as the reception PC answers it (server/checkin-firestore.ts)
interface CheckinAnswer {
  status: 'pending' | 'accepted' | 'already' | 'rejected';
  reason?: RejectReason | null;
}
type CheckinRequest = { ticketId: string } & ({ picc: string; cmac: string; owner: string } | { manual: true; requestedBy: string | null });

// opts.settings: this environment's entry in config.ts ENVIRONMENTS ({ firebase, registerUrl })
export async function connect(opts: ConnectOptions): Promise<QueueConnection> {
  const { firebase: firebaseConfig, registerUrl } = opts.settings;
  if (!firebaseConfig) throw new QueueError('invalid', 'this environment has no Firebase settings');
  const staffProviders = (opts.settings.staffSignIn || ['google']).filter((p): p is StaffProvider => p === 'google' || p === 'password');
  const [{ initializeApp, getApps }, fs, au] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/auth'),
  ]);
  const app = getApps()[0] || initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const fbAuth = au.getAuth(app);
  await fbAuth.authStateReady();

  const ticketsCol = fs.collection(db, 'tickets');
  const counterRef = fs.doc(db, 'meta', 'counter');
  // the owner (an anonymous sign-in id) stays out of what the pages see
  const toTicket = (snap: DocumentSnapshot): Ticket | null => {
    if (!snap.exists()) return null;
    const { owner, ...data } = snap.data();
    return { checkedInAt: null, id: snap.id, ...data } as Ticket;
  };
  // for queries, whose documents always exist
  const mustTicket = (snap: DocumentSnapshot): Ticket => toTicket(snap)!;
  const checkinsCol = fs.collection(db, 'checkins');
  async function submitCheckin(fields: CheckinRequest, waitMs = 15_000): Promise<CheckinResult> {
    const ref = await fs.addDoc(checkinsCol, { ...fields, status: 'pending', createdAt: Date.now() });
    const answer = await new Promise<CheckinAnswer | null>((resolve) => {
      let stop: Unsubscribe = () => {};
      const timer = setTimeout(() => { stop(); resolve(null); }, waitMs);
      stop = fs.onSnapshot(ref, (s) => {
        const d = s.data() as CheckinAnswer | undefined;
        if (d && d.status !== 'pending') { clearTimeout(timer); stop(); resolve(d); }
      }, () => { clearTimeout(timer); resolve(null); });
    });
    if (!answer || answer.status === 'pending') return { status: 'pending', reason: null, ticket: null }; // the reception PC hasn't answered (yet)
    const ticket = answer.status === 'rejected' ? null : toTicket(await fs.getDoc(fs.doc(ticketsCol, fields.ticketId)));
    return { status: answer.status, reason: answer.reason || null, ticket };
  }
  const activeQuery = fs.query(ticketsCol, fs.where('status', 'in', ['waiting', 'called', 'playing']));
  const unsubs = new Set<Unsubscribe>();
  const track = (unsub: Unsubscribe): Unsubscribe => { unsubs.add(unsub); return () => { unsub(); unsubs.delete(unsub); }; };
  // the signed-in staff account (not an anonymous visitor), or null
  const staff = (): User | null => { const u = fbAuth.currentUser; return u && !u.isAnonymous ? u : null; };
  const isStaff = () => !!staff();

  function toQueueError(err: unknown): QueueError {
    if (err instanceof QueueError) return err;
    const e = err as { code?: string; message?: string } | null;
    const name = String((e && e.code) || '').replace(/^(firestore|auth)\//, '');
    // the rules said no: either nobody is signed in as staff, or this account isn't in meta/operators
    const code = name === 'permission-denied' ? (isStaff() ? 'forbidden' : 'unauthenticated') : FIREBASE_CODES[name] || 'unavailable';
    return new QueueError(code, e?.message, err);
  }
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    try { return await fn(...args); } catch (err) { throw toQueueError(err); }
  };

  // the visitor's anonymous sign-in id (signing in first if needed)
  async function visitorUid(): Promise<string> {
    if (!fbAuth.currentUser) await au.signInAnonymously(fbAuth);
    return fbAuth.currentUser!.uid;
  }
  function requireStaff(): User {
    const u = staff();
    if (!u) throw new QueueError('unauthenticated', 'staff sign-in required');
    if (!u.emailVerified) throw new QueueError('unauthenticated', 'email address not verified yet');
    return u;
  }

  return {
    registerUrl: registerUrl || `https://${firebaseConfig.projectId}.web.app/register/`,
    storage: 'firestore',
    // Staff sign in with Google or email + password (settings.staffSignIn). The rules accept only a verified
    // email listed in meta/operators: anyone can create an email + password account, but not verify someone
    // else's address, so an unverified account is treated as not signed in (auth.required stays true).
    auth: {
      method: 'account',
      providers: staffProviders,
      get required() { const u = staff(); return !u || !u.emailVerified; },
      get user() { return staff()?.email ?? null; },
      get verified() { return !!staff()?.emailVerified; },
      // signIn() / signIn({ provider: 'google' }) / signIn({ provider: 'password', email, password })
      signIn: guard(async (arg?: string | SignInOptions) => {
        const o: SignInOptions = typeof arg === 'object' && arg ? arg : {};
        const provider = o.provider || staffProviders[0];
        if (!staffProviders.includes(provider)) throw new QueueError('invalid', `sign-in with "${provider}" is not enabled`);
        if (provider === 'google') {
          const google = new au.GoogleAuthProvider();
          google.setCustomParameters({ prompt: 'select_account' }); // let staff pick the right Google account
          await au.signInWithPopup(fbAuth, google);
        } else {
          if (!o.email || !o.password) throw new QueueError('invalid', 'email and password required');
          await au.signInWithEmailAndPassword(fbAuth, String(o.email).trim(), String(o.password));
        }
        await fbAuth.currentUser?.getIdToken(true);
      }),
      signOut: guard(async () => { await au.signOut(fbAuth); }),
      // email + password accounts: send the verification mail, then refresh() after the link was opened
      sendVerification: guard(async () => {
        const u = staff();
        if (!u) throw new QueueError('unauthenticated', 'sign in first');
        await au.sendEmailVerification(u);
      }),
      refresh: guard(async () => {
        const u = staff();
        if (!u) return;
        await u.reload();
        await u.getIdToken(true); // the rules read email_verified from a fresh token
      }),
      resetPassword: guard(async (email: string) => {
        if (!email) throw new QueueError('invalid', 'email required');
        await au.sendPasswordResetEmail(fbAuth, String(email).trim());
      }),
    },

    createTicket: guard(async (nickname: string) => {
      const name = cleanNickname(nickname);
      if (!name) throw new QueueError('invalid', 'nickname required');
      const owner = await visitorUid();
      const ref = fs.doc(ticketsCol);
      const now = Date.now();
      // the counter and the ticket are written together, so numbers are never reused or skipped
      const number = await fs.runTransaction(db, async (tx) => {
        const c = await tx.get(counterRef);
        const n: number = c.exists() ? c.data().next : 1;
        tx.set(counterRef, { next: n + 1 });
        // owner: this phone's anonymous sign-in, so only this phone can check the ticket in later
        tx.set(ref, { number: n, nickname: name, status: 'waiting', createdAt: now, updatedAt: now, owner });
        return n;
      });
      return { id: ref.id, number, nickname: name, status: 'waiting', createdAt: now, updatedAt: now, checkedInAt: null };
    }),
    getTicket: guard(async (id: string) => toTicket(await fs.getDoc(fs.doc(ticketsCol, id)))),
    watchTicket(id, cb) {
      return track(fs.onSnapshot(fs.doc(ticketsCol, id), (s) => cb(toTicket(s)), (err) => console.warn('watchTicket', toQueueError(err))));
    },
    watchQueue(cb) {
      // sorted here rather than with orderBy, so no composite index is needed
      return track(fs.onSnapshot(activeQuery, (qs) => cb(sortQueue(qs.docs.map(mustTicket))), (err) => console.warn('watchQueue', toQueueError(err))));
    },
    callNext: guard(async () => {
      requireStaff();
      // transactions can't run queries, so pick the candidate first, then claim it only if it is still waiting
      for (let attempt = 0; attempt < 5; attempt++) {
        const qs = await fs.getDocs(fs.query(ticketsCol, fs.where('status', '==', 'waiting')));
        const first = qs.docs.map(mustTicket).sort((a, b) => a.number - b.number)[0];
        if (!first) return null;
        const ref = fs.doc(ticketsCol, first.id);
        const claimed = await fs.runTransaction(db, async (tx): Promise<Ticket | null> => {
          const s = await tx.get(ref);
          if (!s.exists() || s.data().status !== 'waiting') return null;
          const updatedAt = Date.now();
          tx.update(ref, { status: 'called', updatedAt });
          return { ...mustTicket(s), status: 'called', updatedAt };
        });
        if (claimed) return claimed;
      }
      throw new QueueError('unavailable', 'queue busy, try again');
    }),
    setStatus: guard(async (id: string, status: string) => {
      requireStaff();
      if (!isStatus(status)) throw new QueueError('invalid', `unknown status "${status}"`);
      const ref = fs.doc(ticketsCol, id);
      await fs.updateDoc(ref, { status, updatedAt: Date.now() });
      return toTicket(await fs.getDoc(ref));
    }),
    // NFC check-in: the phone files a request; the reception PC checks the tag signature and answers
    // (server/checkin-firestore.ts). Resolves with its answer, or { status: 'pending' } if none comes in time.
    async checkIn(id, { picc, cmac }): Promise<CheckinResult> {
      try {
        const owner = await visitorUid();
        return await submitCheckin({ ticketId: id, picc: String(picc || ''), cmac: String(cmac || ''), owner });
      } catch (err) {
        const e = toQueueError(err);
        // the rules refuse a request for someone else's ticket (or one from a different browser)
        if (e.code === 'unauthenticated' || e.code === 'forbidden') return { status: 'rejected', reason: 'not-owner', ticket: null };
        throw e;
      }
    },
    checkInManual: guard(async (id: string) => {
      const u = requireStaff();
      return submitCheckin({ ticketId: id, manual: true, requestedBy: u.email });
    }),
    listTickets: guard(async () => (await fs.getDocs(ticketsCol)).docs.map(mustTicket).sort((a, b) => a.number - b.number)),
    // a visitor withdraws their own ticket; the rules allow only its owner, only from waiting / called
    async cancelTicket(id): Promise<CancelResult> {
      const ref = fs.doc(ticketsCol, id);
      const t = toTicket(await fs.getDoc(ref).catch((err) => { throw toQueueError(err); }));
      if (!t) return { status: 'rejected', reason: 'no-ticket', ticket: null };
      if (t.status !== 'waiting' && t.status !== 'called') return { status: 'rejected', reason: 'closed', ticket: null };
      try {
        await visitorUid();
        await fs.updateDoc(ref, { status: 'cancelled', updatedAt: Date.now() });
      } catch (err) {
        const e = toQueueError(err);
        if (e.code === 'unauthenticated' || e.code === 'forbidden') return { status: 'rejected', reason: 'not-owner', ticket: null };
        throw e;
      }
      return { status: 'cancelled', reason: null, ticket: toTicket(await fs.getDoc(ref)) };
    },
    close() {
      for (const u of unsubs) u();
      unsubs.clear();
    },
  };
}
