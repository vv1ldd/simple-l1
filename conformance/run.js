#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const identity = require('../node/identity-kernel');
const { decideCapability } = require('../node/capability-resolution');

const root = path.resolve(__dirname, '..');
const vectorsDir = path.join(root, 'test-vectors');

function readVector(file) {
    return JSON.parse(fs.readFileSync(path.join(vectorsDir, file), 'utf8'));
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

function assertThrowsProtocol(name, fn) {
    assert.throws(fn, Error, name);
}

function grantFromVector(vector, grant) {
    return {
        entity_l1_address: vector.entity_l1_address,
        key_l1_address: grant.key_l1_address ?? null,
        capability: vector.capability,
        scope: vector.scope,
        expires_at: null,
        ...grant,
    };
}

function inputFromVector(vector, overrides = {}) {
    return {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        context: {},
        ...overrides,
    };
}

function mayMutateSettlementState(candidate, appliedKeys = new Set()) {
    if (!candidate.has_external_event) return false;
    if (!candidate.has_proof) return false;
    if (!candidate.has_intent) return false;
    if (candidate.cre_decision !== 'allow') return false;
    if (!candidate.has_transition_rule) return false;
    if (!candidate.has_receipt) return false;
    if (!candidate.idempotency_key) return false;
    if (appliedKeys.has(candidate.idempotency_key)) return false;

    return true;
}

function runIdentityConformance() {
    const vector = readVector('identity-v1.json');

    for (const entityAddress of vector.entity.valid) {
        assert.equal(identity.normalizeEntityAddress(entityAddress), entityAddress);
        assert.equal(identity.assertEntityAddress(entityAddress), entityAddress);
    }

    assert.equal(
        identity.systemEntityAddress('simple-l1:conformance:entity'),
        vector.entity.valid[0],
        'system entity derivation must remain versioned and deterministic'
    );

    for (const invalidEntity of vector.entity.invalid) {
        assert.equal(identity.normalizeEntityAddress(invalidEntity), null);
        assertThrowsProtocol('invalid entity address must fail', () => identity.assertEntityAddress(invalidEntity));
    }

    for (const keyCase of vector.key.public_key_cases) {
        const keyAddress = identity.keyAddressFromPublicKey(keyCase.public_key);
        assert.equal(keyAddress, keyCase.key_l1_address);
        assert.equal(identity.normalizeKeyAddress(keyAddress), keyAddress);
        assert.equal(identity.normalizeEntityAddress(keyAddress), null);
        assertThrowsProtocol('key address must never assert as entity', () => identity.assertEntityAddress(keyAddress));
    }

    for (const keyAddress of vector.key.invalid_as_entity) {
        assert.equal(identity.normalizeEntityAddress(keyAddress), null);
    }
}

function runCreConformance() {
    const vector = readVector('cre-v1.json');

    for (const creCase of vector.cases) {
        const grants = creCase.grants.map((grant) => grantFromVector(vector, grant));
        const input = inputFromVector(vector, creCase.input_overrides);
        const decision = decideCapability(grants, input, new Date('2026-05-26T00:00:00.000Z'));

        assert.equal(decision.decision, creCase.decision, creCase.name);
        assert.equal(decision.confidence, 1, 'CRE v1 confidence must be deterministic');
        assert.ok(!Object.prototype.hasOwnProperty.call(decision, 'role'), 'CRE output must not expose roles');
    }
}

function runSettlementConformance() {
    const vector = readVector('settlement-v1.json');

    for (const settlementCase of vector.candidate_cases) {
        const appliedKeys = new Set();

        if (settlementCase.already_applied && settlementCase.idempotency_key) {
            appliedKeys.add(settlementCase.idempotency_key);
        }

        assert.equal(
            mayMutateSettlementState(settlementCase, appliedKeys),
            settlementCase.may_mutate_state,
            settlementCase.name
        );
    }
}

test('Identity Kernel v1 conformance', runIdentityConformance);
test('CRE v1 conformance', runCreConformance);
test('Settlement Transition Rules v1 boundary conformance', runSettlementConformance);

if (process.exitCode) {
    process.exit(process.exitCode);
}
