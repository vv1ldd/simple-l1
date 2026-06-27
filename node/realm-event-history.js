'use strict';

const crypto = require('crypto');
const { hasRealmEventContract } = require('./realm-event-registry');

function canonicalEncode(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalEncode(entry === undefined ? null : entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalEncode(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function eventEnvelope(event) {
    if (event?.envelope && typeof event.envelope === 'object') return event.envelope;
    return event || {};
}

function eventPayload(event) {
    if (event?.payload && typeof event.payload === 'object') return event.payload;
    return {};
}

function isHashChainedRealmEvent(event) {
    const envelope = eventEnvelope(event);
    return Boolean((event?.realm_event === true || hasRealmEventContract(event?.type || envelope.type))
        && hasRealmEventContract(event?.type || envelope.type));
}

function realmEventHashMaterial(event, previousEventHash = event?.previous_event_hash ?? eventEnvelope(event).previous_event_hash ?? null) {
    const envelope = eventEnvelope(event);
    return {
        authority_reference: event?.authority_reference || envelope.authority_reference || '',
        payload: eventPayload(event),
        previous_event_hash: previousEventHash,
        sequence: Number(event?.sequence ?? envelope.sequence),
        signer: event?.signer || envelope.signer || '',
        type: event?.type || envelope.type || '',
        version: Number(event?.version ?? envelope.version ?? 1),
    };
}

function calculateRealmEventHash(event, previousEventHash) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(realmEventHashMaterial(event, previousEventHash)))
        .digest('hex');
}

function buildRealmEventId(event, currentEventHash) {
    const envelope = eventEnvelope(event);
    const type = event?.type || envelope.type || 'REALM_EVENT';
    const sequence = Number(event?.sequence ?? envelope.sequence);
    return `realm_evt_${sequence}_${type.toLowerCase()}_${String(currentEventHash || '').slice(0, 16)}`;
}

function latestRealmEventHash(eventLog = []) {
    for (let index = eventLog.length - 1; index >= 0; index -= 1) {
        const event = eventLog[index];
        if (!isHashChainedRealmEvent(event)) continue;
        return event.current_event_hash || null;
    }
    return null;
}

function attachRealmEventHashChain(event, previousEventHash = null) {
    const currentEventHash = calculateRealmEventHash(event, previousEventHash);
    const eventId = buildRealmEventId(event, currentEventHash);
    return {
        ...event,
        id: eventId,
        event_id: eventId,
        previous_event_hash: previousEventHash,
        current_event_hash: currentEventHash,
    };
}

function verifyRealmEventHistory(eventLog = []) {
    let expectedPreviousHash = null;
    for (const event of eventLog) {
        if (!isHashChainedRealmEvent(event)) continue;

        if (event.previous_event_hash !== expectedPreviousHash) {
            throw new Error(`REALM_EVENT_CHAIN_BROKEN:sequence_${event.sequence}`);
        }

        const recalculatedHash = calculateRealmEventHash(event, expectedPreviousHash);
        if (event.current_event_hash !== recalculatedHash) {
            throw new Error(`REALM_EVENT_HASH_MISMATCH:sequence_${event.sequence}`);
        }

        const expectedEventId = buildRealmEventId(event, recalculatedHash);
        if (event.event_id !== expectedEventId || event.id !== expectedEventId) {
            throw new Error(`REALM_EVENT_ID_MISMATCH:sequence_${event.sequence}`);
        }

        expectedPreviousHash = event.current_event_hash;
    }
    return true;
}

module.exports = {
    attachRealmEventHashChain,
    buildRealmEventId,
    calculateRealmEventHash,
    canonicalEncode,
    latestRealmEventHash,
    realmEventHashMaterial,
    verifyRealmEventHistory,
};
