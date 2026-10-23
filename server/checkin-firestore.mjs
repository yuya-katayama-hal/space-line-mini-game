// NFC check-in checker for the Firebase (product) environment. Runs inside server.mjs on the reception PC.
// Phones write a request to checkins/{id}; this process verifies the tag signature with keys that exist only on
// this PC, applies the shared rules (checkin.mjs) in a Firestore transaction, and writes the result:
//   checkins/{id}: status 'accepted' | 'already' | 'rejected', reason, processedAt
//   tickets/{id}.checkedInAt (first check-in only)        tags/{uid}.lastCounter
// It signs in with a service account, so the security rules let no browser — not even staff — set checkedInAt.
import { verifySun } from './sdm.mjs';
import { decideCheckIn } from './checkin.mjs';

export async function startFirestoreCheckin({ serviceAccount, keys, log = console.log }) {
  let admin;
  try {
    admin = { ...(await import('firebase-admin/app')), ...(await import('firebase-admin/firestore')) };
  } catch {
    throw new Error('the "firebase-admin" npm package is not installed (npm install)');
  }
  const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId: serviceAccount.project_id }, 'spaceline-checkin');
  const checker = watchCheckins(admin.getFirestore(app), { keys, log });
  return { async stop() { await checker.stop(); await admin.deleteApp(app); } };
}

// The checker itself, given a Firestore database (the Admin SDK's, or a stand-in in tests).
export function watchCheckins(db, { keys, log = console.log }) {
  // one request at a time, oldest first, so tap counters are compared in order
  let chain = Promise.resolve();
  const queued = new Set();
  const enqueue = (snap) => {
    if (queued.has(snap.id)) return;
    queued.add(snap.id);
    chain = chain.then(() => processOne(snap.ref)).catch((err) => log(`check-in ${snap.id} failed: ${err.message}`)).finally(() => queued.delete(snap.id));
  };

  async function processOne(ref) {
    const first = await ref.get();
    if (!first.exists || first.get('status') !== 'pending') return;
    const req = first.data();
    // the signature check needs no database, so it happens before the transaction
    const sun = req.manual ? null : verifySun({ picc: req.picc, cmac: req.cmac }, keys);
    const now = Date.now();
    const result = await db.runTransaction(async (tx) => {
      const again = await tx.get(ref);
      if (!again.exists || again.get('status') !== 'pending') return null; // someone else got it
      const ticketRef = db.collection('tickets').doc(String(req.ticketId));
      const tagRef = sun && sun.ok ? db.collection('tags').doc(sun.uid) : null;
      const [ticketSnap, tagSnap] = await Promise.all([tx.get(ticketRef), tagRef ? tx.get(tagRef) : null]); // all reads first
      const ticket = ticketSnap.exists ? ticketSnap.data() : null;
      let d;
      if (sun && !sun.ok) d = { status: 'rejected', reason: sun.reason };
      else {
        d = decideCheckIn({
          ticket, manual: !!req.manual,
          ownerMatches: !!ticket && !!ticket.owner && ticket.owner === req.owner,
          counter: sun ? sun.counter : -1,
          lastCounter: tagSnap && tagSnap.exists ? tagSnap.get('lastCounter') : -1,
        });
      }
      if (d.status !== 'rejected') {
        if (d.lastCounter !== undefined) tx.set(tagRef, { lastCounter: d.lastCounter, updatedAt: now });
        if (!ticket.checkedInAt) tx.update(ticketRef, { checkedInAt: now, updatedAt: now });
      }
      tx.update(ref, {
        status: d.status, reason: d.reason || null, processedAt: now,
        ...(sun && sun.ok ? { tagUid: sun.uid, counter: sun.counter } : {}),
      });
      return d;
    });
    if (result) log(`check-in ${req.manual ? '(manual) ' : ''}ticket ${req.ticketId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
  }

  // watch pending requests; if the connection drops for good, start watching again
  let unsubscribe = () => {}, stopped = false;
  (function listen() {
    unsubscribe = db.collection('checkins').where('status', '==', 'pending').onSnapshot(
      (qs) => qs.docs.sort((a, b) => (a.get('createdAt') || 0) - (b.get('createdAt') || 0)).forEach(enqueue),
      (err) => {
        log(`check-in listener error (retrying in 10 s): ${err.message}`);
        if (!stopped) setTimeout(listen, 10_000);
      },
    );
  })();
  return {
    async stop() { stopped = true; unsubscribe(); await chain; },
    idle: () => chain, // resolves once every queued request has been answered (for tests)
  };
}
