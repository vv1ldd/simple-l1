#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
    assertNoCredentialLeak,
    createIdentityProofEnvelope,
    verifyIdentityProofEnvelope,
} = require('../identity-proof-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'docs', 'contracts', 'identity-proof', 'schema', 'identity-proof-envelope.schema.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compileEnvelopeSchema() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(readJson(schemaPath));
}

const validateEnvelope = compileEnvelopeSchema();
const issuer = {
    issuer_id: 'simplel1.local',
    issuer_url: 'https://simplel1.local',
    key_id: 'identity-proof-test-key-v1',
};
const issuerTrust = {
    'simplel1.local': {
        ...issuer,
        secret: 'identity-proof-test-secret-v1',
    },
};
const expectedContext = {
    validateEnvelope,
    expectedClientId: 'marketplace',
    expectedRedirectUri: 'https://marketplace.example/sl1/callback',
    expectedIntent: {
        type: 'meanly.login',
        resource: 'marketplace',
        nonce: 'intent-nonce-001',
    },
    issuerTrust,
    now: new Date('2026-06-06T16:01:00Z'),
};

const envelope = createIdentityProofEnvelope({
    issuer,
    subject: {
        entity_l1_address: 'sl1e_f690252733b20004bda7916074403f4259206a4',
        key_l1_address: 'sl1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    clientId: expectedContext.expectedClientId,
    redirectUri: expectedContext.expectedRedirectUri,
    intent: expectedContext.expectedIntent,
    state: 'state-001',
    nonce: 'nonce-001',
    issuedAt: '2026-06-06T16:00:00Z',
    expiresAt: '2026-06-06T16:10:00Z',
    assuranceLevel: 'AL2',
    claims: {
        alias: 'alice',
        display_alias: 'Alice',
    },
    secret: issuerTrust['simplel1.local'].secret,
});

assert.equal(validateEnvelope(envelope), true, JSON.stringify(validateEnvelope.errors, null, 2));
assert.deepStrictEqual(assertNoCredentialLeak(envelope).reason_codes, []);

const valid = verifyIdentityProofEnvelope(envelope, expectedContext);
assert.equal(valid.ok, true);
assert.deepStrictEqual(valid.reason_codes, []);
assert.equal(valid.subject.entity_l1_address, envelope.subject.entity_l1_address);

const tampered = { ...envelope, client_id: 'marketplace-tampered' };
const tamperedResult = verifyIdentityProofEnvelope(tampered, expectedContext);
assert.equal(tamperedResult.ok, false);
assert(tamperedResult.reason_codes.includes('CLIENT_MISMATCH'));
assert(tamperedResult.reason_codes.includes('PROOF_VERIFICATION_FAILED'));

const expired = verifyIdentityProofEnvelope(envelope, {
    ...expectedContext,
    now: new Date('2026-06-06T16:11:00Z'),
});
assert.equal(expired.ok, false);
assert(expired.reason_codes.includes('PROOF_EXPIRED'));

const untrusted = verifyIdentityProofEnvelope(envelope, {
    ...expectedContext,
    issuerTrust: {},
});
assert.equal(untrusted.ok, false);
assert(untrusted.reason_codes.includes('UNTRUSTED_ISSUER'));

const boundaryLeak = verifyIdentityProofEnvelope({
    ...envelope,
    credential_id: 'raw-credential-id',
}, expectedContext);
assert.equal(boundaryLeak.ok, false);
assert(boundaryLeak.reason_codes.includes('NO_RAW_CREDENTIAL_LEAK'));

const nativeSessionCapability = {
    typ: 'identity_management_session',
    entity_l1_address: envelope.subject.entity_l1_address,
    exp: 1780779000,
};
const nativeSessionAsProof = verifyIdentityProofEnvelope(nativeSessionCapability, expectedContext);
assert.equal(nativeSessionAsProof.ok, false);
assert(nativeSessionAsProof.reason_codes.includes('SCHEMA_ERROR'));
assert.equal(nativeSessionAsProof.envelope_id, null);
assert.equal(nativeSessionAsProof.subject, null);

console.log('PASS identity proof runtime materializes, verifies, and preserves boundary integrity');
