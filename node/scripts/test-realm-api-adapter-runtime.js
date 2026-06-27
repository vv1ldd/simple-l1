'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { COMMAND_TYPES } = require('../realm-command-runtime');
const { createCommandExecutionStore } = require('../realm-command-execution');
const {
    API_ROUTES,
    handleApiRequest,
} = require('../realm-api-adapter');

const ROOT_REF = 'api_root_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

function createTestLedger() {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: 'test-root',
    };
    ensureAuthorityStateStores(ledger);
    return ledger;
}

function createApplyEvent(ledger) {
    return function applyEvent(event, isInitialReplay = false) {
        if (isCanonicalRealmEvent(event)) {
            applyCanonicalAuthorityProjection(ledger, event);
        }
        if (!isInitialReplay) {
            ledger.event_log.push(event);
        }
    };
}

function acceptRealmEventFor(ledger, applyEvent) {
    return (proposal) => acceptAndApplyRealmEvent(ledger, proposal, { applyEvent });
}

function rootProposal(sequence = 1) {
    return {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'api_root',
            public_key: 'pk_api_root',
        },
    };
}

function apiContext(ledger, applyEvent, overrides = {}) {
    return {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
        readRepresentation: (targetLedger) => clone(targetLedger.current_authority_state),
        ...overrides,
    };
}

function submitRootRequest(commandId, overrides = {}) {
    return {
        command_id: commandId,
        request_id: 'req_01',
        session: {
            session_id: 'session_api_01',
            role: 'admin',
        },
        actor: {
            service: 'api_gateway',
        },
        payload: {
            proposal: rootProposal(1),
        },
        ...overrides,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// direct mutation impossible: API handler only mutates history through kernel acceptance
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    let acceptCalls = 0;

    const response = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        submitRootRequest('api_cmd_root_01'),
        {
            ...apiContext(ledger, applyEvent),
            acceptRealmEvent: (proposal) => {
                acceptCalls += 1;
                return acceptRealmEventFor(ledger, applyEvent)(proposal);
            },
        },
        { executionStore },
    );

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 'accepted');
    assert.strictEqual(acceptCalls, 1);
    assert.strictEqual(ledger.event_log.length, 1);
}

// failed request isolation leaves history and projection unchanged
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    const beforeState = clone(ledger.current_authority_state);

    const response = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        submitRootRequest('api_cmd_root_failed', {
            payload: {
                proposal: rootProposal(2),
            },
        }),
        apiContext(ledger, applyEvent),
        { executionStore },
    );

    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.status, 'rejected');
    assert.ok(response.reason_codes.some((code) => code.startsWith('SEQUENCE_MISMATCH')));
    assert.strictEqual(ledger.event_log.length, 0);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// response representation is not authority: mutating API JSON does not mutate canonical state
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    const response = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        submitRootRequest('api_cmd_root_representation'),
        apiContext(ledger, applyEvent),
        { executionStore },
    );

    assert.strictEqual(response.ok, true);
    assert.ok(response.representation);
    assert.strictEqual(response.representation.rootAuthority.status, 'active');

    response.representation.rootAuthority.status = 'revoked';
    response.representation.devices = [{ id: 'injected_device', status: 'active' }];

    assert.strictEqual(ledger.current_authority_state.rootAuthority.status, 'active');
    assert.strictEqual(ledger.current_authority_state.devices.length, 0);
}

// session metadata does not grant authority
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const response = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        submitRootRequest('api_cmd_root_session_denied', {
            payload: {
                proposal: {
                    envelope: {
                        type: 'DEVICE_KEY_ISSUED',
                        signer: 'remote_admin',
                        authority_reference: ROOT_REF,
                        sequence: 2,
                        timestamp: TIMESTAMP,
                    },
                    payload: {
                        device_id: 'device_from_session',
                        public_key: 'pk_device',
                        authority_ref: 'device:device_from_session',
                    },
                },
            },
            session: {
                role: 'admin',
                is_root: true,
            },
        }),
        apiContext(ledger, applyEvent),
        { executionStore },
    );

    assert.strictEqual(response.ok, false);
    assert.ok(response.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// idempotency preserved through API boundary
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    let acceptCalls = 0;
    const context = {
        ...apiContext(ledger, applyEvent),
        acceptRealmEvent: (proposal) => {
            acceptCalls += 1;
            return acceptRealmEventFor(ledger, applyEvent)(proposal);
        },
    };
    const request = submitRootRequest('api_cmd_root_idempotent');

    const first = handleApiRequest(API_ROUTES.SUBMIT_REALM_EVENT, request, context, { executionStore });
    const second = handleApiRequest(API_ROUTES.SUBMIT_REALM_EVENT, request, context, { executionStore });

    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.status, 'accepted');
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.status, 'already_executed');
    assert.strictEqual(second.idempotent_replay, true);
    assert.deepStrictEqual(second.accepted_event_ids, first.accepted_event_ids);
    assert.strictEqual(acceptCalls, 1);
    assert.strictEqual(ledger.event_log.length, 1);
}

// unsupported route and invalid shape are rejected before command execution
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);

    const unsupported = handleApiRequest(
        'POST /realm/unknown',
        submitRootRequest('api_cmd_unknown'),
        apiContext(ledger, applyEvent),
    );
    assert.strictEqual(unsupported.ok, false);
    assert.ok(unsupported.reason_codes.includes('API_ROUTE_UNSUPPORTED'));

    const invalid = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        'not-an-object',
        apiContext(ledger, applyEvent),
    );
    assert.strictEqual(invalid.ok, false);
    assert.ok(invalid.reason_codes.includes('API_REQUEST_INVALID'));

    const missingCommandId = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        {
            payload: {
                proposal: rootProposal(1),
            },
        },
        apiContext(ledger, applyEvent),
    );
    assert.strictEqual(missingCommandId.ok, false);
    assert.ok(missingCommandId.reason_codes.includes('API_COMMAND_ID_REQUIRED'));
    assert.strictEqual(ledger.event_log.length, 0);
}

// API adapter routes into existing command types without custom authority logic
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    const response = handleApiRequest(
        API_ROUTES.SUBMIT_REALM_EVENT,
        submitRootRequest('api_cmd_route_mapping'),
        apiContext(ledger, applyEvent),
        { executionStore },
    );

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.command_id, 'api_cmd_route_mapping');
    assert.notStrictEqual(COMMAND_TYPES.SUBMIT_REALM_EVENT, undefined);
}

console.log('test-realm-api-adapter-runtime: all tests passed');
