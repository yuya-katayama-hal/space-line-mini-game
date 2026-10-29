// Phone registration page + operator page together (dev environment, local backend): register, live position,
// call next / done / no-show, "your turn", playing, done.
import { checker, startServer, startBrowser, sleep } from '../lib.mjs';

const t = checker('phone page + operator page (dev)');
const srv = await startServer({ environment: 'dev', port: 8203 });
const br = await startBrowser({ port: 9203 });
const base = srv.url;

const phone = await br.newPage({ mobileWidth: 390 });
await phone.go(`${base}/register/`);
await phone.waitFor(`!document.getElementById('form-screen').classList.contains('hidden')`);
t.ok(await phone.visible('form-screen'), 'register: form shown');
await phone.ev(`(() => { const i = document.getElementById('nickname'); i.value = 'あいうえおかきくけこさしす'; i.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
await sleep(300);
t.ok(/12/.test(await phone.text('form-error')), 'register: 13 characters refused');
await srv.api('tickets', { nickname: 'さきのひと' });
await srv.api('tickets', { nickname: 'つぎのひと' });
await phone.ev(`(() => { const i = document.getElementById('nickname'); i.value = 'そらとぶネコ'; i.dispatchEvent(new Event('input')); document.getElementById('form').requestSubmit(); })()`);
await phone.waitFor(`!document.getElementById('ticket-screen').classList.contains('hidden')`);
await sleep(500);
t.ok((await phone.text('t-number')) === '3' && (await phone.visible('st-waiting')), 'register: ticket #3 shown, waiting');
t.ok((await phone.text('ahead')) === '2', 'register: 2 ahead');
t.ok((await phone.text('eta')) === '10', 'register: estimate 2 × 5 min');
t.ok(!!(await phone.ev(`localStorage.getItem('voyage.ticketId')`)), 'register: ticket remembered');
await phone.cmd('Page.reload');
await phone.waitFor(`document.getElementById('t-number').textContent === '3'`);
t.ok((await phone.text('t-number')) === '3', 'register: reload shows the same ticket');

const op = await br.newPage();
await op.go(`${base}/operator.html`);
await op.waitFor(`document.querySelectorAll('#list tr').length === 3`);
const rows = await op.ev(`[...document.querySelectorAll('#list tr')].map(r => r.textContent)`);
t.ok(rows.length === 3 && rows[2].includes('そらとぶネコ'), 'operator: lists 3 waiting incl. the phone');
t.ok(await op.ev(`!!document.querySelector('#qr svg')`) && (await op.text('url')).includes('/register/'), 'operator: QR code drawn');

const next = () => op.ev(`document.getElementById('next').click()`);
await next(); await sleep(600);
t.ok((await op.text('s-number')) === '1', 'operator: call next → #1');
t.ok((await phone.text('ahead')) === '1' && (await phone.text('serving')) === '#1', 'phone updates live: 1 ahead, serving #1');
await op.ev(`document.querySelector('#serving [data-act=done]').click()`); await sleep(400);
await next(); await sleep(400);
await op.ev(`document.querySelector('#serving [data-act=noshow]').click()`); await sleep(600);
t.ok((await op.ev(`document.querySelectorAll('#missed li').length`)) === 1, 'operator: no-show listed for re-call');
t.ok((await phone.text('ahead')) === '0', 'phone: 0 ahead');
await next(); await sleep(800);
t.ok((await phone.visible('st-called')) && (await phone.ev(`document.getElementById('status').classList.contains('is-called')`)), 'phone flips to "your turn" when called');
await op.ev(`document.querySelector('#serving [data-act=playing]').click()`); await sleep(500);
t.ok(await phone.visible('st-playing'), 'phone shows playing');
await op.ev(`document.querySelector('#serving [data-act=done]').click()`); await sleep(500);
t.ok(await phone.visible('st-done'), 'phone shows done');

const logs = [...phone.logs, ...op.logs].filter((l) => !/favicon/.test(l));
t.ok(logs.length === 0, 'no page errors', logs.join(' | '));
await br.close();
await srv.stop();
t.done();
