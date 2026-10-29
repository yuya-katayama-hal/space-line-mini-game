// Nickname rules, shared by the phone page and both adapters (server.mjs repeats them and has the final say).
// Trim, drop control / invisible characters and HTML-ish symbols, collapse spaces, keep at most 12 characters.
export const NICKNAME_MAX = 12;

// control, zero-width, bidi-override and BOM characters, built from code points
const INVISIBLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');

export function cleanNickname(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, NICKNAME_MAX).join('');
}
