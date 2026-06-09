'use strict';

const crypto = require('crypto');
const { stableStringify } = require('./identity-proof-runtime');

const IDENTITY_STATE_ENVELOPE_VERSION = 'simple-l1.identity_state_envelope.v1';
const MESH_OBSERVATION_OUTPUT = 'mesh_observation';
const AUTHORITY_GRANT_ARTIFACT_SPECIFIED = false;

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sha256Ref(value) {
    return `sha256:${sha256Hex(value)}`;
}

function withoutKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function envelopeSigningPayload(envelope) {
    return withoutKeys(envelope, ['signature']);
}

function envelopeStatePayload(envelope) {
    return withoutKeys(envelope, ['state_hash', 'signature']);
}

function stateHashForEnvelope(envelope) {
    return sha256Ref(stableStringify(envelopeStatePayload(envelope)));
}

function envelopeIdFor({ entityAddress, deviceKeyAddress, sequence, issuedAt }) {
    return `ise_${sha256Hex(`${entityAddress}:${deviceKeyAddress}:${sequence}:${issuedAt}`).slice(0, 32)}`;
}

function bindingIdFor(binding) {
    const bindingId = binding.binding_id || binding.id;
    if (bindingId) return String(bindingId);
    return `cb_${sha256Hex([
        binding.entity_l1_address,
        binding.controller_key_l1_address || binding.controller_l1_address || binding.key_l1_address,
        binding.credential_id || '',
    ].join(':')).slice(0, 32)}`;
}

function revocationIdFor(binding) {
    return `rev_${sha256Hex(`${bindingIdFor(binding)}:${binding.revoked_at || binding.updated_at || binding.observed_at || ''}`).slice(0, 32)}`;
}

function normalizeControllerBinding(binding, fallbackEntityAddress = null) {
    const entityAddress = binding.entity_l1_address || fallbackEntityAddress;
    const controllerKey = binding.controller_key_l1_address || binding.controller_l1_address || binding.key_l1_address || binding.controller_key_l1;
    return {
        binding_id: bindingIdFor({ ...binding, entity_l1_address: entityAddress, controller_key_l1_address: controllerKey }),
        entity_l1_address: entityAddress,
        controller_key_l1_address: controllerKey,
        status: String(binding.status || 'active'),
        observed_at: binding.observed_at || binding.updated_at || binding.created_at || new Date(0).toISOString(),
        provider_evidence_hash: binding.provider_evidence_hash || binding.binding_hash || null,
    };
}

function controllerBindingsForLedger(ledger, entityAddress) {
    return (ledger?.controller_bindings || [])
        .map((binding) => normalizeControllerBinding(binding, entityAddress))
        .filter((binding) => binding.entity_l1_address === entityAddress)
        .filter((binding) => ['active', 'revoked', 'unknown'].includes(binding.status));
}

function controllerBindingProposalsForLedger(ledger, entityAddress) {
    return (ledger?.controller_binding_proposals || [])
        .filter((proposal) => (proposal.entity_l1_address || entityAddress) === entityAddress)
        .map((proposal) => ({
            proposal_id: String(proposal.proposal_id || `cbp_${sha256Hex(stableStringify(proposal)).slice(0, 32)}`),
            entity_l1_address: proposal.entity_l1_address || entityAddress,
            proposed_controller_key_l1_address: proposal.proposed_controller_key_l1_address || proposal.key_l1_address || proposal.controller_l1_address,
            controller_type: String(proposal.controller_type || 'unknown'),
            status: String(proposal.status || 'pending'),
            proposed_at: proposal.proposed_at || proposal.created_at || new Date(0).toISOString(),
            approved_by_key_l1_address: proposal.approved_by_key_l1_address || null,
            approved_at: proposal.approved_at || null,
            proposal_hash: proposal.proposal_hash || sha256Ref(stableStringify({
                entity_l1_address: proposal.entity_l1_address || entityAddress,
                proposed_controller_key_l1_address: proposal.proposed_controller_key_l1_address || proposal.key_l1_address || proposal.controller_l1_address,
                controller_type: proposal.controller_type || 'unknown',
            })),
        }))
        .filter((proposal) => proposal.proposed_controller_key_l1_address);
}

function revocationObservationsForBindings(bindings) {
    return bindings
        .filter((binding) => binding.status === 'revoked')
        .map((binding) => ({
            revocation_id: revocationIdFor(binding),
            binding_id: binding.binding_id,
            controller_key_l1_address: binding.controller_key_l1_address,
            observed_at: binding.observed_at,
            source: 'local',
        }));
}

function signBytes({ algorithm, privateKey, payload }) {
    if (algorithm === 'ed25519') {
        return crypto.sign(null, Buffer.from(payload), privateKey).toString('base64url');
    }
    if (algorithm === 'p256-sha256-der') {
        return crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64url');
    }
    throw new Error(`UNSUPPORTED_IDENTITY_MESH_SIGNATURE_ALGORITHM:${algorithm}`);
}

function verifyBytes({ algorithm, publicKey, payload, signature }) {
    try {
        const signatureBytes = Buffer.from(String(signature || ''), 'base64url');
        if (algorithm === 'ed25519') {
            return crypto.verify(null, Buffer.from(payload), publicKey, signatureBytes);
        }
        if (algorithm === 'p256-sha256-der') {
            return crypto.verify('sha256', Buffer.from(payload), publicKey, signatureBytes);
        }
    } catch (error) {
        return false;
    }
    return false;
}

function signIdentityStateEnvelope(envelope, { privateKey, algorithm = 'p256-sha256-der', signedByKeyAddress = envelope.device_key_l1_address } = {}) {
    if (!privateKey) throw new Error('IDENTITY_MESH_PRIVATE_KEY_REQUIRED');
    const payload = stableStringify(envelopeSigningPayload(envelope));
    return {
        algorithm,
        signed_by_key_l1_address: signedByKeyAddress,
        value: signBytes({ algorithm, privateKey, payload }),
    };
}

function createIdentityStateEnvelope({
    ledger,
    entityAddress,
    deviceKeyAddress,
    sequence,
    previousStateHash = null,
    observedEpoch = 0,
    providerStateProof = null,
    now = new Date(),
    ttlMs = 10 * 60 * 1000,
    privateKey = null,
    signatureAlgorithm = 'p256-sha256-der',
} = {}) {
    const issuedAt = now instanceof Date ? now : new Date(now);
    const expiresAt = new Date(issuedAt.getTime() + ttlMs);
    const controllerBindings = controllerBindingsForLedger(ledger, entityAddress);
    const controllerBindingProposals = controllerBindingProposalsForLedger(ledger, entityAddress);
    const envelope = {
        schema_version: IDENTITY_STATE_ENVELOPE_VERSION,
        envelope_id: envelopeIdFor({
            entityAddress,
            deviceKeyAddress,
            sequence,
            issuedAt: issuedAt.toISOString(),
        }),
        entity_l1_address: entityAddress,
        device_key_l1_address: deviceKeyAddress,
        sequence: Number(sequence || 0),
        previous_state_hash: previousStateHash,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        observed_epoch: Number(observedEpoch || 0),
        controller_bindings: controllerBindings,
        controller_binding_proposals: controllerBindingProposals,
        revocation_observations: revocationObservationsForBindings(controllerBindings),
        provider_state_proof: providerStateProof,
        signature: {
            algorithm: signatureAlgorithm,
            signed_by_key_l1_address: deviceKeyAddress,
            value: 'UNSIGNED_IDENTITY_MESH_OBSERVATION_000000',
        },
    };
    envelope.state_hash = stateHashForEnvelope(envelope);
    envelope.signature = privateKey
        ? signIdentityStateEnvelope(envelope, { privateKey, algorithm: signatureAlgorithm, signedByKeyAddress: deviceKeyAddress })
        : envelope.signature;
    return envelope;
}

function trustedPublicKeyFor(envelope, trustedDeviceKeys = {}) {
    const signedBy = envelope?.signature?.signed_by_key_l1_address;
    const deviceKey = envelope?.device_key_l1_address;
    return trustedDeviceKeys[signedBy] || trustedDeviceKeys[deviceKey] || null;
}

function verifyIdentityStateEnvelope(envelope, {
    validateEnvelope = null,
    trustedDeviceKeys = {},
    now = new Date(),
    requireTrustedSignature = true,
} = {}) {
    const reasonCodes = [];
    const checkedAt = now instanceof Date ? now : new Date(now);

    if (!envelope || envelope.schema_version !== IDENTITY_STATE_ENVELOPE_VERSION) {
        reasonCodes.push('IDENTITY_MESH_ENVELOPE_VERSION_INVALID');
    }

    if (typeof validateEnvelope === 'function' && !validateEnvelope(envelope)) {
        reasonCodes.push('IDENTITY_MESH_SCHEMA_INVALID');
    }

    if (envelope?.state_hash !== stateHashForEnvelope(envelope || {})) {
        reasonCodes.push('IDENTITY_MESH_STATE_HASH_INVALID');
    }

    const expiresAtMs = Date.parse(envelope?.expires_at || '');
    if (!expiresAtMs || expiresAtMs <= checkedAt.getTime()) {
        reasonCodes.push('IDENTITY_MESH_ENVELOPE_EXPIRED');
    }

    if (envelope?.signature?.signed_by_key_l1_address !== envelope?.device_key_l1_address) {
        reasonCodes.push('IDENTITY_MESH_SIGNATURE_DEVICE_MISMATCH');
    }

    const publicKey = trustedPublicKeyFor(envelope, trustedDeviceKeys);
    if (!publicKey) {
        if (requireTrustedSignature) reasonCodes.push('IDENTITY_MESH_TRUSTED_DEVICE_KEY_MISSING');
    } else {
        const verified = verifyBytes({
            algorithm: envelope.signature?.algorithm,
            publicKey,
            payload: stableStringify(envelopeSigningPayload(envelope)),
            signature: envelope.signature?.value,
        });
        if (!verified) reasonCodes.push('IDENTITY_MESH_SIGNATURE_INVALID');
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: reasonCodes,
        output_type: MESH_OBSERVATION_OUTPUT,
        observation: reasonCodes.length === 0 ? envelope : null,
    };
}

function selectedByMonotonicSequence(items) {
    return [...items].sort((left, right) => Number(right.sequence || 0) - Number(left.sequence || 0))[0] || null;
}

function selectedByProviderDominance(items) {
    const provider = items.find((item) => item.source === 'provider' || item.provider_state_proof);
    if (provider) return provider;
    return [...items].sort((left, right) => Number(right.observed_epoch || 0) - Number(left.observed_epoch || 0))[0] || null;
}

function mergeIdentityStateObservations(observations = []) {
    const stateObservations = observations.filter((item) => item.state_hash);
    const deviceGroups = new Map();
    for (const observation of stateObservations) {
        const key = observation.device_key_l1_address || observation.source || 'unknown';
        if (!deviceGroups.has(key)) deviceGroups.set(key, []);
        deviceGroups.get(key).push(observation);
    }

    const selectedByDevice = [...deviceGroups.values()].map(selectedByMonotonicSequence).filter(Boolean);
    const selected = selectedByProviderDominance(selectedByDevice.length ? selectedByDevice : stateObservations);
    const activeBindings = observations.filter((item) => item.binding_id && item.status && !item.revocation_id);
    const revokedBindingIds = new Set(observations.filter((item) => item.revocation_id).map((item) => item.binding_id));
    const proposals = observations.filter((item) => item.proposal_id);
    const proposalGroups = new Map();
    for (const proposal of proposals) {
        if (!proposalGroups.has(proposal.proposal_id)) proposalGroups.set(proposal.proposal_id, []);
        proposalGroups.get(proposal.proposal_id).push(proposal);
    }
    const replayDetected = [...proposalGroups.values()].some((items) => {
        const sequences = items.map((item) => Number(item.sequence || 0));
        return sequences.length > 1 && Math.min(...sequences) < Math.max(...sequences);
    });
    const selectedProposal = proposals.find((proposal) => proposal.status === 'approved') || proposals[0] || null;
    const statuses = new Set(activeBindings.map((item) => item.status));
    const conflict = statuses.size > 1;
    const revokedBinding = activeBindings.find((binding) => revokedBindingIds.has(binding.binding_id));

    return {
        output_type: MESH_OBSERVATION_OUTPUT,
        selected_state_hash: selected?.state_hash || null,
        binding_status: revokedBinding ? 'revoked' : (conflict ? null : (activeBindings[0]?.status || null)),
        proposal_status: selectedProposal?.status || null,
        replay_detected: replayDetected,
        conflict,
        authority_grant_created: false,
    };
}

function evaluateMeshMergeCase(testCase) {
    return mergeIdentityStateObservations(testCase.input || []);
}

function evaluateAuthorityBoundaryCase(testCase) {
    switch (testCase.invariant_id) {
        case 'IMESH_V1_OBSERVATION_NOT_GRANT':
        case 'IMESH_V1_RELAY_PAYLOAD_OBSERVATION_ONLY':
            return {
                output_type: MESH_OBSERVATION_OUTPUT,
                forbidden_output_types: [],
                authority_grant_created: false,
            };

        case 'IMESH_V1_QUORUM_CARDINALITY': {
            const signatureCount = (testCase.signatures || []).length;
            const requiredQuorum = Number(testCase.policy?.required_quorum || 0);
            const quorumMet = signatureCount >= requiredQuorum;
            return {
                output_type: MESH_OBSERVATION_OUTPUT,
                authority_grant_created: false,
                reason: quorumMet && !AUTHORITY_GRANT_ARTIFACT_SPECIFIED
                    ? 'authority_grant_artifact_not_specified'
                    : 'quorum_not_met',
            };
        }

        case 'IMESH_V1_QUORUM_INTENT_HASH': {
            const hashes = new Set((testCase.signatures || []).map((signature) => signature.intent_hash));
            const quorumMet = (testCase.signatures || []).length >= Number(testCase.policy?.required_quorum || 0);
            const sameIntentHash = hashes.size === 1;
            return {
                output_type: MESH_OBSERVATION_OUTPUT,
                authority_grant_created: false,
                reason: sameIntentHash && quorumMet && !AUTHORITY_GRANT_ARTIFACT_SPECIFIED
                    ? 'authority_grant_artifact_not_specified'
                    : 'intent_hash_mismatch',
            };
        }

        case 'IMESH_V1_PROVIDER_ONLY_INTENT':
            return {
                output_type: MESH_OBSERVATION_OUTPUT,
                authority_grant_created: false,
                reason: testCase.policy?.provider_required === true
                    ? 'provider_required'
                    : 'authority_grant_artifact_not_specified',
            };

        default:
            throw new Error(`UNKNOWN_IDENTITY_MESH_AUTHORITY_INVARIANT:${testCase.invariant_id}`);
    }
}

function assertNoAuthorityLeak(value) {
    const forbiddenKeys = new Set(['authority_grant', 'authorization_code', 'application_session']);
    const errors = [];

    function visit(current, path = []) {
        if (!current || typeof current !== 'object') return;
        for (const [key, child] of Object.entries(current)) {
            const nextPath = [...path, key];
            if (forbiddenKeys.has(key)) errors.push(nextPath.join('.'));
            if (key === 'authorized' && child === true) errors.push(nextPath.join('.'));
            visit(child, nextPath);
        }
    }

    visit(value);
    return {
        ok: errors.length === 0,
        reason_codes: errors.length ? ['IDENTITY_MESH_AUTHORITY_LEAK_DETECTED'] : [],
        paths: errors,
    };
}

module.exports = {
    AUTHORITY_GRANT_ARTIFACT_SPECIFIED,
    IDENTITY_STATE_ENVELOPE_VERSION,
    MESH_OBSERVATION_OUTPUT,
    assertNoAuthorityLeak,
    createIdentityStateEnvelope,
    evaluateAuthorityBoundaryCase,
    evaluateMeshMergeCase,
    envelopeSigningPayload,
    mergeIdentityStateObservations,
    signIdentityStateEnvelope,
    stateHashForEnvelope,
    verifyIdentityStateEnvelope,
};
