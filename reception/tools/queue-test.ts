// Queue contract test: run it after adding or changing a backend (see docs/queue-backends.md).
// Open http://localhost:8000/tools/queue-test.html (served by server/server.ts on the reception PC). Results also land in window.result.
import { connectQueue, STATUSES, QueueError } from '../../shared/queue/index.ts';
import type { CheckinResult, NewTicket, QueueClient, QueueState, Status, Ticket, Unsubscribe } from '../../shared/queue/index.ts';
import { ENVIRONMENT, ENV } from '../../shared/queue/config.ts';

type Result = { status: 'pass' | 'fail' | 'skip'; name: string; detail: string };
declare global {
  interface Window { result?: { backend: string; passes: number; fails: number; results: Result[] } }
}

// elements of queue-test.html (always there)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const backend = ENV ? ENV.backend : '(unknown environment)';
$('backend').textContent = `${ENVIRONMENT} → ${backend}`;

const results: Result[] = [];
function report(status: Result['status'], name: string, detail = '') {
  results.push({ status, name, detail });
  const li = document.createElement('li');
  li.className = status;
  li.textContent = `${status.toUpperCase()}  ${name}${detail ? ` — ${detail}` : ''}`;
  $('results').appendChild(li);
}
// fn may return 'skip' after reporting why it skipped
async function check(name: string, fn: () => unknown) {
  try {
    const r = await fn();
    if (r === 'skip') return;
    report('pass', name);
  } catch (err) {
    report('fail', name, errorText(err));
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function expectError(code: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (err) {
    assert(err instanceof QueueError, `expected a QueueError, got ${err instanceof Error ? `${err.name}: ${err.message}` : err}`);
    assert(err.code === code, `expected code "${code}", got "${err.code}"`);
    return;
  }
  throw new Error(`expected a "${code}" error, but it succeeded`);
}
// resolves with the first value the watcher reports that passes test(), or rejects after ms
const waitFor = <T>(subscribe: (cb: (v: T) => void) => Unsubscribe, test: (v: T) => unknown, ms = 8000) => new Promise<T>((resolve, reject) => {
  let stop: Unsubscribe = () => {};
  const timer = setTimeout(() => { stop(); reject(new Error(`no matching update within ${ms} ms`)); }, ms);
  stop = subscribe((v) => { if (test(v)) { clearTimeout(timer); setTimeout(() => stop()); resolve(v); } });
});
// checks the shape at run time: the point of this page is to catch a backend that returns something else
const isTicket = (t: unknown): t is Ticket => {
  const x = t as Ticket | null;
  return !!x && typeof x.id === 'string' && Number.isInteger(x.number) && typeof x.nickname === 'string'
    && STATUSES.includes(x.status) && typeof x.createdAt === 'number' && typeof x.updatedAt === 'number';
};
const hasWaiting = (s: QueueState | null): s is QueueState => !!s && Array.isArray(s.waiting);

async function run() {
  $('warn').classList.add('hidden');
  let q: QueueClient | undefined;
  await check('connectQueue() connects', async () => { q = await connectQueue(); });
  if (!q) return finish();
  const queue: QueueClient = q;

  await check('queue object has the interface', () => {
    assert(queue.backend === backend, `q.backend is "${queue.backend}"`);
    assert(queue.registerUrl === null || typeof queue.registerUrl === 'string', 'registerUrl must be a string or null');
    for (const f of ['createTicket', 'getTicket', 'watchTicket', 'watchQueue', 'callNext', 'setStatus', 'close'] as const) assert(typeof queue[f] === 'function', `missing ${f}()`);
    assert(queue.auth && ['none', 'key', 'account'].includes(queue.auth.method), `auth.method is "${queue.auth && queue.auth.method}"`);
    assert(typeof queue.auth.required === 'boolean', 'auth.required must be a boolean');
    assert(typeof queue.auth.signIn === 'function', 'missing auth.signIn()');
  });

  // visitor side
  let a: NewTicket | undefined, b: NewTicket | undefined;
  await check('createTicket() returns a waiting Ticket', async () => {
    a = await queue.createTicket('テスト');
    assert(isTicket(a), `bad ticket shape: ${JSON.stringify(a)}`);
    assert(a.status === 'waiting' && a.nickname === 'テスト', `got ${a.status} / ${a.nickname}`);
  });
  await check('a second ticket gets a higher number', async () => {
    b = await queue.createTicket('テスト');
    assert(a && b.number > a.number, `#${b.number} after #${a?.number}`);
  });
  if (!a || !b) return finish();
  const ta: NewTicket = a, tb: NewTicket = b;
  // 2 + 7 + 1 (below) keeps the local server under its limit of 10 registrations per minute from one address
  let burst: NewTicket[] = [];
  await check('7 registrations at the same moment get 7 different numbers', async () => {
    burst = await Promise.all(Array.from({ length: 7 }, () => queue.createTicket('テスト')));
    const nums = burst.map((t) => t.number);
    assert(new Set(nums).size === nums.length, `duplicate numbers: ${nums.join(',')}`);
    assert(nums.every((n) => n > tb.number), `numbers not after #${tb.number}: ${nums.join(',')}`);
  });
  let c: NewTicket | null = null;
  await check('cancelTicket() by its owner → cancelled, and it leaves the queue', async () => {
    const tc = c = await queue.createTicket('テスト');
    const r = await queue.cancelTicket(tc.id, { ownerToken: tc.ownerToken });
    assert(r.status === 'cancelled' && r.ticket && r.ticket.status === 'cancelled', `got ${r.status} / ${r.reason}`);
    await waitFor<QueueState>((cb) => queue.watchQueue(cb), (s) => hasWaiting(s) && !s.waiting.some((t) => t.id === tc.id), 8000);
  });
  const tc = c as NewTicket | null;
  if (tc) {
    await check('cancelling it again → "closed"', async () => {
      const r = await queue.cancelTicket(tc.id, { ownerToken: tc.ownerToken });
      assert(r.status === 'rejected' && r.reason === 'closed', `got ${r.status} / ${r.reason}`);
    });
  }
  if (ta.ownerToken) {
    await check('cancelTicket() of someone else\'s ticket → "not-owner"', async () => {
      const r = await queue.cancelTicket(tb.id, { ownerToken: ta.ownerToken });
      assert(r.status === 'rejected' && r.reason === 'not-owner', `got ${r.status} / ${r.reason}`);
      assert((await queue.getTicket(tb.id))?.status === 'waiting', 'the other ticket must stay waiting');
    });
  } else {
    report('skip', 'cancelTicket() not-owner', 'ownership is this browser\'s sign-in; test it from a second browser');
  }
  const ours = new Set([ta, tb, tc, ...burst].filter((t): t is NewTicket => !!t).map((t) => t.id));
  await check('empty nickname → "invalid"', () => expectError('invalid', () => queue.createTicket('   ')));
  await check('getTicket() finds it; unknown id → null', async () => {
    const t = await queue.getTicket(ta.id);
    assert(t && t.id === ta.id && t.number === ta.number, 'getTicket returned a different ticket');
    assert((await queue.getTicket('no-such-ticket-0000')) === null, 'unknown id should give null');
  });
  await check('watchTicket() reports the ticket right away', () => waitFor<Ticket | null>((cb) => queue.watchTicket(ta.id, cb), (t) => t && t.id === ta.id, 5000));
  await check('watchQueue() lists it in waiting, sorted', async () => {
    const s = await waitFor<QueueState>((cb) => queue.watchQueue(cb), (s) => hasWaiting(s) && s.waiting.some((t) => t.id === ta.id), 8000);
    const nums = s.waiting.map((t) => t.number);
    assert(nums.every((n, i) => i === 0 || nums[i - 1] < n), `waiting not ascending: ${nums.join(',')}`);
    assert(s.serving === null || isTicket(s.serving), 'serving must be a Ticket or null');
    assert(typeof s.updatedAt === 'number', 'updatedAt must be a number');
  });

  // NFC check-in, visitor side. The "real tap" is NXP's published test message for a tag with all-zero keys,
  // so it is accepted only where the reception PC uses those test keys (dev); with real keys it is skipped.
  const VECTOR = { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' };
  const NOT_TEST_KEYS: (string | null)[] = ['bad-picc', 'bad-signature', 'not-configured'];
  const skipPending = (r: CheckinResult, what: string) => { if (r.status === 'pending') { report('skip', what, 'no answer from the check-in checker (is the reception PC running?)'); return true; } return false; };
  let tapWorks = false;
  await check('checkIn() with a forged tag URL is rejected', async () => {
    const r = await queue.checkIn(ta.id, { picc: '00'.repeat(16), cmac: '00'.repeat(8), ownerToken: ta.ownerToken });
    if (skipPending(r, 'checkIn() forged')) return 'skip';
    assert(r.status === 'rejected' && ['malformed', ...NOT_TEST_KEYS].includes(r.reason), `got ${r.status} / ${r.reason}`);
  });
  await check('checkIn() with a real tap: accepted once, refused when replayed', async () => {
    const r1 = await queue.checkIn(ta.id, { ...VECTOR, ownerToken: ta.ownerToken });
    if (skipPending(r1, 'checkIn() real tap')) return 'skip';
    if (r1.status === 'rejected' && NOT_TEST_KEYS.includes(r1.reason)) { report('skip', 'checkIn() real tap', `the reception PC doesn't use the all-zero test keys (${r1.reason})`); return 'skip'; }
    tapWorks = true;
    if (r1.status === 'rejected' && r1.reason === 'replayed') return; // this test tap was used in an earlier run: the counter check works
    assert(r1.status === 'accepted' && r1.ticket && typeof r1.ticket.checkedInAt === 'number', `got ${r1.status} / ${r1.reason}`);
    const r2 = await queue.checkIn(ta.id, { ...VECTOR, ownerToken: ta.ownerToken });
    assert(r2.status === 'rejected' && r2.reason === 'replayed', `replay gave ${r2.status} / ${r2.reason}`);
  });
  if (tapWorks && tc) {
    await check('checkIn() on a cancelled ticket → "closed"', async () => {
      const r = await queue.checkIn(tc.id, { picc: VECTOR.picc, cmac: VECTOR.cmac, ownerToken: tc.ownerToken });
      assert(r.status === 'rejected' && r.reason === 'closed', `got ${r.status} / ${r.reason}`);
    });
  }
  if (tapWorks && ta.ownerToken) {
    await check('checkIn() for someone else\'s ticket → "not-owner"', async () => {
      const r = await queue.checkIn(tb.id, { ...VECTOR, ownerToken: ta.ownerToken }); // ticket b, but a's proof of ownership
      assert(r.status === 'rejected' && r.reason === 'not-owner', `got ${r.status} / ${r.reason}`);
    });
  } else if (tapWorks) {
    report('skip', 'checkIn() not-owner', 'ownership is this browser\'s sign-in; test it from a second browser');
  }

  // staff side
  if (queue.auth.required) {
    await check('staff action before signing in → "unauthenticated"', () => expectError('unauthenticated', () => queue.setStatus(ta.id, 'called')));
    if (queue.auth.method === 'key') {
      $('key-box').classList.remove('hidden');
      await new Promise<void>((resolve) => {
        $('key-go').onclick = () => queue.auth.signIn($<HTMLInputElement>('key').value.trim()).then(resolve);
        $('key-skip').onclick = () => resolve();
      });
      $('key-box').classList.add('hidden');
    }
    if (queue.auth.method === 'account') {
      $('signin-box').classList.remove('hidden');
      await new Promise<void>((resolve) => { $('signin').onclick = () => queue.auth.signIn().then(resolve, (err) => report('fail', 'auth.signIn()', errorText(err))); });
      $('signin-box').classList.add('hidden');
    }
  }
  if (queue.auth.required) {
    report('skip', 'staff checks', 'not signed in');
  } else {
    await check('setStatus(called) updates the ticket and its watchers', async () => {
      const seen = waitFor<Ticket | null>((cb) => queue.watchTicket(ta.id, cb), (t) => t && t.status === 'called', 8000);
      const t = await queue.setStatus(ta.id, 'called');
      assert(t && t.status === 'called', `setStatus returned ${t && t.status}`);
      await seen;
    });
    await check('unknown status → "invalid"', () => expectError('invalid', () => queue.setStatus(ta.id, 'bogus' as Status)));
    await check('staff can cancel a ticket (setStatus cancelled)', async () => {
      const t = await queue.setStatus(burst[burst.length - 1].id, 'cancelled');
      assert(t && t.status === 'cancelled', `setStatus returned ${t && t.status}`);
    });
    await check('callNext() calls the lowest waiting ticket', async () => {
      // only when every waiting ticket is one of ours, so a real visitor is never called
      const s = await waitFor<QueueState>((cb) => queue.watchQueue(cb), hasWaiting, 5000);
      if (!s.waiting.length || !s.waiting.every((t) => ours.has(t.id)) || s.waiting[0].id !== tb.id) { report('skip', 'callNext()', 'other visitors are waiting; not calling them'); return 'skip'; }
      const t = await queue.callNext();
      assert(t && t.id === tb.id && t.status === 'called', `callNext returned ${t && `#${t.number} ${t.status}`}`);
    });
    await check('checkInManual() checks a ticket in by hand; a second time → "already"', async () => {
      const r1 = await queue.checkInManual(tb.id);
      if (r1.status === 'pending') { report('skip', 'checkInManual()', 'no answer from the check-in checker (is the reception PC running?)'); return 'skip'; }
      assert((r1.status === 'accepted' || r1.status === 'already') && r1.ticket && typeof r1.ticket.checkedInAt === 'number', `got ${r1.status} / ${r1.reason}`);
      const r2 = await queue.checkInManual(tb.id);
      assert(r2.status === 'already', `second manual check-in gave ${r2.status}`);
    });
    await check('listTickets() lists the test tickets, without owner secrets', async () => {
      const all = await queue.listTickets();
      const found = all.find((t) => t.id === tb.id);
      assert(found && isTicket(found), 'test ticket missing from listTickets()');
      assert(!('owner' in found) && !('ownerHash' in found) && !('ownerToken' in found), 'listTickets() exposes the owner');
    });
    await check('cleanup: test tickets marked done', async () => {
      for (const id of ours) await queue.setStatus(id, 'done');
      const s = await waitFor<QueueState>((cb) => queue.watchQueue(cb), (s) => s && ![s.serving, ...s.waiting].some((t) => t && ours.has(t.id)), 8000);
      assert(s, 'test tickets still in the queue');
    });
  }
  queue.close();
  finish();
}

function finish() {
  const fails = results.filter((r) => r.status === 'fail').length;
  const passes = results.filter((r) => r.status === 'pass').length;
  $('summary').textContent = fails ? `${fails} failed, ${passes} passed` : `all ${passes} passed`;
  window.result = { backend, passes, fails, results };
}

if (backend === 'local') run();
else { $('warn').classList.remove('hidden'); $('go').onclick = run; }
