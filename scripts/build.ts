// Builds the pages into dist/ (the server, tools and tests need no build: Node 24+ runs their .ts directly):
//   dist/hosting    phone registration page (Firebase Hosting)
//   dist/reception  booth, operator page, contract test page (reception PC)
//   dist/build.json which environment the pages were built for (the server reads it)
//
//   npm run build                  → the 'product' environment (type checks first)
//   npm run build:dev              → the 'dev' environment (local queue on the reception server)
//   node scripts/build.ts --env dev --out <dir> --pages-only   (used by the tests: no type check)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const environment = opt('env', 'product');
const out = path.resolve(root, opt('out', 'dist'));
const pagesOnly = args.includes('--pages-only');
if (!['product', 'dev'].includes(environment)) { console.error(`unknown environment "${environment}" (product | dev)`); process.exit(1); }

// a type error stops the build, so nothing is deployed or served that doesn't type check
if (!pagesOnly) {
  for (const project of ['tsconfig.web.json', 'tsconfig.node.json']) {
    try {
      execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, project)], { stdio: 'inherit' });
    } catch {
      console.error(`type errors in ${project}; nothing was built`);
      process.exit(1);
    }
  }
}

process.env.SPACELINE_ENV = environment;
process.env.SPACELINE_OUT = out;
for (const config of ['vite.hosting.config.ts', 'vite.reception.config.ts']) {
  await build({ configFile: path.join(root, config), logLevel: 'warn' });
}
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ environment, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`built for "${environment}" → ${out}`);
