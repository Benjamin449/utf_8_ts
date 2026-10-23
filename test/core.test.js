import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, decode, decodeToString, VALID } from '../src/index.js';

const u = (...arr) => new Uint8Array(arr);

const EXPECTED_TEXT = 'héllo😀';
// Manual UTF-8 for "héllo😀": h(68) é(c3 a9) l(6c) l(6c) o(6f) 😀(f0 9f 98 80)
const EXPECTED_BYTES = u(0x68, 0xc3, 0xa9, 0x6c, 0x6c, 0x6f, 0xf0, 0x9f, 0x98, 0x80);

test('VALID is a frozen sentinel with ok=true', () => {
  assert.equal(VALID.ok, true);
  assert.ok(Object.isFrozen(VALID));
});

test('ASCII input validates and round-trips', () => {
  const b = u(0x48, 0x65, 0x6c, 0x6c, 0x6f);
  assert.deepEqual(validate(b), VALID);
  const r = decode(b);
  assert.equal(r.ok, true);
  assert.deepEqual(r.units, [0x48, 0x65, 0x6c, 0x6c, 0x6f]);
});

test('mixed multi-byte input validates and decodes correctly', () => {
  const v = validate(EXPECTED_BYTES);
  assert.deepEqual(v, VALID);
  const r = decode(EXPECTED_BYTES);
  assert.equal(r.ok, true);
  // UTF-16 units for "héllo😀": 'h'(68) 'é'(e9) 'l'(6c) 'l'(6c) 'o'(6f) '😀'(d83d de00)
  assert.deepEqual(r.units, [0x68, 0xe9, 0x6c, 0x6c, 0x6f, 0xd83d, 0xde00]);
  const s = decodeToString(EXPECTED_BYTES);
  assert.equal(s.ok, true);
  assert.equal(s.string, EXPECTED_TEXT);
});

test('2-byte sequence U+00A9 (©) validates and decodes', () => {
  const b = u(0xc2, 0xa9);
  assert.deepEqual(validate(b), VALID);
  const r = decode(b);
  assert.equal(r.ok, true);
  assert.deepEqual(r.units, [0xa9]);
});

test('3-byte sequence U+20AC (€) validates and decodes', () => {
  const b = u(0xe2, 0x82, 0xac);
  assert.deepEqual(validate(b), VALID);
  const r = decode(b);
  assert.equal(r.ok, true);
  assert.deepEqual(r.units, [0x20ac]);
});

test('overlong 2-byte (U+0041 as 2 bytes) is rejected', () => {
  const b = u(0xc1, 0xa1);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('overlong 3-byte (null) is rejected', () => {
  const b = u(0xe0, 0x80, 0x80);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('overlong 3-byte (U+007F) is rejected', () => {
  const b = u(0xe0, 0x81, 0xbf);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('surrogate code point U+D800 encoded as 3 bytes is rejected', () => {
  const b = u(0xed, 0xa0, 0x80);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('surrogate code point U+DFFF encoded as 3 bytes is rejected', () => {
  const b = u(0xed, 0xbf, 0xbf);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('out-of-range code point U+110000 is rejected', () => {
  const b = u(0xf4, 0x90, 0x80, 0x80);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('truncated 4-byte sequence is rejected', () => {
  const b = u(0xf0, 0x9f, 0x98);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('non-continuation byte mid-sequence is rejected at the bad byte', () => {
  const b = u(0xe2, 0x82, 0x20);
  const v = validate(b);
  assert.equal(v.ok, false);
  assert.equal(v.index, 2);
});
