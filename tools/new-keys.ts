// Creates the two AES-128 keys for the NTAG 424 DNA tags in the secrets folder (outside the project):
//   node tools/new-keys.ts
// Writes <home>/spaceline-secrets/sdm-keys.json (or SPACELINE_SECRETS). Refuses to overwrite existing keys,
// because tags already set up with them would stop working.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.SPACELINE_SECRETS || path.join(os.homedir(), 'spaceline-secrets'));
const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
if (norm(dir + path.sep).startsWith(norm(project + path.sep))) { console.error(`${dir} is inside the project folder; choose a folder outside it.`); process.exit(1); }
const file = path.join(dir, 'sdm-keys.json');
if (fs.existsSync(file)) { console.error(`${file} already exists. Tags set up with those keys depend on them; not overwriting.`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const keys = { metaReadKey: crypto.randomBytes(16).toString('hex').toUpperCase(), fileReadKey: crypto.randomBytes(16).toString('hex').toUpperCase() };
fs.writeFileSync(file, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
console.log(`Saved ${file}`);
console.log(`  metaReadKey (SDM meta read key, decrypts the UID + counter): ${keys.metaReadKey}`);
console.log(`  fileReadKey (SDM file read key, for the CMAC signature):     ${keys.fileReadKey}`);
console.log('Enter these two keys when you set up the tags, then keep a copy somewhere safe and offline.');
