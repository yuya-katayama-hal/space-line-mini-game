// Operator page: call the next visitor, mark done / no-show, show the registration QR code.
import qrcode from 'qrcode-generator';
import { connectQueue, QueueError } from '../../shared/queue/index.ts';
import type { QueueAuth, QueueClient, QueueState, Status, Ticket } from '../../shared/queue/index.ts';

// elements of operator.html (always there)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorCode = (err: unknown) => (err instanceof QueueError ? err.code : null);
const KEY_STORE = 'voyage.operatorKey';
const savedKey = (() => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } })();

let q: QueueClient | null = null, queue: QueueState | null = null;
const missed = new Map<string, Ticket>(); // id -> ticket marked no-show in this session

// the queue, once start() has connected (every button below needs it)
function queueClient(): QueueClient {
  if (!q) throw new QueueError('unavailable', 'not connected yet');
  return q;
}

function showError(msg: string) {
  $('error').textContent = msg;
  $('error').classList.toggle('hidden', !msg);
}

// runs a staff action, showing what went wrong; resolves with its result, or undefined if it failed
async function act<T>(fn: (q: QueueClient) => Promise<T>): Promise<T | undefined> {
  showError('');
  try { return await fn(queueClient()); } catch (err) {
    const auth = q?.auth;
    if (errorCode(err) === 'unauthenticated' && auth) { showAuth(AUTH_PROMPT[auth.method] || AUTH_PROMPT.account); return; }
    if (errorCode(err) === 'forbidden') {
      const who = auth?.user || '(?)';
      showError(`できませんでした: ${who} にはスタッフの権限がありません。スタッフ一覧に追加してください (Firebase: meta/operators の emails)。`
        + ` / Failed: ${who} is not allowed to call visitors. Add it to the staff list (Firebase: "emails" in meta/operators).`);
      showAuth('別のアカウントでサインインする / Sign in with another account');
      return;
    }
    showError(`できませんでした / Failed: ${errorText(err)}`);
  }
}

// how staff prove who they are depends on the backend (q.auth.method): a shared key, or an account sign-in
// (Google and/or email + password, q.auth.providers)
const AUTH_PROMPT: Record<string, string> = {
  key: 'オペレーターキーを入力してください / Enter the operator key',
  account: 'スタッフとしてサインインしてください / Sign in as staff',
};
const verifyPrompt = (email: string | null) => `${email} のメールアドレスの確認がまだです。届いた確認メールのリンクを開いてから「確認した」を押してください。`
  + ` / Please verify ${email}: open the link in the verification email, then press "I've verified".`;
const BACKEND_LABEL: Record<string, string> = { local: 'ローカル / Local', firebase: 'Firebase' };
const ENV_LABEL: Record<string, string> = { product: '本番 / product', dev: '開発 / dev' };
const whereLabel = (q: QueueClient) => `${ENV_LABEL[q.environment] || q.environment} · ${BACKEND_LABEL[q.backend] || q.backend}${q.storage ? ` (${q.storage})` : ''}`;

function showAuth(msg: string) {
  $('auth').classList.remove('hidden');
  const a: Pick<QueueAuth, 'method' | 'providers' | 'user' | 'verified'> = q ? q.auth : { method: 'none', providers: [], user: null, verified: true };
  const account = a.method === 'account';
  const needVerify = account && !!a.user && !a.verified; // signed in with email + password, address not verified yet
  $('auth-msg').textContent = needVerify ? verifyPrompt(a.user) : msg;
  for (const id of ['key', 'key-save']) $(id).classList.toggle('hidden', a.method !== 'key');
  $('signin').classList.toggle('hidden', !account || needVerify || !a.providers.includes('google'));
  $('pw-form').classList.toggle('hidden', !account || needVerify || !a.providers.includes('password'));
  $('verify').classList.toggle('hidden', !needVerify);
}

// after any sign-in change: show the sign-in bar only while staff actions would still be refused
function afterAuthChange(q: QueueClient) {
  if (q.auth.required) showAuth(AUTH_PROMPT[q.auth.method]);
  else $('auth').classList.add('hidden');
  showSignedIn(q);
  refreshStats();
}

async function start() {
  let c: QueueClient;
  try {
    c = await connectQueue();
    if (savedKey && c.auth.method === 'key') await c.auth.signIn(savedKey);
  } catch (err) {
    $('conn').textContent = 'つながりません / Offline';
    $('conn').className = 'pill off';
    showError(`キューに接続できません。サーバーを確認してください。/ Can't reach the queue: ${errorText(err)}`);
    setTimeout(start, 5000);
    return;
  }
  q = c;
  showError('');
  $('conn').textContent = whereLabel(c);
  $('conn').className = 'pill on';
  if (c.auth.required) showAuth(AUTH_PROMPT[c.auth.method]);
  showSignedIn(c);
  drawQr(c.registerUrl);
  c.watchQueue((nq) => { queue = nq; render(nq); });
  refreshStats();
}

// which backend, and who is signed in (only listed staff accounts may call visitors)
function showSignedIn(q: QueueClient) {
  const who = q.auth.method === 'account' ? ` · サインイン中 / Signed in: ${q.auth.user || '—'}`
    : q.auth.method === 'key' ? (q.auth.required ? ' · キー未入力 / no key' : ' · キー入力済み / key set')
    : '';
  $('mode').textContent = `${whereLabel(q)}${who}`;
  const signedIn = q.auth.method === 'account' && !!q.auth.user;
  $('who').textContent = signedIn ? q.auth.user + (q.auth.verified ? '' : ' (未確認 / unverified)') : '';
  $('signout').classList.toggle('hidden', !signedIn);
}

function drawQr(url: string | null) {
  if (!url) { $('url').textContent = '(URL unknown)'; return; }
  $('url').textContent = url;
  if (/\/\/(localhost|127\.)/.test(url)) {
    $('url').textContent += '\n⚠ このQRはこのPCでしか開けません。スマホ用は start-lan.bat で起動 / Phones can\'t open this; start with start-lan.bat';
    $('url').style.whiteSpace = 'pre-line';
  }
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  $('qr').innerHTML = code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function minutesSince(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? '1分未満' : `${m}分`;
}

const STATE_LABEL: Partial<Record<Status, string>> = { called: '呼び出し中 / Called', playing: 'プレイ中 / Playing' };

function render(queue: QueueState) {
  const s = queue.serving;
  $('serving').classList.toggle('hidden', !s);
  $('serving-empty').classList.toggle('hidden', !!s);
  if (s) {
    $('s-number').textContent = String(s.number);
    $('s-name').textContent = s.nickname;
    $('s-state').textContent = STATE_LABEL[s.status] || s.status;
    $('s-checkin').textContent = s.checkedInAt ? `来場済み ✔ ${clock(s.checkedInAt)} / Checked in` : 'チェックイン前 / Not checked in';
    $('s-checkin').classList.toggle('ok', !!s.checkedInAt);
    $('s-manual').classList.toggle('hidden', !!s.checkedInAt);
  }
  $<HTMLButtonElement>('next').disabled = !queue.waiting.length;
  $('count').textContent = String(queue.waiting.length);
  $('list-empty').classList.toggle('hidden', queue.waiting.length > 0);

  const list = $('list');
  list.textContent = '';
  for (const t of queue.waiting) {
    const tr = document.createElement('tr');
    const cell = (text: string, cls?: string) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; };
    cell(`#${t.number}`, 'num');
    cell(t.nickname, 'name');
    cell(minutesSince(t.createdAt));
    cell(t.checkedInAt ? `✔ ${clock(t.checkedInAt)}` : '—', t.checkedInAt ? 'in' : 'out');
    const td = cell('', 'act');
    td.append(button('呼ぶ', () => act((q) => q.setStatus(t.id, 'called'))), ' ', button('不在', () => markNoShow(t)), ' ', button('取消', () => cancelTicket(t)));
    if (!t.checkedInAt) td.append(' ', button('手動', () => manualCheckIn(t)));
    list.appendChild(tr);
  }

  $('missed-wrap').classList.toggle('hidden', missed.size === 0);
  const ul = $('missed');
  ul.textContent = '';
  for (const t of missed.values()) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `#${t.number} ${t.nickname}`;
    li.append(label, button('再呼び出し / Re-call', async () => {
      if (await act((q) => q.setStatus(t.id, 'called'))) { missed.delete(t.id); render(queue); }
    }));
    ul.appendChild(li);
  }
}

function button(text: string, onClick: () => unknown) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

// staff check a visitor in by hand (no NFC); in the Firebase environment the reception PC confirms it
async function manualCheckIn(t: Ticket) {
  const r = await act((q) => q.checkInManual(t.id));
  if (!r) return;
  if (r.status === 'pending') showError(`#${t.number}: 受付PCの確認待ちです。server.ts が動いているか確認してください。/ Waiting for the reception PC to confirm.`);
  else if (r.status === 'rejected') showError(`#${t.number}: チェックインできませんでした (${r.reason}) / Check-in refused`);
  refreshStats();
}

// ---------- records: counts + CSV export ----------
async function refreshStats() {
  if (!q || q.auth.required) return;
  try {
    const all = await q.listTickets();
    const n = (f: (t: Ticket) => unknown) => all.filter(f).length;
    $('stats').innerHTML = `登録 <b>${all.length}</b> · 来場 <b>${n((t) => t.checkedInAt)}</b> · 体験 <b>${n((t) => t.status === 'done')}</b>`
      + ` · キャンセル <b>${n((t) => t.status === 'cancelled')}</b>`
      + `<br><small>registered · checked in · finished · cancelled</small>`;
  } catch (err) {
    $('stats').textContent = `— (${errorText(err)})`;
  }
}

function toCsv(rows: unknown[][]) {
  // quote every field; a leading = + - @ would run as a formula in Excel, so neutralize it
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
const iso = (ms: number | null) => (ms ? new Date(ms).toLocaleString('sv-SE') : ''); // 2026-10-23 14:05:09, local time

$('csv').addEventListener('click', () => act(async (q) => {
  const all = await q.listTickets();
  const rows = [['number', 'nickname', 'status', 'registered_at', 'checked_in_at', 'updated_at'],
    ...all.map((t) => [t.number, t.nickname, t.status, iso(t.createdAt), iso(t.checkedInAt), iso(t.updatedAt)])];
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spaceline-${new Date().toLocaleString('sv-SE').slice(0, 16).replace(/[-:]/g, '').replace(' ', '-')}.csv`; // spaceline-20261023-1405.csv
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}));
$('s-manual').addEventListener('click', () => { if (queue && queue.serving) manualCheckIn(queue.serving); });

// staff cancel a ticket (the visitor asked, or it was made by mistake); unlike no-show it is counted as cancelled
async function cancelTicket(t: Ticket) {
  if (!confirm(`#${t.number} ${t.nickname} さんの整理券をキャンセルしますか?\nCancel ticket #${t.number}?`)) return;
  await act((q) => q.setStatus(t.id, 'cancelled'));
  refreshStats();
}

async function markNoShow(t: Ticket) {
  const r = await act((q) => q.setStatus(t.id, 'noshow'));
  if (r && queue) { missed.set(r.id, r); render(queue); }
}

$('next').addEventListener('click', () => act((q) => q.callNext()));
for (const b of document.querySelectorAll<HTMLElement>('#serving [data-act]')) {
  b.addEventListener('click', () => {
    const s = queue && queue.serving;
    if (!s) return;
    const action = b.dataset.act as Status; // data-act in operator.html: playing / done / noshow / cancelled
    if (action === 'noshow') markNoShow(s);
    else if (action === 'cancelled') cancelTicket(s);
    else act((q) => q.setStatus(s.id, action));
  });
}
$('key-save').addEventListener('click', () => {
  if (!q) return;
  const k = input('key').value.trim();
  try { localStorage.setItem(KEY_STORE, k); } catch {}
  q.auth.signIn(k);
  $('auth').classList.add('hidden');
  showSignedIn(q);
});
$('signin').addEventListener('click', () => act(async (q) => {
  await q.auth.signIn({ provider: 'google' });
  afterAuthChange(q);
}));

// email + password sign-in (errors are shown here rather than by act(), which would just reopen this bar)
const authNote = (text: string) => { $('auth-msg').textContent = text; };
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  try {
    const c = queueClient();
    await c.auth.signIn({ provider: 'password', email: input('pw-email').value, password: input('pw-pass').value });
    input('pw-pass').value = '';
    afterAuthChange(c);
  } catch (err) {
    const code = errorCode(err);
    authNote(code === 'unauthenticated' ? 'メールアドレスかパスワードが違います / Wrong email or password'
      : code === 'rate-limited' ? '試行が多すぎます。しばらく待ってからもう一度 / Too many attempts, please wait'
      : code === 'forbidden' ? 'このアカウントは無効になっています / This account is disabled'
      : `サインインできませんでした / Sign-in failed (${errorText(err)}). メール/パスワードのサインインがFirebaseで有効になっているか確認してください。`);
  }
});
$('pw-reset').addEventListener('click', async () => {
  const email = input('pw-email').value.trim();
  if (!email) { authNote('メールアドレスを入力してから押してください / Enter your email first'); return; }
  try {
    await queueClient().auth.resetPassword?.(email);
    authNote(`${email} に、パスワード再設定のメールを送りました(登録があれば) / A reset email was sent to ${email} (if it has an account)`);
  } catch (err) {
    authNote(`送れませんでした / Couldn't send (${errorText(err)})`);
  }
});
$('verify-send').addEventListener('click', async () => {
  try {
    const c = queueClient();
    await c.auth.sendVerification?.();
    authNote(`${c.auth.user} に確認メールを送りました。リンクを開いてから「確認した」を押してください。 / Verification email sent.`);
  } catch (err) {
    authNote(`送れませんでした / Couldn't send (${errorText(err)})`);
  }
});
$('verify-done').addEventListener('click', async () => {
  try {
    const c = queueClient();
    await c.auth.refresh?.();
    if (!c.auth.verified) { authNote(`まだ確認されていません。メールのリンクを開いたか確かめてください。 / Not verified yet. ${verifyPrompt(c.auth.user)}`); return; }
    afterAuthChange(c);
  } catch (err) {
    authNote(`確認できませんでした / Couldn't check (${errorText(err)})`);
  }
});
$('signout').addEventListener('click', () => act(async (q) => {
  await q.auth.signOut();
  afterAuthChange(q);
}));
setInterval(() => { if (queue) render(queue); }, 30_000); // keep the waiting times fresh
setInterval(refreshStats, 60_000);

start();
