#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const identity = require('../node/identity-kernel');
const { decideCapability } = require('../node/capability-resolution');
const {
    buildAuthorization,
    createControlGrant,
    revokeControlGrant,
    verifyAuthorization,
} = require('../node/authority-runtime');
const {
    challengeForIntent,
    consumeIntentApproval,
    createIntentApproval,
    intentHash,
    normalizeIntent,
    verifyIntentApproval,
} = require('../node/intent-approval-runtime');
const { recordPolicyArtifacts } = require('../node/policy-artifacts');
const { createExternalProof, verifyExternalProof } = require('../node/external-proof-runtime');
const { MemoryConnectRuntimeStore } = require('../node/connect-runtime-store');
const { createIdentityProof, verifyIdentityProof } = require('../node/identity-proof-runtime');
const {
    createNotificationEnvelope,
    dismissNotification,
    markNotificationRead,
    verifyNotificationEnvelope,
} = require('../node/notification-runtime');
const {
    executeMarketplaceSettlement,
    explainSettlement,
} = require('../node/marketplace-flow-runtime');

const root = path.resolve(__dirname, '..');
const vectorsDir = path.join(root, 'test-vectors');
const nodeDir = path.join(root, 'node');

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

function runAuthorityRuntimeConformance() {
    const vector = readVector('authority-v1.json');
    const now = new Date(vector.now);

    for (const authorityCase of vector.cases) {
        const ledger = {};
        const grant = createControlGrant(ledger, {
            entity_l1_address: vector.entity_l1_address,
            key_l1_address: authorityCase.grant.key_l1_address ?? null,
            capability: vector.capability,
            scope: vector.scope,
            ...authorityCase.grant,
        }, now);

        if (authorityCase.revoke) {
            revokeControlGrant(ledger, { grant_id: grant.id, reason: 'test_revocation' }, now);
        }

        const policyDecision = authorityCase.authorization.policy_decision
            ? recordPolicyArtifacts(
                ledger,
                authorityCase.authorization.policy_decision.input,
                authorityCase.authorization.policy_decision.result,
                now
            ).decision
            : null;

        const authorization = buildAuthorization(ledger, {
            entity_l1_address: vector.entity_l1_address,
            proof_key_l1_address: authorityCase.authorization.proof_key_l1_address ?? vector.proof_key_l1_address,
            capability: vector.capability,
            scope: vector.scope,
            ...authorityCase.authorization,
            policy_decision_id: policyDecision?.id ?? authorityCase.authorization.policy_decision_id ?? null,
        }, now);

        assert.equal(authorization.can_execute, authorityCase.can_execute, authorityCase.name);
        assert.equal(
            verifyAuthorization(ledger, authorization.id, now).ok,
            authorityCase.verify_ok,
            authorityCase.name
        );
        assert.ok(!Object.prototype.hasOwnProperty.call(authorization, 'role'), 'Authorization must not expose roles');
    }

    const bindingLedger = {};
    createControlGrant(bindingLedger, {
        id: 'grant_controller_binding',
        entity_l1_address: vector.entity_l1_address,
        key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        policy: 'allow',
        status: 'active',
    }, now);
    const bindingPolicy = recordPolicyArtifacts(bindingLedger, {
        intent_type: 'MARKETPLACE_FULFILLMENT',
        intent: { intent_id: 'intent_controller_binding' },
        facts: { payment_status: 'paid' },
    }, {
        ok: true,
        policies_evaluated: 1,
    }, now).decision;

    bindingLedger.intent_approvals = [{
        id: 'iap_controller_bound',
        object_type: 'IntentApproval',
        status: 'pending',
        intent_id: 'intent_controller_binding',
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.proof_key_l1_address,
        expires_at: '2026-05-27T13:10:00.000Z',
    }];

    const boundAuthorization = buildAuthorization(bindingLedger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_id: 'intent_controller_binding',
        intent_approval_id: 'iap_controller_bound',
        policy_decision_id: bindingPolicy.id,
    }, now);
    assert.equal(boundAuthorization.can_execute, true, 'Bound controller approval must authorize');

    bindingLedger.intent_approvals.push({
        id: 'iap_controller_substituted',
        object_type: 'IntentApproval',
        status: 'pending',
        intent_id: 'intent_controller_binding',
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: 'sl1_2255d4a39f5fe8fab62ecd5aeea158a6e8c1ba3f',
        expires_at: '2026-05-27T13:10:00.000Z',
    });
    const substitutedControllerAuthorization = buildAuthorization(bindingLedger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_id: 'intent_controller_binding',
        intent_approval_id: 'iap_controller_substituted',
        policy_decision_id: bindingPolicy.id,
    }, now);
    assert.equal(substitutedControllerAuthorization.can_execute, false, 'Substituted controller must not authorize');
    assert.ok(
        substitutedControllerAuthorization.reason_codes.includes('INTENT_APPROVAL_CONTROLLER_MISMATCH'),
        'Controller substitution must be explicit in reason codes'
    );

    bindingLedger.intent_approvals.push({
        id: 'iap_entity_substituted',
        object_type: 'IntentApproval',
        status: 'pending',
        intent_id: 'intent_controller_binding',
        entity_l1_address: 'sl1e_2255d4a39f5fe8fab62ecd5aeea158a6e8c1ba3',
        controller_l1_address: vector.proof_key_l1_address,
        expires_at: '2026-05-27T13:10:00.000Z',
    });
    const substitutedEntityAuthorization = buildAuthorization(bindingLedger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_id: 'intent_controller_binding',
        intent_approval_id: 'iap_entity_substituted',
        policy_decision_id: bindingPolicy.id,
    }, now);
    assert.equal(substitutedEntityAuthorization.can_execute, false, 'Substituted entity must not authorize');
    assert.ok(
        substitutedEntityAuthorization.reason_codes.includes('INTENT_APPROVAL_ENTITY_MISMATCH'),
        'Entity substitution must be explicit in reason codes'
    );
}

function runIntentApprovalRuntimeConformance() {
    const vector = readVector('intent-approval-v1.json');
    const now = new Date(vector.now);
    const intent = normalizeIntent({
        ...vector.intent,
        entity_l1_address: vector.entity_l1_address,
        audience: vector.audience,
    });
    const challenge = challengeForIntent(intent);
    const reorderedIntent = normalizeIntent({
        audience: vector.audience,
        entity_l1_address: vector.entity_l1_address,
        expires_at: vector.intent.expires_at,
        nonce: vector.intent.nonce,
        scope: vector.intent.scope,
        capability: vector.intent.capability,
        payload: {
            asset: 'RUBT',
            amount: '100.00',
            order_id: 'order_001',
        },
        intent_type: vector.intent.intent_type,
    });
    assert.equal(intentHash(reorderedIntent), intentHash(intent), 'Intent hash must be key-order stable');
    assert.equal(challengeForIntent(reorderedIntent), challenge, 'Intent challenge must be key-order stable');

    const nestedIntentA = normalizeIntent({
        entity_l1_address: vector.entity_l1_address,
        audience: vector.audience,
        intent_type: 'marketplace.purchase',
        nonce: 'nonce_nested_order',
        expires_at: vector.intent.expires_at,
        payload: {
            checkout: {
                amount: '100.00',
                asset: 'RUBT',
            },
            order_id: 'order_001',
        },
    });
    const nestedIntentB = normalizeIntent({
        expires_at: vector.intent.expires_at,
        nonce: 'nonce_nested_order',
        intent_type: 'marketplace.purchase',
        audience: vector.audience,
        entity_l1_address: vector.entity_l1_address,
        payload: {
            order_id: 'order_001',
            checkout: {
                asset: 'RUBT',
                amount: '100.00',
            },
        },
    });
    assert.equal(intentHash(nestedIntentA), intentHash(nestedIntentB), 'Intent hash must be nested-key-order stable');
    assert.equal(challengeForIntent(nestedIntentA), challengeForIntent(nestedIntentB), 'Challenge must be nested-key-order stable');

    const unicodeIntentA = normalizeIntent({
        entity_l1_address: vector.entity_l1_address,
        audience: vector.audience,
        intent_type: 'marketplace.purchase',
        nonce: 'nonce_unicode',
        expires_at: vector.intent.expires_at,
        payload: { label: 'Cafe\u0301' },
    });
    const unicodeIntentB = normalizeIntent({
        entity_l1_address: vector.entity_l1_address,
        audience: vector.audience,
        intent_type: 'marketplace.purchase',
        nonce: 'nonce_unicode',
        expires_at: vector.intent.expires_at,
        payload: { label: 'Café' },
    });
    assert.equal(intentHash(unicodeIntentA), intentHash(unicodeIntentB), 'Intent hash must be Unicode-normalization stable');
    assert.equal(challengeForIntent(unicodeIntentA), challengeForIntent(unicodeIntentB), 'Challenge must be Unicode-normalization stable');
    assert.notEqual(challenge, intentHash(intent), 'Challenge must be domain-separated from raw intent hash');
    const ledger = {
        controller_bindings: [{
            credential_id: vector.credential_id,
            entity_l1_address: vector.entity_l1_address,
            controller_l1_address: vector.controller_l1_address,
            rp_id: vector.rp_id,
            status: 'active',
        }],
    };

    const approval = createIntentApproval(ledger, {
        intent,
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.controller_l1_address,
        credential_id: vector.credential_id,
        rp_id: vector.rp_id,
        assertion: { challenge, authenticator_data: 'authdata', signature: 'sig' },
    }, now);

    assert.equal(approval.status, 'pending', 'IntentApproval starts pending');
    assert.equal(approval.entity_l1_address, vector.entity_l1_address, 'IntentApproval binds entity');
    assert.equal(approval.controller_l1_address, vector.controller_l1_address, 'IntentApproval binds controller');
    assert.equal(approval.audience, vector.audience, 'IntentApproval binds audience');
    assert.equal(approval.nonce, vector.intent.nonce, 'IntentApproval binds nonce');
    assert.equal(
        verifyIntentApproval(ledger, approval.id, {
            entity_l1_address: vector.entity_l1_address,
            controller_l1_address: vector.controller_l1_address,
            intent_id: intent.id,
            audience: vector.audience,
            nonce: vector.intent.nonce,
            expires_at: vector.intent.expires_at,
            credential_id: vector.credential_id,
            rp_id: vector.rp_id,
        }, now).ok,
        true,
        'IntentApproval verifies with exact immutable bindings'
    );

    assert.equal(
        verifyIntentApproval(ledger, approval.id, { audience: vector.other_audience }, now).ok,
        false,
        'Audience substitution must deny'
    );
    const nonceSubstitution = verifyIntentApproval(ledger, approval.id, { nonce: 'nonce_purchase_substituted' }, now);
    assert.equal(
        nonceSubstitution.ok,
        false,
        'Nonce substitution must deny'
    );
    assert.ok(
        nonceSubstitution.reason_codes.includes('INTENT_APPROVAL_NONCE_MISMATCH'),
        'Nonce substitution must be explicit in reason codes'
    );
    const expirySubstitution = verifyIntentApproval(ledger, approval.id, { expires_at: '2026-05-27T13:20:00.000Z' }, now);
    assert.equal(
        expirySubstitution.ok,
        false,
        'Expiry substitution must deny'
    );
    assert.ok(
        expirySubstitution.reason_codes.includes('INTENT_APPROVAL_EXPIRY_MISMATCH'),
        'Expiry substitution must be explicit in reason codes'
    );
    assert.equal(
        verifyIntentApproval(ledger, approval.id, { credential_id: vector.other_credential_id }, now).ok,
        false,
        'Credential substitution must deny'
    );
    assert.throws(() => createIntentApproval(ledger, {
        intent: { ...intent, nonce: 'nonce_purchase_002' },
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.other_controller_l1_address,
        credential_id: vector.credential_id,
        rp_id: vector.rp_id,
        assertion: { challenge: challengeForIntent({ ...intent, nonce: 'nonce_purchase_002' }) },
    }, now), /CREDENTIAL_CONTROLLER_MISMATCH/, 'Credential must remain bound to controller');
    assert.throws(() => createIntentApproval(ledger, {
        intent: { ...intent, nonce: 'nonce_purchase_003' },
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.controller_l1_address,
        credential_id: vector.other_credential_id,
        rp_id: vector.rp_id,
        assertion: { challenge: challengeForIntent({ ...intent, nonce: 'nonce_purchase_003' }) },
    }, now), /CREDENTIAL_BINDING_NOT_FOUND/, 'Unknown credential must not approve intent');
    assert.throws(() => createIntentApproval(ledger, {
        intent: { ...intent, nonce: 'nonce_purchase_004' },
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.controller_l1_address,
        credential_id: vector.credential_id,
        rp_id: vector.rp_id,
        assertion: { challenge: 'wrong_challenge' },
    }, now), /WEBAUTHN_CHALLENGE_MISMATCH/, 'Assertion challenge must match canonical intent challenge');
    assert.throws(() => createIntentApproval(ledger, {
        intent,
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.controller_l1_address,
        credential_id: vector.credential_id,
        rp_id: vector.rp_id,
        assertion: { challenge },
    }, now), /INTENT_APPROVAL_REPLAY_DETECTED/, 'IntentApproval replay must be rejected');

    const consumed = consumeIntentApproval(ledger, approval.id, {
        entity_l1_address: vector.entity_l1_address,
        controller_l1_address: vector.controller_l1_address,
        intent_id: intent.id,
        audience: vector.audience,
        credential_id: vector.credential_id,
        rp_id: vector.rp_id,
    }, now);
    assert.equal(consumed.ok, true, 'Pending IntentApproval can be consumed once');
    assert.equal(
        verifyIntentApproval(ledger, approval.id, {
            entity_l1_address: vector.entity_l1_address,
            controller_l1_address: vector.controller_l1_address,
            intent_id: intent.id,
            audience: vector.audience,
            nonce: vector.intent.nonce,
            expires_at: vector.intent.expires_at,
            credential_id: vector.credential_id,
            rp_id: vector.rp_id,
        }, now).ok,
        false,
        'Executed IntentApproval cannot be reused'
    );

    const authLedger = {
        controller_bindings: ledger.controller_bindings,
        intent_approvals: [approval],
    };
    createControlGrant(authLedger, {
        id: 'grant_executed_approval',
        entity_l1_address: vector.entity_l1_address,
        key_l1_address: vector.controller_l1_address,
        capability: vector.intent.capability,
        scope: vector.intent.scope,
        policy: 'allow',
        status: 'active',
    }, now);
    const policy = recordPolicyArtifacts(authLedger, {
        intent_type: vector.intent.intent_type,
        intent: { intent_id: intent.id },
        facts: { payment_status: 'paid' },
    }, { ok: true, policies_evaluated: 1 }, now).decision;
    const authorization = buildAuthorization(authLedger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.controller_l1_address,
        capability: vector.intent.capability,
        scope: vector.intent.scope,
        intent_id: intent.id,
        intent_approval_id: approval.id,
        policy_decision_id: policy.id,
    }, now);
    assert.equal(authorization.can_execute, false, 'Authorization must reject executed IntentApproval');
    assert.ok(authorization.reason_codes.includes('INTENT_APPROVAL_EXECED') || authorization.reason_codes.includes('INTENT_APPROVAL_EXECUTED'));
}

function runPolicyArtifactConformance() {
    const vector = readVector('policy-artifacts-v1.json');
    const now = new Date(vector.now);

    for (const policyCase of vector.cases) {
        const ledger = {};
        const artifacts = recordPolicyArtifacts(ledger, policyCase.input, policyCase.result, now);

        assert.equal(artifacts.decision.decision, policyCase.decision, policyCase.name);
        assert.equal(ledger.policy_evaluations.length, 1, 'PolicyEvaluation must be persisted');
        assert.equal(ledger.policy_decisions.length, 1, 'PolicyDecision must be persisted');
        assert.equal(artifacts.decision.policy_evaluation_id, artifacts.evaluation.id, 'Decision must reference evaluation');

        const replayed = recordPolicyArtifacts({}, policyCase.input, policyCase.result, now);
        assert.equal(replayed.evaluation.id, artifacts.evaluation.id, 'PolicyEvaluation ID must be deterministic');
        assert.equal(replayed.decision.id, artifacts.decision.id, 'PolicyDecision ID must be deterministic');
    }
}

function runExternalProofConformance() {
    const vector = readVector('external-proof-v1.json');
    const now = new Date(vector.now);
    const ledger = {};

    const artifacts = createExternalProof(ledger, vector.proof, now);
    assert.equal(artifacts.externalProof.object_type, 'ExternalProof');
    assert.equal(artifacts.normalizedFact.object_type, 'NormalizedFact');
    assert.equal(artifacts.verificationPath.object_type, 'VerificationPath');
    assert.equal(artifacts.finalityClaim.object_type, 'FinalityClaim');
    assert.equal(verifyExternalProof(ledger, artifacts.externalProof.id).ok, true, 'ExternalProof must verify with lineage');
    assert.throws(() => createExternalProof(ledger, vector.proof, now), new RegExp(vector.duplicate_error));
}

function runNotificationEnvelopeConformance() {
    const vector = readVector('notification-v1.json');
    const now = new Date(vector.now);
    const ledger = {};
    const envelope = createNotificationEnvelope(ledger, vector.envelope, now);

    assert.equal(envelope.object_type, vector.expected.object_type, 'NotificationEnvelope object type must be explicit');
    assert.equal(envelope.authority_effect, vector.expected.authority_effect, 'NotificationEnvelope must carry no authority effect');
    assert.equal(envelope.non_authoritative, vector.expected.non_authoritative, 'NotificationEnvelope must be non-authoritative');
    assert.equal(envelope.consumes_artifact, vector.expected.consumes_artifact, 'NotificationEnvelope must not consume artifacts');
    assert.equal(envelope.mutates_authority, vector.expected.mutates_authority, 'NotificationEnvelope must not mutate authority');
    assert.deepEqual(envelope.capabilities_granted, vector.expected.capabilities_granted, 'NotificationEnvelope must not grant capabilities');
    assert.equal(verifyNotificationEnvelope(ledger, envelope.id, now).ok, true, 'NotificationEnvelope verifies as non-authoritative');

    assert.equal(ledger.control_grants?.length || 0, 0, 'NotificationEnvelope must not create ControlGrant');
    assert.equal(ledger.capability_grants?.length || 0, 0, 'NotificationEnvelope must not create capability grant projection');
    assert.equal(ledger.authorizations?.length || 0, 0, 'NotificationEnvelope must not create Authorization');
    assert.equal(ledger.intent_approvals?.length || 0, 0, 'NotificationEnvelope must not create IntentApproval');
    assert.equal(ledger.transactions?.length || 0, 0, 'NotificationEnvelope must not create Transaction');
    assert.equal(ledger.settlement_operations?.length || 0, 0, 'NotificationEnvelope must not create SettlementOperation');

    const read = markNotificationRead(ledger, envelope.id, now);
    assert.equal(read.ok, true, 'NotificationEnvelope can be marked read');
    assert.equal(read.envelope.status, 'read', 'Read status is notification metadata only');
    assert.equal(read.envelope.consumes_artifact, false, 'Read status must not consume artifact');
    assert.equal(ledger.authorizations?.length || 0, 0, 'Reading notification must not create Authorization');

    const dismissed = dismissNotification(ledger, envelope.id, now);
    assert.equal(dismissed.ok, true, 'NotificationEnvelope can be dismissed');
    assert.equal(dismissed.envelope.status, 'dismissed', 'Dismiss status is notification metadata only');
    assert.equal(dismissed.envelope.mutates_authority, false, 'Dismiss status must not mutate authority');

    assert.throws(
        () => createNotificationEnvelope(ledger, vector.envelope, now),
        /NotificationEnvelope replay detected/,
        'NotificationEnvelope publication must be replay-safe'
    );

    for (const forbidden of vector.forbidden_inputs) {
        assert.throws(
            () => createNotificationEnvelope({}, { ...vector.envelope, ...forbidden.override }, now),
            new RegExp(forbidden.error),
            forbidden.name
        );
    }

    const expired = createNotificationEnvelope({}, {
        ...vector.envelope,
        idempotency_key: 'expired-notification',
        expires_at: '2026-05-28T12:59:59.000Z',
    }, now);
    assert.equal(
        verifyNotificationEnvelope({ notification_envelopes: [expired] }, expired.id, now).ok,
        false,
        'Expired NotificationEnvelope must not verify as active discovery'
    );
}

function buildMarketplaceLedger(vector, overrides = {}) {
    const now = new Date(vector.now);
    const ledger = {};
    const proof = createExternalProof(ledger, {
        source_domain: 'psp:meanly-sandbox',
        proof_type: 'psp.payment.succeeded',
        external_reference: { id: overrides.external_reference_id || 'psp_evt_001' },
        fact_type: 'payment.received',
        payload: { order_id: 'order_001', amount: '100.00' },
        status: overrides.proof_status || 'verified',
    }, now);
    const policy = recordPolicyArtifacts(ledger, {
        intent_type: 'MARKETPLACE_FULFILLMENT',
        intent: { intent_id: vector.purchase_intent_id },
        facts: { payment_fact_id: proof.normalizedFact.id },
    }, overrides.policy_result || { ok: true, policies_evaluated: 1 }, now);
    const grant = createControlGrant(ledger, {
        id: overrides.grant_id || 'grant_marketplace_reference',
        entity_l1_address: vector.entity_l1_address,
        key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        policy: 'allow',
        expires_at: overrides.grant_expires_at || null,
    }, now);

    if (overrides.revoke_grant) {
        revokeControlGrant(ledger, { grant_id: grant.id }, now);
    }

    const authorization = overrides.skip_authorization ? null : buildAuthorization(ledger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_approval_id: 'iap_marketplace_reference',
        policy_decision_id: policy.decision.id,
        expires_at: overrides.authorization_expires_at || '2026-05-27T13:05:00.000Z',
    }, now);

    return { ledger, proof, policy, grant, authorization, now };
}

function runMarketplaceConformance() {
    const vector = readVector('marketplace-flow-v1.json');
    const happy = buildMarketplaceLedger(vector);
    const settlement = executeMarketplaceSettlement(happy.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: happy.proof.externalProof.id,
        authorization_id: happy.authorization.id,
        idempotency_key: vector.idempotency_key,
        payload: vector.payload,
    }, happy.now);

    assert.equal(settlement.ok, true, 'marketplace happy path must settle');
    assert.equal(explainSettlement(happy.ledger, settlement.settlementProof.id).ok, true, 'settlement must explain lineage');
    assert.equal(executeMarketplaceSettlement(happy.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: happy.proof.externalProof.id,
        authorization_id: happy.authorization.id,
        idempotency_key: vector.idempotency_key,
        payload: vector.payload,
    }, happy.now).ok, false, 'duplicate webhook must not mutate twice');

    const revoked = buildMarketplaceLedger(vector, { revoke_grant: true, grant_id: 'grant_revoked_reference', external_reference_id: 'psp_evt_revoked' });
    assert.equal(executeMarketplaceSettlement(revoked.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: revoked.proof.externalProof.id,
        authorization_id: revoked.authorization.id,
        payload: vector.payload,
    }, revoked.now).ok, false, 'revoked grant must deny settlement');

    const expired = buildMarketplaceLedger(vector, {
        authorization_expires_at: '2026-05-27T12:59:59.000Z',
        grant_id: 'grant_expired_auth_reference',
        external_reference_id: 'psp_evt_expired_auth',
    });
    assert.equal(executeMarketplaceSettlement(expired.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: expired.proof.externalProof.id,
        authorization_id: expired.authorization.id,
        payload: vector.payload,
    }, expired.now).ok, false, 'expired authorization must deny settlement');

    const lateProof = buildMarketplaceLedger(vector, {
        proof_status: 'late',
        grant_id: 'grant_late_proof_reference',
        external_reference_id: 'psp_evt_late',
    });
    assert.equal(executeMarketplaceSettlement(lateProof.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: lateProof.proof.externalProof.id,
        authorization_id: lateProof.authorization.id,
        payload: vector.payload,
    }, lateProof.now).ok, false, 'late proof must deny settlement');

    const noAuth = buildMarketplaceLedger(vector, {
        skip_authorization: true,
        grant_id: 'grant_no_auth_reference',
        external_reference_id: 'psp_evt_no_auth',
    });
    assert.equal(executeMarketplaceSettlement(noAuth.ledger, {
        purchase_intent_id: vector.purchase_intent_id,
        external_proof_id: noAuth.proof.externalProof.id,
        authorization_id: 'missing_authorization',
        payload: vector.payload,
    }, noAuth.now).ok, false, 'payment receipt without authorization must deny settlement');
}

function runLineageAuditConformance() {
    const vector = readVector('marketplace-flow-v1.json');
    const now = new Date(vector.now);
    const ledger = {};

    const grant = createControlGrant(ledger, {
        id: 'grant_lineage_audit',
        entity_l1_address: vector.entity_l1_address,
        key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        policy: 'allow',
    }, now);

    const noPolicyAuthorization = buildAuthorization(ledger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_approval_id: 'iap_without_policy',
    }, now);
    assert.equal(noPolicyAuthorization.can_execute, false, 'Authorization without PolicyDecision must not execute');

    const proofOnly = createExternalProof(ledger, {
        source_domain: 'psp:lineage-audit',
        proof_type: 'psp.payment.succeeded',
        external_reference: { id: 'lineage_evt_001' },
        fact_type: 'payment.received',
        payload: { order_id: 'lineage_order_001' },
    }, now);

    assert.equal(ledger.settlement_operations?.length || 0, 0, 'ExternalProof must not create settlement operation');
    assert.equal(ledger.authorizations?.filter((auth) => auth.can_execute).length || 0, 0, 'ExternalProof must not create executable authorization');
    assert.equal(ledger.control_grants.length, 1, 'ExternalProof must not create capability grants');

    const policy = recordPolicyArtifacts(ledger, {
        intent_type: 'MARKETPLACE_FULFILLMENT',
        intent: { intent_id: vector.purchase_intent_id },
        facts: { payment_fact_id: proofOnly.normalizedFact.id },
    }, { ok: true, policies_evaluated: 1 }, now);

    const authorization = buildAuthorization(ledger, {
        entity_l1_address: vector.entity_l1_address,
        proof_key_l1_address: vector.proof_key_l1_address,
        capability: vector.capability,
        scope: vector.scope,
        intent_approval_id: 'iap_with_policy',
        policy_decision_id: policy.decision.id,
    }, now);

    assert.equal(authorization.can_execute, true, 'PolicyDecision plus grant should create executable authorization');

    revokeControlGrant(ledger, { grant_id: grant.id }, now);
    assert.equal(verifyAuthorization(ledger, authorization.id, now).ok, false, 'Revocation must dominate old authorization');

    const incompleteLedger = {
        settlement_proofs: [{
            id: 'sproof_incomplete',
            lineage: {
                facts: ['fact_1'],
                policy_evaluation_id: 'peval_1',
                policy_decision_id: 'pdec_1',
                control_grant_ids: ['grant_1'],
                authorization_id: 'authz_1',
                transaction_id: 'tx_1',
                settlement_operation_id: 'settle_1',
            },
        }],
    };
    assert.equal(explainSettlement(incompleteLedger, 'sproof_incomplete').ok, false, 'Lineage without Capability must be incomplete');
}

function runStateMutationScannerConformance() {
    const files = [
        'server.js',
        'authority-runtime.js',
        'intent-approval-runtime.js',
        'policy-artifacts.js',
        'external-proof-runtime.js',
        'notification-runtime.js',
        'marketplace-flow-runtime.js',
        'settlement/federation.js',
        'settlement/governance.js',
        'settlement/intent-resolution.js',
        'settlement/event-bus.js',
        'settlement/receipt.js',
    ];
    const mutationPatterns = [
        /balances\[[^\]]+\]\s*(?:\+\+|--|[+\-*/]?=)/,
        /\.balance\s*(?:\+\+|--|[+\-*/]?=)/,
        /ledger\.accounts\[[^\]]+\]\s*=/,
        /ledger\.transactions\.push\(/,
        /ledger\.settlement_operations\.push\(/,
        /ledger\.settlement_proofs\.push\(/,
        /ledger\.[a-z_]+\.push\(/,
        /upsertById\(ledger\./,
        /saveLedger\(\)/,
    ];
    const allowed = [
        {
            file: 'server.js',
            snippet: 'ledger.event_log.push(event);',
            reason: 'event_replay_runtime: append accepted protocol events after applyEvent validation',
        },
        {
            file: 'server.js',
            snippet: 'saveLedger();',
            context: 'ledger.event_log.push(event);',
            reason: 'event_replay_runtime: persist accepted protocol events and derived state root',
        },
        {
            file: 'server.js',
            snippet: 'ledger.event_log.push(genesisEvent);',
            reason: 'genesis_state_initialization: bootstrap empty ledger from genesis event',
        },
        {
            file: 'server.js',
            snippet: 'saveLedger();',
            context: 'if (result.state === PROPOSAL_STATES.ENACTED)',
            reason: 'governance_epoch_store: persist enacted constitution epoch metadata',
        },
        {
            file: 'server.js',
            snippet: 'ledger.accounts[entityAddress] =',
            context: "case 'GENESIS'",
            reason: 'genesis_state_initialization: materialize account view from GENESIS event',
        },
        {
            file: 'server.js',
            snippet: 'ledger.controller_bindings.push',
            context: "case 'GENESIS'",
            reason: 'genesis_state_initialization: materialize ControllerBinding from verified passkey public credential',
        },
        {
            file: 'server.js',
            snippet: 'ledger.controller_bindings.push',
            context: "case 'PASSKEY_ADDED'",
            reason: 'identity_key_lifecycle: materialize ControllerBinding from verified added passkey credential',
        },
        {
            file: 'server.js',
            snippet: 'ledger.accounts[devAddress] =',
            reason: 'developer_bootstrap_fixture: local seeded developer identity view',
        },
        {
            file: 'server.js',
            snippet: 'ledger.settlement_events.push',
            reason: 'event_observability_store: persist peer settlement event metadata without state mutation',
        },
        {
            file: 'authority-runtime.js',
            snippet: 'upsertById(ledger.capabilities',
            reason: 'lineage_artifact_store: persist Capability authority artifact',
        },
        {
            file: 'authority-runtime.js',
            snippet: 'upsertById(ledger.control_grants',
            reason: 'lineage_artifact_store: persist ControlGrant authority artifact',
        },
        {
            file: 'authority-runtime.js',
            snippet: 'upsertById(ledger.capability_grants',
            reason: 'lineage_artifact_store: persist CRE-compatible grant projection',
        },
        {
            file: 'authority-runtime.js',
            snippet: 'upsertById(ledger.revocations',
            reason: 'lineage_artifact_store: persist revocation for execution-time authority checks',
        },
        {
            file: 'authority-runtime.js',
            snippet: 'upsertById(ledger.authorizations',
            reason: 'lineage_artifact_store: persist Authorization after PolicyDecision and grant checks',
        },
        {
            file: 'intent-approval-runtime.js',
            snippet: 'upsertById(ledger.intent_approvals',
            reason: 'lineage_artifact_store: persist IntentApproval cryptographic approval artifact',
        },
        {
            file: 'intent-approval-runtime.js',
            snippet: 'ledger.intent_approval_replay_keys.push',
            reason: 'replay_guard_store: remember consumed IntentApproval replay key',
        },
        {
            file: 'policy-artifacts.js',
            snippet: 'upsertById(ledger.policy_evaluations',
            reason: 'lineage_artifact_store: persist PolicyEvaluation facts-to-decision trace',
        },
        {
            file: 'policy-artifacts.js',
            snippet: 'upsertById(ledger.policy_decisions',
            reason: 'lineage_artifact_store: persist PolicyDecision required by Authorization',
        },
        {
            file: 'external-proof-runtime.js',
            snippet: 'upsertById(ledger.verification_paths',
            reason: 'lineage_artifact_store: persist VerificationPath for external proof audit',
        },
        {
            file: 'external-proof-runtime.js',
            snippet: 'upsertById(ledger.finality_claims',
            reason: 'lineage_artifact_store: persist FinalityClaim for external proof audit',
        },
        {
            file: 'external-proof-runtime.js',
            snippet: 'upsertById(ledger.normalized_facts',
            reason: 'lineage_artifact_store: persist NormalizedFact consumed by policy',
        },
        {
            file: 'external-proof-runtime.js',
            snippet: 'upsertById(ledger.external_proofs',
            reason: 'lineage_artifact_store: persist ExternalProof without mutating economic state',
        },
        {
            file: 'external-proof-runtime.js',
            snippet: 'ledger.external_proof_replay_keys.push',
            reason: 'replay_guard_store: remember consumed external proof replay key',
        },
        {
            file: 'notification-runtime.js',
            snippet: 'upsertById(ledger.notification_envelopes',
            reason: 'lineage_artifact_store: persist non-authoritative NotificationEnvelope discovery pointer',
        },
        {
            file: 'notification-runtime.js',
            snippet: 'ledger.notification_replay_keys.push',
            reason: 'replay_guard_store: remember published notification replay key',
        },
        {
            file: 'marketplace-flow-runtime.js',
            snippet: 'upsertById(ledger.transactions',
            reason: 'lineage_artifact_store: persist Transaction created from validated Authorization',
        },
        {
            file: 'marketplace-flow-runtime.js',
            snippet: 'upsertById(ledger.settlement_operations',
            reason: 'lineage_artifact_store: persist SettlementOperation with complete lineage',
        },
        {
            file: 'marketplace-flow-runtime.js',
            snippet: 'upsertById(ledger.settlement_proofs',
            reason: 'lineage_artifact_store: persist SettlementProof explaining state mutation',
        },
        {
            file: 'marketplace-flow-runtime.js',
            snippet: 'ledger.settlement_idempotency_keys.push',
            reason: 'replay_guard_store: remember consumed settlement idempotency key',
        },
        {
            file: 'settlement/federation.js',
            snippet: 'this.saveLedger();',
            reason: 'network_metadata_store: persist federation metadata outside economic state',
        },
        {
            file: 'settlement/governance.js',
            snippet: 'this.saveLedger();',
            reason: 'governance_epoch_store: persist governance metadata outside economic state',
        },
        {
            file: 'settlement/intent-resolution.js',
            snippet: 'this.ledger.intent_registry',
            reason: 'workflow_metadata_store: persist intent lifecycle metadata without balance mutation',
        },
        {
            file: 'settlement/event-bus.js',
            snippet: 'this.ledger.settlement_events',
            reason: 'event_observability_store: persist audit event stream metadata',
        },
        {
            file: 'settlement/receipt.js',
            snippet: 'this.ledger.receipts',
            reason: 'receipt_metadata_store: persist receipt metadata for audit queries',
        },
    ];

    for (const entry of allowed) {
        assert.equal(typeof entry.reason, 'string', `Allowlist entry missing reason: ${JSON.stringify(entry)}`);
        assert.ok(entry.reason.includes(':'), `Allowlist reason must include category: ${entry.reason}`);
    }

    function scanSourceMap(sourceMap, allowlist) {
        const violations = [];
        for (const [relativeFile, content] of Object.entries(sourceMap)) {
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (!mutationPatterns.some((pattern) => pattern.test(line))) continue;

            const context = lines.slice(Math.max(0, index - 72), index + 1).join('\n');
                const isAllowed = allowlist.some((entry) => {
                    if (entry.file !== relativeFile) return false;
                    if (!line.includes(entry.snippet)) return false;
                    return !entry.context || context.includes(entry.context);
            });

            if (!isAllowed) {
                violations.push(`${relativeFile}:${index + 1}: ${line.trim()}`);
            }
        }
        }
        return violations;
    }

    const sourceMap = Object.fromEntries(
        files.map((relativeFile) => [
            relativeFile,
            fs.readFileSync(path.join(nodeDir, relativeFile), 'utf8'),
        ])
    );
    const violations = scanSourceMap(sourceMap, allowed);
    assert.deepEqual(violations, [], `Unapproved state mutations:\n${violations.join('\n')}`);

    const regressionViolations = scanSourceMap({
        'negative-runtime.js': [
            'function creditWithoutLineage(account, asset, amount) {',
            '    account.balances[asset] += amount;',
            '}',
        ].join('\n'),
    }, []);
    assert.equal(regressionViolations.length, 1, 'Direct balance mutation regression must be detected');
    assert.match(regressionViolations[0], /account\.balances\[asset\] \+= amount/);
}

function runKeyCustodyScannerConformance() {
    const skipDirectories = new Set(['.git', 'node_modules']);
    const scannedExtensions = new Set(['.js', '.json', '.md', '.webmanifest', '.pem', '.key']);
    const custodyPatterns = [
        /BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY/,
        /\b(?:user|account|controller|credential|passkey)[A-Za-z0-9_]*(?:PrivateKey|SecretKey)\b/,
        /\b(?:private_key|secret_key|credential_private_key|passkey_private_key)\b/i,
        /\b(?:mnemonic|seed_phrase|recovery_phrase)\b/i,
    ];
    const allowed = [
        {
            file: 'node/settlement/attestations.js',
            snippet: 'this._privateKey = privateKey;',
            reason: 'node_validator_runtime_key: ephemeral validator key, not user/controller custody',
        },
        {
            file: 'node/settlement/attestations.js',
            snippet: 'key:    crypto.createPrivateKey({ key: this._privateKey',
            reason: 'node_validator_runtime_key: signs validator attestations only',
        },
        {
            file: 'node/settlement/governance.js',
            snippet: 'key: require(\'crypto\').createPrivateKey({ key: validator._privateKey',
            reason: 'node_validator_runtime_key: signs simulated governance validator votes only',
        },
        {
            file: 'node/settlement/receipt.js',
            snippet: 'const { privateKey, publicKey } = crypto.generateKeyPairSync',
            reason: 'node_receipt_runtime_key: node issuer key, not user/controller custody',
        },
        {
            file: 'node/settlement/receipt.js',
            snippet: 'privateKeyEncoding: { type: \'pkcs8\', format: \'der\' }',
            reason: 'node_receipt_runtime_key: node issuer key encoding only',
        },
        {
            file: 'node/settlement/receipt.js',
            snippet: 'this._nodePrivateKey = privateKey;',
            reason: 'node_receipt_runtime_key: signs receipts only',
        },
        {
            file: 'node/settlement/receipt.js',
            snippet: 'key:    crypto.createPrivateKey({ key: this._nodePrivateKey',
            reason: 'node_receipt_runtime_key: signs receipts only',
        },
    ];

    for (const entry of allowed) {
        assert.equal(typeof entry.reason, 'string', `Key custody allowlist entry missing reason: ${JSON.stringify(entry)}`);
        assert.ok(entry.reason.includes(':'), `Key custody allowlist reason must include category: ${entry.reason}`);
    }

    function walk(directory) {
        const files = [];
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (skipDirectories.has(entry.name)) continue;
            const fullPath = path.join(directory, entry.name);
            const relativePath = path.relative(root, fullPath);
            if (entry.isDirectory()) {
                files.push(...walk(fullPath));
            } else if (relativePath !== 'conformance/run.js' && scannedExtensions.has(path.extname(entry.name))) {
                files.push(fullPath);
            }
        }
        return files;
    }

    function scanSourceMap(sourceMap, allowlist) {
        const violations = [];
        for (const [relativeFile, content] of Object.entries(sourceMap)) {
            const isPublicPrivateKeyFile = /(?:^|\/)(?:www|public)\/.*(?:private|key).*\.pem$/i.test(relativeFile);
            if (isPublicPrivateKeyFile) {
                violations.push(`${relativeFile}: static private key material is forbidden`);
                continue;
            }

            const lines = content.split(/\r?\n/);
            for (let index = 0; index < lines.length; index++) {
                const line = lines[index];
                if (!custodyPatterns.some((pattern) => pattern.test(line))) continue;

                const isAllowed = allowlist.some((entry) => {
                    return entry.file === relativeFile && line.includes(entry.snippet);
                });

                if (!isAllowed) {
                    violations.push(`${relativeFile}:${index + 1}: ${line.trim()}`);
                }
            }
        }
        return violations;
    }

    const sourceMap = Object.fromEntries(
        walk(root).map((filePath) => [
            path.relative(root, filePath),
            fs.readFileSync(filePath, 'utf8'),
        ])
    );
    const violations = scanSourceMap(sourceMap, allowed);
    assert.deepEqual(violations, [], `Private key custody violations:\n${violations.join('\n')}`);

    const regressionViolations = scanSourceMap({
        'node/www/leaked-user-key.pem': '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
        'node/bad-custody.js': 'const userPrivateKey = request.body.private_key;',
    }, []);
    assert.equal(regressionViolations.length, 2, 'Private key custody regressions must be detected');
    assert.match(regressionViolations.join('\n'), /static private key material is forbidden/);
    assert.match(regressionViolations.join('\n'), /userPrivateKey/);
}

function runConnectRuntimeStoreConformance() {
    let now = 1000;
    const store = new MemoryConnectRuntimeStore({ now: () => now });

    store.set('authChallenges', 'challenge_live', { expiresAtMs: 2000, challenge: 'abc' });
    assert.equal(store.get('authChallenges', 'challenge_live').challenge, 'abc', 'live challenge must be readable');
    now = 2500;
    assert.equal(store.get('authChallenges', 'challenge_live'), null, 'expired challenge must be rejected on read');

    store.set('deviceHandoffs', 'handoff_once', { expiresAtMs: 4000, status: 'pending' });
    assert.equal(store.consume('deviceHandoffs', 'handoff_once').status, 'pending', 'handoff can be consumed once');
    assert.equal(store.consume('deviceHandoffs', 'handoff_once'), null, 'consumed handoff cannot be reused');

    const limitedA = store.incrementRateLimit('registration:subject', { limit: 2, windowMs: 1000 });
    const limitedB = store.incrementRateLimit('registration:subject', { limit: 2, windowMs: 1000 });
    const limitedC = store.incrementRateLimit('registration:subject', { limit: 2, windowMs: 1000 });
    assert.equal(limitedA.allowed, true, 'first registration attempt allowed');
    assert.equal(limitedB.allowed, true, 'second registration attempt allowed');
    assert.equal(limitedC.allowed, false, 'third registration attempt rate-limited');

    assert.equal(store.markProofConsumed('proof_once', 6000), true, 'proof can be marked consumed once');
    assert.equal(store.markProofConsumed('proof_once', 6000), false, 'proof replay must be rejected');
}

function runIdentityProofRuntimeConformance() {
    const now = new Date('2026-05-27T13:00:00.000Z');
    const account = {
        entity_l1_address: 'sl1e_1111111111111111111111111111111111111111',
        key_l1_address: 'sl1_2222222222222222222222222222222222222222',
        alias: 'ivan.sl1.one',
        handle: 'ivan.sl1.one',
    };
    const query = {
        client_id: 'marketplace.one',
        redirect_uri: 'https://marketplace.one/simple-l1/callback',
        state: 'state_001',
        nonce: 'nonce_001',
        mode: 'login',
    };
    const secret = 'conformance-secret';
    const proof = createIdentityProof({
        account,
        query,
        challenge: 'challenge_001',
        controllerCredential: { key_l1_address: account.key_l1_address },
        mode: 'login',
        now,
        ttlMs: 10 * 60 * 1000,
        secret,
        publicAlias: '@ivan.sl1.one',
        displayAlias: 'ivan',
    });

    assert.equal(proof.object_type, 'IdentityProof');
    assert.equal(proof.audience, 'marketplace.one', 'IdentityProof must be audience-bound');
    assert.equal(proof.challenge, 'challenge_001', 'IdentityProof must bind challenge');
    assert.ok(proof.proof_id, 'IdentityProof must include proof_id');
    assert.ok(proof.issued_at, 'IdentityProof must include issued_at');
    assert.ok(proof.expires_at, 'IdentityProof must include expires_at');

    const consumed = new Set();
    const consumeProof = (proofId) => {
        if (consumed.has(proofId)) return false;
        consumed.add(proofId);
        return true;
    };
    assert.equal(
        verifyIdentityProof(proof, { audience: 'marketplace.one', challenge: 'challenge_001', now, secret, consumeProof }).ok,
        true,
        'valid proof verifies once'
    );
    assert.equal(
        verifyIdentityProof(proof, { audience: 'marketplace.one', challenge: 'challenge_001', now, secret, consumeProof }).ok,
        false,
        'proof replay must be rejected'
    );
    assert.ok(
        verifyIdentityProof(proof, { audience: 'other.app', challenge: 'challenge_001', now, secret }).reason_codes.includes('IDENTITY_PROOF_AUDIENCE_MISMATCH'),
        'wrong audience must be explicit'
    );
    assert.ok(
        verifyIdentityProof(proof, { audience: 'marketplace.one', challenge: 'wrong_challenge', now, secret }).reason_codes.includes('IDENTITY_PROOF_CHALLENGE_MISMATCH'),
        'wrong challenge must be explicit'
    );
    assert.ok(
        verifyIdentityProof(proof, { audience: 'marketplace.one', challenge: 'challenge_001', now: new Date('2026-05-27T13:11:00.000Z'), secret }).reason_codes.includes('IDENTITY_PROOF_EXPIRED'),
        'expired proof must be rejected'
    );
    assert.ok(
        verifyIdentityProof(proof, {
            audience: 'marketplace.one',
            challenge: 'challenge_001',
            now,
            secret,
            isControllerRevoked: () => true,
        }).reason_codes.includes('IDENTITY_PROOF_CONTROLLER_REVOKED'),
        'revoked controller must be rejected'
    );
}

function runConnectServerSurfaceConformance() {
    const source = fs.readFileSync(path.join(nodeDir, 'server.js'), 'utf8');
    assert.match(source, /alias_too_short/, 'username minimum rule must exist');
    assert.match(source, /alias_invalid_format/, 'username special-character rule must exist');
    assert.match(source, /signedToken/, 'alias reservations and identity sessions must use signed tokens');
    assert.match(source, /device_handoff_already_completed/, 'QR handoff completion must be single-use');
    assert.match(source, /rate_limited/, 'Connect endpoints must expose rate limits');
    assert.match(source, /fastify\.get\('\/identity'/, 'identity management page must exist');
    assert.match(source, /cannot_remove_last_passkey/, 'passkey lifecycle must protect last key');
}

test('Identity Kernel v1 conformance', runIdentityConformance);
test('CRE v1 conformance', runCreConformance);
test('Settlement Transition Rules v1 boundary conformance', runSettlementConformance);
test('Authority Runtime v1 conformance', runAuthorityRuntimeConformance);
test('IntentApproval Runtime v1 conformance', runIntentApprovalRuntimeConformance);
test('Policy Artifact v1 conformance', runPolicyArtifactConformance);
test('External Proof Runtime v1 conformance', runExternalProofConformance);
test('NotificationEnvelope v1 conformance', runNotificationEnvelopeConformance);
test('Marketplace Reference Flow v1 conformance', runMarketplaceConformance);
test('Lineage Audit v1 conformance', runLineageAuditConformance);
test('State Mutation Scanner v1 conformance', runStateMutationScannerConformance);
test('Key Custody Scanner v1 conformance', runKeyCustodyScannerConformance);
test('Connect Runtime Store v1 conformance', runConnectRuntimeStoreConformance);
test('IdentityProof Runtime v1 conformance', runIdentityProofRuntimeConformance);
test('SL1 Connect production surface conformance', runConnectServerSurfaceConformance);

if (process.exitCode) {
    process.exit(process.exitCode);
}
