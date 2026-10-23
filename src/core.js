/**
 * UTF-8 byte-sequence validator and decoder.
 *
 * Design decision: this module operates on Uint8Array only and returns plain
 * structures. It never throws for bad input — it returns a result object with
 * ok=false so callers can branch without try/catch. The reason is that UTF-8
 * validation is frequently used on untrusted input where throwing would be
 * noisy, and a boolean result is cheaper to branch on than a stack trace is
 * to build.
 *
 * Interpretation choice (stated plainly): decode returns an array of UTF-16
 * code units (i.e. what JavaScript strings are made of). We do NOT join them
 * into a string because that hides the cost and the caller may want to reason
 * about surrogate pairs directly. decodeToString is provided as a convenience
 * wrapper. Both reject overlong encodings and out-of-range code points, and
 * treat lone surrogate code points U+D800–U+DFFF as invalid rather than
 * encoding them as CESU-8 — this matches WHATWG / Unicode "Well-Formed UTF-8".
 */

/**
 * Sentinel returned in result objects when validation succeeds. Keeping it an
 * object identity rather than a string lets callers compare with === VALID
 * without worrying about accidental string matches from other sources.
 */
export const VALID = Object.freeze({ ok: true });

/**
 * @typedef {Object} InvalidResult
 * @property {false} ok
 * @property {number} index  Byte offset where the error was detected.
 * @property {string} reason Short human-readable explanation.
 */

/**
 * @typedef {Object} ValidResult
 * @property {true} ok
 */

/**
 * @param {number} b
 * @returns {boolean}
 */
function isAscii(b) {
  return b < 0x80;
}

/**
 * Validate a Uint8Array as well-formed UTF-8 per the WHATWG encoding spec,
 * rejecting overlong encodings, code points above U+10FFFF, and surrogate
 * code points (U+D800–U+DFFF).
 *
 * @param {Uint8Array} bytes
 * @returns {ValidResult|InvalidResult}
 */
export function validate(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, index: 0, reason: 'expected Uint8Array' };
  }

  let i = 0;
  const len = bytes.length;

  while (i < len) {
    const b0 = bytes[i];

    // 1-byte sequence: ASCII fast path. Most real-world input is ASCII, so
    // handling it inline avoids function-call overhead in the hot loop.
    if (isAscii(b0)) {
      i++;
      continue;
    }

    let codePoint;
    let extra;

    if (b0 >= 0xc2 && b0 <= 0xdf) {
      extra = 1;
      codePoint = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      extra = 2;
      codePoint = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      extra = 3;
      codePoint = b0 & 0x07;
    } else {
      // 0x80-0xc1 are illegal as lead bytes. 0x80-0xbf are continuation bytes
      // that appear without a lead, and 0xc0/0xc1 would be overlong 2-byte
      // sequences. 0xf5-0xff are always illegal (lead to code points > U+10FFFF).
      return { ok: false, index: i, reason: 'illegal lead byte' };
    }

    // Not enough continuation bytes — bounds check before reading so we never
    // read out of the array.
    if (i + extra >= len) {
      return { ok: false, index: i, reason: 'truncated sequence' };
    }

    // Accumulate continuation bytes, rejecting non-continuation bytes.
    for (let j = 1; j <= extra; j++) {
      const b = bytes[i + j];
      if (b < 0x80 || b > 0xbf) {
        return { ok: false, index: i + j, reason: 'expected continuation byte' };
      }
      codePoint = (codePoint << 6) | (b & 0x3f);
    }

    // The byte ranges accepted above already exclude the vast majority of
    // overlong encodings via the lead-byte lower bound (0xc2 not 0xc0, etc.).
    // But 3-byte and 4-byte sequences still need range checks because the
    // lead byte window alone does not cover every case.
    if (extra === 2) {
      // Must be U+0800..U+FFFF. Below 0x800 is overlong; D800..DFFF is a
      // surrogate code point, which is not valid UTF-8.
      if (codePoint < 0x800 || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return { ok: false, index: i, reason: 'overlong or surrogate code point' };
      }
    } else if (extra === 3) {
      // Must be U+10000..U+10FFFF. Below 0x10000 is overlong; above 0x10FFFF
      // is out of Unicode range.
      if (codePoint < 0x10000 || codePoint > 0x10ffff) {
        return { ok: false, index: i, reason: 'overlong or out-of-range code point' };
      }
    }

    i += 1 + extra;
  }

  return VALID;
}

/**
 * Decode validated UTF-8 into an array of UTF-16 code units.
 *
 * If the input is not well-formed UTF-8, returns an error object with the
 * first bad offset. Callers who already ran validate() can safely use the
 * result, but decode re-checks so that a single call is enough.
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, units: number[] } | InvalidResult}
 */
export function decode(bytes) {
  const v = validate(bytes);
  if (!v.ok) {
    return v;
  }

  const units = [];
  const len = bytes.length;
  let i = 0;

  while (i < len) {
    const b0 = bytes[i++];

    if (b0 < 0x80) {
      units.push(b0);
      continue;
    }

    let codePoint;
    if (b0 < 0xe0) {
      codePoint = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    } else if (b0 < 0xf0) {
      codePoint = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else {
      codePoint =
        ((b0 & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    }

    // Code points above U+FFFF need a UTF-16 surrogate pair. Because we already
    // validated, codePoint is guaranteed in [0, 0x10FFFF] and not a surrogate,
    // so this arithmetic is always sound.
    if (codePoint > 0xffff) {
      const v1 = codePoint - 0x10000;
      units.push(0xd800 + (v1 >> 10));
      units.push(0xdc00 + (v1 & 0x3ff));
    } else {
      units.push(codePoint);
    }
  }

  return { ok: true, units };
}

/**
 * Convenience wrapper: decode to a JavaScript string.
 *
 * We build the string from code units with String.fromCharCode.apply. Slicing
 * large unit arrays into 8k chunks keeps us under the argument-count limit of
 * every JS engine currently shipping.
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, string: string } | InvalidResult}
 */
export function decodeToString(bytes) {
  const r = decode(bytes);
  if (!r.ok) {
    return r;
  }
  const units = r.units;
  let out = '';
  const CHUNK = 8192;
  for (let k = 0; k < units.length; k += CHUNK) {
    out += String.fromCharCode.apply(null, units.slice(k, k + CHUNK));
  }
  return { ok: true, string: out };
}
