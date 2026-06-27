'use strict';

const crypto = require('crypto');
const { canonicalEncode } = require('./realm-event-history');
const { executeRealmCommand, normalizeRealmCommand } = require('./realm-command-runtime');

function createCommandExecutionStore() {
    const records = new Map();

    return {
        get(commandId) {
            return records.get(String(commandId)) || null;
        },
        set(commandId, record) {
            records.set(String(commandId), record);
            return record;
        },
        has(commandId) {
            return records.has(String(commandId));
        },
    };
}

function commandIntentFingerprint(command = {}) {
    const normalized = normalizeRealmCommand(command);
    return crypto
        .createHash('sha256')
        .update(canonicalEncode({
            type: normalized.type,
            payload: normalized.payload,
            actor: normalized.actor,
            evidence: normalized.evidence,
        }))
        .digest('hex');
}

function eventId(event) {
    return event?.id || event?.event_id || null;
}

function collectAcceptedEventIds(result = {}) {
    const ids = [];

    if (Array.isArray(result.acceptedEvents)) {
        for (const event of result.acceptedEvents) {
            const id = eventId(event);
            if (id) ids.push(id);
        }
    }

    if (result.event) {
        const id = eventId(result.event);
        if (id && !ids.includes(id)) ids.push(id);
    }

    return ids;
}

function attachExecutionMetadata(result, { commandId, acceptedEventIds, idempotentReplay }) {
    return {
        ...result,
        command_id: commandId,
        accepted_event_ids: acceptedEventIds,
        idempotent_replay: idempotentReplay,
    };
}

function executeCommand(command, context = {}, options = {}) {
    const executionStore = options.executionStore || createCommandExecutionStore();
    const commandId = String(command?.command_id || '').trim();

    if (!commandId) {
        const result = executeRealmCommand(command, context);
        return attachExecutionMetadata(result, {
            commandId: null,
            acceptedEventIds: collectAcceptedEventIds(result),
            idempotentReplay: false,
        });
    }

    const intentFingerprint = commandIntentFingerprint(command);
    const existing = executionStore.get(commandId);
    if (existing) {
        if (existing.intent_fingerprint !== intentFingerprint) {
            return {
                ok: false,
                reason_codes: ['COMMAND_ID_INTENT_MISMATCH'],
                command_id: commandId,
                accepted_event_ids: [],
                idempotent_replay: false,
            };
        }

        return attachExecutionMetadata(existing.execution_result, {
            commandId,
            acceptedEventIds: existing.accepted_event_ids,
            idempotentReplay: true,
        });
    }

    const executionResult = executeRealmCommand(command, context);
    const acceptedEventIds = collectAcceptedEventIds(executionResult);

    executionStore.set(commandId, {
        command_id: commandId,
        intent_fingerprint: intentFingerprint,
        execution_result: executionResult,
        accepted_event_ids: acceptedEventIds,
        recorded_at: new Date().toISOString(),
    });

    return attachExecutionMetadata(executionResult, {
        commandId,
        acceptedEventIds,
        idempotentReplay: false,
    });
}

module.exports = {
    collectAcceptedEventIds,
    commandIntentFingerprint,
    createCommandExecutionStore,
    executeCommand,
};
