// Runs the queue contract test page (/tools/queue-test.html) against the dev environment, in three setups:
// open server, operator key not entered, operator key entered. NFC checks use the all-zero test keys.
import { checker, projectFor, startServer, startBrowser, testSecrets, tmpDir } from '../lib.mjs';

const t = checker('queue contract test (dev)');
const root = projectFor('dev');
const secrets = testSecrets();
const data = tmpDir('contract'); // shared across the setups, so the second and third see an already-used test tap
for (const [label, env, key] of [
  ['open server', {}, null],
  ['OPERATOR_KEY, key not entered', { OPERATOR_KEY: 's3cret' }, null],
  ['OPERATOR_KEY, key entered', { OPERATOR_KEY: 's3cret' }, 's3cret'],
]) {
  const srv = await startServer({ root, port: 8204, env: { DATA_DIR: data, SPACELINE_SECRETS: secrets, ...env } });
  const br = await startBrowser({ port: 9204 });
  const page = await br.newPage();
  await page.go(`${srv.url}/tools/queue-test.html`);
  let result = null;
  for (let i = 0; i < 150 && !result; i++) {
    if (await page.visible('key-box')) await page.ev(key ? `document.getElementById('key').value = '${key}'; document.getElementById('key-go').click()` : `document.getElementById('key-skip').click()`);
    result = await page.ev('window.result');
    if (!result) await new Promise((r) => setTimeout(r, 200));
  }
  const fails = result ? result.results.filter((r) => r.status === 'fail') : [];
  t.ok(result && result.fails === 0, `${label}: ${result ? `${result.passes} passed, ${result.results.filter((r) => r.status === 'skip').length} skipped` : 'no result'}`,
    fails.map((f) => `${f.name}: ${f.detail}`).join(' | '));
  await br.close();
  await srv.stop();
}
t.done();
