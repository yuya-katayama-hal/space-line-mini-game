// Operator page: call the next visitor, mark done / no-show, show the registration QR code.
import qrcode from 'qrcode-generator';
import { connectQueue } from '../../shared/queue/index.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'voyage.operatorKey';
const savedKey = (() => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } })();

let q = null, queue = null;
const missed = new Map(); // id -> ticket marked no-show in this session

function showError(msg) {
  $('error').textContent = msg;
  $('error').classList.toggle('hidden', !msg);
}

async function act(fn) {
  showError('');
  try { return await fn(); } catch (err) {
    if (err.code === 'unauthenticated') { showAuth(AUTH_PROMPT[q.auth.method] || AUTH_PROMPT.account); return; }
    if (err.code === 'forbidden') {
      const who = q.auth.user || '(?)';
      showError(`できませんでした: ${who} にはスタッフの権限がありません。スタッフ一覧に追加してください (Firebase: meta/operators の emails)。`
        + ` / Failed: ${who} is not allowed to call visitors. Add it to the staff list (Firebase: "emails" in meta/operators).`);
      showAuth('別のアカウントでサインインする / Sign in with another account');
      return;
    }
    showError(`できませんでした / Failed: ${err.message}`);
  }
}

// how staff prove who they are depends on the backend (q.auth.method): a shared key, or an account sign-in
// (Google and/or email + password, q.auth.providers)
const AUTH_PROMPT = {
  key: 'オペレーターキーを入力してください / Enter the operator key',
  account: 'スタッフとしてサインインしてください / Sign in as staff',
};
const verifyPrompt = (email) => `${email} のメールアドレスの確認がまだです。届いた確認メールのリンクを開いてから「確認した」を押してください。`
  + ` / Please verify ${email}: open the link in the verification email, then press "I've verified".`;
const BACKEND_LABEL = { local: 'ローカル / Local', firebase: 'Firebase' };
const ENV_LABEL = { product: '本番 / product', dev: '開発 / dev' };
const whereLabel = () => `${ENV_LABEL[q.environment] || q.environment} · ${BACKEND_LABEL[q.backend] || q.backend}${q.storage ? ` (${q.storage})` : ''}`;

function showAuth(msg) {
  $('auth').classList.remove('hidden');
  const a = q ? q.auth : { method: 'none', providers: [] };
  const account = a.method === 'account';
  const needVerify = account && !!a.user && !a.verified; // signed in with email + password, address not verified yet
  $('auth-msg').textContent = needVerify ? verifyPrompt(a.user) : msg;
  for (const id of ['key', 'key-save']) $(id).classList.toggle('hidden', a.method !== 'key');
  $('signin').classList.toggle('hidden', !account || needVerify || !a.providers.includes('google'));
  $('pw-form').classList.toggle('hidden', !account || needVerify || !a.providers.includes('password'));
  $('verify').classList.toggle('hidden', !needVerify);
}

// after any sign-in change: show the sign-in bar only while staff actions would still be refused
function afterAuthChange() {
  if (q.auth.required) showAuth(AUTH_PROMPT[q.auth.method]);
  else $('auth').classList.add('hidden');
  showSignedIn();
  refreshStats();
}

async function start() {
  try {
    q = await connectQueue();
    if (savedKey && q.auth.method === 'key') await q.auth.signIn(savedKey);
  } catch (err) {
    $('conn').textContent = 'つながりません / Offline';
    $('conn').className = 'pill off';
    showError(`キューに接続できません。サーバーを確認してください。/ Can't reach the queue: ${err.message}`);
    setTimeout(start, 5000);
    return;
  }
  showError('');
  $('conn').textContent = whereLabel();
  $('conn').className = 'pill on';
  if (q.auth.required) showAuth(AUTH_PROMPT[q.auth.method]);
  showSignedIn();
  drawQr(q.registerUrl);
  q.watchQueue((nq) => { queue = nq; render(); });
  refreshStats();
}

// which backend, and who is signed in (only listed staff accounts may call visitors)
function showSignedIn() {
  const who = q.auth.method === 'account' ? ` · サインイン中 / Signed in: ${q.auth.user || '—'}`
    : q.auth.method === 'key' ? (q.auth.required ? ' · キー未入力 / no key' : ' · キー入力済み / key set')
    : '';
  $('mode').textContent = `${whereLabel()}${who}`;
  const signedIn = q.auth.method === 'account' && !!q.auth.user;
  $('who').textContent = signedIn ? q.auth.user + (q.auth.verified ? '' : ' (未確認 / unverified)') : '';
  $('signout').classList.toggle('hidden', !signedIn);
}

function drawQr(url) {
  if (!url) { $('url').textContent = '(URL unknown)'; return; }
  $('url').textContent = url;
  if (/\/\/(localhost|127\.)/.test(url)) {
    $('url').textContent += '\n⚠ このQRはこのPCでしか開けません。スマホ用は start-lan.bat で起動 / Phones can\'t open this; start with start-lan.bat';
    $('url').style.whiteSpace = 'pre-line';
  }
  if (typeof qrcode !== 'function') { $('qr').textContent = 'QR library missing (npm install)'; return; }
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  $('qr').innerHTML = code.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function minutesSince(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? '1分未満' : `${m}分`;
}

const STATE_LABEL = { called: '呼び出し中 / Called', playing: 'プレイ中 / Playing' };

function render() {
  const s = queue.serving;
  $('serving').classList.toggle('hidden', !s);
  $('serving-empty').classList.toggle('hidden', !!s);
  if (s) {
    $('s-number').textContent = s.number;
    $('s-name').textContent = s.nickname;
    $('s-state').textContent = STATE_LABEL[s.status] || s.status;
    $('s-checkin').textContent = s.checkedInAt ? `来場済み ✔ ${clock(s.checkedInAt)} / Checked in` : 'チェックイン前 / Not checked in';
    $('s-checkin').classList.toggle('ok', !!s.checkedInAt);
    $('s-manual').classList.toggle('hidden', !!s.checkedInAt);
  }
  $('next').disabled = !queue.waiting.length;
  $('count').textContent = queue.waiting.length;
  $('list-empty').classList.toggle('hidden', queue.waiting.length > 0);

  const list = $('list');
  list.textContent = '';
  for (const t of queue.waiting) {
    const tr = document.createElement('tr');
    const cell = (text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; };
    cell(`#${t.number}`, 'num');
    cell(t.nickname, 'name');
    cell(minutesSince(t.createdAt));
    cell(t.checkedInAt ? `✔ ${clock(t.checkedInAt)}` : '—', t.checkedInAt ? 'in' : 'out');
    const td = cell('', 'act');
    td.append(button('呼ぶ', () => act(() => q.setStatus(t.id, 'called'))), ' ', button('不在', () => markNoShow(t)), ' ', button('取消', () => cancelTicket(t)));
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
      if (await act(() => q.setStatus(t.id, 'called'))) { missed.delete(t.id); render(); }
    }));
    ul.appendChild(li);
  }
}

function button(text, onClick) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

const clock = (ms) => new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

// staff check a visitor in by hand (no NFC); in the Firebase environment the reception PC confirms it
async function manualCheckIn(t) {
  const r = await act(() => q.checkInManual(t.id));
  if (!r) return;
  if (r.status === 'pending') showError(`#${t.number}: 受付PCの確認待ちです。server.mjs が動いているか確認してください。/ Waiting for the reception PC to confirm.`);
  else if (r.status === 'rejected') showError(`#${t.number}: チェックインできませんでした (${r.reason}) / Check-in refused`);
  refreshStats();
}

// ---------- records: counts + CSV export ----------
async function refreshStats() {
  if (!q || q.auth.required) return;
  try {
    const all = await q.listTickets();
    const n = (f) => all.filter(f).length;
    $('stats').innerHTML = `登録 <b>${all.length}</b> · 来場 <b>${n((t) => t.checkedInAt)}</b> · 体験 <b>${n((t) => t.status === 'done')}</b>`
      + ` · キャンセル <b>${n((t) => t.status === 'cancelled')}</b>`
      + `<br><small>registered · checked in · finished · cancelled</small>`;
  } catch (err) {
    $('stats').textContent = `— (${err.message})`;
  }
}

function toCsv(rows) {
  // quote every field; a leading = + - @ would run as a formula in Excel, so neutralize it
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
const iso = (ms) => (ms ? new Date(ms).toLocaleString('sv-SE') : ''); // 2026-10-23 14:05:09, local time

$('csv').addEventListener('click', () => act(async () => {
  const all = await q.listTickets();
  const rows = [['number', 'nickname', 'status', 'registered_at', 'checked_in_at', 'updated_at'],
    ...all.map((t) => [t.number, t.nickname, t.status, iso(t.createdAt), iso(t.checkedInAt), iso(t.updatedAt)])];
  const blob = new Blob(['\ufeff' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spaceline-${new Date().toLocaleString('sv-SE').slice(0, 16).replace(/[-:]/g, '').replace(' ', '-')}.csv`; // spaceline-20261023-1405.csv
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}));
$('s-manual').addEventListener('click', () => { if (queue && queue.serving) manualCheckIn(queue.serving); });

// staff cancel a ticket (the visitor asked, or it was made by mistake); unlike no-show it is counted as cancelled
async function cancelTicket(t) {
  if (!confirm(`#${t.number} ${t.nickname} さんの整理券をキャンセルしますか?\nCancel ticket #${t.number}?`)) return;
  await act(() => q.setStatus(t.id, 'cancelled'));
  refreshStats();
}

async function markNoShow(t) {
  const r = await act(() => q.setStatus(t.id, 'noshow'));
  if (r) { missed.set(r.id, r); render(); }
}

$('next').addEventListener('click', () => act(() => q.callNext()));
for (const b of document.querySelectorAll('#serving [data-act]')) {
  b.addEventListener('click', () => {
    const s = queue && queue.serving;
    if (!s) return;
    if (b.dataset.act === 'noshow') markNoShow(s);
    else if (b.dataset.act === 'cancelled') cancelTicket(s);
    else act(() => q.setStatus(s.id, b.dataset.act));
  });
}
$('key-save').addEventListener('click', () => {
  const k = $('key').value.trim();
  try { localStorage.setItem(KEY_STORE, k); } catch {}
  q.auth.signIn(k);
  $('auth').classList.add('hidden');
  showSignedIn();
});
$('signin').addEventListener('click', () => act(async () => {
  await q.auth.signIn({ provider: 'google' });
  afterAuthChange();
}));

// email + password sign-in (errors are shown here rather than by act(), which would just reopen this bar)
const authNote = (text) => { $('auth-msg').textContent = text; };
$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  try {
    await q.auth.signIn({ provider: 'password', email: $('pw-email').value, password: $('pw-pass').value });
    $('pw-pass').value = '';
    afterAuthChange();
  } catch (err) {
    authNote(err.code === 'unauthenticated' ? 'メールアドレスかパスワードが違います / Wrong email or password'
      : err.code === 'rate-limited' ? '試行が多すぎます。しばらく待ってからもう一度 / Too many attempts, please wait'
      : err.code === 'forbidden' ? 'このアカウントは無効になっています / This account is disabled'
      : `サインインできませんでした / Sign-in failed (${err.message}). メール/パスワードのサインインがFirebaseで有効になっているか確認してください。`);
  }
});
$('pw-reset').addEventListener('click', async () => {
  const email = $('pw-email').value.trim();
  if (!email) { authNote('メールアドレスを入力してから押してください / Enter your email first'); return; }
  try {
    await q.auth.resetPassword(email);
    authNote(`${email} に、パスワード再設定のメールを送りました(登録があれば) / A reset email was sent to ${email} (if it has an account)`);
  } catch (err) {
    authNote(`送れませんでした / Couldn't send (${err.message})`);
  }
});
$('verify-send').addEventListener('click', async () => {
  try {
    await q.auth.sendVerification();
    authNote(`${q.auth.user} に確認メールを送りました。リンクを開いてから「確認した」を押してください。 / Verification email sent.`);
  } catch (err) {
    authNote(`送れませんでした / Couldn't send (${err.message})`);
  }
});
$('verify-done').addEventListener('click', async () => {
  try {
    await q.auth.refresh();
    if (!q.auth.verified) { authNote(`まだ確認されていません。メールのリンクを開いたか確かめてください。 / Not verified yet. ${verifyPrompt(q.auth.user)}`); return; }
    afterAuthChange();
  } catch (err) {
    authNote(`確認できませんでした / Couldn't check (${err.message})`);
  }
});
$('signout').addEventListener('click', () => act(async () => {
  await q.auth.signOut();
  afterAuthChange();
}));
setInterval(() => { if (queue) render(); }, 30_000); // keep the waiting times fresh
setInterval(refreshStats, 60_000);

start();
