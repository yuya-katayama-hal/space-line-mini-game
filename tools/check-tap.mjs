// Checks a URL from a real tag tap with the keys in the secrets folder (use it after setting up a tag):
//   node tools/check-tap.mjs "https://space-line-54818.web.app/register/?picc=...&cmac=..."
//   node tools/check-tap.mjs <picc> <cmac>        (the two values alone; easier where & in a URL gets cut off)
// Prints the tag UID and tap counter if the signature is valid. Nothing is recorded; the tap stays usable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifySun } from '../server/sdm.mjs';

const dir = process.env.SPACELINE_SECRETS || path.join(os.homedir(), 'spaceline-secrets');
const file = path.join(dir, 'sdm-keys.json');
if (!fs.existsSync(file)) { console.error(`No ${file}. Create it first (docs/nfc-checkin.md).`); process.exit(1); }
const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
const [arg, arg2] = process.argv.slice(2);
if (!arg) { console.error('Usage: node tools/check-tap.mjs "<URL from the tag>"   or   node tools/check-tap.mjs <picc> <cmac>'); process.exit(1); }
let picc, cmac;
if (arg2) {
  [picc, cmac] = [arg, arg2];
} else {
  const u = new URL(arg);
  [picc, cmac] = [u.searchParams.get('picc'), u.searchParams.get('cmac')];
  console.log(`page:  ${u.origin}${u.pathname}`);
}
const r = verifySun({ picc, cmac }, keys);
if (r.ok) {
  console.log(`OK     tag UID ${r.uid}, tap counter ${r.counter}`);
} else {
  const hint = {
    'malformed': 'the URL needs picc= (32 hex) and cmac= (16 hex): check the parameter names and SDM mirroring on the tag',
    'bad-picc': 'picc does not decrypt with metaReadKey: the tag\'s SDM meta read key differs, or UID + counter mirroring is off',
    'bad-signature': 'cmac does not match with fileReadKey: the tag\'s SDM file read key differs, or the MAC covers more than nothing (MAC input offset must equal the MAC offset)',
  }[r.reason];
  console.log(`NG     ${r.reason}: ${hint}`);
  process.exit(2);
}
