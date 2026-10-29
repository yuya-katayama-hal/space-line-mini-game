// Builds everything into dist/:
//   dist/hosting    phone registration page (Firebase Hosting)
//   dist/reception  booth, operator page, contract test page (reception PC)
//   dist/node       server and command-line tools (reception PC), once they are TypeScript
//   dist/build.json which environment the pages were built for (the server reads it)
//
//   npm run build                  → the 'product' environment
//   npm run build:dev              → the 'dev' environment (local queue on the reception server)
//   node scripts/build.mjs --env dev --out <dir> --pages-only   (used by the tests)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const environment = opt('env', 'product');
const out = path.resolve(root, opt('out', 'dist'));
const pagesOnly = args.includes('--pages-only');
if (!['product', 'dev'].includes(environment)) { console.error(`unknown environment "${environment}" (product | dev)`); process.exit(1); }

process.env.SPACELINE_ENV = environment;
process.env.SPACELINE_OUT = out;
for (const config of ['vite.hosting.config.ts', 'vite.reception.config.ts']) {
  await build({ configFile: path.join(root, config), logLevel: 'warn' });
}
if (!pagesOnly && fs.existsSync(path.join(root, 'tsconfig.node.json'))) {
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.node.json')], { stdio: 'inherit' });
}
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ environment, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`built for "${environment}" → ${out}`);
