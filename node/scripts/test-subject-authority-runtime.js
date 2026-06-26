#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
    evaluateAuthorityHistory,
    hashCanonicalSubjectState,
    legacyEventToAuthorityEvent,
    stableStringify,
    validateAuthorityEvent,
} = require('../subject-authority-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(repoRoot, 'docs', 'contracts', 'subject-authority', 'fixtures', 'conformance-v1.json');
const schemaPath = path.join(repoRoot, 'docs', 'contracts', 'subject-authority', 'schema', 'authority-event.schema.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compileAuthorityEventSchema() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(readJson(schemaPath));
}

const fixture = readJson(fixturePath);
const validateSchema = compileAuthorityEventSchema();

assert.equal(fixture.ruleset_version, 'subject-authority-v1');
assert.equal(fixture.ruleset_status, 'frozen');

for (const event of fixture.authority_history) {
    assert.equal(validateSchema(event), true, JSON.stringify(validateSchema.errors, null, 2));
    assert.equal(validateAuthorityEvent(event).ok, true);
}

const firstEvaluation = evaluateAuthorityHistory(fixture.authority_history);
const secondEvaluation = evaluateAuthorityHistory(JSON.parse(JSON.stringify(fixture.authority_history)));

assert.equal(firstEvaluation.ok, true, firstEvaluation.reason_codes.join(','));
assert.equal(secondEvaluation.ok, true, secondEvaluation.reason_codes.join(','));
assert.deepStrictEqual(firstEvaluation.canonical_subject_state, secondEvaluation.canonical_subject_state);
assert.equal(firstEvaluation.state_hash, secondEvaluation.state_hash);
assert.equal(
    stableStringify(firstEvaluation.canonical_subject_state),
    stableStringify(secondEvaluation.canonical_subject_state),
);

const state = firstEvaluation.canonical_subject_state;
assert.deepStrictEqual(state.identity_continuity, fixture.expected.identity_continuity);
assert.deepStrictEqual(state.effective_authority, fixture.expected.effective_authority);
assert.deepStrictEqual(state.delegations, fixture.expected.delegations);
assert.deepStrictEqual(state.transfers, fixture.expected.transfers);
assert.equal(state.subject, fixture.expected.subject);

assert.equal(state.effective_authority.device.includes('sl1:device:pixel-7a'), false);
assert.equal(
    state.effective_authority.finance.includes('sl1:agent:app-x:approve_payment:payment:daily-limit:100'),
    true,
);
assert.deepStrictEqual(state.effective_authority.organization, []);
assert.deepStrictEqual(state.effective_authority.application, []);

const projectionInputCase = fixture.semantic_cases.find((testCase) => testCase.case_type === 'projection_input');
const projectionResult = evaluateAuthorityHistory(projectionInputCase.input);
assert.equal(projectionResult.ok, false);
assert(projectionResult.reason_codes.includes('PROJECTION_INPUT_REJECTED'));

const invalidCausalCase = fixture.semantic_cases.find((testCase) => testCase.case_type === 'invalid_causal_reference');
assert.equal(validateSchema(invalidCausalCase.event), true, JSON.stringify(validateSchema.errors, null, 2));
const invalidCausalResult = evaluateAuthorityHistory([...fixture.authority_history, invalidCausalCase.event]);
assert.equal(invalidCausalResult.ok, false);
for (const expectedCode of invalidCausalCase.expected.reason_codes) {
    assert(invalidCausalResult.reason_codes.includes(expectedCode), expectedCode);
}

const baseHash = hashCanonicalSubjectState(firstEvaluation.canonical_subject_state);
const projectionMutationAttempt = {
    ...projectionInputCase.input,
    device_owner: 'sl1:device:pixel-7a',
};
const projectionMutationResult = evaluateAuthorityHistory(projectionMutationAttempt);
assert.equal(projectionMutationResult.ok, false);
assert.equal(hashCanonicalSubjectState(firstEvaluation.canonical_subject_state), baseHash);

for (const bridgeCase of fixture.legacy_bridge_cases) {
    const mapped = legacyEventToAuthorityEvent(bridgeCase.legacy_event);
    assert.equal(mapped.ok, true, bridgeCase.name);
    assert.equal(mapped.authority_event.authority_domain, bridgeCase.expected.authority_domain);
    assert.equal(mapped.authority_event.action, bridgeCase.expected.action);
    assert.equal(mapped.authority_event.proof.type, bridgeCase.expected.proof_type);
    assert.equal(mapped.authority_event.proof.legacy_event_id, bridgeCase.legacy_event.id);
    assert(mapped.authority_event.proof.evidence_hash.startsWith('sha256:'));
    assert.equal(validateSchema(mapped.authority_event), true, JSON.stringify(validateSchema.errors, null, 2));
}

const unsupportedBridge = legacyEventToAuthorityEvent({
    id: 'legacy_projection_write',
    type: 'PROJECTION_MUTATED',
    payload: {
        entity_l1_address: 'sl1e_0123456789abcdef0123456789abcdef0123456',
        device_owner: 'sl1:device:pixel-7a',
    },
    timestamp: '2026-06-26T12:12:00Z',
});
assert.equal(unsupportedBridge.ok, false);
assert(unsupportedBridge.reason_codes.includes('UNSUPPORTED_LEGACY_EVENT_TYPE'));

const bridgeWithoutSubject = legacyEventToAuthorityEvent({
    id: 'legacy_missing_subject',
    type: 'GENESIS',
    payload: {
        device_owner: 'sl1:device:pixel-7a',
    },
    timestamp: '2026-06-26T12:13:00Z',
});
assert.equal(bridgeWithoutSubject.ok, false);
assert(bridgeWithoutSubject.reason_codes.includes('BRIDGE_FACT_INVENTION'));

console.log('PASS subject authority runtime deterministically evaluates causality and preserves bridge boundaries');
