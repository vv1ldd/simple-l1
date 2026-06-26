#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    CLAIM_ISSUANCE_POLICY_RULESET_VERSION,
    CLAIM_POLICY_DECISIONS,
    evaluateClaimIssuancePolicy,
    validateClaimEventCandidate,
} = require('../subject-claim-issuance-policy');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'subject-authority',
    'fixtures',
    'claim-issuance-policy-v1.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function candidatesById(fixture) {
    return Object.fromEntries(fixture.claim_event_candidates.map((candidate) => [candidate.candidate_id, candidate]));
}

function assertExpectedDecision(actual, expected, label) {
    assert.equal(actual.decision, expected.decision, `${label}: decision`);
    assert.deepStrictEqual(actual.reason_codes, expected.reason_codes, `${label}: reason_codes`);
    assert.equal(actual.authority_effect, expected.authority_effect, `${label}: authority_effect`);
    assert.deepStrictEqual(actual.writes, expected.writes, `${label}: writes`);
    assert.equal(actual.emits_claim_event, false, `${label}: no claim event emitted`);
    assert.equal(actual.emits_authority_event, false, `${label}: no authority event emitted`);
    assert.equal(actual.disclosure_performed, false, `${label}: no disclosure performed`);
    assert(!Object.prototype.hasOwnProperty.call(actual, 'value_hash'), `${label}: decision must not echo claim value hash`);
    assert(!Object.prototype.hasOwnProperty.call(actual, 'disclosure_value'), `${label}: decision must not echo raw disclosure value`);
}

const fixture = readJson(fixturePath);
const byId = candidatesById(fixture);

assert.equal(fixture.ruleset_version, CLAIM_ISSUANCE_POLICY_RULESET_VERSION);
assert.equal(fixture.ruleset_status, 'frozen');
assert.deepStrictEqual(fixture.decision_alphabet.sort(), Object.values(CLAIM_POLICY_DECISIONS).sort());

for (const candidate of fixture.claim_event_candidates) {
    assert.equal(validateClaimEventCandidate(candidate).ok, true, candidate.candidate_id);
}

for (const positive of fixture.positive_cases) {
    const candidate = byId[positive.candidate_id];
    assert(candidate, `missing candidate ${positive.candidate_id}`);
    const actual = evaluateClaimIssuancePolicy(candidate, fixture.policy);
    assertExpectedDecision(actual, positive.expected, positive.name);
}

for (const negative of fixture.negative_cases) {
    const candidate = byId[negative.candidate_id];
    assert(candidate, `missing candidate ${negative.candidate_id}`);
    const actual = evaluateClaimIssuancePolicy(candidate, fixture.policy);
    assertExpectedDecision(actual, negative.expected, negative.name);
    assert.notEqual(actual.decision, CLAIM_POLICY_DECISIONS.ADMITTED, `${negative.name}: must not default admit`);
}

const malformed = evaluateClaimIssuancePolicy({
    candidate_id: 'claim_candidate_bad',
    subject: 'sl1e_claim_alice',
    claim_type: 'controls_email',
    issuer: { issuer_id: 'issuer' },
    value_hash: 'not-a-hash',
    evidence_refs: [],
}, fixture.policy);
assert.equal(malformed.decision, CLAIM_POLICY_DECISIONS.REJECTED);
assert(malformed.reason_codes.includes('CLAIM_ISSUER_CLASS_INVALID'));
assert(malformed.reason_codes.includes('CLAIM_VALUE_HASH_INVALID'));

const beforeCandidate = JSON.stringify(byId.claim_candidate_email_self_001);
const beforePolicy = JSON.stringify(fixture.policy);
evaluateClaimIssuancePolicy(byId.claim_candidate_email_self_001, fixture.policy);
assert.equal(JSON.stringify(byId.claim_candidate_email_self_001), beforeCandidate, 'candidate input must not mutate');
assert.equal(JSON.stringify(fixture.policy), beforePolicy, 'policy input must not mutate');

const first = evaluateClaimIssuancePolicy(byId.claim_candidate_email_self_001, fixture.policy);
const second = evaluateClaimIssuancePolicy(byId.claim_candidate_email_self_001, fixture.policy);
assert.deepStrictEqual(first, second, 'same candidate and policy must produce same decision');

for (const forbiddenEffect of fixture.forbidden_effects) {
    assert(
        !Object.prototype.hasOwnProperty.call(first, forbiddenEffect)
        || first[forbiddenEffect] === false
        || first[forbiddenEffect] === 'none'
        || (Array.isArray(first[forbiddenEffect]) && first[forbiddenEffect].length === 0),
        `decision must not perform forbidden effect ${forbiddenEffect}`,
    );
}

for (const invariant of fixture.invariants) {
    assert(!invariant.includes('unknown does not default to admitted') || byId.claim_candidate_unknown_type_001);
}

console.log('PASS subject claim issuance policy preserves ADR-0058 admission boundaries');
