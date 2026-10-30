// server/sdm.ts against published test vectors (RFC 4493 AES-CMAC, NXP AN12196 SUN message) and tools/fake-tap.ts.
import { describe, expect, it } from 'vitest';
import { aesCmac, verifySun } from '../../server/sdm.ts';
import { makeTap } from '../../tools/fake-tap.ts';

const hex = (b: Buffer) => b.toString('hex').toUpperCase();
const zero = { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
const PICC = 'EF963FF7828658A599F3041510671E88', CMAC = '94EED9EE65337086';

describe('AES-CMAC (RFC 4493)', () => {
  const K = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
  it('empty message', () => expect(hex(aesCmac(K, Buffer.alloc(0)))).toBe('BB1D6929E95937287FA37D129B756746'));
  it('16 bytes', () => expect(hex(aesCmac(K, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex')))).toBe('070A16B46B4D4144F79BDD9DD04A287C'));
  it('40 bytes', () => {
    const msg = Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411', 'hex');
    expect(hex(aesCmac(K, msg))).toBe('DFA66747DE9AE63030CA32611497C827');
  });
});

describe('verifySun', () => {
  it('decodes the NXP test tap (zero keys): UID 04DE5F1EACC040, counter 61', () => {
    expect(verifySun({ picc: PICC, cmac: CMAC }, zero)).toEqual({ ok: true, uid: '04DE5F1EACC040', counter: 61 });
  });
  it('accepts lower-case hex', () => expect(verifySun({ picc: PICC.toLowerCase(), cmac: CMAC.toLowerCase() }, zero).ok).toBe(true));
  it('one bit changed in cmac → bad-signature', () => expect(verifySun({ picc: PICC, cmac: '94EED9EE65337087' }, zero)).toEqual({ ok: false, reason: 'bad-signature' }));
  it('one bit changed in picc → rejected', () => expect(verifySun({ picc: 'EF963FF7828658A599F3041510671E89', cmac: CMAC }, zero).ok).toBe(false));
  it('wrong file key → bad-signature', () => expect(verifySun({ picc: PICC, cmac: CMAC }, { ...zero, fileReadKey: '11'.repeat(16) })).toEqual({ ok: false, reason: 'bad-signature' }));
  it('wrong meta key → rejected', () => expect(verifySun({ picc: PICC, cmac: CMAC }, { ...zero, metaReadKey: '22'.repeat(16) }).ok).toBe(false));
  it.each([
    [{ picc: 'xyz', cmac: CMAC }],
    [{ picc: PICC, cmac: '' }],
    [{ picc: 42, cmac: CMAC }],
    [{}],
  ])('malformed input %j → malformed', (input) => expect(verifySun(input, zero)).toEqual({ ok: false, reason: 'malformed' }));
});

describe('makeTap (tools/fake-tap.ts)', () => {
  const keys = { metaReadKey: '0123456789ABCDEF0123456789ABCDEF', fileReadKey: 'FEDCBA9876543210FEDCBA9876543210' };
  it('makes taps verifySun accepts, with the given UID and counter', () => {
    for (const counter of [0, 1, 255, 256, 0xabcdef]) {
      expect(verifySun(makeTap({ uid: '04A1B2C3D4E5F6', counter, keys }), keys)).toEqual({ ok: true, uid: '04A1B2C3D4E5F6', counter });
    }
  });
  it('a tap made with other keys is refused', () => {
    expect(verifySun(makeTap({ uid: '04A1B2C3D4E5F6', counter: 5, keys: zero }), keys).ok).toBe(false);
  });
  it('refuses a UID that is not 7 bytes', () => expect(() => makeTap({ uid: '0102', counter: 1, keys })).toThrow(/7 bytes/));
});
