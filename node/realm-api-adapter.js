'use strict';

const { COMMAND_TYPES } = require('./realm-command-runtime');
const { executeCommand } = require('./realm-command-execution');

const API_ROUTES = Object.freeze({
    SUBMIT_REALM_EVENT: 'POST /realm/events/submit',
    SUBMIT_DEVICE_EVENT: 'POST /realm/device-events/submit',
    EXECUTE_RECOVERY_CEREMONY: 'POST /realm/recovery/execute',
    RECOGNIZE_REMOTE_REALM: 'POST /realm/federation/recognize',
});

const ROUTE_COMMAND_TYPES = Object.freeze({
    [API_ROUTES.SUBMIT_REALM_EVENT]: COMMAND_TYPES.SUBMIT_REALM_EVENT,
    [API_ROUTES.SUBMIT_DEVICE_EVENT]: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
    [API_ROUTES.EXECUTE_RECOVERY_CEREMONY]: COMMAND_TYPES.EXECUTE_RECOVERY_CEREMONY,
    [API_ROUTES.RECOGNIZE_REMOTE_REALM]: COMMAND_TYPES.RECOGNIZE_REMOTE_REALM,
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function apiError(reasonCodes, details = {}) {
    return {
        ok: false,
        reason_codes: reasonCodes,
        ...details,
    };
}

function normalizeApiBody(body) {
    if (body === null || body === undefined) return {};
    if (typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }
    return body;
}

function validateApiRequest(route, body) {
    if (!route || typeof route !== 'string') {
        return apiError(['API_ROUTE_REQUIRED']);
    }
    if (!ROUTE_COMMAND_TYPES[route]) {
        return apiError(['API_ROUTE_UNSUPPORTED'], { route });
    }

    const normalizedBody = normalizeApiBody(body);
    if (normalizedBody === null) {
        return apiError(['API_REQUEST_INVALID']);
    }
    if (!String(normalizedBody.command_id || '').trim()) {
        return apiError(['API_COMMAND_ID_REQUIRED']);
    }

    return {
        ok: true,
        route,
        body: normalizedBody,
    };
}

function buildCommand(route, body, context = {}) {
    const commandType = ROUTE_COMMAND_TYPES[route];
    const payload = body.payload && typeof body.payload === 'object'
        ? body.payload
        : {};

    return {
        command_id: String(body.command_id).trim(),
        type: commandType,
        payload,
        actor: {
            ...(context.actor && typeof context.actor === 'object' ? context.actor : {}),
            ...(body.actor && typeof body.actor === 'object' ? body.actor : {}),
            session: body.session || context.session || null,
        },
        evidence: {
            ...(context.evidence && typeof context.evidence === 'object' ? context.evidence : {}),
            ...(body.evidence && typeof body.evidence === 'object' ? body.evidence : {}),
            request_id: body.request_id || context.request_id || null,
            route,
            session: body.session || context.session || null,
        },
    };
}

function executionStatus(executionResult = {}) {
    if (executionResult.ok === true) {
        return executionResult.idempotent_replay ? 'already_executed' : 'accepted';
    }
    return 'rejected';
}

function serializeExecutionResponse(executionResult, options = {}) {
    const representation = options.representation === undefined
        ? undefined
        : clone(options.representation);

    return {
        ok: executionResult.ok === true,
        status: executionStatus(executionResult),
        command_id: executionResult.command_id || null,
        accepted_event_ids: executionResult.accepted_event_ids || [],
        reason_codes: executionResult.reason_codes || [],
        idempotent_replay: executionResult.idempotent_replay === true,
        representation,
    };
}

function handleApiRequest(route, body, context = {}, options = {}) {
    const validation = validateApiRequest(route, body);
    if (!validation.ok) {
        return serializeExecutionResponse(validation, {
            representation: undefined,
        });
    }

    const command = buildCommand(route, validation.body, context);
    const executionResult = executeCommand(command, context, {
        executionStore: options.executionStore,
    });

    const representation = typeof context.readRepresentation === 'function'
        ? context.readRepresentation(context.ledger)
        : undefined;

    return serializeExecutionResponse(executionResult, { representation });
}

module.exports = {
    API_ROUTES,
    buildCommand,
    handleApiRequest,
    serializeExecutionResponse,
    validateApiRequest,
};
