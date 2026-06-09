#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const identityMesh = require('../identity-mesh-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const packRoot = path.join(repoRoot, 'docs', 'contracts', 'identity-mesh');
const schemaPath = path.join(packRoot, 'schema', 'identity-state-envelope.schema.json');
const rulesetPath = path.join(packRoot, 'invariants', 'ruleset-v1.json');
const fixturePath = path.join(packRoot, 'fixtures', 'conformance-v1.json');

const RULESET_VERSION = 'identity-mesh-v1';
const RULESET_STATUS = 'frozen';
const RUNNER_SEED = 'identity-mesh-v1:0000000000000001';

const failureCodes = {
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  QUORUM_MISMATCH: 'QUORUM_MISMATCH',
  AUTHORITY_LEAK_DETECTED: 'AUTHORITY_LEAK_DETECTED',
  RULESET_VERSION_ERROR: 'RULESET_VERSION_ERROR',
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

function assertEqual(actual, expected, label, code = failureCodes.INVARIANT_VIOLATION) {
  if (actual === expected) {
    pass(label);
    return;
  }

  fail(code, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertFalse(value, label, code = failureCodes.INVARIANT_VIOLATION) {
  assertEqual(value, false, label, code);
}

function loadPackArtifacts() {
  try {
    const schema = readJson(schemaPath);
    const ruleset = readJson(rulesetPath);
    const fixture = readJson(fixturePath);
    pass('identity mesh contract pack artifacts parse as JSON');
    return { schema, ruleset, fixture };
  } catch (error) {
    fail(failureCodes.SCHEMA_ERROR, 'identity mesh contract pack artifacts parse as JSON', error.message);
    return {};
  }
}

function compileEnvelopeSchema(schema) {
  if (!schema) return null;

  try {
    const validateEnvelope = ajv.compile(schema);
    pass('identity-state-envelope schema compiles');
    return validateEnvelope;
  } catch (error) {
    fail(failureCodes.SCHEMA_ERROR, 'identity-state-envelope schema compiles', error.message);
    return null;
  }
}

function invariantFailureCode(ruleset, invariantId, fallback = failureCodes.INVARIANT_VIOLATION) {
  const invariant = (ruleset?.invariants || []).find((item) => item.id === invariantId);
  return invariant?.failure_code || fallback;
}

function validateRulesetBoundary(ruleset, fixture) {
  assertEqual(
    ruleset?.schema_version,
    'simple-l1.identity_mesh_ruleset.v1',
    'identity mesh ruleset uses frozen schema_version',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    ruleset?.ruleset_version,
    RULESET_VERSION,
    'identity mesh ruleset version is frozen v1',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    ruleset?.ruleset_status,
    RULESET_STATUS,
    'identity mesh ruleset status is frozen',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    fixture?.ruleset_version,
    RULESET_VERSION,
    'identity mesh fixture targets frozen v1 ruleset',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    fixture?.ruleset_status,
    RULESET_STATUS,
    'identity mesh fixture status is frozen',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    fixture?.deterministic_runner?.seed,
    RUNNER_SEED,
    'identity mesh deterministic runner seed is pinned',
    failureCodes.RULESET_VERSION_ERROR,
  );
  assertEqual(
    fixture?.deterministic_runner?.case_order,
    'fixture_order',
    'identity mesh deterministic runner uses fixture order',
    failureCodes.RULESET_VERSION_ERROR,
  );
}

function validateInvariantReferences(ruleset, fixture) {
  const invariantIds = new Set((ruleset?.invariants || []).map((item) => item.id));
  const cases = [
    ...(fixture?.merge_cases || []),
    ...(fixture?.authority_boundary_cases || []),
  ];

  for (const testCase of cases) {
    const known = invariantIds.has(testCase.invariant_id);
    assertEqual(
      known,
      true,
      `${testCase.name}: invariant_id is registered in ruleset`,
      failureCodes.RULESET_VERSION_ERROR,
    );
  }
}

function validateEnvelopes(fixture, validateEnvelope) {
  for (const [index, envelope] of (fixture.valid_envelopes || []).entries()) {
    const label = `valid_envelopes[${index}] conforms to identity-state-envelope.schema.json`;
    if (validateEnvelope(envelope)) {
      pass(label);
    } else {
      fail(failureCodes.SCHEMA_ERROR, label, ajv.errorsText(validateEnvelope.errors, { separator: '\n' }));
    }
  }
}

function validateMergeCases(ruleset, fixture) {
  for (const testCase of fixture.merge_cases || []) {
    const actual = identityMesh.evaluateMeshMergeCase(testCase);
    const code = invariantFailureCode(ruleset, testCase.invariant_id);
    for (const [key, expected] of Object.entries(testCase.expected || {})) {
      assertEqual(actual[key], expected, `${testCase.name}: ${key}`, code);
    }
  }
}

function validateAuthorityBoundaryCases(ruleset, fixture) {
  for (const testCase of fixture.authority_boundary_cases || []) {
    const actual = identityMesh.evaluateAuthorityBoundaryCase(testCase);
    const code = invariantFailureCode(ruleset, testCase.invariant_id);

    if (testCase.expected_output_type) {
      assertEqual(actual.output_type, testCase.expected_output_type, `${testCase.name}: output type`, code);
    }

    for (const forbiddenType of testCase.forbidden_output_types || []) {
      const created = actual.output_type === forbiddenType || actual.forbidden_output_types?.includes(forbiddenType);
      assertFalse(created, `${testCase.name}: does not produce ${forbiddenType}`, failureCodes.AUTHORITY_LEAK_DETECTED);
    }

    for (const [key, expected] of Object.entries(testCase.expected || {})) {
      assertEqual(actual[key], expected, `${testCase.name}: ${key}`, code);
    }
  }
}

const { schema, ruleset, fixture } = loadPackArtifacts();
const validateEnvelope = compileEnvelopeSchema(schema);

if (ruleset && fixture) {
  validateRulesetBoundary(ruleset, fixture);
  validateInvariantReferences(ruleset, fixture);
}

if (fixture && validateEnvelope) validateEnvelopes(fixture, validateEnvelope);
if (ruleset && fixture) validateMergeCases(ruleset, fixture);
if (ruleset && fixture) validateAuthorityBoundaryCases(ruleset, fixture);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error(`\n${failures.length} identity mesh conformance check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} identity mesh conformance check(s) passed.`);
