'use strict';

const {
    buildCurrentAuthorityState,
    canonicalEventsFromLog,
} = require('./current-authority-state');
const { latestRealmEventHash } = require('./realm-event-history');
const { calculateProjectionHash } = require('./realm-observability');
const { verifyRealmSnapshot } = require('./realm-snapshot');

function checkPass(name) {
    return { name, status: 'pass' };
}

function checkFail(name, code, message = null) {
    return { name, status: 'fail', code, message };
}

function checkWarn(name, code, message = null) {
    return { name, status: 'warning', code, message };
}

function checkSkip(name) {
    return { name, status: 'skip' };
}

function normalizeErrorCode(error) {
    return String(error?.message || error || 'INTEGRITY_CHECK_FAILED');
}

function eventIdsInLog(eventLog = []) {
    return new Set(
        canonicalEventsFromLog(eventLog)
            .map((event) => event.event_id || event.id)
            .filter(Boolean),
    );
}

function verifyEventHistoryIntegrity(eventLog = []) {
    const { verifyRealmEventHistory } = require('./realm-event-history');
    try {
        verifyRealmEventHistory(eventLog);
        return {
            ok: true,
            check: checkPass('EVENT_CHAIN_OK'),
        };
    } catch (error) {
        const code = normalizeErrorCode(error);
        return {
            ok: false,
            check: checkFail('EVENT_CHAIN_OK', code, code),
            failure: code,
        };
    }
}

function verifyProjectionReplayIntegrity(ledger = {}) {
    const eventLog = ledger.event_log || [];
    const historyCheck = verifyEventHistoryIntegrity(eventLog);
    if (!historyCheck.ok) {
        return {
            ok: false,
            check: checkFail('PROJECTION_REPLAY_OK', 'EVENT_CHAIN_BROKEN', 'Projection replay requires valid event history.'),
            failure: 'EVENT_CHAIN_BROKEN',
            replayProjectionHash: null,
            liveProjectionHash: null,
        };
    }

    const replayed = buildCurrentAuthorityState(eventLog);
    const replayProjectionHash = calculateProjectionHash(replayed);
    const liveProjection = ledger.current_authority_state && typeof ledger.current_authority_state === 'object'
        ? ledger.current_authority_state
        : replayed;
    const liveProjectionHash = calculateProjectionHash(liveProjection);

    if (replayProjectionHash !== liveProjectionHash) {
        return {
            ok: false,
            check: checkFail('PROJECTION_REPLAY_OK', 'PROJECTION_REPLAY_MISMATCH', 'CurrentAuthorityState does not match replay from event history.'),
            failure: 'PROJECTION_REPLAY_MISMATCH',
            replayProjectionHash,
            liveProjectionHash,
        };
    }

    return {
        ok: true,
        check: checkPass('PROJECTION_REPLAY_OK'),
        replayProjectionHash,
        liveProjectionHash,
    };
}

function verifySnapshotIntegrity(snapshot, ledger = {}) {
    if (snapshot === null || snapshot === undefined) {
        return {
            ok: true,
            check: checkSkip('SNAPSHOT_OK'),
            skipped: true,
        };
    }

    const historyCheck = verifyEventHistoryIntegrity(ledger.event_log || []);
    if (!historyCheck.ok) {
        return {
            ok: false,
            check: checkFail('SNAPSHOT_OK', 'EVENT_CHAIN_BROKEN', 'Snapshot verification requires valid event history.'),
            failure: 'EVENT_CHAIN_BROKEN',
        };
    }

    try {
        verifyRealmSnapshot(ledger, snapshot);
        return {
            ok: true,
            check: checkPass('SNAPSHOT_OK'),
        };
    } catch (error) {
        const code = normalizeErrorCode(error);
        return {
            ok: false,
            check: checkFail('SNAPSHOT_OK', code, code),
            failure: code,
        };
    }
}

function federationTrustEventFor(ledger, establishedEventId) {
    return canonicalEventsFromLog(ledger.event_log || []).find((event) =>
        (event.event_id || event.id) === establishedEventId
    ) || null;
}

function verifyFederationReferences(ledger = {}, options = {}) {
    const projection = ledger.current_authority_state || {};
    const federationTrusts = projection.federationTrusts || [];
    const remoteEvidenceHeads = options.remoteEvidenceHeads || options.remote_evidence_heads || {};

    if (federationTrusts.length === 0) {
        return {
            ok: true,
            check: checkPass('FEDERATION_REFERENCES_OK'),
        };
    }

    for (const trust of federationTrusts) {
        const establishedEventId = trust.establishedEvent || trust.established_event || null;
        const remoteEventHead = trust.remoteEventHead || trust.remote_event_head || null;
        const realmId = trust.realmId || trust.remote_realm_id || null;

        if (!establishedEventId) {
            return {
                ok: false,
                check: checkFail('FEDERATION_REFERENCES_OK', 'FEDERATION_REFERENCE_INVALID', 'Federation trust lacks established event reference.'),
                failure: 'FEDERATION_REFERENCE_INVALID',
            };
        }

        const establishingEvent = federationTrustEventFor(ledger, establishedEventId);
        if (!establishingEvent) {
            return {
                ok: false,
                check: checkFail('FEDERATION_REFERENCES_OK', 'FEDERATION_REFERENCE_INVALID', 'Federation trust references missing local accepted event.'),
                failure: 'FEDERATION_REFERENCE_INVALID',
            };
        }

        const payloadHead = establishingEvent.payload?.remote_event_head || null;
        if (remoteEventHead && payloadHead && remoteEventHead !== payloadHead) {
            return {
                ok: false,
                check: checkFail('FEDERATION_REFERENCES_OK', 'FEDERATION_REFERENCE_INVALID', 'Federation trust projection head does not match establishing event payload.'),
                failure: 'FEDERATION_REFERENCE_INVALID',
            };
        }

        if (realmId && remoteEvidenceHeads[realmId] && remoteEventHead && remoteEvidenceHeads[realmId] !== remoteEventHead) {
            return {
                ok: false,
                check: checkFail('FEDERATION_REFERENCES_OK', 'FEDERATION_REFERENCE_INVALID', 'Federation trust references remote head not present in supplied remote evidence.'),
                failure: 'FEDERATION_REFERENCE_INVALID',
            };
        }
    }

    return {
        ok: true,
        check: checkPass('FEDERATION_REFERENCES_OK'),
    };
}

function commandExecutionRecords(executionStore, options = {}) {
    if (!executionStore) return [];

    if (typeof executionStore.list === 'function') {
        return executionStore.list();
    }

    const commandIds = options.commandIds || [];
    return commandIds
        .map((commandId) => executionStore.get(commandId))
        .filter(Boolean);
}

function verifyCommandExecutionBoundary(executionStore, ledger = {}, options = {}) {
    if (!executionStore) {
        return {
            ok: true,
            canonical: false,
            check: checkWarn('COMMAND_LINEAGE_OK', 'COMMAND_EXECUTION_RECORD_MISSING', 'Command execution store was not supplied.'),
            warning: 'COMMAND_EXECUTION_RECORD_MISSING',
        };
    }

    const records = commandExecutionRecords(executionStore, options);
    if (records.length === 0) {
        return {
            ok: true,
            canonical: false,
            check: checkWarn('COMMAND_LINEAGE_OK', 'COMMAND_EXECUTION_RECORD_MISSING', 'No command execution records were available for lineage verification.'),
            warning: 'COMMAND_EXECUTION_RECORD_MISSING',
        };
    }

    const acceptedIds = eventIdsInLog(ledger.event_log || []);
    for (const record of records) {
        for (const acceptedEventId of record.accepted_event_ids || []) {
            if (!acceptedIds.has(acceptedEventId)) {
                return {
                    ok: false,
                    canonical: false,
                    check: checkFail('COMMAND_LINEAGE_OK', 'COMMAND_EXECUTION_REFERENCE_INVALID', 'Command execution record references accepted event absent from canonical history.'),
                    failure: 'COMMAND_EXECUTION_REFERENCE_INVALID',
                };
            }
        }
    }

    return {
        ok: true,
        canonical: false,
        check: checkPass('COMMAND_LINEAGE_OK'),
    };
}

function summarizeSection(checks = []) {
    if (checks.some((check) => check.status === 'fail')) return 'fail';
    if (checks.some((check) => check.status === 'warning')) return 'warning';
    if (checks.every((check) => check.status === 'skip')) return 'skip';
    return 'ok';
}

function verifyRealmIntegrity(ledger = {}, options = {}) {
    const verifiedAt = options.verifiedAt || new Date().toISOString();
    const checks = [];
    const failures = [];
    const warnings = [];

    const history = verifyEventHistoryIntegrity(ledger.event_log || []);
    checks.push(history.check);
    if (history.failure) failures.push(history.failure);

    const projection = verifyProjectionReplayIntegrity(ledger);
    checks.push(projection.check);
    if (projection.failure) failures.push(projection.failure);

    const snapshot = verifySnapshotIntegrity(options.snapshot, ledger);
    checks.push(snapshot.check);
    if (snapshot.failure) failures.push(snapshot.failure);
    if (snapshot.warning) warnings.push(snapshot.warning);

    const federation = verifyFederationReferences(ledger, options);
    checks.push(federation.check);
    if (federation.failure) failures.push(federation.failure);

    const commandLineage = verifyCommandExecutionBoundary(options.executionStore, ledger, options);
    checks.push(commandLineage.check);
    if (commandLineage.failure) failures.push(commandLineage.failure);
    if (commandLineage.warning) warnings.push(commandLineage.warning);

    const historyHead = history.ok ? latestRealmEventHash(ledger.event_log || []) : null;
    const projectionHash = projection.replayProjectionHash
        || (history.ok ? calculateProjectionHash(buildCurrentAuthorityState(ledger.event_log || [])) : null);

    const canonicalChecks = [history.check, projection.check];
    const derivedChecks = [snapshot.check];
    const operationalChecks = [federation.check, commandLineage.check];

    const realmValid = failures.length === 0;

    return {
        realm_valid: realmValid,
        history_head: historyHead,
        projection_hash: projectionHash,
        verified_at: verifiedAt,
        checks,
        failures,
        warnings,
        canonical: {
            history: summarizeSection([history.check]),
            projection_replay: summarizeSection([projection.check]),
        },
        derived: {
            snapshot: summarizeSection([snapshot.check]),
        },
        operational: {
            federation_references: summarizeSection([federation.check]),
            command_lineage: summarizeSection([commandLineage.check]),
        },
    };
}

module.exports = {
    verifyCommandExecutionBoundary,
    verifyEventHistoryIntegrity,
    verifyFederationReferences,
    verifyProjectionReplayIntegrity,
    verifyRealmIntegrity,
    verifySnapshotIntegrity,
};
