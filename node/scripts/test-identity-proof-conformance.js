#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
  createIdentityProofEnvelope,
  verifyIdentityProofEnvelope,
} = require('../identity-proof-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const packRoot = path.join(repoRoot, 'docs', 'contracts', 'identity-proof');
const schemaPath = path.join(packRoot, 'schema', 'identity-proof-envelope.schema.json');
const rulesetPath = path.join(packRoot, 'invariants', 'ruleset-v1.json');
const fixturePath = path.join(packRoot, 'fixtures', 'conformance-v1.json');

const RULESET_VERSION = 'identity-proof-v1';
const RULESET_STATUS = 'frozen';
const RUNNER_SEED = 'identity-proof-v1:0000000000000001';

const failureCodes = {
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  RULESET_VERSION_ERROR: 'RULESET_VERSION_ERROR',
  CLIENT_MISMATCH: 'CLIENT_MISMATCH',
  REDIRECT_URI_MISMATCH: 'REDIRECT_URI_MISMATCH',
  INTENT_MISMATCH: 'INTENT_MISMATCH',
  PROOF_EXPIRED: 'PROOF_EXPIRED',
  UNTRUSTED_ISSUER: 'UNTRUSTED_ISSUER',
  PROOF_VERIFICATION_FAILED: 'PROOF_VERIFICATION_FAILED',
  NO_RAW_CREDENTIAL_LEAK: 'NO_RAW_CREDENTIAL_LEAK',
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const checks = [];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function pass(label) {
  checks.push({ ok: true, label });
  console.log(`PASS ${label}`);
}

function fail(code, label, detail) {
  checks.push({ ok: false, code, label, detail });
  console.error(`FAIL [${code}] ${label}`);
  if (detail) console.error(String(detail).split('\n').map((line) => `  ${line}`).join('\n'));
}

function assertEqual(actual, expected, label, code = failureCodes.SCHEMA_ERROR) {
  if (actual === expected) {
    pass(label);
    return;
  }
  fail(code, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludesAll(actual, expected, label) {
  const missing = expected.filter((code) => !actual.includes(code));
  if (missing.length === 0) {
    pass(label);
    return;
  }
  fail(missing[0] || failureCodes.SCHEMA_ERROR, label, `missing ${missing.join(', ')} from ${JSON.stringify(actual)}`);
}

function loadPackArtifacts() {
  try {
    const schema = readJson(schemaPath);
    const ruleset = readJson(rulesetPath);
    const fixture = readJson(fixturePath);
    pass('identity proof contract pack artifacts parse as JSON');
    return { schema, ruleset, fixture };
  } catch (error) {
    fail(failureCodes.SCHEMA_ERROR, 'identity proof contract pack artifacts parse as JSON', error.message);
    return {};
  }
}

function compileEnvelopeSchema(schema) {
  if (!schema) return null;
  try {
    const validateEnvelope = ajv.compile(schema);
    pass('identity-proof-envelope schema compiles');
    return validateEnvelope;
  } catch (error) {
    fail(failureCodes.SCHEMA_ERROR, 'identity-proof-envelope schema compiles', error.message);
    return null;
  }
}

function validateRulesetBoundary(ruleset, fixture) {
  assertEqual(
    ruleset?.schema_version,
    'simple-l1.identity_proof_ruleset.v1',
    'identity proof ruleset uses frozen schema_version',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(ruleset?.ruleset_version, RULESET_VERSION, 'identity proof ruleset version is frozen v1', failureCodes.RULESET_VERSION_ERROR);
  assertEqual(ruleset?.ruleset_status, RULESET_STATUS, 'identity proof ruleset status is frozen', failureCodes.RULESET_VERSION_ERROR);
  assertEqual(fixture?.ruleset_version, RULESET_VERSION, 'identity proof fixture targets frozen v1 ruleset', failureCodes.RULESET_VERSION_ERROR);
  assertEqual(fixture?.ruleset_status, RULESET_STATUS, 'identity proof fixture status is frozen', failureCodes.RULESET_VERSION_ERROR);
  assertEqual(fixture?.deterministic_runner?.seed, RUNNER_SEED, 'identity proof deterministic runner seed is pinned', failureCodes.RULESET_VERSION_ERROR);
  assertEqual(fixture?.deterministic_runner?.case_order, 'fixture_order', 'identity proof deterministic runner uses fixture order', failureCodes.RULESET_VERSION_ERROR);
}

function materializeBaseEnvelope(fixture) {
  const issuerTrust = fixture.issuer_trust_snapshot;
  const issuerSecret = issuerTrust[fixture.base_input.issuer.issuer_id].secret;
  return createIdentityProofEnvelope({
    ...fixture.base_input,
    clientId: fixture.base_input.client_id,
    redirectUri: fixture.base_input.redirect_uri,
    issuedAt: fixture.base_input.issued_at,
    expiresAt: fixture.base_input.expires_at,
    assuranceLevel: fixture.base_input.assurance_level,
    secret: issuerSecret,
  });
}

function expectedContext(fixture, testCase, validateEnvelope) {
  const base = fixture.base_input;
  return {
    validateEnvelope,
    expectedClientId: testCase.expected_context?.client_id || base.client_id,
    expectedRedirectUri: testCase.expected_context?.redirect_uri || base.redirect_uri,
    expectedIntent: testCase.expected_context?.intent || base.intent,
    issuerTrust: testCase.trust_snapshot || fixture.issuer_trust_snapshot,
    now: new Date(testCase.now || '2026-06-06T16:01:00Z'),
  };
}

function applyMutation(envelope, mutation = {}) {
  return {
    ...envelope,
    ...mutation,
  };
}

function validateEnvelopeShape(envelope, validateEnvelope, label) {
  if (validateEnvelope(envelope)) {
    pass(label);
  } else {
    fail(failureCodes.SCHEMA_ERROR, label, ajv.errorsText(validateEnvelope.errors, { separator: '\n' }));
  }
}

function validateSemanticCases(fixture, validateEnvelope) {
  for (const testCase of fixture.semantic_cases || []) {
    const signed = materializeBaseEnvelope(fixture);
    const envelope = testCase.tamper_after_sign
      ? applyMutation(signed, testCase.tamper_after_sign)
      : applyMutation(signed, testCase.mutate);
    if (!testCase.tamper_after_sign) validateEnvelopeShape(envelope, validateEnvelope, `${testCase.name}: schema valid`);
    const verification = verifyIdentityProofEnvelope(envelope, expectedContext(fixture, testCase, validateEnvelope));
    assertEqual(verification.ok, testCase.expected.ok, `${testCase.name}: verification result`);
    assertIncludesAll(verification.reason_codes, testCase.expected.reason_codes, `${testCase.name}: reason codes`);
  }
}

function validateBoundaryCases(fixture, validateEnvelope) {
  for (const testCase of fixture.boundary_cases || []) {
    const envelope = {
      ...materializeBaseEnvelope(fixture),
      ...testCase.inject,
    };
    const verification = verifyIdentityProofEnvelope(envelope, expectedContext(fixture, testCase, validateEnvelope));
    assertEqual(verification.ok, testCase.expected.ok, `${testCase.name}: verification result`);
    assertIncludesAll(verification.reason_codes, testCase.expected.reason_codes, `${testCase.name}: reason codes`);
  }
}

function validateForbiddenFieldCoverage(ruleset, fixture) {
  const covered = new Set((fixture.boundary_cases || []).flatMap((testCase) => Object.keys(testCase.inject || {})));
  for (const field of ruleset.forbidden_fields || []) {
    assertEqual(
      covered.has(field),
      true,
      `forbidden field ${field} has a boundary fixture`,
      failureCodes.NO_RAW_CREDENTIAL_LEAK,
    );
  }
}

const { schema, ruleset, fixture } = loadPackArtifacts();
const validateEnvelope = compileEnvelopeSchema(schema);

if (ruleset && fixture) validateRulesetBoundary(ruleset, fixture);
if (ruleset && fixture) validateForbiddenFieldCoverage(ruleset, fixture);
if (fixture && validateEnvelope) {
  const envelope = materializeBaseEnvelope(fixture);
  validateEnvelopeShape(envelope, validateEnvelope, 'materialized base envelope conforms to identity-proof-envelope.schema.json');
  validateSemanticCases(fixture, validateEnvelope);
  validateBoundaryCases(fixture, validateEnvelope);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} identity proof conformance check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} identity proof conformance check(s) passed.`);
