#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const {
    EMAIL_CLAIM_RULESET_VERSION,
    buildEmailClaimProjection,
    buildConsentedEmailClaims,
    buildIdentityProofClaims,
    buildNotificationEmailHint,
    hashEmail,
    normalizeEmail,
    scopeIncludesEmail,
    validateEmailDisclosure,
} = require('../subject-email-claims');
const { createIdentityProofEnvelope } = require('../identity-proof-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'subject-authority',
    'fixtures',
    'email-claim-v1.json',
);
const envelopeSchemaPath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'identity-proof',
    'schema',
    'identity-proof-envelope.schema.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const fixture = readJson(fixturePath);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateEnvelope = ajv.compile(readJson(envelopeSchemaPath));

assert.equal(fixture.ruleset_version, EMAIL_CLAIM_RULESET_VERSION);
assert.equal(fixture.ruleset_status, 'frozen');

for (const positive of fixture.positive_cases) {
    if (positive.name === 'scope_gated_email_disclosure') {
        const built = buildIdentityProofClaims(positive.input);
        assert.equal(built.ok, positive.expected.ok, positive.name);
        assert.deepStrictEqual(built.claims, positive.expected.claims, positive.name);
    } else if (positive.name === 'email_claim_projection_uses_value_hash') {
        const projection = buildEmailClaimProjection(positive.input);
        assert.equal(projection.ok, positive.expected.ok, positive.name);
        assert.equal(projection.claim.claim_type, positive.expected.claim_type);
        assert.equal(projection.claim.value_hash, positive.expected.value_hash);
    } else if (positive.name === 'notification_email_hint_is_non_authoritative') {
        const hint = buildNotificationEmailHint(positive.input.email);
        assert.equal(hint.ok, positive.expected.ok, positive.name);
        assert.equal(hint.recipient_hint.type, positive.expected.recipient_hint.type);
        assert.equal(hint.recipient_hint.authority_effect, positive.expected.recipient_hint.authority_effect);
        assert.equal(hint.recipient_hint.value, hashEmail(positive.input.email));
    }
}

for (const negative of fixture.negative_cases) {
    if (negative.name === 'email_without_scope_is_rejected') {
        const built = buildConsentedEmailClaims(negative.input);
        assert.equal(built._rejected, true);
        assert.deepStrictEqual(built.reason_codes, negative.expected.reason_codes);
    } else if (negative.name === 'invalid_email_is_rejected') {
        const built = buildIdentityProofClaims({
            alias: null,
            displayAlias: null,
            email: negative.input.email,
            scope: negative.input.scope,
        });
        assert.equal(built.ok, false);
        assert(built.reason_codes.includes('EMAIL_INVALID'));
    } else if (negative.name === 'email_as_controller_is_forbidden' || negative.name === 'email_as_recovery_path_is_forbidden' || negative.name === 'email_as_subject_key_is_forbidden') {
        const validation = validateEmailDisclosure(negative.input);
        assert.equal(validation.ok, negative.expected.ok);
        for (const code of negative.expected.reason_codes) {
            assert(validation.reason_codes.includes(code), code);
        }
    } else if (negative.name === 'raw_email_in_authority_history_is_forbidden_pattern') {
        assert.equal(negative.expected.pattern, 'RAW_EMAIL_IN_AUTHORITY_HISTORY_FORBIDDEN');
        const event = negative.forbidden_authority_event;
        assert.equal(event.metadata.email, 'alice@example.com');
    }
}

assert.equal(scopeIncludesEmail('openid sl1e email'), true);
assert.equal(scopeIncludesEmail('openid sl1e'), false);
assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
assert.equal(hashEmail('alice@example.com'), 'sha256:ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976');

const envelopeWithEmail = createIdentityProofEnvelope({
    subject: {
        entity_l1_address: 'sl1e_f690252733b20004bda7916074403f4259206a4',
        key_l1_address: 'sl1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    clientId: 'meanly.ops',
    redirectUri: 'https://ops.meanly.one/auth/sl1/callback',
    intent: { type: 'sl1e.connect', resource: null, nonce: null },
    state: 'state-001',
    nonce: 'nonce-001',
    scope: 'openid sl1e email',
    claims: {
        alias: 'alice',
        display_alias: 'Alice',
        email: 'alice@example.com',
    },
    secret: 'identity-proof-test-secret-v1',
});
assert.equal(validateEnvelope(envelopeWithEmail), true, JSON.stringify(validateEnvelope.errors, null, 2));
assert.equal(envelopeWithEmail.claims.email, 'alice@example.com');
assert.equal(envelopeWithEmail.claims.email_hash, hashEmail('alice@example.com'));

const envelopeWithoutEmailScope = createIdentityProofEnvelope({
    subject: {
        entity_l1_address: 'sl1e_f690252733b20004bda7916074403f4259206a4',
        key_l1_address: 'sl1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    clientId: 'meanly.ops',
    redirectUri: 'https://ops.meanly.one/auth/sl1/callback',
    intent: { type: 'sl1e.connect', resource: null, nonce: null },
    state: 'state-001',
    nonce: 'nonce-001',
    scope: 'openid sl1e',
    claims: {
        alias: 'alice',
        display_alias: 'Alice',
    },
    secret: 'identity-proof-test-secret-v1',
});
assert.equal(envelopeWithoutEmailScope.claims.email, null);
assert.equal(envelopeWithoutEmailScope.claims.email_hash, null);

assert.throws(() => createIdentityProofEnvelope({
    subject: {
        entity_l1_address: 'sl1e_f690252733b20004bda7916074403f4259206a4',
        key_l1_address: 'sl1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    clientId: 'meanly.ops',
    redirectUri: 'https://ops.meanly.one/auth/sl1/callback',
    scope: 'openid sl1e',
    claims: {
        alias: 'alice',
        display_alias: 'Alice',
        email: 'alice@example.com',
    },
    secret: 'test',
}), /EMAIL_SCOPE_REQUIRED/);

const before = JSON.stringify(fixture.positive_cases[0].input);
buildIdentityProofClaims(fixture.positive_cases[0].input);
const after = JSON.stringify(fixture.positive_cases[0].input);
assert.equal(before, after, 'email claim helpers must not mutate inputs');

console.log('PASS subject email claims preserve non-authoritative ADR-0056 boundaries');
