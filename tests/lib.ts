// Shared helpers for the integration and browser tests: start the server, drive headless Chrome over the
// DevTools protocol, prepare the dev environment, report PASS / FAIL.
// Answers from the server API and from page.ev() are typed `any`: the tests check their shape themselves.
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const tmpDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `spaceline-${prefix}-`));

// ---------- PASS / FAIL ----------
export function checker(title?: string) {
  let fails = 0, passes = 0;
  if (title) console.log(`\n=== ${title} ===`);
  return {
    ok(cond: unknown, msg: string, extra: unknown = '') {
      console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${extra !== '' ? `  — ${extra}` : ''}`);
      if (cond) passes++; else fails++;
      return !!cond;
    },
    get fails() { return fails; },
    done() {
      console.log(fails ? `${fails} FAILED, ${passes} passed` : `all ${passes} passed`);
      if (fails) process.exitCode = 1;
      return fails;
    },
  };
}

// ---------- the server ----------
// The test keys (all zero) for NFC check-in: valid taps can be made with tools/fake-tap.ts.
export function testSecrets() {
  const dir = tmpDir('secrets');
  fs.writeFileSync(path.join(dir, 'sdm-keys.json'), JSON.stringify({ metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) }));
  return dir;
}

// The built pages a test serves (SPACELINE_DIST): the regular build ('product', built if missing), or a 'dev'
// build in a temporary folder. Pages bake the environment in at build time.
const builds = new Map<string, string>();
export function distFor(environment = 'product') {
  const known = builds.get(environment);
  if (known) return known;
  let dir;
  if (environment === 'product') {
    dir = path.join(ROOT, 'dist');
    if (!fs.existsSync(path.join(dir, 'build.json'))) buildPages('product', dir, false);
    else if (JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8')).environment !== 'product') throw new Error('dist/ holds a dev build; run "npm run build" first');
  } else {
    dir = tmpDir(`dist-${environment}`);
    buildPages(environment, dir, true);
  }
  builds.set(environment, dir);
  return dir;
}
function buildPages(environment: string, out: string, pagesOnly: boolean) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.ts'), '--env', environment, '--out', out, ...(pagesOnly ? ['--pages-only'] : [])], { cwd: ROOT, stdio: 'ignore' });
}

// waits until a child process has exited (killing it first)
const stopProcess = (proc: ChildProcess) => new Promise<void>((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', () => r()); proc.kill(); });

// Starts the server for an environment's build and waits until it answers.
// env: extra environment variables (DATA_DIR defaults to a fresh temp dir).
export async function startServer({ environment = 'product', port, env = {} }: { environment?: string; port: number; env?: Record<string, string> }) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.ts')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmpDir('data'), SPACELINE_SECRETS: tmpDir('nosecrets'), SPACELINE_DIST: distFor(environment), ...env },
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${url}/api/info`)).ok) break; } catch {}
    if (proc.exitCode !== null) throw new Error(`server exited:\n${log}`);
    await sleep(100);
  }
  return {
    url, proc,
    get log() { return log; },
    // GET /api/<p>, or POST it with a JSON body
    api: (p: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> =>
      fetch(`${url}/api/${p}`, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.json()),
    stop: () => stopProcess(proc),
  };
}

// ---------- headless Chrome ----------
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((c): c is string => !!c);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

export async function startBrowser({ port, width = 1280, height = 720 }: { port: number; width?: number; height?: number }) {
  const proc = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${tmpDir('chrome')}`,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`, 'about:blank',
  ]);
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    await sleep(200);
  }
  return {
    newPage: (opts?: { mobileWidth?: number }) => openPage(port, opts),
    close: () => stopProcess(proc),
  };
}

export type Page = Awaited<ReturnType<typeof openPage>>;

async function openPage(port: number, { mobileWidth }: { mobileWidth?: number } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending: Record<number, (d: any) => void> = {}, logs: string[] = [], dialogs: string[] = [];
  // a DevTools protocol command; resolves with the whole answer ({ id, result } or { id, error })
  const cmd = (method: string, params: object = {}) => new Promise<any>((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
    if (d.method === 'Page.javascriptDialogOpening') { dialogs.push(d.params.message); cmd('Page.handleJavaScriptDialog', { accept: true }); }
    if (d.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION ${d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(`console.error ${d.params.args.map((a: any) => a.value ?? a.description).join(' ')}`);
  };
  await cmd('Runtime.enable');
  await cmd('Page.enable');
  if (mobileWidth) await cmd('Emulation.setDeviceMetricsOverride', { width: mobileWidth, height: 844, deviceScaleFactor: 1, mobile: true });
  const page = {
    cmd, logs, dialogs,
    go: (url: string) => cmd('Page.navigate', { url }),
    // evaluates an expression in the page (awaiting a promise) and returns its value
    ev: async (expr: string): Promise<any> => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value,
    visible: (elId: string): Promise<boolean> => page.ev(`(() => { const e = document.getElementById(${JSON.stringify(elId)}); return !!e && !e.classList.contains('hidden'); })()`),
    text: (elId: string): Promise<string> => page.ev(`(document.getElementById(${JSON.stringify(elId)}) || {}).textContent`),
    mouse: (x: number, y: number, type = 'mouseMoved') => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }),
    key: async (key: string) => { for (const type of ['rawKeyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0) }); },
    shot: async (file: string) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    waitFor: async (expr: string, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.ev(expr)) return true; await sleep(200); } return false; },
  };
  return page;
}

// fill the phone page's form and register
export async function registerOnPhone(page: Page, base: string, nickname: string) {
  await page.go(`${base}/register/`);
  await page.waitFor(`!document.getElementById('form-screen').classList.contains('hidden') || !document.getElementById('ticket-screen').classList.contains('hidden')`);
  await page.ev(`(() => { const i = document.getElementById('nickname'); i.value = ${JSON.stringify(nickname)}; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('form').requestSubmit(); })()`);
  await page.waitFor(`!document.getElementById('ticket-screen').classList.contains('hidden')`);
  return JSON.parse(await page.ev(`localStorage.getItem('voyage.ticketId')`));
}
