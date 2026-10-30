// Runs the queue contract test page (/tools/queue-test.html) against the dev environment, in three setups:
// open server, operator key not entered, operator key entered. NFC checks use the all-zero test keys.
import { checker, startServer, startBrowser, testSecrets, tmpDir } from '../lib.ts';

// what the contract test page leaves in window.result (reception/tools/queue-test.ts)
type Result = { status: 'pass' | 'fail' | 'skip'; name: string; detail: string };
type PageResult = { passes: number; fails: number; results: Result[] };

const t = checker('queue contract test (dev)');

const secrets = testSecrets();
const data = tmpDir('contract'); // shared across the setups, so the second and third see an already-used test tap
const setups: [string, Record<string, string>, string | null][] = [
  ['open server', {}, null],
  ['OPERATOR_KEY, key not entered', { OPERATOR_KEY: 's3cret' }, null],
  ['OPERATOR_KEY, key entered', { OPERATOR_KEY: 's3cret' }, 's3cret'],
];
for (const [label, env, key] of setups) {
  const srv = await startServer({ environment: 'dev', port: 8204, env: { DATA_DIR: data, SPACELINE_SECRETS: secrets, ...env } });
  const br = await startBrowser({ port: 9204 });
  const page = await br.newPage();
  await page.go(`${srv.url}/tools/queue-test.html`);
  let result: PageResult | null = null;
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
