// Cancelling through the real pages (dev environment): the visitor cancels on the phone, 新しく登録 cancels the old
// ticket, staff cancel from the operator page, records count cancellations.
import { checker, projectFor, startServer, startBrowser, registerOnPhone, sleep } from '../lib.mjs';

const t = checker('cancel through the pages (dev)');
const srv = await startServer({ root: projectFor('dev'), port: 8206 });
const br = await startBrowser({ port: 9206 });
const base = srv.url;

const phone = await br.newPage({ mobileWidth: 390 });
const mine = await registerOnPhone(phone, base, 'キャンセル太郎');
t.ok(await phone.visible('cancel'), 'phone: "受付をキャンセル" shown while waiting');
await phone.ev(`document.getElementById('cancel').click()`);
await phone.waitFor(`!document.getElementById('st-cancelled').classList.contains('hidden')`);
t.ok(phone.dialogs.some((m) => m.startsWith('受付をキャンセルしますか')), 'phone: asks for confirmation');
t.ok((await phone.visible('st-cancelled')) && !(await phone.visible('cancel')), 'phone: shows "キャンセルしました", button gone');
t.ok((await srv.api(`tickets/${mine.id}`)).status === 'cancelled', 'server: ticket is cancelled');

await phone.ev(`document.getElementById('again').click()`); await sleep(500);
await phone.ev(`(() => { const i = document.getElementById('nickname'); i.value = '二回目'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('form').requestSubmit(); })()`);
await phone.waitFor(`!document.getElementById('ticket-screen').classList.contains('hidden')`);
const second = JSON.parse(await phone.ev(`localStorage.getItem('voyage.ticketId')`)).id;
await phone.ev(`document.getElementById('again').click()`); await sleep(1200);
t.ok((await srv.api(`tickets/${second}`)).status === 'cancelled', 'phone: 新しく登録 cancels the previous waiting ticket');

const victim = await srv.api('tickets', { nickname: '取消される人' });
const op = await br.newPage();
await op.go(`${base}/operator.html`);
await op.waitFor(`document.getElementById('list').innerText.includes('取消される人')`);
await op.ev(`[...document.querySelectorAll('#list tr')].find(tr => tr.innerText.includes('取消される人')).querySelector('button:nth-of-type(3)').click()`);
await sleep(1500);
t.ok(op.dialogs.some((m) => m.includes('キャンセルしますか')), 'operator: asks for confirmation');
t.ok((await srv.api(`tickets/${victim.id}`)).status === 'cancelled', 'operator: ticket cancelled from the list');
t.ok(!(await op.ev(`document.getElementById('list').innerText.includes('取消される人')`)), 'operator: it left the waiting list');
await op.waitFor(`/キャンセル 3/.test(document.getElementById('stats').innerText)`, 5000);
t.ok(/キャンセル 3/.test(await op.ev(`document.getElementById('stats').innerText`)), 'operator: records count cancellations');
t.ok((await srv.api(`tickets/${mine.id}/cancel`, { ownerToken: 'x' })).reason === 'not-owner', 'server: wrong owner token cannot cancel');
t.ok((await srv.api(`tickets/${victim.id}/checkin`, { manual: true })).reason === 'closed', 'server: manual check-in of a cancelled ticket → closed');

const logs = [phone, op].flatMap((p) => p.logs).filter((l) => !/favicon/.test(l));
t.ok(logs.length === 0, 'no page errors', logs.join(' | '));
await br.close();
await srv.stop();
t.done();
