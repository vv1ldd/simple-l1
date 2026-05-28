'use strict';

const identity = require('./identity-kernel');
const { artifactId, canonicalJson, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');

const INTENT_APPROVAL_STATUS = Object.freeze({
    PENDING: 'pending',
    EXECUTED: 'executed',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
});

function ensureIntentApprovalStores(ledger) {
    ensureArrayStore(ledger, 'intent_approvals');
    ensureArrayStore(ledger, 'intent_approval_replay_keys');
    ensureArrayStore(ledger, 'controller_bindings');

    return ledger;
}

function normalizeIntent(input) {
    const entityAddress = identity.assertEntityAddress(input.entity_l1_address);
    const audience = String(input.audience || '').normalize('NFC');
    const nonce = String(input.nonce || '').normalize('NFC');
    const expiresAt = String(input.expires_at || '').normalize('NFC');
    const intentType = String(input.intent_type || input.type || '').normalize('NFC');

    if (!audience || !nonce || !expiresAt || !intentType) {
        throw new Error('intent_type, audience, nonce, and expires_at are required');
    }

    const basis = {
        object_type: 'Intent',
        entity_l1_address: entityAddress,
        intent_type: intentType,
        capability: input.capability || null,
        scope: input.scope || null,
        audience,
        nonce,
        expires_at: expiresAt,
        payload_hash: input.payload_hash || hashObject(input.payload || {}),
    };

    return {
        id: input.id || input.intent_id || artifactId('intent', basis, 24),
        ...basis,
        metadata: input.metadata || {},
    };
}

function intentHash(intent) {
    return hashObject({
        object_type: 'Intent',
        id: intent.id,
        entity_l1_address: intent.entity_l1_address,
        intent_type: intent.intent_type,
        capability: intent.capability || null,
        scope: intent.scope || null,
        audience: intent.audience,
        nonce: intent.nonce,
        expires_at: intent.expires_at,
        payload_hash: intent.payload_hash,
    });
}

function challengeForIntent(intent) {
    return hashObject({
        domain: 'SL1_INTENT_APPROVAL_V1',
        intent_hash: intentHash(intent),
    });
}

function findCredentialBinding(ledger, { entityAddress, credentialId }) {
    const explicit = (ledger.controller_bindings || [])
        .find((binding) => binding.credential_id === credentialId && String(binding.status || 'active') === 'active');

    if (explicit) {
        return {
            entity_l1_address: explicit.entity_l1_address,
            controller_l1_address: explicit.controller_l1_address || explicit.key_l1_address,
            credential_id: explicit.credential_id,
            rp_id: explicit.rp_id,
            source: 'controller_bindings',
        };
    }

    const account = (ledger.accounts || {})[entityAddress];
    const accountKeys = [
        account,
        ...(account?.keys || []),
    ].filter(Boolean);
    const key = accountKeys.find((candidate) => candidate.credentialId === credentialId || candidate.credential_id === credentialId);

    if (!key) return null;

    return {
        entity_l1_address: entityAddress,
        controller_l1_address: key.key_l1_address || account.key_l1_address,
        credential_id: key.credentialId || key.credential_id,
        rp_id: key.rp_id || account.rp_id || null,
        source: 'accounts',
    };
}

function verifyCredentialBinding(ledger, { entityAddress, controllerAddress, credentialId, rpId }) {
    if (!credentialId) {
        return { ok: false, reason_codes: ['CREDENTIAL_ID_REQUIRED'] };
    }

    const binding = findCredentialBinding(ledger, { entityAddress, credentialId });
    if (!binding) {
        return { ok: false, reason_codes: ['CREDENTIAL_BINDING_NOT_FOUND'] };
    }

    const reasonCodes = [];
    if (identity.normalizeEntityAddress(binding.entity_l1_address) !== entityAddress) {
        reasonCodes.push('CREDENTIAL_ENTITY_MISMATCH');
    }

    if (identity.normalizeKeyAddress(binding.controller_l1_address) !== controllerAddress) {
        reasonCodes.push('CREDENTIAL_CONTROLLER_MISMATCH');
    }

    if (rpId && binding.rp_id && String(binding.rp_id) !== String(rpId)) {
        reasonCodes.push('CREDENTIAL_RP_ID_MISMATCH');
    }

    return { ok: reasonCodes.length === 0, binding, reason_codes: reasonCodes };
}

function createIntentApproval(ledger, input, now = new Date()) {
    ensureIntentApprovalStores(ledger);

    const intent = normalizeIntent(input.intent || input);
    const entityAddress = identity.assertEntityAddress(input.entity_l1_address || intent.entity_l1_address);
    const controllerAddress = identity.assertKeyAddress(
        input.controller_l1_address || input.proof_key_l1_address || input.key_l1_address
    );
    const credentialId = String(input.credential_id || '');
    const rpId = String(input.rp_id || '');
    const expectedChallenge = challengeForIntent(intent);
    const assertion = input.assertion || {};
    const assertionChallenge = String(assertion.challenge || input.challenge || '');

    if (intent.entity_l1_address !== entityAddress) {
        throw new Error('INTENT_ENTITY_MISMATCH');
    }

    if (new Date(intent.expires_at).getTime() <= now.getTime()) {
        throw new Error('INTENT_EXPIRED');
    }

    if (assertionChallenge !== expectedChallenge) {
        throw new Error('WEBAUTHN_CHALLENGE_MISMATCH');
    }

    const credentialBinding = verifyCredentialBinding(ledger, {
        entityAddress,
        controllerAddress,
        credentialId,
        rpId,
    });
    if (!credentialBinding.ok) {
        throw new Error(credentialBinding.reason_codes.join(', '));
    }

    const hash = intentHash(intent);
    const replayKey = hashObject({
        intent_hash: hash,
        controller_l1_address: controllerAddress,
        credential_id: credentialId,
        audience: intent.audience,
        nonce: intent.nonce,
    });

    if (ledger.intent_approval_replay_keys.includes(replayKey)) {
        throw new Error('INTENT_APPROVAL_REPLAY_DETECTED');
    }

    const approval = {
        id: input.id || artifactId('iap', { replay_key: replayKey }, 24),
        object_type: 'IntentApproval',
        status: INTENT_APPROVAL_STATUS.PENDING,
        intent_id: intent.id,
        intent_hash: hash,
        canonical_intent: canonicalJson(intent),
        entity_l1_address: entityAddress,
        controller_l1_address: controllerAddress,
        credential_id: credentialId,
        rp_id: rpId,
        audience: intent.audience,
        nonce: intent.nonce,
        expires_at: intent.expires_at,
        challenge: expectedChallenge,
        assertion_hash: hashObject(assertion),
        issued_at: input.issued_at || now.toISOString(),
        consumed_at: null,
        replay_key: replayKey,
    };

    upsertById(ledger.intent_approvals, approval);
    ledger.intent_approval_replay_keys.push(replayKey);

    return approval;
}

function verifyIntentApproval(ledger, approvalOrId, context = {}, now = new Date()) {
    ensureIntentApprovalStores(ledger);

    const approval = typeof approvalOrId === 'string'
        ? ledger.intent_approvals.find((candidate) => candidate.id === approvalOrId)
        : approvalOrId;

    if (!approval) {
        return { ok: false, reason_codes: ['INTENT_APPROVAL_NOT_FOUND'] };
    }

    const reasonCodes = [];
    const status = String(approval.status || '').toLowerCase();
    if (status !== INTENT_APPROVAL_STATUS.PENDING) {
        reasonCodes.push(`INTENT_APPROVAL_${status ? status.toUpperCase() : 'STATUS_UNKNOWN'}`);
    }

    if (approval.expires_at && new Date(approval.expires_at).getTime() <= now.getTime()) {
        reasonCodes.push('INTENT_APPROVAL_EXPIRED');
    }

    const comparisons = [
        ['entity_l1_address', 'INTENT_APPROVAL_ENTITY_MISMATCH', identity.normalizeEntityAddress],
        ['controller_l1_address', 'INTENT_APPROVAL_CONTROLLER_MISMATCH', identity.normalizeKeyAddress],
        ['intent_id', 'INTENT_APPROVAL_INTENT_MISMATCH', String],
        ['intent_hash', 'INTENT_APPROVAL_INTENT_HASH_MISMATCH', String],
        ['audience', 'INTENT_APPROVAL_AUDIENCE_MISMATCH', String],
        ['nonce', 'INTENT_APPROVAL_NONCE_MISMATCH', String],
        ['expires_at', 'INTENT_APPROVAL_EXPIRY_MISMATCH', String],
        ['credential_id', 'INTENT_APPROVAL_CREDENTIAL_MISMATCH', String],
        ['rp_id', 'INTENT_APPROVAL_RP_ID_MISMATCH', String],
    ];

    for (const [key, reasonCode, normalize] of comparisons) {
        if (context[key] === undefined || context[key] === null || context[key] === '') continue;
        if (normalize(approval[key]) !== normalize(context[key])) {
            reasonCodes.push(reasonCode);
        }
    }

    return { ok: reasonCodes.length === 0, approval, reason_codes: reasonCodes.length ? reasonCodes : ['INTENT_APPROVAL_VALID'] };
}

function consumeIntentApproval(ledger, approvalId, input = {}, now = new Date()) {
    const result = verifyIntentApproval(ledger, approvalId, input, now);
    if (!result.ok) {
        return result;
    }

    result.approval.status = INTENT_APPROVAL_STATUS.EXECUTED;
    result.approval.consumed_at = now.toISOString();
    result.approval.transaction_id = input.transaction_id || null;

    return { ok: true, approval: result.approval, reason_codes: ['INTENT_APPROVAL_CONSUMED'] };
}

function revokeIntentApproval(ledger, approvalId, input = {}, now = new Date()) {
    ensureIntentApprovalStores(ledger);
    const approval = ledger.intent_approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) {
        return { ok: false, reason_codes: ['INTENT_APPROVAL_NOT_FOUND'] };
    }

    approval.status = INTENT_APPROVAL_STATUS.REVOKED;
    approval.revoked_at = input.revoked_at || now.toISOString();
    approval.revocation_reason = input.reason || 'revoked';

    return { ok: true, approval, reason_codes: ['INTENT_APPROVAL_REVOKED'] };
}

module.exports = {
    INTENT_APPROVAL_STATUS,
    challengeForIntent,
    consumeIntentApproval,
    createIntentApproval,
    ensureIntentApprovalStores,
    intentHash,
    normalizeIntent,
    revokeIntentApproval,
    verifyCredentialBinding,
    verifyIntentApproval,
};
