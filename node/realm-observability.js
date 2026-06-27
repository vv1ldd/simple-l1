'use strict';

const crypto = require('crypto');
const {
    buildCurrentAuthorityState,
    canonicalEventsFromLog,
    eventEnvelope,
    eventPayload,
} = require('./current-authority-state');
const { findDevice } = require('./realm-event-registry');
const {
    canonicalEncode,
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('./realm-event-history');

function calculateProjectionHash(projection = {}) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(projection))
        .digest('hex');
}

function eventId(event) {
    return event?.event_id || event?.id || null;
}

function sequenceOf(event) {
    const envelope = eventEnvelope(event);
    return Number(event?.sequence ?? envelope.sequence);
}

function typeOf(event) {
    const envelope = eventEnvelope(event);
    return event?.type || envelope.type || null;
}

function traceEntry(event) {
    const envelope = eventEnvelope(event);
    return {
        event_id: eventId(event),
        type: typeOf(event),
        sequence: sequenceOf(event),
        signer: event?.signer || envelope.signer || null,
        authority_reference: event?.authority_reference || envelope.authority_reference || null,
        previous_event_hash: event?.previous_event_hash ?? null,
        current_event_hash: event?.current_event_hash ?? null,
    };
}

function buildEventTrace(eventLog = []) {
    verifyRealmEventHistory(eventLog);
    return canonicalEventsFromLog(eventLog).map(traceEntry);
}

function verifiedProjection(ledger = {}) {
    const eventLog = ledger.event_log || [];
    verifyRealmEventHistory(eventLog);
    const projection = ledger.current_authority_state && typeof ledger.current_authority_state === 'object'
        ? ledger.current_authority_state
        : buildCurrentAuthorityState(eventLog);
    return {
        eventLog,
        projection,
        historyHead: latestRealmEventHash(eventLog),
        projectionHash: calculateProjectionHash(projection),
    };
}

function normalizeSubjectRef(subjectRef) {
    return String(subjectRef || '').trim();
}

function eventReferencesSubject(event, subjectRef) {
    const ref = normalizeSubjectRef(subjectRef);
    if (!ref) return false;

    const envelope = eventEnvelope(event);
    const payload = eventPayload(event);
    const candidates = new Set([ref]);

    if (ref.startsWith('device:')) candidates.add(ref.slice('device:'.length));
    if (ref.startsWith('recovery:')) candidates.add(ref.slice('recovery:'.length));
    if (ref.startsWith('session:')) candidates.add(ref.slice('session:'.length));

    const values = [
        envelope.signer,
        envelope.authority_reference,
        payload.device_id,
        payload.authority_ref,
        payload.device_authority,
        payload.old_device_id,
        payload.new_device_id,
        payload.old_device_ref,
        payload.new_device_authority_ref,
        payload.recovery_authority_id,
        payload.recovery_authority_ref,
        payload.root_id,
        payload.session_id,
    ].filter(Boolean).map(String);

    return values.some((value) => candidates.has(value));
}

function findSubjectInProjection(projection, subjectRef) {
    const ref = normalizeSubjectRef(subjectRef);
    if (!ref) return null;

    if (projection.rootAuthority
        && (projection.rootAuthority.id === ref || projection.rootAuthority.authorityRef === ref)) {
        return {
            kind: 'root',
            ref: projection.rootAuthority.authorityRef || projection.rootAuthority.id,
            status: projection.rootAuthority.status,
            issuedEvent: projection.rootAuthority.issuedEvent || null,
            revokedEvent: projection.rootAuthority.revokedEvent || null,
        };
    }

    const device = findDevice(projection, ref);
    if (device) {
        return {
            kind: 'device',
            ref: device.authorityRef || device.id,
            status: device.status,
            issuedEvent: device.issuedEvent || null,
            revokedEvent: device.revokedEvent || null,
        };
    }

    const recoveryAuthority = (projection.recoveryAuthorities || []).find((entry) =>
        entry.id === ref || entry.authorityRef === ref
    );
    if (recoveryAuthority) {
        return {
            kind: 'recovery_authority',
            ref: recoveryAuthority.authorityRef || recoveryAuthority.id,
            status: recoveryAuthority.status,
            issuedEvent: recoveryAuthority.issuedEvent || null,
            revokedEvent: recoveryAuthority.revokedEvent || null,
        };
    }

    const session = (projection.sessions || []).find((entry) =>
        entry.id === ref || entry.authorityRef === ref
    );
    if (session) {
        return {
            kind: 'session',
            ref: session.authorityRef || session.id,
            status: session.status,
            issuedEvent: session.issuedEvent || null,
            revokedEvent: session.expiredEvent || null,
        };
    }

    return null;
}

function causallyRelevantEvents(eventLog, subjectRef) {
    return canonicalEventsFromLog(eventLog).filter((event) => eventReferencesSubject(event, subjectRef));
}

function buildAuthoritySummary(subject, derivedFrom) {
    if (!subject) {
        return 'No matching authority subject found in derived projection.';
    }

    const lastEvent = derivedFrom[derivedFrom.length - 1];
    if (!lastEvent) {
        return `${subject.kind} ${subject.ref} has no causally relevant accepted events.`;
    }

    if (subject.status === 'active') {
        return `${subject.kind} ${subject.ref} is active because ${lastEvent.type} was accepted at sequence ${lastEvent.sequence} by signer ${lastEvent.signer}.`;
    }

    return `${subject.kind} ${subject.ref} is ${subject.status} because accepted history includes ${derivedFrom.map((entry) => `${entry.type}#${entry.sequence}`).join(' -> ')}.`;
}

function explainCurrentAuthorityState(ledger = {}) {
    const { eventLog, projection, historyHead, projectionHash } = verifiedProjection(ledger);
    const derivedFrom = buildEventTrace(eventLog);

    return {
        subject: 'realm',
        current_authority: projection.rootAuthority?.authorityRef || projection.rootAuthority?.id || null,
        status: projection.rootAuthority?.status || null,
        derived_from: derivedFrom,
        projection_hash: projectionHash,
        history_head: historyHead,
        last_sequence: projection.lastSequence || 0,
        summary: projection.rootAuthority
            ? `Root authority ${projection.rootAuthority.authorityRef || projection.rootAuthority.id} is ${projection.rootAuthority.status} across ${derivedFrom.length} accepted Realm events.`
            : 'No root authority has been accepted into Realm history.',
        derivation_source: {
            event_history: true,
            projection: true,
        },
    };
}

function explainAuthorityForSubject(ledger = {}, subjectRef) {
    const { eventLog, projection, historyHead, projectionHash } = verifiedProjection(ledger);
    const subject = findSubjectInProjection(projection, subjectRef);
    const derivedFrom = causallyRelevantEvents(eventLog, subjectRef).map(traceEntry);

    return {
        subject: normalizeSubjectRef(subjectRef),
        current_authority: subject?.ref || null,
        status: subject?.status || 'unknown',
        derived_from: derivedFrom,
        projection_hash: projectionHash,
        history_head: historyHead,
        summary: buildAuthoritySummary(subject, derivedFrom),
        derivation_source: {
            event_history: true,
            projection: true,
        },
    };
}

function explainEventCausality(ledger = {}, targetEventId) {
    const { eventLog, projection, historyHead, projectionHash } = verifiedProjection(ledger);
    const eventTrace = buildEventTrace(eventLog);
    const targetId = String(targetEventId || '').trim();
    const targetIndex = eventTrace.findIndex((entry) => entry.event_id === targetId);

    if (targetIndex < 0) {
        return {
            ok: false,
            reason_codes: ['OBSERVABILITY_EVENT_NOT_FOUND'],
            event_id: targetId,
        };
    }

    const target = eventTrace[targetIndex];
    const prefix = eventTrace.slice(0, targetIndex + 1);

    return {
        ok: true,
        event_id: target.event_id,
        type: target.type,
        sequence: target.sequence,
        derived_from: prefix,
        projection_hash: projectionHash,
        history_head: historyHead,
        summary: `${target.type} at sequence ${target.sequence} is causally preceded by ${Math.max(prefix.length - 1, 0)} accepted Realm events.`,
        current_authority: projection.rootAuthority?.authorityRef || projection.rootAuthority?.id || null,
        derivation_source: {
            event_history: true,
            projection: true,
        },
    };
}

function explainCommandExecution(commandId, executionStore) {
    const normalizedCommandId = String(commandId || '').trim();
    if (!executionStore || typeof executionStore.get !== 'function') {
        return {
            ok: false,
            reason_codes: ['COMMAND_EXECUTION_STORE_REQUIRED'],
            command_id: normalizedCommandId,
        };
    }

    const record = executionStore.get(normalizedCommandId);
    if (!record) {
        return {
            ok: false,
            reason_codes: ['COMMAND_EXECUTION_NOT_FOUND'],
            command_id: normalizedCommandId,
        };
    }

    return {
        ok: true,
        command_id: normalizedCommandId,
        accepted_event_ids: record.accepted_event_ids || [],
        lineage: {
            intent_fingerprint: record.intent_fingerprint,
            recorded_at: record.recorded_at,
            execution_ok: record.execution_result?.ok === true,
            idempotent_replay: record.execution_result?.idempotent_replay === true,
        },
        derived_from: {
            source: 'command_execution_store',
            accepted_event_ids: record.accepted_event_ids || [],
        },
        summary: `Command ${normalizedCommandId} produced ${(record.accepted_event_ids || []).length} accepted Realm event reference(s).`,
        derivation_source: {
            command_execution_store: true,
        },
    };
}

function rejectionSummary(reasonCodes = []) {
    if (reasonCodes.includes('AUTHORITY_TRANSITION_DENIED')) {
        return 'Signer is not authorized by current Realm history.';
    }
    if (reasonCodes.some((code) => code.startsWith('SEQUENCE_MISMATCH'))) {
        return 'Proposal sequence does not match the next expected accepted Realm event sequence.';
    }
    if (reasonCodes.includes('DEVICE_SIGNATURE_INVALID')) {
        return 'Device signature verification failed before Realm validation.';
    }
    if (reasonCodes.length > 0) {
        return 'Realm transition was rejected by validator policy.';
    }
    return 'Realm transition was rejected.';
}

function explainRejection(validationResult = {}, options = {}) {
    const reasonCodes = Array.isArray(validationResult.reason_codes)
        ? [...validationResult.reason_codes]
        : [];

    const historyHead = options.historyHead !== undefined
        ? options.historyHead
        : latestRealmEventHash(options.ledger?.event_log || []);

    return {
        ok: false,
        reason_codes: reasonCodes,
        explanation: {
            summary: rejectionSummary(reasonCodes),
            derived_from: {
                validator: options.validator || 'validateRealmEventProposal',
                history_head: historyHead,
            },
        },
        derivation_source: {
            validation_result: true,
            event_history_head: historyHead !== undefined,
        },
    };
}

module.exports = {
    buildEventTrace,
    calculateProjectionHash,
    explainAuthorityForSubject,
    explainCommandExecution,
    explainCurrentAuthorityState,
    explainEventCausality,
    explainRejection,
};
