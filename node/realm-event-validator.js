'use strict';

const {
    buildCurrentAuthorityState,
    canAuthorityIssueEvent,
    nextExpectedSequence,
} = require('./current-authority-state');
const {
    REALM_EVENT_REGISTRY,
    getRealmEventContract,
} = require('./realm-event-registry');
const {
    attachRealmEventHashChain,
    latestRealmEventHash,
} = require('./realm-event-history');

const REALM_EVENT_SCHEMAS = Object.freeze(
    Object.fromEntries(
        Object.entries(REALM_EVENT_REGISTRY).map(([type, contract]) => [
            contract.canonicalName || type,
            {
                version: contract.version,
                envelope: contract.envelope,
                payload: contract.payloadContract,
                requiredAuthority: contract.requiredAuthority,
                projectionVersion: contract.projectionVersion,
            },
        ]),
    ),
);

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function normalizeRealmEventProposal(proposal = {}) {
    const envelope = proposal.envelope && typeof proposal.envelope === 'object'
        ? { ...proposal.envelope }
        : {
            type: proposal.type,
            signer: proposal.signer,
            authority_reference: proposal.authority_reference,
            sequence: proposal.sequence,
            timestamp: proposal.timestamp,
            previous_event_hash: proposal.previous_event_hash,
        };

    const payload = proposal.payload && typeof proposal.payload === 'object'
        ? { ...proposal.payload }
        : {};

    return {
        envelope: {
            type: String(envelope.type || '').trim(),
            signer: String(envelope.signer || '').trim(),
            authority_reference: String(envelope.authority_reference || '').trim(),
            sequence: Number(envelope.sequence),
            timestamp: envelope.timestamp || new Date().toISOString(),
            previous_event_hash: envelope.previous_event_hash ?? proposal.previous_event_hash ?? null,
        },
        payload,
    };
}

function validateEnvelope(envelope) {
    const reasonCodes = [];
    if (!isNonEmptyString(envelope.type)) reasonCodes.push('ENVELOPE_TYPE_REQUIRED');
    const contract = getRealmEventContract(envelope.type);
    if (!contract) reasonCodes.push('UNKNOWN_REALM_EVENT_TYPE');

    const required = contract?.envelope?.required || ['signer', 'authority_reference', 'sequence', 'timestamp'];
    if (required.includes('signer') && !isNonEmptyString(envelope.signer)) reasonCodes.push('ENVELOPE_SIGNER_REQUIRED');
    if (required.includes('authority_reference') && !isNonEmptyString(envelope.authority_reference)) {
        reasonCodes.push('ENVELOPE_AUTHORITY_REFERENCE_REQUIRED');
    }
    if (required.includes('sequence') && (!Number.isInteger(envelope.sequence) || envelope.sequence < 1)) {
        reasonCodes.push('ENVELOPE_SEQUENCE_INVALID');
    }
    if (required.includes('timestamp') && !isNonEmptyString(envelope.timestamp)) reasonCodes.push('ENVELOPE_TIMESTAMP_REQUIRED');
    return reasonCodes;
}

function validatePayload(type, payload) {
    const schema = getRealmEventContract(type)?.payloadContract;
    if (!schema) return ['UNKNOWN_PAYLOAD_SCHEMA'];

    const reasonCodes = [];
    for (const field of schema.required || []) {
        if (!isNonEmptyString(payload[field]) && payload[field] !== 0 && !Array.isArray(payload[field])) {
            reasonCodes.push(`PAYLOAD_${field.toUpperCase()}_REQUIRED`);
        }
    }

    if (schema.requireOneOf) {
        const hasOne = schema.requireOneOf.some((field) => isNonEmptyString(payload[field]));
        if (!hasOne) reasonCodes.push('PAYLOAD_TARGET_REQUIRED');
    }

    for (const [field, expectedType] of Object.entries(schema.fields || {})) {
        if (payload[field] === undefined || payload[field] === null) continue;
        if (expectedType === 'array' && !Array.isArray(payload[field])) {
            reasonCodes.push(`PAYLOAD_${field.toUpperCase()}_TYPE_INVALID`);
        }
        if (expectedType === 'string' && typeof payload[field] !== 'string') {
            reasonCodes.push(`PAYLOAD_${field.toUpperCase()}_TYPE_INVALID`);
        }
    }

    return reasonCodes;
}

function currentAuthorityStateForLedger(ledger) {
    if (ledger?.current_authority_state && typeof ledger.current_authority_state === 'object') {
        return ledger.current_authority_state;
    }
    return buildCurrentAuthorityState(ledger?.event_log || []);
}

function validateSequence(ledger, sequence) {
    const expected = nextExpectedSequence(ledger);
    if (sequence !== expected) {
        return [`SEQUENCE_MISMATCH:expected_${expected}_got_${sequence}`];
    }
    return [];
}

function validatePreviousEventHash(ledger, previousEventHash) {
    if (previousEventHash === null || previousEventHash === undefined) return [];
    const expected = latestRealmEventHash(ledger?.event_log || []);
    if (previousEventHash !== expected) {
        return [`PREVIOUS_EVENT_HASH_MISMATCH:expected_${expected}_got_${previousEventHash}`];
    }
    return [];
}

function validateAuthorityTransition(state, envelope, payload = {}) {
    const reasonCodes = [];
    const contract = getRealmEventContract(envelope.type);
    if (!contract) return ['UNKNOWN_REALM_EVENT_TYPE'];

    if (!canAuthorityIssueEvent(state, envelope.signer, envelope.type)) {
        reasonCodes.push('AUTHORITY_TRANSITION_DENIED');
    }

    if (typeof contract.validateTransition === 'function') {
        reasonCodes.push(...contract.validateTransition(state, envelope, payload));
    }

    return reasonCodes;
}

function buildAcceptedRealmEvent(normalized, ledger) {
    const { envelope, payload } = normalized;
    const contract = getRealmEventContract(envelope.type);
    const previousEventHash = latestRealmEventHash(ledger?.event_log || []);
    return attachRealmEventHashChain({
        type: envelope.type,
        realm_event: true,
        version: contract?.version || 1,
        projection_version: contract?.projectionVersion || 1,
        envelope,
        payload,
        signer: envelope.signer,
        authority_reference: envelope.authority_reference,
        sequence: envelope.sequence,
        timestamp: envelope.timestamp,
        accepted_at: new Date().toISOString(),
    }, previousEventHash);
}

function validateRealmEventProposal(ledger, proposal, options = {}) {
    const normalized = normalizeRealmEventProposal(proposal);
    const reasonCodes = [
        ...validateEnvelope(normalized.envelope),
        ...validatePayload(normalized.envelope.type, normalized.payload),
    ];

    if (reasonCodes.length === 0 && !options.skipSequenceCheck) {
        reasonCodes.push(...validateSequence(ledger, normalized.envelope.sequence));
    }

    if (reasonCodes.length === 0) {
        reasonCodes.push(...validatePreviousEventHash(ledger, normalized.envelope.previous_event_hash));
    }

    if (reasonCodes.length === 0) {
        const state = currentAuthorityStateForLedger(ledger);
        reasonCodes.push(...validateAuthorityTransition(state, normalized.envelope, normalized.payload));
    }

    if (reasonCodes.length > 0) {
        return { ok: false, reason_codes: reasonCodes, proposal: normalized };
    }

    return {
        ok: true,
        event: buildAcceptedRealmEvent(normalized, ledger),
        proposal: normalized,
    };
}

function acceptRealmEventProposal(ledger, proposal, options = {}) {
    const validation = validateRealmEventProposal(ledger, proposal, options);
    if (!validation.ok) {
        return validation;
    }
    return {
        ok: true,
        event: validation.event,
        proposal: validation.proposal,
    };
}

module.exports = {
    REALM_EVENT_SCHEMAS,
    normalizeRealmEventProposal,
    validateRealmEventProposal,
    acceptRealmEventProposal,
    buildAcceptedRealmEvent,
};
