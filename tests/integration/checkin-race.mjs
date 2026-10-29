// NFC check-in against the real server (json store) with taps generated from the all-zero test keys.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { checker, startServer, testSecrets, ROOT } from '../lib.mjs';

const t = checker('NFC check-in races (server, json store)');
const { makeTap } = await import(pathToFileURL(path.join(ROOT, 'tools', 'fake-tap.mjs')).href);
const keys = { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
const srv = await startServer({ port: 8202, env: { SPACELINE_SECRETS: testSecrets() } });
const api = srv.api;

const tickets = [];
for (let i = 0; i < 8; i++) tickets.push(await api('tickets', { nickname: `race${i}` }));

const tap = makeTap({ uid: '04A1B2C3D4E5F6', counter: 2000, keys });
const r = await Promise.all(tickets.map((x) => api(`tickets/${x.id}/checkin`, { ...tap, ownerToken: x.ownerToken })));
t.ok(r.filter((x) => x.status === 'accepted').length === 1 && r.filter((x) => x.reason === 'replayed').length === 7, 'one fresh tap used by 8 phones at once → exactly 1 accepted, 7 replayed');

const rest = tickets.filter((x, i) => r[i].status !== 'accepted');
const old = makeTap({ uid: '04A1B2C3D4E5F6', counter: 1500, keys });
t.ok((await api(`tickets/${rest[0].id}/checkin`, { ...old, ownerToken: rest[0].ownerToken })).reason === 'replayed', 'a saved tap with a lower counter is refused after a newer one was used');
let good = 0;
for (let i = 0; i < 3; i++) {
  const tp = makeTap({ uid: '04A1B2C3D4E5F6', counter: 3000 + i, keys });
  if ((await api(`tickets/${rest[i + 1].id}/checkin`, { ...tp, ownerToken: rest[i + 1].ownerToken })).status === 'accepted') good++;
}
t.ok(good === 3, 'later taps (higher counters) are each accepted', `${good}/3`);
t.ok((await api(`tickets/${rest[4].id}/checkin`, { ...makeTap({ uid: '04112233445566', counter: 5, keys }), ownerToken: rest[4].ownerToken })).status === 'accepted', 'a second tag has its own counter');
const forged = makeTap({ uid: '04A1B2C3D4E5F6', counter: 9999, keys: { metaReadKey: '00'.repeat(16), fileReadKey: '42'.repeat(16) } });
t.ok((await api(`tickets/${rest[5].id}/checkin`, { ...forged, ownerToken: rest[5].ownerToken })).reason === 'bad-signature', 'a tap signed with the wrong key → bad-signature');
const owner = makeTap({ uid: '04A1B2C3D4E5F6', counter: 4000, keys });
t.ok((await api(`tickets/${rest[6].id}/checkin`, { ...owner, ownerToken: rest[5].ownerToken })).reason === 'not-owner', 'someone else\'s owner token → not-owner');
t.ok((await api(`tickets/${rest[6].id}/checkin`, { ...owner, ownerToken: rest[6].ownerToken })).status === 'accepted', '... and that tap is still usable by the owner');
await srv.stop();
t.done();
