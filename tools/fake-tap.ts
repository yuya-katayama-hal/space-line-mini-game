// Makes the URL an NTAG 424 DNA tag would produce on a tap, for testing WITHOUT a real tag.
// Only for the dev environment with test keys: anyone holding the keys can make valid taps, which is exactly
// why the real keys must stay in the secrets folder on the reception PC.
//   node tools/fake-tap.ts [counter] [uid] [base-url]
//   e.g. node tools/fake-tap.ts 100 04A1B2C3D4E5F6 http://192.168.1.20:8000/register/
// Uses <secrets>/sdm-keys.json if SPACELINE_SECRETS points to one, otherwise the all-zero test keys.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { aesCmac } from '../server/sdm.ts';
import type { SdmKeys } from '../server/sdm.ts';

export function makeTap({ uid, counter, keys }: { uid: string; counter: number; keys: SdmKeys }) {
  const uidBuf = Buffer.from(uid, 'hex');
  if (uidBuf.length !== 7) throw new Error('uid must be 7 bytes (14 hex characters)');
  const ctr = Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]);
  const plain = Buffer.concat([Buffer.from([0xc7]), uidBuf, ctr, crypto.randomBytes(5)]); // tag 0xC7: UID + counter mirrored
  const enc = crypto.createCipheriv('aes-128-ecb', Buffer.from(keys.metaReadKey, 'hex'), null);
  enc.setAutoPadding(false);
  const picc = Buffer.concat([enc.update(plain), enc.final()]);
  const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uidBuf, ctr]);
  const full = aesCmac(aesCmac(Buffer.from(keys.fileReadKey, 'hex'), sv2), Buffer.alloc(0));
  const cmac = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i]));
  return { picc: picc.toString('hex').toUpperCase(), cmac: cmac.toString('hex').toUpperCase() };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [counter = String(Math.floor(Date.now() / 1000) % 0xffffff), uid = '04DE5F1EACC040', base = 'http://localhost:8000/register/'] = process.argv.slice(2);
  const file = path.join(process.env.SPACELINE_SECRETS || path.join(os.homedir(), 'spaceline-secrets'), 'sdm-keys.json');
  const keys: SdmKeys = process.env.SPACELINE_SECRETS && fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
  const { picc, cmac } = makeTap({ uid, counter: Number(counter), keys });
  console.log(`${base}?picc=${picc}&cmac=${cmac}`);
}
