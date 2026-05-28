'use strict';

const identity = require('./identity-kernel');
const { decideCapability } = require('./capability-resolution');
const { verifyIntentApproval } = require('./intent-approval-runtime');
const { artifactId, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');

const AUTHORITY_DECISIONS = Object.freeze({
    AUTHORIZED: 'authorized',
    DENIED: 'denied',
});

function ensureAuthorityStores(ledger) {
    ensureArrayStore(ledger, 'capabilities');
    ensureArrayStore(ledger, 'control_grants');
    ensureArrayStore(ledger, 'authorizations');
    ensureArrayStore(ledger, 'revocations');
    ensureArrayStore(ledger, 'capability_grants');
    ensureArrayStore(ledger, 'intent_approvals');

    return ledger;
}

function capabilityKey(capability, scope) {
    return `${String(capability || '')}:${String(scope || '')}`;
}

function assertCapabilityInput(input) {
    const capability = String(input.capability || '');
    const scope = String(input.scope || '');

    if (!capability || !scope) {
        throw new Error('capability and scope are required');
    }

    if (capability.includes('*') || scope.includes('*')) {
        throw new Error('wildcard capabilities are not part of Authority Runtime v1');
    }

    return { capability, scope };
}

function buildCapability(input, now = new Date()) {
    const { capability, scope } = assertCapabilityInput(input);
    const id = input.id || artifactId('cap', { capability, scope }, 20);

    return {
        id,
        object_type: 'Capability',
        capability,
        scope,
        created_at: input.created_at || now.toISOString(),
        metadata: input.metadata || {},
    };
}

function registerCapability(ledger, input, now = new Date()) {
    ensureAuthorityStores(ledger);
    const capability = buildCapability(input, now);

    return upsertById(ledger.capabilities, capability);
}

function buildControlGrant(input, now = new Date()) {
    const { capability, scope } = assertCapabilityInput(input);
    const entityAddress = identity.assertEntityAddress(input.entity_l1_address);
    const keyAddress = input.key_l1_address ? identity.assertKeyAddress(input.key_l1_address) : null;
    const status = String(input.status || 'active').toLowerCase();
    const policy = String(input.policy || 'allow').toLowerCase();

    if (!['active', 'revoked', 'expired'].includes(status)) {
        throw new Error('Unsupported grant status');
    }

    if (!['deny', 'require_quorum', 'require_approval', 'allow'].includes(policy)) {
        throw new Error('Unsupported grant policy');
    }

    const capability_id = input.capability_id || buildCapability({ capability, scope }).id;
    const basis = {
        entity_l1_address: entityAddress,
        key_l1_address: keyAddress,
        capability,
        scope,
        policy,
        granted_by_entity_l1_address: input.granted_by_entity_l1_address || null,
        granted_at: input.granted_at || now.toISOString(),
    };

    return {
        id: input.id || artifactId('grant', basis, 24),
        object_type: 'ControlGrant',
        capability_id,
        entity_l1_address: entityAddress,
        key_l1_address: keyAddress,
        capability,
        scope,
        policy,
        status,
        granted_by_entity_l1_address: input.granted_by_entity_l1_address
            ? identity.assertEntityAddress(input.granted_by_entity_l1_address)
            : null,
        granted_at: input.granted_at || now.toISOString(),
        expires_at: input.expires_at || null,
        revoked_at: input.revoked_at || null,
        metadata: input.metadata || {},
    };
}

function grantToCreGrant(grant) {
    return {
        id: grant.id,
        entity_l1_address: grant.entity_l1_address,
        key_l1_address: grant.key_l1_address,
        capability: grant.capability,
        scope: grant.scope,
        policy: grant.policy,
        status: grant.status,
        expires_at: grant.expires_at,
    };
}

function createControlGrant(ledger, input, now = new Date()) {
    ensureAuthorityStores(ledger);
    const grant = buildControlGrant(input, now);

    registerCapability(ledger, {
        id: grant.capability_id,
        capability: grant.capability,
        scope: grant.scope,
        created_at: grant.granted_at,
    }, now);

    upsertById(ledger.control_grants, grant);
    upsertById(ledger.capability_grants, grantToCreGrant(grant));

    return grant;
}

function revokeControlGrant(ledger, input, now = new Date()) {
    ensureAuthorityStores(ledger);

    const grantId = String(input.grant_id || input.id || '');
    if (!grantId) {
        throw new Error('grant_id is required');
    }

    const grant = ledger.control_grants.find((candidate) => candidate.id === grantId)
        || ledger.capability_grants.find((candidate) => candidate.id === grantId);
    if (!grant) {
        throw new Error('ControlGrant not found');
    }

    const revokedAt = input.revoked_at || now.toISOString();
    const revocation = {
        id: input.revocation_id || artifactId('revoke', { grant_id: grantId, revoked_at: revokedAt }, 20),
        object_type: 'Revocation',
        grant_id: grantId,
        reason: input.reason || 'revoked',
        revoked_at: revokedAt,
        revoked_by_entity_l1_address: input.revoked_by_entity_l1_address
            ? identity.assertEntityAddress(input.revoked_by_entity_l1_address)
            : null,
    };

    for (const storeName of ['control_grants', 'capability_grants']) {
        const existing = ledger[storeName].find((candidate) => candidate.id === grantId);
        if (existing) {
            existing.status = 'revoked';
            existing.revoked_at = revokedAt;
        }
    }

    upsertById(ledger.revocations, revocation);

    return revocation;
}

function activeControlGrants(ledger) {
    ensureAuthorityStores(ledger);

    const controlGrantIds = new Set(ledger.control_grants.map((grant) => grant.id));
    const legacyOnly = ledger.capability_grants.filter((grant) => !controlGrantIds.has(grant.id));

    return [...ledger.control_grants, ...legacyOnly].map(grantToCreGrant);
}

function policyDecisionAllows(ledger, policyDecisionId) {
    if (!policyDecisionId) {
        return false;
    }

    const decision = (ledger.policy_decisions || []).find((candidate) => candidate.id === policyDecisionId);
    return !!decision && decision.decision === 'allow';
}

function resolveIntentApproval(ledger, input) {
    if (input.intent_approval && typeof input.intent_approval === 'object') {
        return input.intent_approval;
    }

    const intentApprovalId = input.intent_approval_id || null;
    if (!intentApprovalId) {
        return null;
    }

    return (ledger.intent_approvals || []).find((candidate) => candidate.id === intentApprovalId) || null;
}

function verifyIntentApprovalBinding(ledger, input, entityAddress, proofKeyAddress, now = new Date()) {
    const intentApprovalId = input.intent_approval_id || input.intent_approval?.id || null;
    const hasApprovalStore = Array.isArray(ledger.intent_approvals) && ledger.intent_approvals.length > 0;
    const approval = resolveIntentApproval(ledger, input);

    if (!intentApprovalId && !approval) {
        return { ok: true, reason_codes: [] };
    }

    if (!approval) {
        return {
            ok: !hasApprovalStore,
            reason_codes: hasApprovalStore ? ['INTENT_APPROVAL_NOT_FOUND'] : [],
        };
    }

    const approvalEntity = identity.normalizeEntityAddress(approval.entity_l1_address);
    const approvalController = identity.normalizeKeyAddress(
        approval.controller_l1_address || approval.proof_key_l1_address || approval.key_l1_address
    );
    const reasonCodes = [];

    if (approvalEntity !== entityAddress) {
        reasonCodes.push('INTENT_APPROVAL_ENTITY_MISMATCH');
    }

    if (!proofKeyAddress || approvalController !== proofKeyAddress) {
        reasonCodes.push('INTENT_APPROVAL_CONTROLLER_MISMATCH');
    }

    if (input.intent_id && approval.intent_id && String(input.intent_id) !== String(approval.intent_id)) {
        reasonCodes.push('INTENT_APPROVAL_INTENT_MISMATCH');
    }

    const approvalStatus = verifyIntentApproval(ledger, approval, {
        entity_l1_address: entityAddress,
        controller_l1_address: proofKeyAddress,
        intent_id: input.intent_id || approval.intent_id,
        audience: input.audience || undefined,
        nonce: input.nonce || undefined,
        expires_at: input.expires_at || undefined,
        credential_id: input.credential_id || undefined,
        rp_id: input.rp_id || undefined,
    }, now);

    return {
        ok: reasonCodes.length === 0 && approvalStatus.ok,
        approval,
        reason_codes: [...reasonCodes, ...(approvalStatus.ok ? [] : approvalStatus.reason_codes)],
    };
}

function buildAuthorization(ledger, input, now = new Date()) {
    ensureAuthorityStores(ledger);

    const entityAddress = identity.assertEntityAddress(input.entity_l1_address);
    const proofKeyAddress = input.proof_key_l1_address
        ? identity.assertKeyAddress(input.proof_key_l1_address)
        : null;
    const { capability, scope } = assertCapabilityInput(input);

    const creDecision = decideCapability(activeControlGrants(ledger), {
        entity_l1_address: entityAddress,
        proof_key_l1_address: proofKeyAddress,
        capability,
        scope,
    }, now);

    const policyDecisionId = input.policy_decision_id || null;
    const policyAllows = policyDecisionAllows(ledger, policyDecisionId);
    const approvalBinding = verifyIntentApprovalBinding(ledger, input, entityAddress, proofKeyAddress, now);
    const isAllow = creDecision.decision === 'allow' && policyAllows && approvalBinding.ok;
    const authorizedAt = input.authorized_at || now.toISOString();
    const expiresAt = input.expires_at || new Date(now.getTime() + 5 * 60 * 1000).toISOString();
    const reasonCodes = [
        ...(creDecision.reason_codes || []),
        ...(!policyDecisionId ? ['POLICY_DECISION_REQUIRED'] : []),
        ...(!policyAllows ? ['POLICY_DECISION_NOT_ALLOW'] : []),
        ...(approvalBinding.reason_codes || []),
    ];

    const basis = {
        entity_l1_address: entityAddress,
        proof_key_l1_address: proofKeyAddress,
        capability,
        scope,
        intent_approval_id: input.intent_approval_id || null,
        intent_id: input.intent_id || null,
        policy_decision_id: policyDecisionId,
        matched_grants: creDecision.matched_grants || [],
        authorized_at: authorizedAt,
    };

    const authorization = {
        id: input.id || artifactId('authz', basis, 24),
        object_type: 'Authorization',
        status: isAllow ? AUTHORITY_DECISIONS.AUTHORIZED : AUTHORITY_DECISIONS.DENIED,
        can_execute: isAllow,
        entity_l1_address: entityAddress,
        proof_key_l1_address: proofKeyAddress,
        capability_id: buildCapability({ capability, scope }).id,
        capability,
        scope,
        intent_approval_id: input.intent_approval_id || null,
        intent_id: input.intent_id || null,
        policy_decision_id: policyDecisionId,
        matched_grants: creDecision.matched_grants || [],
        decision: creDecision.decision,
        reason_codes: reasonCodes,
        input_hash: hashObject(basis),
        authorized_at: authorizedAt,
        expires_at: expiresAt,
    };

    upsertById(ledger.authorizations, authorization);

    return authorization;
}

function verifyAuthorization(ledger, authorizationOrId, now = new Date()) {
    ensureAuthorityStores(ledger);

    const authorization = typeof authorizationOrId === 'string'
        ? ledger.authorizations.find((candidate) => candidate.id === authorizationOrId)
        : authorizationOrId;

    if (!authorization) {
        return { ok: false, reason_codes: ['AUTHORIZATION_NOT_FOUND'] };
    }

    if (authorization.status !== AUTHORITY_DECISIONS.AUTHORIZED || authorization.can_execute !== true) {
        return { ok: false, authorization, reason_codes: ['AUTHORIZATION_NOT_EXECUTABLE'] };
    }

    if (authorization.expires_at && new Date(authorization.expires_at).getTime() <= now.getTime()) {
        return { ok: false, authorization, reason_codes: ['AUTHORIZATION_EXPIRED'] };
    }

    const revoked = (authorization.matched_grants || []).some((grantId) => {
        const grant = ledger.control_grants.find((candidate) => candidate.id === grantId)
            || ledger.capability_grants.find((candidate) => candidate.id === grantId);
        return !grant || grant.status !== 'active';
    });

    if (revoked) {
        return { ok: false, authorization, reason_codes: ['AUTHORIZATION_GRANT_NOT_ACTIVE'] };
    }

    return { ok: true, authorization, reason_codes: ['AUTHORIZATION_VALID'] };
}

module.exports = {
    AUTHORITY_DECISIONS,
    activeControlGrants,
    buildAuthorization,
    buildCapability,
    buildControlGrant,
    createControlGrant,
    ensureAuthorityStores,
    registerCapability,
    revokeControlGrant,
    verifyAuthorization,
};
