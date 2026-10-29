// The booth: a full turn in the product environment (launch by swipe → space → Moon gate → fly home → landing →
// finale → attract), launch-gesture rules, Mars reachable, and in the dev environment the queue flow
// (called + checked-in visitor greeted, ticket playing → done after the turn, next visitor shown).
import { checker, startServer, startBrowser, sleep } from '../lib.mjs';

const t = checker('booth');
const phase = (p) => p.ev(`voyage.state.phase + (voyage.state.transitioning ? '*' : '')`);
const settled = (p, ph, ms = 25000) => p.waitFor(`voyage.state.phase === '${ph}' && !voyage.state.transitioning`, ms);
async function swipe(p, fromY, toY) { for (let y = fromY; y >= toY; y -= 60) { await p.mouse(640, y); await sleep(35); } }

// ---------- product: a full turn ----------
{
  const srv = await startServer({ port: 8207 });
  const br = await startBrowser({ port: 9207 });
  const b = await br.newPage();
  await b.go(`${srv.url}/`);
  await b.waitFor('!!window.voyage', 20000);
  await sleep(1500);
  t.ok((await phase(b)) === 'attract', 'starts on the attract screen');
  await b.mouse(640, 110); await sleep(800);
  t.ok((await phase(b)) === 'launch', 'a hand (mouse) starts a turn on the launch pad');
  for (let i = 0; i < 20; i++) { await b.mouse(640 + (i % 2), 110); await sleep(200); }
  t.ok((await phase(b)) === 'launch', 'holding the hand up high does not launch');
  const h = await b.ev('innerHeight');
  await swipe(b, Math.round(h * 0.4), 20);
  await sleep(400);
  t.ok((await phase(b)) === 'launch', 'a fast rise that starts in the upper half does not launch');
  await b.mouse(640, Math.round(h * 0.9)); await sleep(300);
  await swipe(b, Math.round(h * 0.9), Math.round(h * 0.2));
  await sleep(400);
  t.ok(/^launch\*/.test(await phase(b)), 'a low-to-high swipe launches (countdown)');
  t.ok(await settled(b, 'space'), 'lift-off → space');
  t.ok((await b.text('era-year')) === '2126', 'space shows 2126');
  const gates = await b.ev(`voyage.scenes.space.targets.filter(x => x.id.startsWith('gate-')).map(x => [x.id, x._vis])`);
  t.ok(gates.length === 2 && gates.every((g) => g[1]), 'two visible gates (Moon, Mars)', JSON.stringify(gates));
  const g = await b.ev(`(() => { const x = voyage.scenes.space.targets.find(x => x.id === 'gate-moon'); return [x._x, x._y]; })()`);
  await b.mouse(g[0], g[1]); await sleep(2000); await b.mouse(120, 300);
  t.ok(await settled(b, 'dest'), 'dwelling on the Moon gate → the Moon');
  t.ok((await b.ev('voyage.ui.era')) === 'moon', 'era is moon');
  await b.key('Escape'); await sleep(300);
  t.ok((await phase(b)).startsWith('return'), 'Esc at a destination flies home');
  t.ok(await b.waitFor(`voyage.scenes.launch.mode === 'landing'`, 25000), 'homecoming → capsule landing');
  t.ok(await settled(b, 'finale', 30000), 'landing → closing message');
  await b.key('Escape'); await sleep(800);
  t.ok((await phase(b)) === 'attract', 'Esc on the closing message ends the turn');
  await b.mouse(500, 400); await sleep(1200);
  t.ok((await phase(b)) === 'attract', 'the same visitor still present does not restart a turn');
  await b.ev(`voyage.travel('mars')`);
  t.ok(await settled(b, 'dest'), 'operator key path: travel to Mars works');
  t.ok((await b.ev('voyage.ui.era')) === 'mars' && (await b.ev(`voyage.scenes.mars.targets.every(x => x._vis)`)), 'Mars: all hotspots visible');
  const logs = b.logs.filter((l) => !/favicon|GL_CONTEXT|OpenGL/.test(l));
  t.ok(logs.length === 0, 'no page errors (product)', logs.join(' | '));
  await br.close();
  await srv.stop();
}

// ---------- dev: queue + booth ----------
{
  const srv = await startServer({ environment: 'dev', port: 8208 });
  const a = await srv.api('tickets', { nickname: 'はると' });
  const bt = await srv.api('tickets', { nickname: 'Mia' });
  await srv.api('call-next', {});
  await srv.api(`tickets/${a.id}/checkin`, { manual: true });
  const br = await startBrowser({ port: 9208 });
  const b = await br.newPage();
  await b.go(`${srv.url}/`);
  await b.waitFor('!!(window.voyage && window.voyage.queue)', 20000);
  await sleep(1000);
  t.ok((await b.text('next-up')).includes('#1 はると'), 'attract screen shows the next visitor');
  t.ok(await b.ev(`!!document.querySelector('#qr svg')`), 'attract screen shows the registration QR');
  await b.mouse(640, 500); await sleep(1500);
  t.ok((await b.ev('voyage.turn.ticket && voyage.turn.ticket.number')) === 1 && (await b.text('caption')).startsWith('ようこそ、はるとさん'), 'called + checked-in visitor is greeted by name');
  await sleep(500);
  t.ok((await srv.api(`tickets/${a.id}`)).status === 'playing', 'ticket marked playing');
  await b.ev('voyage.launch()');
  await settled(b, 'space');
  await b.ev('voyage.goHome()');
  t.ok(await settled(b, 'finale', 40000), 'turn reaches the closing message');
  t.ok((await b.text('finale-title')) === 'おかえりなさい、はるとさん', 'closing message uses the nickname');
  await b.key('Escape'); await sleep(1500);
  t.ok((await srv.api(`tickets/${a.id}`)).status === 'done' && (await srv.api(`tickets/${bt.id}`)).status === 'waiting', 'after the turn: ticket done, next one still waiting');
  t.ok((await b.text('next-up')).includes('#2 Mia'), 'attract screen moves on to the next visitor');
  const logs = b.logs.filter((l) => !/favicon|GL_CONTEXT|OpenGL/.test(l));
  t.ok(logs.length === 0, 'no page errors (dev)', logs.join(' | '));
  await br.close();
  await srv.stop();
}
t.done();
