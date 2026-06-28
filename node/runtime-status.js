'use strict';

const crypto = require('crypto');
const { canonicalEncode, latestRealmEventHash } = require('./realm-event-history');

function eventEnvelope(event) {
    if (event?.envelope && typeof event.envelope === 'object') return event.envelope;
    return event || {};
}

function transitionType(event) {
    const envelope = eventEnvelope(event);
    return event?.type || envelope.type || null;
}

function transitionId(event) {
    return event?.event_id || event?.id || null;
}

function transitionTimestamp(event) {
    const envelope = eventEnvelope(event);
    return event?.timestamp || envelope.timestamp || null;
}

function transitionSequence(event) {
    const envelope = eventEnvelope(event);
    const value = event?.sequence ?? envelope.sequence;
    const sequence = Number(value);
    return Number.isFinite(sequence) ? sequence : null;
}

function lastRuntimeTransition(eventLog = []) {
    if (!Array.isArray(eventLog) || eventLog.length === 0) return null;

    const event = eventLog[eventLog.length - 1];
    if (!event || typeof event !== 'object') return null;

    return {
        type: transitionType(event),
        id: transitionId(event),
        timestamp: transitionTimestamp(event),
        sequence: transitionSequence(event),
        current_event_hash: event.current_event_hash || null,
    };
}

function eventLogHead(eventLog = []) {
    if (!Array.isArray(eventLog) || eventLog.length === 0) return null;
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(eventLog))
        .digest('hex');
}

function runtimeCausalityEvidence(eventLog = []) {
    const canonicalHistoryHead = latestRealmEventHash(eventLog);
    const fallbackHistoryHead = eventLogHead(eventLog);
    return {
        history_head: canonicalHistoryHead || fallbackHistoryHead,
        history_head_kind: canonicalHistoryHead ? 'realm_event_hash' : (fallbackHistoryHead ? 'event_log_hash' : null),
        last_transition: lastRuntimeTransition(eventLog),
    };
}

module.exports = {
    eventLogHead,
    lastRuntimeTransition,
    runtimeCausalityEvidence,
};
