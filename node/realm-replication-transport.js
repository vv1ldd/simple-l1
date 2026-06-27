'use strict';

const { COMMAND_TYPES } = require('./realm-command-runtime');
const { commandIntentFingerprint, executeCommand } = require('./realm-command-execution');
const {
    buildRealmEventId,
    calculateRealmEventHash,
    latestRealmEventHash,
} = require('./realm-event-history');
const { verifyRealmSnapshot } = require('./realm-snapshot');

function forbiddenStateImport(batch = {}) {
    return Boolean(
        batch.current_authority_state
        || batch.currentAuthorityState
        || batch.CurrentAuthorityState
    );
}

function transportBatchError(code, details = {}) {
    return {
        ok: false,
        reason_codes: [code],
        ...details,
    };
}

function batchPreviousHash(batch = {}) {
    return batch.previous_event_hash ?? batch.previous_hash ?? null;
}

function batchHeadHash(batch = {}) {
    return batch.head_hash ?? batch.current_event_hash ?? null;
}

function verifyTransportEventSegment(events = [], previousEventHash = null) {
    let expectedPreviousHash = previousEventHash;

    for (const event of events) {
        if (event.previous_event_hash !== expectedPreviousHash) {
            return transportBatchError('TRANSPORT_HISTORY_GAP', {
                expected_previous_event_hash: expectedPreviousHash,
                received_previous_event_hash: event.previous_event_hash,
            });
        }

        const recalculatedHash = calculateRealmEventHash(event, expectedPreviousHash);
        if (event.current_event_hash !== recalculatedHash) {
            return transportBatchError('TRANSPORT_EVENT_HASH_MISMATCH', {
                sequence: event.sequence ?? event.envelope?.sequence,
            });
        }

        const expectedEventId = buildRealmEventId(event, recalculatedHash);
        if (event.event_id !== expectedEventId || event.id !== expectedEventId) {
            return transportBatchError('TRANSPORT_EVENT_ID_MISMATCH', {
                sequence: event.sequence ?? event.envelope?.sequence,
            });
        }

        expectedPreviousHash = event.current_event_hash;
    }

    return {
        ok: true,
        head_hash: expectedPreviousHash,
    };
}

function verifyTransportEnvelope(batch = {}, { ledger } = {}) {
    if (!batch || typeof batch !== 'object') {
        return transportBatchError('TRANSPORT_ENVELOPE_INVALID');
    }
    if (forbiddenStateImport(batch)) {
        return transportBatchError('TRANSPORT_STATE_IMPORT_FORBIDDEN');
    }
    if (!Array.isArray(batch.events)) {
        return transportBatchError('TRANSPORT_EVENTS_REQUIRED');
    }

    const localHead = latestRealmEventHash(ledger?.event_log || []);
    const previousEventHash = batchPreviousHash(batch);
    if (previousEventHash !== localHead) {
        return transportBatchError('TRANSPORT_HISTORY_GAP', {
            local_head: localHead,
            batch_previous_event_hash: previousEventHash,
        });
    }

    const segment = verifyTransportEventSegment(batch.events, previousEventHash);
    if (!segment.ok) return segment;

    const expectedHeadHash = batchHeadHash(batch);
    if (expectedHeadHash !== segment.head_hash) {
        return transportBatchError('TRANSPORT_HEAD_HASH_MISMATCH', {
            expected_head_hash: segment.head_hash,
            batch_head_hash: expectedHeadHash,
        });
    }

    return {
        ok: true,
        event_count: batch.events.length,
        head_hash: segment.head_hash,
        previous_event_hash: previousEventHash,
        received: true,
    };
}

function transportCommandId(batch = {}, event = {}, index = 0) {
    const prefix = batch.command_id
        || batch.command_id_prefix
        || batch.delivery_id
        || batch.transport_id
        || batch.batch_id
        || batchHeadHash(batch)
        || 'transport_batch';
    const eventRef = event.event_id || event.id || event.current_event_hash || `event_${index}`;
    return `transport:${prefix}:${eventRef}`;
}

function eventCommand(batch, event, index) {
    return {
        command_id: transportCommandId(batch, event, index),
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: event,
        },
        actor: {
            transport: batch.transport || batch.remote_realm_id || batch.source || 'realm_replication_transport',
        },
        evidence: {
            batch_head_hash: batchHeadHash(batch),
            batch_previous_event_hash: batchPreviousHash(batch),
            delivery_id: batch.delivery_id || null,
            remote_realm_id: batch.remote_realm_id || null,
        },
    };
}

function batchCommands(batch = {}) {
    return (batch.events || []).map((event, index) => eventCommand(batch, event, index));
}

function cachedBatchReplay(batch = {}, context = {}, options = {}) {
    const { executionStore } = options;
    if (!executionStore || typeof executionStore.has !== 'function') return null;

    const commands = batchCommands(batch);
    if (commands.length === 0) return null;
    if (!commands.every((command) => executionStore.has(command.command_id))) return null;

    const results = commands.map((command) => executeCommand(command, context, { executionStore }));
    const mismatch = results.find((result) => result.reason_codes?.includes('COMMAND_ID_INTENT_MISMATCH'));
    if (mismatch) return mismatch;

    if (!results.every((result) => result.idempotent_replay === true)) return null;

    return {
        ok: results.every((result) => result.ok === true),
        received: true,
        idempotent_replay: true,
        command_results: results,
        accepted_event_ids: results.flatMap((result) => result.accepted_event_ids || []),
    };
}

function receiveEventBatch(batch = {}, context = {}, options = {}) {
    if (forbiddenStateImport(batch)) {
        return transportBatchError('TRANSPORT_STATE_IMPORT_FORBIDDEN');
    }

    const verification = verifyTransportEnvelope(batch, context);
    if (!verification.ok) {
        const replay = cachedBatchReplay(batch, context, options);
        return replay || verification;
    }

    const commandResults = [];
    for (const command of batchCommands(batch)) {
        const result = executeCommand(command, context, {
            executionStore: options.executionStore,
        });
        commandResults.push(result);
        if (!result.ok) {
            return {
                ok: false,
                received: true,
                reason_codes: result.reason_codes || [],
                failed_command_id: result.command_id,
                command_results: commandResults,
                accepted_event_ids: commandResults.flatMap((entry) => entry.accepted_event_ids || []),
            };
        }
    }

    return {
        ok: true,
        received: true,
        idempotent_replay: false,
        verification,
        command_results: commandResults,
        accepted_event_ids: commandResults.flatMap((result) => result.accepted_event_ids || []),
    };
}

function requestMissingHistory(afterHash, options = {}) {
    return {
        type: 'MISSING_HISTORY_REQUEST',
        after_hash: afterHash ?? null,
        limit: options.limit || null,
    };
}

function announceEventHead(headHash, options = {}) {
    return {
        type: 'EVENT_HEAD_ANNOUNCEMENT',
        head_hash: headHash ?? null,
        remote_realm_id: options.remoteRealmId || options.remote_realm_id || null,
    };
}

function receiveSnapshot(snapshot = {}, { source } = {}) {
    if (forbiddenStateImport(snapshot)) {
        return transportBatchError('TRANSPORT_STATE_IMPORT_FORBIDDEN');
    }
    if (!source) {
        return {
            ok: true,
            received: true,
            snapshot,
        };
    }

    try {
        return {
            ok: true,
            received: true,
            verification: verifyRealmSnapshot(source, snapshot),
            snapshot,
        };
    } catch (error) {
        return transportBatchError(error.message || 'SNAPSHOT_TRANSPORT_INVALID');
    }
}

module.exports = {
    announceEventHead,
    batchCommands,
    commandIntentFingerprint,
    receiveEventBatch,
    receiveSnapshot,
    requestMissingHistory,
    verifyTransportEnvelope,
};
