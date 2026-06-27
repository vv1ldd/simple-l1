'use strict';

const { buildCurrentAuthorityState } = require('./current-authority-state');
const {
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('./realm-event-history');

function rootAuthorityRef(rootAuthority) {
    if (!rootAuthority) return null;
    return rootAuthority.authorityRef || rootAuthority.id || null;
}

function rootMatches(rootAuthority, expectedRoot) {
    if (!expectedRoot || !rootAuthority) return false;
    return rootAuthority.id === expectedRoot || rootAuthority.authorityRef === expectedRoot;
}

function verifyRemoteRealmHistory({ realmId, eventLog = [], claimedRootAuthority = null } = {}) {
    try {
        verifyRealmEventHistory(eventLog);
        const currentAuthorityState = buildCurrentAuthorityState(eventLog);
        const rootAuthority = currentAuthorityState.rootAuthority;

        if (!rootAuthority || rootAuthority.status !== 'active') {
            return { ok: false, reason_codes: ['REMOTE_ROOT_AUTHORITY_NOT_ACTIVE'] };
        }

        if (claimedRootAuthority && !rootMatches(rootAuthority, claimedRootAuthority)) {
            return {
                ok: false,
                reason_codes: ['REMOTE_ROOT_AUTHORITY_MISMATCH'],
                evidence: {
                    claimedRootAuthority,
                    derivedRootAuthority: rootAuthorityRef(rootAuthority),
                },
            };
        }

        return {
            ok: true,
            evidence: {
                realmId: String(realmId || ''),
                eventLog,
                currentAuthorityState,
                rootAuthority: {
                    id: rootAuthority.id,
                    authorityRef: rootAuthority.authorityRef,
                    status: rootAuthority.status,
                    issuedEvent: rootAuthority.issuedEvent,
                },
                eventHead: latestRealmEventHash(eventLog),
            },
        };
    } catch (error) {
        return {
            ok: false,
            reason_codes: [error.message || 'REMOTE_REALM_HISTORY_INVALID'],
        };
    }
}

function evaluateFederationPolicy(localPolicy = {}, remoteRealmEvidence = {}) {
    const evidence = remoteRealmEvidence.evidence || remoteRealmEvidence;
    const reasonCodes = [];
    const trustedRealmId = String(localPolicy.trustedRealmId || localPolicy.remote_realm_id || '');
    const remoteRealmId = String(evidence.realmId || '');

    if (!trustedRealmId || trustedRealmId !== remoteRealmId) {
        reasonCodes.push('FEDERATION_POLICY_REALM_DENIED');
    }

    const acceptedAuthorityRoot = localPolicy.acceptedAuthorityRoot || localPolicy.trusted_root_authority || null;
    if (acceptedAuthorityRoot && !rootMatches(evidence.rootAuthority, acceptedAuthorityRoot)) {
        reasonCodes.push('FEDERATION_POLICY_ROOT_MISMATCH');
    }

    const allowedClaimScopes = localPolicy.allowedClaimScopes || localPolicy.allowedClaims || localPolicy.allowed_claim_scopes || [];
    if (!Array.isArray(allowedClaimScopes) || allowedClaimScopes.length === 0) {
        reasonCodes.push('FEDERATION_POLICY_SCOPE_REQUIRED');
    }

    if (reasonCodes.length > 0) {
        return { ok: false, reason_codes: reasonCodes };
    }

    return {
        ok: true,
        decision: {
            remoteRealmId,
            trustedRootAuthority: rootAuthorityRef(evidence.rootAuthority),
            allowedClaimScopes,
            trustScope: localPolicy.trustScope || localPolicy.trust_scope || 'claims',
            policyId: localPolicy.policyId || localPolicy.policy_id || null,
            remoteEventHead: evidence.eventHead || null,
        },
    };
}

function createFederationTrustProposal({
    localRootAuthority,
    remoteRealmEvidence,
    policyDecision,
    sequence,
    timestamp = new Date().toISOString(),
} = {}) {
    const evidence = remoteRealmEvidence.evidence || remoteRealmEvidence;
    const decision = policyDecision.decision || policyDecision;
    const signer = rootAuthorityRef(localRootAuthority) || String(localRootAuthority || '');
    const nextSequence = Number(sequence);

    if (!Number.isInteger(nextSequence) || nextSequence < 1) {
        throw new Error('FEDERATION_SEQUENCE_INVALID');
    }

    return {
        envelope: {
            type: 'FEDERATION_TRUST_ESTABLISHED',
            signer,
            authority_reference: signer,
            sequence: nextSequence,
            timestamp,
        },
        payload: {
            remote_realm_id: decision.remoteRealmId || evidence.realmId,
            trusted_root_authority: decision.trustedRootAuthority || rootAuthorityRef(evidence.rootAuthority),
            allowed_claim_scopes: decision.allowedClaimScopes || [],
            trust_scope: decision.trustScope || 'claims',
            policy_id: decision.policyId || null,
            remote_event_head: decision.remoteEventHead || evidence.eventHead || null,
        },
    };
}

function recognizeRemoteRealm(input = {}, { acceptRealmEvent } = {}) {
    if (typeof acceptRealmEvent !== 'function') {
        throw new Error('acceptRealmEvent callback is required');
    }

    const remoteVerification = verifyRemoteRealmHistory(input.remoteRealm);
    if (!remoteVerification.ok) return remoteVerification;

    const policyEvaluation = evaluateFederationPolicy(input.localPolicy, remoteVerification);
    if (!policyEvaluation.ok) return policyEvaluation;

    const proposal = createFederationTrustProposal({
        localRootAuthority: input.localRootAuthority,
        remoteRealmEvidence: remoteVerification,
        policyDecision: policyEvaluation,
        sequence: input.sequence,
        timestamp: input.timestamp,
    });
    const accepted = acceptRealmEvent(proposal);
    if (!accepted.ok) {
        return {
            ok: false,
            reason_codes: accepted.reason_codes || [],
            proposal,
            remoteVerification,
            policyEvaluation,
        };
    }

    return {
        ok: true,
        event: accepted.event,
        proposal,
        remoteVerification,
        policyEvaluation,
    };
}

module.exports = {
    createFederationTrustProposal,
    evaluateFederationPolicy,
    recognizeRemoteRealm,
    verifyRemoteRealmHistory,
};
