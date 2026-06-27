'use strict';

const {
    CANONICAL_REALM_EVENT_TYPES: REGISTRY_EVENT_TYPES,
    canSignerSatisfyAuthorityPolicy,
    findDevice,
    getRealmEventContract,
    hasRealmEventContract,
    interpretRealmEvent,
} = require('./realm-event-registry');
const { verifyRealmEventHistory } = require('./realm-event-history');

const CANONICAL_REALM_EVENT_TYPES = new Set(REGISTRY_EVENT_TYPES);

function emptyAuthorityState() {
    return {
        rootAuthority: null,
        recoveryAuthorities: [],
        devices: [],
        sessions: [],
        federationTrusts: [],
        lastSequence: 0,
    };
}

function ensureAuthorityStateStores(ledger) {
    if (!ledger.current_authority_state || typeof ledger.current_authority_state !== 'object') {
        ledger.current_authority_state = emptyAuthorityState();
    }
    if (typeof ledger.realm_canonical_sequence !== 'number') {
        ledger.realm_canonical_sequence = 0;
    }
    return ledger;
}

function eventEnvelope(event) {
    if (event?.envelope && typeof event.envelope === 'object') {
        return event.envelope;
    }
    if (event?.type && hasRealmEventContract(event.type)) {
        return {
            type: event.type,
            signer: event.signer,
            authority_reference: event.authority_reference,
            sequence: event.sequence,
            timestamp: event.timestamp,
        };
    }
    return null;
}

function eventPayload(event) {
    if (event?.payload && typeof event.payload === 'object') {
        return event.payload;
    }
    return {};
}

function isCanonicalRealmEvent(event) {
    if (event?.realm_event === true) return true;
    const envelope = eventEnvelope(event);
    return Boolean(envelope && hasRealmEventContract(envelope.type));
}

function activeAuthorityByRef(state, ref) {
    const key = String(ref || '');
    if (!key) return null;
    if (state.rootAuthority && (state.rootAuthority.id === key || state.rootAuthority.authorityRef === key)) {
        return state.rootAuthority.status === 'active' ? state.rootAuthority : null;
    }
    const device = findDevice(state, key);
    if (device && device.status === 'active') return device;
    const recoveryAuthority = (state.recoveryAuthorities || []).find((entry) =>
        (entry.id === key || entry.authorityRef === key) && entry.status === 'active'
    );
    if (recoveryAuthority) return recoveryAuthority;
    const session = (state.sessions || []).find((entry) =>
        (entry.id === key || entry.authorityRef === key) && entry.status === 'active'
    );
    return session || null;
}

function canAuthorityIssueEvent(state, signerRef, eventType) {
    const contract = getRealmEventContract(eventType);
    if (!contract) return false;
    return canSignerSatisfyAuthorityPolicy(state, signerRef, contract.requiredAuthority);
}

function applyAuthorityEvent(state, event) {
    const envelope = eventEnvelope(event);
    if (!envelope) return state;
    const contract = getRealmEventContract(envelope.type);
    if (!contract) return state;
    const payload = interpretRealmEvent(contract, event, envelope, eventPayload(event));
    return contract.apply(state, event, envelope, payload);
}

function buildCurrentAuthorityState(eventLog = []) {
    verifyRealmEventHistory(eventLog);
    let state = emptyAuthorityState();
    for (const event of eventLog) {
        if (!isCanonicalRealmEvent(event)) continue;
        state = applyAuthorityEvent(state, event);
    }
    return state;
}

function rebuildAuthorityStateOnLedger(ledger) {
    ensureAuthorityStateStores(ledger);
    ledger.current_authority_state = buildCurrentAuthorityState(ledger.event_log || []);
    ledger.realm_canonical_sequence = ledger.current_authority_state.lastSequence || 0;
    return ledger.current_authority_state;
}

function canonicalEventsFromLog(eventLog = []) {
    return (eventLog || []).filter(isCanonicalRealmEvent);
}

function nextExpectedSequence(stateOrLedger) {
    if (stateOrLedger?.current_authority_state) {
        return Number(stateOrLedger.current_authority_state.lastSequence || stateOrLedger.realm_canonical_sequence || 0) + 1;
    }
    return Number(stateOrLedger?.lastSequence || 0) + 1;
}

module.exports = {
    CANONICAL_REALM_EVENT_TYPES,
    emptyAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
    eventEnvelope,
    eventPayload,
    activeAuthorityByRef,
    canAuthorityIssueEvent,
    applyAuthorityEvent,
    buildCurrentAuthorityState,
    rebuildAuthorityStateOnLedger,
    canonicalEventsFromLog,
    nextExpectedSequence,
};
