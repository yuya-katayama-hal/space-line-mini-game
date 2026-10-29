// Firebase queue backend (Cloud Firestore). Implements the interface in docs/queue-backends.md.
// Live on project space-line-54818 (see firebase/README-firebase.md).
//
// Data:  tickets/{id}  { number, nickname, status, createdAt, updatedAt }     meta/counter { next }
//        meta/operators { emails: [...] }  (staff allowed to call / complete tickets; edited in the console)
// Visitors sign in anonymously (so the rules can require an auth'd caller to create a ticket).
// Staff and the booth sign in with Google; firebase/firestore.rules checks their email against meta/operators.
import { cleanNickname } from './nickname.js';
import { sortQueue, QueueError, STATUSES } from './common.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

// Firebase error names → generic queue error codes (see common.js)
const FIREBASE_CODES = {
  'unauthenticated': 'unauthenticated', 'popup-closed-by-user': 'unauthenticated', 'cancelled-popup-request': 'unauthenticated',
  // email + password sign-in
  'invalid-credential': 'unauthenticated', 'wrong-password': 'unauthenticated', 'user-not-found': 'unauthenticated',
  'invalid-email': 'invalid', 'missing-password': 'invalid', 'user-disabled': 'forbidden',
  'too-many-requests': 'rate-limited', 'operation-not-allowed': 'invalid', // provider not enabled in the console
  'not-found': 'not-found', 'invalid-argument': 'invalid', 'failed-precondition': 'invalid', 'resource-exhausted': 'rate-limited',
  'unavailable': 'unavailable', 'deadline-exceeded': 'unavailable', 'network-request-failed': 'unavailable',
};

// opts.settings: this environment's entry in config.js ENVIRONMENTS ({ firebase, registerUrl })
export async function connect(opts) {
  const { firebase: firebaseConfig, registerUrl } = opts.settings;
  const staffProviders = (opts.settings.staffSignIn || ['google']).filter((p) => p === 'google' || p === 'password');
  const [{ initializeApp, getApps }, fs, au] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  const app = getApps()[0] || initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const fbAuth = au.getAuth(app);
  await fbAuth.authStateReady();

  const ticketsCol = fs.collection(db, 'tickets');
  const counterRef = fs.doc(db, 'meta', 'counter');
  // the owner (an anonymous sign-in id) stays out of what the pages see
  const toTicket = (snap) => {
    if (!snap.exists()) return null;
    const { owner, ...data } = snap.data();
    return { checkedInAt: null, id: snap.id, ...data };
  };
  const checkinsCol = fs.collection(db, 'checkins');
  async function submitCheckin(fields, waitMs = 15_000) {
    const ref = await fs.addDoc(checkinsCol, { ...fields, status: 'pending', createdAt: Date.now() });
    const answer = await new Promise((resolve) => {
      let stop = () => {};
      const timer = setTimeout(() => { stop(); resolve(null); }, waitMs);
      stop = fs.onSnapshot(ref, (s) => {
        const d = s.data();
        if (d && d.status !== 'pending') { clearTimeout(timer); stop(); resolve(d); }
      }, () => { clearTimeout(timer); resolve(null); });
    });
    if (!answer) return { status: 'pending', reason: null, ticket: null }; // the reception PC hasn't answered (yet)
    const ticket = answer.status === 'rejected' ? null : toTicket(await fs.getDoc(fs.doc(ticketsCol, fields.ticketId)));
    return { status: answer.status, reason: answer.reason || null, ticket };
  }
  const activeQuery = fs.query(ticketsCol, fs.where('status', 'in', ['waiting', 'called', 'playing']));
  const unsubs = new Set();
  const track = (unsub) => { unsubs.add(unsub); return () => { unsub(); unsubs.delete(unsub); }; };
  const isStaff = () => { const u = fbAuth.currentUser; return !!u && !u.isAnonymous; };

  function toQueueError(err) {
    if (err instanceof QueueError) return err;
    const name = String((err && err.code) || '').replace(/^(firestore|auth)\//, '');
    // the rules said no: either nobody is signed in as staff, or this account isn't in meta/operators
    const code = name === 'permission-denied' ? (isStaff() ? 'forbidden' : 'unauthenticated') : FIREBASE_CODES[name] || 'unavailable';
    return new QueueError(code, err && err.message, err);
  }
  const guard = (fn) => async (...args) => { try { return await fn(...args); } catch (err) { throw toQueueError(err); } };

  async function ensureVisitor() {
    if (!fbAuth.currentUser) await au.signInAnonymously(fbAuth);
  }
  function requireStaff() {
    if (!isStaff()) throw new QueueError('unauthenticated', 'staff sign-in required');
    if (!fbAuth.currentUser.emailVerified) throw new QueueError('unauthenticated', 'email address not verified yet');
  }

  return {
    registerUrl: registerUrl || `https://${firebaseConfig.projectId}.web.app/register/`,
    storage: 'firestore',
    // staff sign in with a Google account listed in meta/operators
    // Staff sign in with Google or email + password (settings.staffSignIn). The rules accept only a verified
    // email listed in meta/operators: anyone can create an email + password account, but not verify someone
    // else's address, so an unverified account is treated as not signed in (auth.required stays true).
    auth: {
      method: 'account',
      providers: staffProviders,
      get required() { return !isStaff() || !fbAuth.currentUser.emailVerified; },
      get user() { return isStaff() ? fbAuth.currentUser.email : null; },
      get verified() { return isStaff() && fbAuth.currentUser.emailVerified; },
      // signIn() / signIn({ provider: 'google' }) / signIn({ provider: 'password', email, password })
      signIn: guard(async (opts = {}) => {
        const provider = (opts && opts.provider) || staffProviders[0];
        if (!staffProviders.includes(provider)) throw new QueueError('invalid', `sign-in with "${provider}" is not enabled`);
        if (provider === 'google') {
          const google = new au.GoogleAuthProvider();
          google.setCustomParameters({ prompt: 'select_account' }); // let staff pick the right Google account
          await au.signInWithPopup(fbAuth, google);
        } else {
          if (!opts.email || !opts.password) throw new QueueError('invalid', 'email and password required');
          await au.signInWithEmailAndPassword(fbAuth, String(opts.email).trim(), String(opts.password));
        }
        await fbAuth.currentUser.getIdToken(true);
      }),
      signOut: guard(async () => { await au.signOut(fbAuth); }),
      // email + password accounts: send the verification mail, then refresh() after the link was opened
      sendVerification: guard(async () => {
        if (!isStaff()) throw new QueueError('unauthenticated', 'sign in first');
        await au.sendEmailVerification(fbAuth.currentUser);
      }),
      refresh: guard(async () => {
        if (!isStaff()) return;
        await fbAuth.currentUser.reload();
        await fbAuth.currentUser.getIdToken(true); // the rules read email_verified from a fresh token
      }),
      resetPassword: guard(async (email) => {
        if (!email) throw new QueueError('invalid', 'email required');
        await au.sendPasswordResetEmail(fbAuth, String(email).trim());
      }),
    },

    createTicket: guard(async (nickname) => {
      const name = cleanNickname(nickname);
      if (!name) throw new QueueError('invalid', 'nickname required');
      await ensureVisitor();
      const ref = fs.doc(ticketsCol);
      const now = Date.now();
      // the counter and the ticket are written together, so numbers are never reused or skipped
      const number = await fs.runTransaction(db, async (tx) => {
        const c = await tx.get(counterRef);
        const n = c.exists() ? c.data().next : 1;
        tx.set(counterRef, { next: n + 1 });
        // owner: this phone's anonymous sign-in, so only this phone can check the ticket in later
        tx.set(ref, { number: n, nickname: name, status: 'waiting', createdAt: now, updatedAt: now, owner: fbAuth.currentUser.uid });
        return n;
      });
      return { id: ref.id, number, nickname: name, status: 'waiting', createdAt: now, updatedAt: now, checkedInAt: null };
    }),
    getTicket: guard(async (id) => toTicket(await fs.getDoc(fs.doc(ticketsCol, id)))),
    watchTicket(id, cb) {
      return track(fs.onSnapshot(fs.doc(ticketsCol, id), (s) => cb(toTicket(s)), (err) => console.warn('watchTicket', toQueueError(err))));
    },
    watchQueue(cb) {
      // sorted here rather than with orderBy, so no composite index is needed
      return track(fs.onSnapshot(activeQuery, (qs) => cb(sortQueue(qs.docs.map(toTicket))), (err) => console.warn('watchQueue', toQueueError(err))));
    },
    callNext: guard(async () => {
      requireStaff();
      // transactions can't run queries, so pick the candidate first, then claim it only if it is still waiting
      for (let attempt = 0; attempt < 5; attempt++) {
        const qs = await fs.getDocs(fs.query(ticketsCol, fs.where('status', '==', 'waiting')));
        const first = qs.docs.map(toTicket).sort((a, b) => a.number - b.number)[0];
        if (!first) return null;
        const ref = fs.doc(ticketsCol, first.id);
        const claimed = await fs.runTransaction(db, async (tx) => {
          const s = await tx.get(ref);
          if (!s.exists() || s.data().status !== 'waiting') return null;
          const updatedAt = Date.now();
          tx.update(ref, { status: 'called', updatedAt });
          return { ...toTicket(s), status: 'called', updatedAt };
        });
        if (claimed) return claimed;
      }
      throw new QueueError('unavailable', 'queue busy, try again');
    }),
    setStatus: guard(async (id, status) => {
      requireStaff();
      if (!STATUSES.includes(status)) throw new QueueError('invalid', `unknown status "${status}"`);
      const ref = fs.doc(ticketsCol, id);
      await fs.updateDoc(ref, { status, updatedAt: Date.now() });
      return toTicket(await fs.getDoc(ref));
    }),
    // NFC check-in: the phone files a request; the reception PC checks the tag signature and answers
    // (server/checkin-firestore.mjs). Resolves with its answer, or { status: 'pending' } if none comes in time.
    async checkIn(id, { picc, cmac }) {
      try {
        await ensureVisitor();
        return await submitCheckin({ ticketId: id, picc: String(picc || ''), cmac: String(cmac || ''), owner: fbAuth.currentUser.uid });
      } catch (err) {
        const e = toQueueError(err);
        // the rules refuse a request for someone else's ticket (or one from a different browser)
        if (e.code === 'unauthenticated' || e.code === 'forbidden') return { status: 'rejected', reason: 'not-owner', ticket: null };
        throw e;
      }
    },
    checkInManual: guard(async (id) => {
      requireStaff();
      return submitCheckin({ ticketId: id, manual: true, requestedBy: fbAuth.currentUser.email });
    }),
    listTickets: guard(async () => (await fs.getDocs(ticketsCol)).docs.map(toTicket).sort((a, b) => a.number - b.number)),
    // a visitor withdraws their own ticket; the rules allow only its owner, only from waiting / called
    async cancelTicket(id) {
      const ref = fs.doc(ticketsCol, id);
      const t = toTicket(await fs.getDoc(ref).catch((err) => { throw toQueueError(err); }));
      if (!t) return { status: 'rejected', reason: 'no-ticket', ticket: null };
      if (t.status !== 'waiting' && t.status !== 'called') return { status: 'rejected', reason: 'closed', ticket: null };
      try {
        await ensureVisitor();
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
