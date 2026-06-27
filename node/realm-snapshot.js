'use strict';

const {
    applyAuthorityEvent,
    buildCurrentAuthorityState,
    isCanonicalRealmEvent,
} = require('./current-authority-state');
const { verifyRealmEventHistory } = require('./realm-event-history');

const SUPPORTED_PROJECTION_VERSION = 1;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function eventLogFrom(source = {}) {
    return Array.isArray(source) ? source : (source.event_log || []);
}

function canonicalEvents(eventLog = []) {
    return eventLog.filter(isCanonicalRealmEvent);
}

function sequenceOf(event) {
    return Number(event?.sequence ?? event?.envelope?.sequence);
}

function snapshotError(code) {
    return new Error(code);
}

function verifySnapshotMetadata(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') throw snapshotError('SNAPSHOT_METADATA_INVALID');
    if (!snapshot.projection || typeof snapshot.projection !== 'object') throw snapshotError('SNAPSHOT_METADATA_INVALID');
    if (!Number.isInteger(snapshot.last_sequence) || snapshot.last_sequence < 0) {
        throw snapshotError('SNAPSHOT_METADATA_INVALID');
    }
    if (snapshot.last_verified_event_hash !== null && typeof snapshot.last_verified_event_hash !== 'string') {
        throw snapshotError('SNAPSHOT_METADATA_INVALID');
    }
    if (snapshot.projection_version !== SUPPORTED_PROJECTION_VERSION) {
        throw snapshotError('SNAPSHOT_PROJECTION_VERSION_UNSUPPORTED');
    }
    return true;
}

function historyPrefix(eventLog, lastSequence) {
    return eventLog.filter((event) => isCanonicalRealmEvent(event) && sequenceOf(event) <= lastSequence);
}

function remainingHistory(eventLog, lastSequence) {
    return eventLog.filter((event) => isCanonicalRealmEvent(event) && sequenceOf(event) > lastSequence);
}

function headEventForSequence(eventLog, lastSequence) {
    if (lastSequence === 0) return null;
    return canonicalEvents(eventLog).find((event) => sequenceOf(event) === lastSequence) || null;
}

function assertSnapshotHistoryHead(eventLog, snapshot) {
    const headEvent = headEventForSequence(eventLog, snapshot.last_sequence);
    if (snapshot.last_sequence === 0) {
        if (snapshot.last_verified_event_hash !== null) throw snapshotError('SNAPSHOT_HISTORY_MISMATCH');
        return;
    }
    if (!headEvent) throw snapshotError('SNAPSHOT_HISTORY_MISMATCH');
    if (headEvent.current_event_hash !== snapshot.last_verified_event_hash) {
        throw snapshotError('SNAPSHOT_HISTORY_MISMATCH');
    }
}

function createRealmSnapshot(source = {}, options = {}) {
    const eventLog = eventLogFrom(source);
    verifyRealmEventHistory(eventLog);
    const events = canonicalEvents(eventLog);
    const lastSequence = options.lastSequence === undefined
        ? (events.length > 0 ? sequenceOf(events[events.length - 1]) : 0)
        : Number(options.lastSequence);

    if (!Number.isInteger(lastSequence) || lastSequence < 0) throw snapshotError('SNAPSHOT_METADATA_INVALID');
    const prefix = historyPrefix(eventLog, lastSequence);
    const projection = buildCurrentAuthorityState(prefix);
    const headEvent = headEventForSequence(eventLog, lastSequence);

    return {
        projection,
        last_verified_event_hash: headEvent ? headEvent.current_event_hash : null,
        last_sequence: lastSequence,
        projection_version: SUPPORTED_PROJECTION_VERSION,
    };
}

function verifyRealmSnapshot(source = {}, snapshot = {}) {
    verifySnapshotMetadata(snapshot);
    const eventLog = eventLogFrom(source);
    verifyRealmEventHistory(eventLog);
    assertSnapshotHistoryHead(eventLog, snapshot);

    const prefix = historyPrefix(eventLog, snapshot.last_sequence);
    const expectedProjection = buildCurrentAuthorityState(prefix);
    if (JSON.stringify(expectedProjection) !== JSON.stringify(snapshot.projection)) {
        throw snapshotError('SNAPSHOT_PROJECTION_MISMATCH');
    }

    return {
        ok: true,
        projection: clone(snapshot.projection),
        remainingEvents: remainingHistory(eventLog, snapshot.last_sequence),
        lastVerifiedEventHash: snapshot.last_verified_event_hash,
        lastSequence: snapshot.last_sequence,
        projectionVersion: snapshot.projection_version,
    };
}

function rebuildFromSnapshot(source = {}, snapshot = {}) {
    const verification = verifyRealmSnapshot(source, snapshot);
    let projection = verification.projection;
    for (const event of verification.remainingEvents) {
        projection = applyAuthorityEvent(projection, event);
    }
    return projection;
}

module.exports = {
    createRealmSnapshot,
    rebuildFromSnapshot,
    verifyRealmSnapshot,
    verifySnapshotMetadata,
};
