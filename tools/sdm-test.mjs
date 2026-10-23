// Checks server/sdm.mjs against published test vectors:  node tools/sdm-test.mjs
import { aesCmac, verifySun } from '../server/sdm.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const hex = (b) => b.toString('hex').toUpperCase();

// RFC 4493 AES-CMAC vectors
const K = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
ok(hex(aesCmac(K, Buffer.alloc(0))) === 'BB1D6929E95937287FA37D129B756746', 'AES-CMAC, empty message (RFC 4493)');
ok(hex(aesCmac(K, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex'))) === '070A16B46B4D4144F79BDD9DD04A287C', 'AES-CMAC, 16 bytes (RFC 4493)');
ok(hex(aesCmac(K, Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411', 'hex'))) === 'DFA66747DE9AE63030CA32611497C827', 'AES-CMAC, 40 bytes (RFC 4493)');

// NTAG 424 DNA SUN message with factory (all-zero) keys: NXP AN12196 / common SUN verifier test vector
const zero = { metaReadKey: '00'.repeat(16), fileReadKey: '00'.repeat(16) };
const r = verifySun({ picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' }, zero);
ok(r.ok && r.uid === '04DE5F1EACC040' && r.counter === 61, `SUN vector → UID 04DE5F1EACC040, counter 61 (got ${JSON.stringify(r)})`);
ok(verifySun({ picc: 'ef963ff7828658a599f3041510671e88', cmac: '94eed9ee65337086' }, zero).ok, 'lower-case hex accepted');
ok(verifySun({ picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337087' }, zero).reason === 'bad-signature', 'one bit changed in cmac → bad-signature');
ok(verifySun({ picc: 'EF963FF7828658A599F3041510671E89', cmac: '94EED9EE65337086' }, zero).ok === false, 'one bit changed in picc → rejected');
const other = { metaReadKey: '00'.repeat(16), fileReadKey: '11'.repeat(16) };
ok(verifySun({ picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' }, other).reason === 'bad-signature', 'wrong file key → bad-signature');
ok(verifySun({ picc: 'EF963FF7828658A599F3041510671E88', cmac: '94EED9EE65337086' }, { ...zero, metaReadKey: '22'.repeat(16) }).ok === false, 'wrong meta key → rejected');
ok(verifySun({ picc: 'xyz', cmac: '94EED9EE65337086' }, zero).reason === 'malformed', 'malformed input → malformed');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
