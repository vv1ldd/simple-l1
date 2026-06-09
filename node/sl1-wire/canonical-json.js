'use strict';

function codePoints(value) {
  return Array.from(value).map((char) => char.codePointAt(0));
}

function compareKeys(left, right) {
  const a = codePoints(left);
  const b = codePoints(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function assertSupportedNumber(value) {
  if (!Number.isFinite(value) || Object.is(value, -0)) {
    throw new Error('BAD_CANONICALIZATION: unsupported JSON number');
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error('BAD_CANONICALIZATION: non-safe integer');
  }
}

function canonicalizeValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assertSupportedNumber(value);
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort(compareKeys);
    const fields = keys.map((key) => {
      const child = value[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') {
        throw new Error(`BAD_CANONICALIZATION: unsupported value for key ${key}`);
      }
      return `${JSON.stringify(key.normalize('NFC'))}:${canonicalizeValue(child)}`;
    });
    return `{${fields.join(',')}}`;
  }
  throw new Error('BAD_CANONICALIZATION: unsupported JSON value');
}

function canonicalJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BAD_CANONICALIZATION: root must be a JSON object');
  }
  return canonicalizeValue(value);
}

function withoutSignature(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BAD_CANONICALIZATION: signed object root must be a JSON object');
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    if (key !== 'signature') copy[key] = value[key];
  }
  return copy;
}

module.exports = {
  canonicalJson,
  compareKeys,
  withoutSignature,
};
