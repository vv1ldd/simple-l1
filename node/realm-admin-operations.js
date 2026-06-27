'use strict';

const { createBackupArtifact } = require('./realm-backup-restore');
const { verifyRealmIntegrity } = require('./realm-integrity-check');
const { executeCommand } = require('./realm-command-execution');
const { COMMAND_TYPES } = require('./realm-command-runtime');
const {
    buildEventTrace,
    explainCurrentAuthorityState,
} = require('./realm-observability');

const ADMIN_ACTIONS = Object.freeze({
    CREATE_BACKUP: 'CREATE_BACKUP',
    EXECUTE_RECOVERY: 'EXECUTE_RECOVERY',
    EXPLAIN_REALM_STATE: 'EXPLAIN_REALM_STATE',
    INSPECT_EVENT_HISTORY: 'INSPECT_EVENT_HISTORY',
    RECOGNIZE_REALM: 'RECOGNIZE_REALM',
    ROTATE_AUTHORITY: 'ROTATE_AUTHORITY',
    RUN_INTEGRITY_CHECK: 'RUN_INTEGRITY_CHECK',
    SUBMIT_DEVICE_EVENT: 'SUBMIT_DEVICE_EVENT',
});

const READ_ADMIN_ACTIONS = new Set([
    ADMIN_ACTIONS.CREATE_BACKUP,
    ADMIN_ACTIONS.EXPLAIN_REALM_STATE,
    ADMIN_ACTIONS.INSPECT_EVENT_HISTORY,
    ADMIN_ACTIONS.RUN_INTEGRITY_CHECK,
]);

const MUTATING_ADMIN_ACTIONS = new Set([
    ADMIN_ACTIONS.EXECUTE_RECOVERY,
    ADMIN_ACTIONS.RECOGNIZE_REALM,
    ADMIN_ACTIONS.ROTATE_AUTHORITY,
    ADMIN_ACTIONS.SUBMIT_DEVICE_EVENT,
]);

const ADMIN_ACTION_COMMAND_TYPES = Object.freeze({
    [ADMIN_ACTIONS.EXECUTE_RECOVERY]: COMMAND_TYPES.EXECUTE_RECOVERY_CEREMONY,
    [ADMIN_ACTIONS.RECOGNIZE_REALM]: COMMAND_TYPES.RECOGNIZE_REMOTE_REALM,
    [ADMIN_ACTIONS.ROTATE_AUTHORITY]: COMMAND_TYPES.SUBMIT_REALM_EVENT,
    [ADMIN_ACTIONS.SUBMIT_DEVICE_EVENT]: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
});

function adminError(reasonCodes, details = {}) {
    return {
        ok: false,
        reason_codes: reasonCodes,
        ...details,
    };
}

function normalizeAdminRequest(request = {}) {
    if (!request || typeof request !== 'object') {
        return adminError(['ADMIN_REQUEST_INVALID']);
    }

    const commandId = String(request.command_id || '').trim();
    const requestedAction = String(request.requested_action || '').trim();

    if (!commandId) {
        return adminError(['ADMIN_COMMAND_ID_REQUIRED']);
    }
    if (!requestedAction) {
        return adminError(['ADMIN_REQUESTED_ACTION_REQUIRED']);
    }
    if (!READ_ADMIN_ACTIONS.has(requestedAction) && !MUTATING_ADMIN_ACTIONS.has(requestedAction)) {
        return adminError(['ADMIN_ACTION_UNSUPPORTED'], { requested_action: requestedAction });
    }

    return {
        ok: true,
        command_id: commandId,
        requested_action: requestedAction,
        actor: request.actor && typeof request.actor === 'object' ? request.actor : { role: 'admin' },
        payload: request.payload && typeof request.payload === 'object' ? request.payload : {},
        evidence: request.evidence && typeof request.evidence === 'object' ? request.evidence : {},
    };
}

function buildAuditRecord(request, result = {}) {
    return {
        command_id: request.command_id,
        actor: request.actor,
        requested_action: request.requested_action,
        result: result.ok === true
            ? (result.idempotent_replay ? 'already_executed' : 'accepted')
            : 'rejected',
        accepted_event_ids: result.accepted_event_ids || [],
        reason_codes: result.reason_codes || [],
    };
}

function executionStatus(executionResult = {}) {
    if (executionResult.ok === true) {
        return executionResult.idempotent_replay ? 'already_executed' : 'accepted';
    }
    return 'rejected';
}

function serializeAdminResponse(request, executionResult = {}, options = {}) {
    return {
        ok: executionResult.ok === true,
        status: executionStatus(executionResult),
        command_id: executionResult.command_id || request.command_id,
        requested_action: request.requested_action,
        accepted_event_ids: executionResult.accepted_event_ids || [],
        reason_codes: executionResult.reason_codes || [],
        idempotent_replay: executionResult.idempotent_replay === true,
        representation: options.representation,
        audit: buildAuditRecord(request, executionResult),
    };
}

function executeReadAdminAction(request, context = {}) {
    const ledger = context.ledger;
    if (!ledger || typeof ledger !== 'object') {
        return adminError(['ADMIN_LEDGER_REQUIRED']);
    }

    switch (request.requested_action) {
    case ADMIN_ACTIONS.EXPLAIN_REALM_STATE:
        return {
            ok: true,
            representation: explainCurrentAuthorityState(ledger),
        };
    case ADMIN_ACTIONS.RUN_INTEGRITY_CHECK:
        return {
            ok: true,
            representation: verifyRealmIntegrity(ledger, context),
        };
    case ADMIN_ACTIONS.INSPECT_EVENT_HISTORY:
        return {
            ok: true,
            representation: {
                trace: buildEventTrace(ledger.event_log || []),
            },
        };
    case ADMIN_ACTIONS.CREATE_BACKUP:
        return {
            ok: true,
            representation: createBackupArtifact(ledger, context.backupOptions || {}),
        };
    default:
        return adminError(['ADMIN_ACTION_UNSUPPORTED']);
    }
}

function buildAdminCommand(request) {
    return {
        command_id: request.command_id,
        type: ADMIN_ACTION_COMMAND_TYPES[request.requested_action],
        payload: request.payload,
        actor: request.actor,
        evidence: request.evidence,
    };
}

function attemptAdminProjectionMutation(ledger, mutation = {}) {
    if (!ledger || typeof ledger !== 'object') {
        return adminError(['ADMIN_LEDGER_REQUIRED']);
    }
    if (!mutation || typeof mutation !== 'object') {
        return adminError(['ADMIN_MUTATION_INVALID']);
    }

    return {
        ok: false,
        reason_codes: ['ADMIN_PROJECTION_MUTATION_FORBIDDEN'],
        mutation_applied: false,
        requested_mutation: mutation,
    };
}

function attemptAdminEventAppend(ledger, event) {
    if (!ledger || typeof ledger !== 'object') {
        return adminError(['ADMIN_LEDGER_REQUIRED']);
    }
    if (!event || typeof event !== 'object') {
        return adminError(['ADMIN_EVENT_INVALID']);
    }

    return {
        ok: false,
        reason_codes: ['ADMIN_EVENT_APPEND_FORBIDDEN'],
        event_appended: false,
        requested_event: event,
    };
}

function executeAdminRequest(request, context = {}, options = {}) {
    const normalized = normalizeAdminRequest(request);
    if (!normalized.ok) {
        return serializeAdminResponse(
            {
                command_id: request?.command_id || null,
                requested_action: request?.requested_action || null,
                actor: request?.actor || { role: 'admin' },
            },
            normalized,
        );
    }

    if (READ_ADMIN_ACTIONS.has(normalized.requested_action)) {
        const readResult = executeReadAdminAction(normalized, context);
        return serializeAdminResponse(normalized, {
            ...readResult,
            command_id: normalized.command_id,
            accepted_event_ids: [],
            idempotent_replay: false,
        }, {
            representation: readResult.representation,
        });
    }

    const command = buildAdminCommand(normalized);
    const executionResult = executeCommand(command, context, {
        executionStore: options.executionStore,
    });
    const representation = typeof context.readRepresentation === 'function'
        ? context.readRepresentation(context.ledger)
        : undefined;

    return serializeAdminResponse(normalized, executionResult, { representation });
}

module.exports = {
    ADMIN_ACTIONS,
    attemptAdminEventAppend,
    attemptAdminProjectionMutation,
    buildAdminCommand,
    executeAdminRequest,
    normalizeAdminRequest,
};
