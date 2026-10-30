// NFC check-in through the real pages (dev environment, all-zero test keys): phone tap → checked in, replay refused,
// browser without a ticket, booth binds the called visitor only after check-in, operator ✔ / records / CSV.
import fs from 'node:fs';
import path from 'node:path';
import { checker, startServer, startBrowser, testSecrets, tmpDir, registerOnPhone, sleep } from '../lib.ts';
import type { Page } from '../lib.ts';

const t = checker('NFC check-in through the pages (dev)');
const VECTOR = 'picc=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086'; // NXP test tap (zero keys), counter 61
const srv = await startServer({ environment: 'dev', port: 8205, env: { SPACELINE_SECRETS: testSecrets() } });
const br = await startBrowser({ port: 9205 });
const base = srv.url;
const title = (p: Page) => p.text('ci-title');

const phone = await br.newPage({ mobileWidth: 390 });
const saved = await registerOnPhone(phone, base, 'はると');
t.ok(saved && saved.ownerToken, 'phone: ticket saved with its owner token');
t.ok(await phone.visible('checkin-hint'), 'phone: "tap the NFC tag" hint before check-in');
await phone.go(`${base}/register/?${VECTOR}`);
await phone.waitFor(`document.getElementById('ci-title').textContent === 'チェックイン完了!'`);
t.ok((await title(phone)) === 'チェックイン完了!', 'phone: tag tap → "チェックイン完了!"');
t.ok((await phone.ev('location.search')) === '', 'phone: tag values removed from the address bar');
await phone.ev(`document.getElementById('ci-ticket').click()`);
await phone.waitFor(`!document.getElementById('t-checkin').classList.contains('hidden')`);
t.ok((await phone.visible('t-checkin')) && !(await phone.visible('checkin-hint')), 'phone: ticket shows "来場済み ✔", hint gone');
await phone.go(`${base}/register/?${VECTOR}`);
await phone.waitFor(`document.getElementById('ci-title').textContent && document.getElementById('ci-title').textContent !== '確認しています…'`);
t.ok((await title(phone)) === 'このタッチは使えません', 'phone: reusing the same tap URL → refused (replayed)', await title(phone));

const stranger = await br.newPage({ mobileWidth: 390 });
await stranger.go(`${base}/no-such-page`); // same browser profile as the phone: drop its saved ticket first (any page of this origin)
await stranger.ev('localStorage.clear()');
await stranger.go(`${base}/register/?picc=00000000000000000000000000000000&cmac=0000000000000000`);
await stranger.waitFor(`!!document.getElementById('ci-title').textContent`);
t.ok((await title(stranger)) === 'このブラウザに整理券がありません', 'browser without a ticket → "no ticket in this browser"');

const tickets: { id: string; ownerToken: string }[] = [];
for (let i = 0; i < 5; i++) tickets.push(await srv.api('tickets', { nickname: `並列${i}` }));
const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => srv.api(`tickets/${tickets[i % 5].id}/checkin`, { picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086', ownerToken: tickets[i % 5].ownerToken })));
t.ok(burst.every((r) => r.status === 'rejected' && r.reason === 'replayed'), '20 simultaneous reuses of an accepted tap → all refused');

const mia = await srv.api('tickets', { nickname: 'Mia' });
for (const x of await srv.api('tickets')) if (x.id !== mia.id) await srv.api(`tickets/${x.id}/status`, { status: 'done' });
await srv.api('call-next', {}); // → Mia, not checked in
const booth = await br.newPage();
await booth.go(`${base}/`);
await booth.waitFor('!!(window.voyage && window.voyage.queue)', 20000);
await booth.mouse(640, 500); await sleep(1500);
const cap1 = await booth.text('caption');
t.ok(cap1.includes('チェックインしてね') && (await booth.ev('voyage.turn.ticket')) === null, 'booth: called visitor not checked in → asks for the tap, turn not bound');
await srv.api(`tickets/${mia.id}/checkin`, { manual: true });
await booth.waitFor(`!!(voyage.turn.ticket && voyage.turn.ticket.nickname === 'Mia')`, 8000);
t.ok((await booth.ev('voyage.turn.ticket && voyage.turn.ticket.nickname')) === 'Mia' && (await booth.text('caption')).startsWith('ようこそ'), 'booth: after check-in the turn binds and greets');
await sleep(800);
t.ok((await srv.api(`tickets/${mia.id}`)).status === 'playing', 'booth: ticket marked playing');

const dl = tmpDir('csv');
const op = await br.newPage();
await op.cmd('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await op.go(`${base}/operator.html`);
await op.waitFor(`/登録 \\d+/.test(document.getElementById('stats').innerText)`);
t.ok(/登録 \d+ · 来場 \d+ · 体験 \d+/.test(await op.ev(`document.getElementById('stats').innerText`)), 'operator: records show counts');
t.ok((await op.text('s-checkin')).startsWith('来場済み'), 'operator: serving visitor shows "来場済み ✔"');
await op.ev(`document.getElementById('csv').click()`);
await sleep(1500);
const csvFile = fs.readdirSync(dl).find((f) => /^spaceline-\d{8}-\d{4}\.csv$/.test(f));
const csv = csvFile ? fs.readFileSync(path.join(dl, csvFile), 'utf8') : '';
t.ok(csv.startsWith('\ufeff"number","nickname","status","registered_at","checked_in_at","updated_at"') && csv.includes('"Mia","playing"'), 'operator: CSV downloaded with header and rows', csvFile);

const logs = [phone, stranger, booth, op].flatMap((p) => p.logs).filter((l) => !/favicon/.test(l));
t.ok(logs.length === 0, 'no page errors', logs.join(' | '));
await br.close();
await srv.stop();
t.done();
