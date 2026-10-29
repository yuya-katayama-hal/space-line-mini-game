// Phone registration page: nickname → ticket number → live status until it's your turn.
// Tapping the NFC tag at the booth opens this page with ?picc=…&cmac=… and checks the ticket in.
import { connectQueue, aheadOf } from '../../shared/queue/index.js';
import { cleanNickname, NICKNAME_MAX } from '../../shared/queue/nickname.js';
import { TURN_MINUTES } from '../../shared/queue/config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'voyage.ticketId';
// the saved ticket: { id, ownerToken } (ownerToken: proof of ownership for the local backend; Firebase uses the sign-in)
const store = {
  get() {
    try {
      const v = localStorage.getItem(KEY);
      if (!v) return null;
      return v.startsWith('{') ? JSON.parse(v) : { id: v, ownerToken: null }; // older pages saved just the id
    } catch { return null; }
  },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

// an NFC tap: take the tag's values and clean them out of the address bar, so a reload doesn't resend them
const params = new URLSearchParams(location.search);
let tap = params.get('picc') && params.get('cmac') ? { picc: params.get('picc'), cmac: params.get('cmac') } : null;
if (tap) history.replaceState(null, '', location.pathname);

let q = null;
let ticket = null, queue = null;
let stopTicket = null, stopQueue = null;

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
}

async function start() {
  show('loading');
  try {
    q = await connectQueue();
  } catch (err) {
    console.warn(err);
    show('offline');
    return;
  }
  const saved = store.get();
  if (tap) { await checkIn(saved); return; }
  if (saved) {
    const t = await q.getTicket(saved.id).catch(() => undefined);
    if (t) { openTicket(t); return; }
    if (t === null) store.clear(); // gone from the queue; a network error keeps it for next time
    else { show('offline'); return; }
  }
  show('form-screen');
  $('nickname').focus();
}

// ---------- NFC check-in ----------
const REASONS = {
  'replayed': ['このタッチは使えません', 'もう一度、ブースのタグにタッチしてください。<br><small>This tap can\'t be used. Please tap the tag at the booth again.</small>'],
  'not-owner': ['この整理券では入れません', '整理券を登録したブラウザで、もう一度タッチしてください。わからないときは受付のスタッフに声をかけてね。<br><small>Please tap again with the browser you registered in, or ask the staff.</small>'],
  'bad-signature': ['ブースのタグではありません', 'SPACE LINEのブースにあるタグにタッチしてください。<br><small>Please tap the tag at the SPACE LINE booth.</small>'],
  'bad-picc': ['ブースのタグではありません', 'SPACE LINEのブースにあるタグにタッチしてください。<br><small>Please tap the tag at the SPACE LINE booth.</small>'],
  'malformed': ['ブースのタグではありません', 'SPACE LINEのブースにあるタグにタッチしてください。<br><small>Please tap the tag at the SPACE LINE booth.</small>'],
  'closed': ['この整理券は終了しています', 'ご参加ありがとうございました。<br><small>This ticket has already been used.</small>'],
  'no-ticket': ['整理券が見つかりません', '受付のスタッフに声をかけてください。<br><small>We couldn\'t find your ticket. Please ask the staff.</small>'],
  'not-configured': ['チェックインの準備中です', '受付のスタッフに声をかけてください。<br><small>Check-in isn\'t ready. Please ask the staff.</small>'],
};

function checkinScreen(kind, title, html, { toTicket = false, toRegister = false } = {}) {
  $('ci-card').className = `card status checkin ${kind}`;
  $('ci-title').textContent = title;
  $('ci-text').innerHTML = html; // only our own fixed texts above, never visitor input
  $('ci-ticket').classList.toggle('hidden', !toTicket);
  $('ci-register').classList.toggle('hidden', !toRegister);
  show('checkin-screen');
}

async function checkIn(saved) {
  const proof = tap;
  tap = null;
  if (!saved) {
    checkinScreen('ng', 'このブラウザに整理券がありません',
      '整理券を登録したブラウザで、もう一度タッチしてください。まだ登録していない人は、ここで登録できます。<br><small>No ticket in this browser. Tap again with the browser you registered in, or get a ticket here.</small>',
      { toRegister: true });
    return;
  }
  checkinScreen('', '確認しています…', '<small>Checking…</small>');
  let r;
  try {
    r = await q.checkIn(saved.id, { ...proof, ownerToken: saved.ownerToken });
  } catch (err) {
    console.warn(err);
    checkinScreen('ng', 'つながりません', '通信のよい場所で、もう一度タッチしてください。<br><small>Couldn\'t reach the queue. Please tap again.</small>');
    return;
  }
  if (r.status === 'accepted' || r.status === 'already') {
    checkinScreen('ok', 'チェックイン完了!', `#${r.ticket ? r.ticket.number : ''} ${r.status === 'already' ? '(チェックイン済みです)' : ''}<br>順番が来たら、この画面でお知らせします。<br><small>You're checked in. This page will tell you when it's your turn.</small>`, { toTicket: true });
  } else if (r.status === 'pending') {
    checkinScreen('', '受付で確認しています', '少し待ってから、整理券の画面で「来場済み」になったか確認してね。<br><small>The reception is checking. Watch for "Checked in" on your ticket.</small>', { toTicket: true });
  } else {
    const [title, text] = REASONS[r.reason] || ['チェックインできませんでした', `受付のスタッフに声をかけてください (${r.reason})。`];
    checkinScreen('ng', title, text, { toTicket: r.reason !== 'not-owner' });
  }
}

$('ci-ticket').addEventListener('click', async () => {
  const saved = store.get();
  const t = saved && await q.getTicket(saved.id).catch(() => null);
  if (t) openTicket(t); else show('form-screen');
});
$('ci-register').addEventListener('click', () => { show('form-screen'); $('nickname').focus(); });

// ---------- form ----------
$('nickname').addEventListener('input', () => {
  $('count').textContent = [...$('nickname').value.trim()].length;
  $('form-error').textContent = '';
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = $('nickname').value;
  const name = cleanNickname(raw);
  if (!name) { $('form-error').textContent = 'ニックネームを入れてください / Please enter a nickname'; return; }
  if ([...raw.trim()].length > NICKNAME_MAX) { $('form-error').textContent = `${NICKNAME_MAX}文字までです / Up to ${NICKNAME_MAX} characters`; return; }
  $('submit').disabled = true;
  try {
    const t = await q.createTicket(name);
    store.set({ id: t.id, ownerToken: t.ownerToken || null });
    openTicket(t);
  } catch (err) {
    $('form-error').textContent = err.code === 'rate-limited'
      ? '登録が多すぎます。少し待ってね / Too many registrations, please wait a minute'
      : `登録できませんでした / Couldn't register (${err.message})`;
  } finally {
    $('submit').disabled = false;
  }
});

// ---------- ticket ----------
function openTicket(t) {
  stopTicket?.(); stopQueue?.();
  ticket = t;
  $('t-number').textContent = t.number;
  $('t-name').textContent = t.nickname;
  show('ticket-screen');
  render();
  stopTicket = q.watchTicket(t.id, (nt) => {
    const wasCalled = ticket && ticket.status === 'called';
    ticket = nt;
    if (nt && nt.status === 'called' && !wasCalled) buzz();
    render();
  });
  stopQueue = q.watchQueue((nq) => { queue = nq; render(); });
}

function render() {
  const status = ticket ? ticket.status : 'missing';
  for (const s of ['waiting', 'called', 'playing', 'done', 'noshow', 'cancelled', 'missing']) $(`st-${s}`).classList.toggle('hidden', s !== status);
  $('cancel').classList.toggle('hidden', !(status === 'waiting' || status === 'called'));
  $('status').classList.toggle('is-called', status === 'called');
  const checkedIn = !!(ticket && ticket.checkedInAt);
  $('t-checkin').classList.toggle('hidden', !checkedIn);
  $('checkin-hint').classList.toggle('hidden', checkedIn || !(status === 'waiting' || status === 'called'));
  if (status === 'waiting' && queue) {
    const ahead = aheadOf(ticket, queue);
    $('ahead').textContent = ahead;
    $('ahead-en').textContent = ahead;
    $('serving').textContent = queue.serving ? `#${queue.serving.number}` : '—';
    $('eta').textContent = (ahead + (queue.serving ? 1 : 0)) * TURN_MINUTES;
  }
  $('live').textContent = queue ? `更新 ${new Date(queue.updatedAt).toLocaleTimeString('ja-JP')} · live` : '';
}

function buzz() {
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
}

// ---------- cancel ----------
const CANCEL_ERRORS = {
  'closed': 'もう順番が始まっているか、終わっています / Your turn has already started or ended',
  'not-owner': 'このブラウザで登録した整理券ではありません / This ticket wasn\'t registered in this browser',
  'no-ticket': '整理券が見つかりません / Ticket not found',
};
async function cancelTicket() {
  const saved = store.get();
  if (!ticket || !saved) return { status: 'rejected', reason: 'no-ticket' };
  return q.cancelTicket(ticket.id, { ownerToken: saved.ownerToken });
}
$('cancel').addEventListener('click', async () => {
  if (!confirm('受付をキャンセルしますか?\n順番は元に戻せません。\nCancel your ticket? You will lose your place in the queue.')) return;
  $('cancel').disabled = true;
  $('cancel-error').textContent = '';
  try {
    const r = await cancelTicket();
    if (r.status === 'cancelled') { ticket = r.ticket || { ...ticket, status: 'cancelled' }; render(); }
    else $('cancel-error').textContent = CANCEL_ERRORS[r.reason] || `キャンセルできませんでした / Couldn't cancel (${r.reason})`;
  } catch (err) {
    $('cancel-error').textContent = `キャンセルできませんでした / Couldn't cancel (${err.message})`;
  } finally {
    $('cancel').disabled = false;
  }
});

$('again').addEventListener('click', async () => {
  if (ticket && (ticket.status === 'waiting' || ticket.status === 'called')) {
    if (!confirm('いまの整理券をキャンセルして、新しく登録しますか?\nCancel this ticket and register again?')) return;
    await cancelTicket().catch(() => {}); // don't leave the old ticket waiting in the queue
  }
  stopTicket?.(); stopQueue?.();
  stopTicket = stopQueue = null;
  ticket = null;
  store.clear();
  $('nickname').value = '';
  $('count').textContent = '0';
  show('form-screen');
});

$('retry').addEventListener('click', start);

start();
