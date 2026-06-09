#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
    assertNoAuthorityLeak,
    createIdentityStateEnvelope,
    evaluateAuthorityBoundaryCase,
    mergeIdentityStateObservations,
    verifyIdentityStateEnvelope,
} = require('../identity-mesh-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'docs', 'contracts', 'identity-mesh', 'schema', 'identity-state-envelope.schema.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compileEnvelopeSchema() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(readJson(schemaPath));
}

const entityAddress = 'sl1e_0123456789abcdef0123456789abcdef01234567';
const deviceKeyAddress = 'sl1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const validateEnvelope = compileEnvelopeSchema();

const ledger = {
    controller_bindings: [
        {
            binding_id: 'cb_device_a_primary',
            entity_l1_address: entityAddress,
            controller_key_l1_address: deviceKeyAddress,
            status: 'active',
            observed_at: '2026-06-06T16:00:00Z',
            provider_evidence_hash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        },
        {
            binding_id: 'cb_device_b_webauthn',
            entity_l1_address: entityAddress,
            controller_key_l1_address: 'sl1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            status: 'active',
            observed_at: '2026-06-06T16:02:00Z',
            provider_evidence_hash: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
        },
    ],
    controller_binding_proposals: [
        {
            proposal_id: 'cbp_device_c_mobile',
            entity_l1_address: entityAddress,
            proposed_controller_key_l1_address: 'sl1_cccccccccccccccccccccccccccccccccccccccc',
            controller_type: 'mobile_device',
            status: 'approved',
            proposed_at: '2026-06-06T16:03:00Z',
            approved_by_key_l1_address: deviceKeyAddress,
            approved_at: '2026-06-06T16:04:00Z',
        },
    ],
};

const envelope = createIdentityStateEnvelope({
    ledger,
    entityAddress,
    deviceKeyAddress,
    sequence: 1,
    previousStateHash: null,
    observedEpoch: 7,
    now: new Date('2026-06-06T16:00:00Z'),
    privateKey,
});

assert.equal(validateEnvelope(envelope), true, JSON.stringify(validateEnvelope.errors, null, 2));

const verification = verifyIdentityStateEnvelope(envelope, {
    validateEnvelope,
    trustedDeviceKeys: {
        [deviceKeyAddress]: publicKey,
    },
    now: new Date('2026-06-06T16:01:00Z'),
});

assert.equal(verification.ok, true);
assert.equal(verification.output_type, 'mesh_observation');
assert.equal(verification.observation.envelope_id, envelope.envelope_id);
assert.equal(verification.observation.controller_bindings.length, 2);
assert.equal(verification.observation.controller_binding_proposals.length, 1);
assert.deepStrictEqual(assertNoAuthorityLeak(verification).reason_codes, []);

const tampered = {
    ...envelope,
    sequence: 2,
};
const tamperedVerification = verifyIdentityStateEnvelope(tampered, {
    validateEnvelope,
    trustedDeviceKeys: {
        [deviceKeyAddress]: publicKey,
    },
    now: new Date('2026-06-06T16:01:00Z'),
});
assert.equal(tamperedVerification.ok, false);
assert(tamperedVerification.reason_codes.includes('IDENTITY_MESH_STATE_HASH_INVALID'));
assert(tamperedVerification.reason_codes.includes('IDENTITY_MESH_SIGNATURE_INVALID'));

const merged = mergeIdentityStateObservations([
    {
        device_key_l1_address: deviceKeyAddress,
        sequence: 1,
        state_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    },
    {
        device_key_l1_address: deviceKeyAddress,
        sequence: 2,
        state_hash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
]);
assert.equal(merged.output_type, 'mesh_observation');
assert.equal(merged.selected_state_hash, 'sha256:2222222222222222222222222222222222222222222222222222222222222222');
assert.equal(merged.authority_grant_created, false);
assert.deepStrictEqual(assertNoAuthorityLeak(merged).reason_codes, []);

const proposalMerge = mergeIdentityStateObservations([
    { proposal_id: 'cbp_replay', sequence: 3, status: 'approved' },
    { proposal_id: 'cbp_replay', sequence: 2, status: 'approved' },
]);
assert.equal(proposalMerge.proposal_status, 'approved');
assert.equal(proposalMerge.replay_detected, true);
assert.equal(proposalMerge.authority_grant_created, false);

const denyOnlyAuthority = evaluateAuthorityBoundaryCase({
    invariant_id: 'IMESH_V1_QUORUM_CARDINALITY',
    signatures: [
        { device_key_l1_address: deviceKeyAddress, intent_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        { device_key_l1_address: 'sl1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', intent_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ],
    policy: {
        required_quorum: 2,
        allowed: true,
    },
});
assert.equal(denyOnlyAuthority.output_type, 'mesh_observation');
assert.equal(denyOnlyAuthority.authority_grant_created, false);
assert.equal(denyOnlyAuthority.reason, 'authority_grant_artifact_not_specified');
assert.deepStrictEqual(assertNoAuthorityLeak(denyOnlyAuthority).reason_codes, []);

console.log('PASS identity mesh runtime creates, verifies, merges, and stays deny-only');
