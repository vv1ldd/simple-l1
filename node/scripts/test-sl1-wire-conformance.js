#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJson } = require('../sl1-wire/canonical-json');
const { objectHash } = require('../sl1-wire/hash');
const { verifyProof } = require('../sl1-wire/verifier');

const repoRoot = path.resolve(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'test-vectors', 'sl1-wire');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function vectorFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return vectorFiles(entryPath);
      if (entry.name.endsWith('.json')) return [entryPath];
      return [];
    })
    .sort();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}\nexpected: ${expected}\nactual:   ${actual}`);
  }
}

function runCanonicalizationVector(vector) {
  const canonical = canonicalJson(vector.input);
  assertEqual(canonical, vector.expected.canonical_json, `${vector.id} canonical_json`);
  assertEqual(objectHash(vector.input), vector.expected.object_hash, `${vector.id} object_hash`);
}

function runVerifierVector(vector) {
  const nonceStore = new Set(vector.preconsumed_nonce_keys || []);
  const verdict = verifyProof(vector.input, nonceStore);
  assertEqual(verdict.verdict, vector.expected.outcome, `${vector.id} outcome`);
  assertEqual(verdict.code, vector.expected.code, `${vector.id} code`);
  if (vector.expected.policy_trace) {
    assertEqual(JSON.stringify(verdict.policy_trace), JSON.stringify(vector.expected.policy_trace), `${vector.id} policy_trace`);
  }
}

function runVector(filePath) {
  const vector = readJson(filePath);
  if (vector.layer === 'canonicalization') {
    runCanonicalizationVector(vector);
    return;
  }
  if (vector.layer === 'verifier') {
    runVerifierVector(vector);
    return;
  }
  throw new Error(`${vector.id || filePath} has unsupported layer ${vector.layer}`);
}

let failures = 0;
for (const filePath of vectorFiles(vectorsDir)) {
  const relative = path.relative(repoRoot, filePath);
  try {
    runVector(filePath);
    console.log(`PASS ${relative}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${relative}`);
    console.error(String(error.message || error).split('\n').map((line) => `  ${line}`).join('\n'));
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log('PASS SL1 wire v0 conformance vectors');
}
