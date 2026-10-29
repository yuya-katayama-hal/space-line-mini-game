// Queue contract test: run it after adding or changing a backend (see docs/queue-backends.md).
// Open http://localhost:8000/tools/queue-test.html (served by server/server.mjs on the reception PC). Results also land in window.result.
import { connectQueue, STATUSES, QueueError } from '../../shared/queue/index.js';
import { ENVIRONMENT, ENV } from '../../shared/queue/config.js';

const $ = (id) => document.getElementById(id);
const backend = ENV ? ENV.backend : '(unknown environment)';
$('backend').textContent = `${ENVIRONMENT} → ${backend}`;

const results = [];
function report(status, name, detail = '') {
  results.push({ status, name, detail });
  const li = document.createElement('li');
  li.className = status;
  li.textContent = `${status.toUpperCase()}  ${name}${detail ? ` — ${detail}` : ''}`;
  $('results').appendChild(li);
}
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === 'skip') return;
    report('pass', name);
  } catch (err) {
    report('fail', name, err.message);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function expectError(code, fn) {
  try { await fn(); } catch (err) {
    assert(err instanceof QueueError, `expected a QueueError, got ${err && err.name}: ${err && err.message}`);
    assert(err.code === code, `expected code "${code}", got "${err.code}"`);
    return;
  }
  throw new Error(`expected a "${code}" error, but it succeeded`);
}
// resolves with the first value the watcher reports that passes test(), or rejects after ms
const waitFor = (subscribe, test, ms = 8000) => new Promise((resolve, reject) => {
  let stop = () => {};
  const timer = setTimeout(() => { stop(); reject(new Error(`no matching update within ${ms} ms`)); }, ms);
  stop = subscribe((v) => { if (test(v)) { clearTimeout(timer); setTimeout(() => stop()); resolve(v); } });
});
const isTicket = (t) => t && typeof t.id === 'string' && Number.isInteger(t.number) && typeof t.nickname === 'string'
  && STATUSES.includes(t.status) && typeof t.createdAt === 'number' && typeof t.updatedAt === 'number';

async function run() {
  $('warn').classList.add('hidden');
  let q;
  await check('connectQueue() connects', async () => { q = await connectQueue(); });
  if (!q) return finish();

  await check('queue object has the interface', () => {
    assert(q.backend === backend, `q.backend is "${q.backend}"`);
    assert(q.registerUrl === null || typeof q.registerUrl === 'string', 'registerUrl must be a string or null');
    for (const f of ['createTicket', 'getTicket', 'watchTicket', 'watchQueue', 'callNext', 'setStatus', 'close']) assert(typeof q[f] === 'function', `missing ${f}()`);
    assert(q.auth && ['none', 'key', 'account'].includes(q.auth.method), `auth.method is "${q.auth && q.auth.method}"`);
    assert(typeof q.auth.required === 'boolean', 'auth.required must be a boolean');
    assert(typeof q.auth.signIn === 'function', 'missing auth.signIn()');
  });

  // visitor side
  let a, b;
  await check('createTicket() returns a waiting Ticket', async () => {
    a = await q.createTicket('テスト');
    assert(isTicket(a), `bad ticket shape: ${JSON.stringify(a)}`);
    assert(a.status === 'waiting' && a.nickname === 'テスト', `got ${a.status} / ${a.nickname}`);
  });
  await check('a second ticket gets a higher number', async () => {
    b = await q.createTicket('テスト');
    assert(b.number > a.number, `#${b.number} after #${a.number}`);
  });
  // 2 + 7 + 1 (below) keeps the local server under its limit of 10 registrations per minute from one address
  let burst = [];
  await check('7 registrations at the same moment get 7 different numbers', async () => {
    burst = await Promise.all(Array.from({ length: 7 }, () => q.createTicket('テスト')));
    const nums = burst.map((t) => t.number);
    assert(new Set(nums).size === nums.length, `duplicate numbers: ${nums.join(',')}`);
    assert(nums.every((n) => n > b.number), `numbers not after #${b.number}: ${nums.join(',')}`);
  });
  let c = null;
  await check('cancelTicket() by its owner → cancelled, and it leaves the queue', async () => {
    c = await q.createTicket('テスト');
    const r = await q.cancelTicket(c.id, { ownerToken: c.ownerToken });
    assert(r.status === 'cancelled' && r.ticket && r.ticket.status === 'cancelled', `got ${r.status} / ${r.reason}`);
    await waitFor((cb) => q.watchQueue(cb), (s) => s && Array.isArray(s.waiting) && !s.waiting.some((t) => t.id === c.id), 8000);
  });
  await check('cancelling it again → "closed"', async () => {
    const r = await q.cancelTicket(c.id, { ownerToken: c.ownerToken });
    assert(r.status === 'rejected' && r.reason === 'closed', `got ${r.status} / ${r.reason}`);
  });
  if (a.ownerToken) {
    await check('cancelTicket() of someone else\'s ticket → "not-owner"', async () => {
      const r = await q.cancelTicket(b.id, { ownerToken: a.ownerToken });
      assert(r.status === 'rejected' && r.reason === 'not-owner', `got ${r.status} / ${r.reason}`);
      assert((await q.getTicket(b.id)).status === 'waiting', 'the other ticket must stay waiting');
    });
  } else {
    report('skip', 'cancelTicket() not-owner', 'ownership is this browser\'s sign-in; test it from a second browser');
  }
  const ours = new Set([a, b, c, ...burst].filter(Boolean).map((t) => t.id));
  await check('empty nickname → "invalid"', () => expectError('invalid', () => q.createTicket('   ')));
  await check('getTicket() finds it; unknown id → null', async () => {
    const t = await q.getTicket(a.id);
    assert(t && t.id === a.id && t.number === a.number, 'getTicket returned a different ticket');
    assert((await q.getTicket('no-such-ticket-0000')) === null, 'unknown id should give null');
  });
  await check('watchTicket() reports the ticket right away', () => waitFor((cb) => q.watchTicket(a.id, cb), (t) => t && t.id === a.id, 5000));
  await check('watchQueue() lists it in waiting, sorted', async () => {
    const s = await waitFor((cb) => q.watchQueue(cb), (s) => s && Array.isArray(s.waiting) && s.waiting.some((t) => t.id === a.id), 8000);
    const nums = s.waiting.map((t) => t.number);
    assert(nums.every((n, i) => i === 0 || nums[i - 1] < n), `waiting not ascending: ${nums.join(',')}`);
    assert(s.serving === null || isTicket(s.serving), 'serving must be a Ticket or null');
    assert(typeof s.updatedAt === 'number', 'updatedAt must be a number');
  });

  // NFC check-in, visitor side. The "real tap" is NXP's published test message for a tag with all-zero keys,
  // so it is accepted only where the reception PC uses those test keys (dev); with real keys it is skipped.
  const VECTOR = { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' };
  const NOT_TEST_KEYS = ['bad-picc', 'bad-signature', 'not-configured'];
  const skipPending = (r, what) => { if (r.status === 'pending') { report('skip', what, 'no answer from the check-in checker (is the reception PC running?)'); return true; } return false; };
  let tapWorks = false;
  await check('checkIn() with a forged tag URL is rejected', async () => {
    const r = await q.checkIn(a.id, { picc: '00'.repeat(16), cmac: '00'.repeat(8), ownerToken: a.ownerToken });
    if (skipPending(r, 'checkIn() forged')) return 'skip';
    assert(r.status === 'rejected' && ['malformed', ...NOT_TEST_KEYS].includes(r.reason), `got ${r.status} / ${r.reason}`);
  });
  await check('checkIn() with a real tap: accepted once, refused when replayed', async () => {
    const r1 = await q.checkIn(a.id, { ...VECTOR, ownerToken: a.ownerToken });
    if (skipPending(r1, 'checkIn() real tap')) return 'skip';
    if (r1.status === 'rejected' && NOT_TEST_KEYS.includes(r1.reason)) { report('skip', 'checkIn() real tap', `the reception PC doesn't use the all-zero test keys (${r1.reason})`); return 'skip'; }
    tapWorks = true;
    if (r1.status === 'rejected' && r1.reason === 'replayed') return; // this test tap was used in an earlier run: the counter check works
    assert(r1.status === 'accepted' && r1.ticket && typeof r1.ticket.checkedInAt === 'number', `got ${r1.status} / ${r1.reason}`);
    const r2 = await q.checkIn(a.id, { ...VECTOR, ownerToken: a.ownerToken });
    assert(r2.status === 'rejected' && r2.reason === 'replayed', `replay gave ${r2.status} / ${r2.reason}`);
  });
  if (tapWorks && c) {
    await check('checkIn() on a cancelled ticket → "closed"', async () => {
      const r = await q.checkIn(c.id, { picc: VECTOR.picc, cmac: VECTOR.cmac, ownerToken: c.ownerToken });
      assert(r.status === 'rejected' && r.reason === 'closed', `got ${r.status} / ${r.reason}`);
    });
  }
  if (tapWorks && a.ownerToken) {
    await check('checkIn() for someone else\'s ticket → "not-owner"', async () => {
      const r = await q.checkIn(b.id, { ...VECTOR, ownerToken: a.ownerToken }); // ticket b, but a's proof of ownership
      assert(r.status === 'rejected' && r.reason === 'not-owner', `got ${r.status} / ${r.reason}`);
    });
  } else if (tapWorks) {
    report('skip', 'checkIn() not-owner', 'ownership is this browser\'s sign-in; test it from a second browser');
  }

  // staff side
  if (q.auth.required) {
    await check('staff action before signing in → "unauthenticated"', () => expectError('unauthenticated', () => q.setStatus(a.id, 'called')));
    if (q.auth.method === 'key') {
      $('key-box').classList.remove('hidden');
      await new Promise((resolve) => {
        $('key-go').onclick = () => q.auth.signIn($('key').value.trim()).then(resolve);
        $('key-skip').onclick = resolve;
      });
      $('key-box').classList.add('hidden');
    }
    if (q.auth.method === 'account') {
      $('signin-box').classList.remove('hidden');
      await new Promise((resolve) => { $('signin').onclick = () => q.auth.signIn().then(resolve, (err) => report('fail', 'auth.signIn()', err.message)); });
      $('signin-box').classList.add('hidden');
    }
  }
  if (q.auth.required) {
    report('skip', 'staff checks', 'not signed in');
  } else {
    await check('setStatus(called) updates the ticket and its watchers', async () => {
      const seen = waitFor((cb) => q.watchTicket(a.id, cb), (t) => t && t.status === 'called', 8000);
      const t = await q.setStatus(a.id, 'called');
      assert(t && t.status === 'called', `setStatus returned ${t && t.status}`);
      await seen;
    });
    await check('unknown status → "invalid"', () => expectError('invalid', () => q.setStatus(a.id, 'bogus')));
    await check('staff can cancel a ticket (setStatus cancelled)', async () => {
      const t = await q.setStatus(burst[burst.length - 1].id, 'cancelled');
      assert(t && t.status === 'cancelled', `setStatus returned ${t && t.status}`);
    });
    await check('callNext() calls the lowest waiting ticket', async () => {
      // only when every waiting ticket is one of ours, so a real visitor is never called
      const s = await waitFor((cb) => q.watchQueue(cb), (s) => s && Array.isArray(s.waiting), 5000);
      if (!s.waiting.length || !s.waiting.every((t) => ours.has(t.id)) || s.waiting[0].id !== b.id) { report('skip', 'callNext()', 'other visitors are waiting; not calling them'); return 'skip'; }
      const t = await q.callNext();
      assert(t && t.id === b.id && t.status === 'called', `callNext returned ${t && `#${t.number} ${t.status}`}`);
    });
    await check('checkInManual() checks a ticket in by hand; a second time → "already"', async () => {
      const r1 = await q.checkInManual(b.id);
      if (r1.status === 'pending') { report('skip', 'checkInManual()', 'no answer from the check-in checker (is the reception PC running?)'); return 'skip'; }
      assert((r1.status === 'accepted' || r1.status === 'already') && r1.ticket && typeof r1.ticket.checkedInAt === 'number', `got ${r1.status} / ${r1.reason}`);
      const r2 = await q.checkInManual(b.id);
      assert(r2.status === 'already', `second manual check-in gave ${r2.status}`);
    });
    await check('listTickets() lists the test tickets, without owner secrets', async () => {
      const all = await q.listTickets();
      const tb = all.find((t) => t.id === b.id);
      assert(tb && isTicket(tb), 'test ticket missing from listTickets()');
      assert(!('owner' in tb) && !('ownerHash' in tb) && !('ownerToken' in tb), 'listTickets() exposes the owner');
    });
    await check('cleanup: test tickets marked done', async () => {
      for (const id of ours) await q.setStatus(id, 'done');
      const s = await waitFor((cb) => q.watchQueue(cb), (s) => s && ![s.serving, ...s.waiting].some((t) => t && ours.has(t.id)), 8000);
      assert(s, 'test tickets still in the queue');
    });
  }
  q.close();
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
