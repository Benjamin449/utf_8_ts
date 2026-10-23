# utf_8_ts

Validates and decodes UTF-8 byte sequences, rejecting overlong encodings and surrogate code points per the WHATWG / Unicode "Well-Formed UTF-8" definition.

```js
import { validate, decode, decodeToString, VALID } from './src/index.js';

const bytes = new Uint8Array([0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f]); // "héllo"

const r = validate(bytes);
if (r === VALID) {
  const { string } = decodeToString(bytes);
  console.log(string); // héllo
}
```

`validate(bytes)` returns the frozen `VALID` sentinel on success, or `{ ok: false, index, reason }` on the first malformed byte. `decode(bytes)` returns `{ ok: true, units }` where `units` is an array of UTF-16 code units, or the same error shape. `decodeToString` is a convenience that joins those units into a JavaScript string.

## Why this exists

The built-in `TextDecoder('utf-8')` is fast and lenient by default — with `fatal: true` it throws on bad input, and without it silently replaces bad bytes with U+FFFD. Neither gives you the byte offset of the error or a structured result you can branch on without try/catch. This library fills that gap: a pure-JavaScript validator that reports where input went wrong and lets you decode only when you already know the input is good.

The trade-off is speed. This is single-pass JavaScript with no SIMD and no native code. For validating megabytes of trusted UTF-8, prefer `TextDecoder`. For a few kilobytes of untrusted input where you need the offset of the first bad byte, this is the right shape.

## Edge you will hit

`decode` returns UTF-16 code units, not Unicode code points. Characters outside the Basic Multilingual Plane (above U+FFFF) come back as two units forming a surrogate pair. This matches what a JavaScript string contains, so `decodeToString` round-trips correctly, but if you iterate `result.units` expecting one entry per character you will be surprised by emoji and other astral-plane text. The choice is deliberate: the caller can join with `String.fromCharCode` for free, while going the other direction (splitting a string into code points) would add overhead nobody asked for.

Another deliberate interpretation: lone surrogate code points (U+D800–U+DFFF) are treated as invalid input, never emitted. Some environments (CESU-8, WTF-8) allow encoding them; this library follows the WHATWG and Unicode "Well-Formed UTF-8" rules and rejects them. If you need CESU-8, this is not the library for it.
