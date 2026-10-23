// NTAG 424 DNA "SUN" (Secure Unique NFC) message verification, following NXP AN12196.
// The tag, configured with SDM, puts two hex parameters into its URL on every tap:
//   picc = AES-128 encrypted PICC data (tag UID + tap counter)      cmac = 8-byte truncated CMAC
// verifySun() decrypts the UID and counter and checks the CMAC. The keys never leave the reception PC.
import crypto from 'node:crypto';

const ZERO = Buffer.alloc(16);

function aesEcb(key, block, decrypt = false) {
  const c = decrypt ? crypto.createDecipheriv('aes-128-ecb', key, null) : crypto.createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

// AES-CMAC (RFC 4493)
function subkey(b) {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = ((b[i] << 1) | (i < 15 ? b[i + 1] >> 7 : 0)) & 0xff;
  if (b[0] & 0x80) out[15] ^= 0x87;
  return out;
}
export function aesCmac(key, msg) {
  const k1 = subkey(aesEcb(key, ZERO));
  const k2 = subkey(k1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const complete = msg.length > 0 && msg.length % 16 === 0;
  const last = Buffer.alloc(16);
  msg.copy(last, 0, (n - 1) * 16);
  if (!complete) last[msg.length - (n - 1) * 16] = 0x80;
  const sub = complete ? k1 : k2;
  for (let i = 0; i < 16; i++) last[i] ^= sub[i];
  let x = Buffer.alloc(16);
  for (let b = 0; b < n - 1; b++) {
    const blk = msg.subarray(b * 16, b * 16 + 16);
    for (let i = 0; i < 16; i++) x[i] ^= blk[i];
    x = aesEcb(key, x);
  }
  for (let i = 0; i < 16; i++) x[i] ^= last[i];
  return aesEcb(key, x);
}

const isHex = (s, len) => typeof s === 'string' && s.length === len && /^[0-9a-fA-F]+$/.test(s);
const keyBuf = (k) => {
  if (!isHex(k, 32)) throw new Error('SDM keys must be 32 hex characters (AES-128)');
  return Buffer.from(k, 'hex');
};

// keys: { metaReadKey, fileReadKey } as hex. Returns { ok: true, uid, counter } or { ok: false, reason }.
// reason: 'malformed' | 'bad-picc' | 'bad-signature'
export function verifySun({ picc, cmac }, keys) {
  if (!isHex(picc, 32) || !isHex(cmac, 16)) return { ok: false, reason: 'malformed' };
  const metaKey = keyBuf(keys.metaReadKey), fileKey = keyBuf(keys.fileReadKey);

  // 1. decrypt the PICC data (one block, so CBC with a zero IV is plain ECB)
  const plain = aesEcb(metaKey, Buffer.from(picc, 'hex'), true);
  const tag = plain[0];
  const hasUid = (tag & 0x80) !== 0, hasCounter = (tag & 0x40) !== 0, uidLen = tag & 0x0f;
  if (!hasUid || !hasCounter || uidLen !== 7) return { ok: false, reason: 'bad-picc' }; // wrong key, or not mirroring UID + counter
  const uid = plain.subarray(1, 8);
  const ctrBytes = plain.subarray(8, 11); // least significant byte first
  const counter = ctrBytes[0] | (ctrBytes[1] << 8) | (ctrBytes[2] << 16);

  // 2. session MAC key from the UID and counter, then the CMAC over the (empty) MAC input
  const sv2 = Buffer.concat([Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]), uid, ctrBytes]);
  const sessionKey = aesCmac(fileKey, sv2);
  const full = aesCmac(sessionKey, Buffer.alloc(0));
  const truncated = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i])); // the odd bytes
  const given = Buffer.from(cmac, 'hex');
  if (!crypto.timingSafeEqual(truncated, given)) return { ok: false, reason: 'bad-signature' };
  return { ok: true, uid: uid.toString('hex').toUpperCase(), counter };
}
