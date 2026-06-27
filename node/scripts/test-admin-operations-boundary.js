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
const {
    ADMIN_ACTIONS,
    attemptAdminEventAppend,
    attemptAdminProjectionMutation,
    buildAdminCommand,
    executeAdminRequest,
} = require('../realm-admin-operations');
const { COMMAND_TYPES } = require('../realm-command-runtime');
const { createCommandExecutionStore } = require('../realm-command-execution');

const ROOT_REF = 'admin_root_ref';
const ADMIN_REF = 'admin:operator_console';
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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function rootProposal(sequence = 1, signer = ROOT_REF) {
    return {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer,
            authority_reference: signer,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'admin_root',
            public_key: 'pk_admin_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_admin') {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: deviceId,
            public_key: `pk_${deviceId}`,
            authority_ref: `device:${deviceId}`,
        },
    };
}

function recoveryAuthorityIssueProposal(sequence, recoveryId = 'recovery_admin') {
    return {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: recoveryId,
            public_key: 'pk_recovery_admin',
            authority_ref: `recovery:${recoveryId}`,
        },
    };
}

function adminContext(ledger, applyEvent, overrides = {}) {
    let acceptCalls = 0;
    const acceptRealmEvent = (proposal) => {
        acceptCalls += 1;
        return acceptRealmEventFor(ledger, applyEvent)(proposal);
    };

    return {
        ledger,
        acceptRealmEvent,
        getAcceptCalls: () => acceptCalls,
        readRepresentation: (targetLedger) => clone(targetLedger.current_authority_state),
        ...overrides,
    };
}

function setupRootAndDevice(ledger, applyEvent) {
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
}

function adminRequest(commandId, requestedAction, payload = {}, evidence = {}) {
    return {
        command_id: commandId,
        requested_action: requestedAction,
        actor: {
            role: 'admin',
            id: ADMIN_REF,
        },
        payload,
        evidence,
    };
}

// admin valid command goes through executeCommand and kernel acceptance
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    const executionStore = createCommandExecutionStore();

    setupRootAndDevice(ledger, applyEvent);
    const beforeLength = ledger.event_log.length;

    const response = executeAdminRequest(
        adminRequest('cmd_admin_device_issue', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: deviceIssueProposal(3, 'device_from_admin'),
        }),
        context,
        { executionStore },
    );

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 'accepted');
    assert.strictEqual(response.accepted_event_ids.length, 1);
    assert.strictEqual(context.getAcceptCalls(), 1);
    assert.strictEqual(ledger.event_log.length, beforeLength + 1);
    assert.strictEqual(ledger.event_log[2].payload.device_id, 'device_from_admin');
    assert.strictEqual(response.audit.result, 'accepted');
}

// direct admin projection mutation is forbidden and leaves canonical state unchanged
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const rejected = attemptAdminProjectionMutation(ledger, {
        current_authority_state: {
            rootAuthority: {
                id: 'fake_root',
                status: 'active',
            },
        },
    });

    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('ADMIN_PROJECTION_MUTATION_FORBIDDEN'));
    assert.strictEqual(rejected.mutation_applied, false);
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// direct admin event append is forbidden and leaves canonical state unchanged
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const rejected = attemptAdminEventAppend(ledger, {
        type: 'ROOT_AUTHORITY_CREATED',
        sequence: 99,
        payload: { root_id: 'fake_root' },
    });

    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('ADMIN_EVENT_APPEND_FORBIDDEN'));
    assert.strictEqual(rejected.event_appended, false);
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// admin cannot self-escalate to root authority
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const response = executeAdminRequest(
        adminRequest('cmd_admin_root_escalation', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: rootProposal(3, ADMIN_REF),
        }),
        context,
    );

    assert.strictEqual(response.ok, false);
    assert.ok(response.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.strictEqual(response.accepted_event_ids.length, 0);
    assert.strictEqual(response.audit.result, 'rejected');
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// admin recovery request is rejected without corresponding authority transition
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const response = executeAdminRequest(
        adminRequest('cmd_admin_recovery_without_authority', ADMIN_ACTIONS.EXECUTE_RECOVERY, {
            recoveryAuthority: {
                authorityRef: 'admin:fake_recovery',
            },
            oldDevice: { id: 'device_admin', authorityRef: 'device:device_admin' },
            newDevice: {
                id: 'device_recovered',
                public_key: 'pk_device_recovered',
                authorityRef: 'device:device_recovered',
            },
            recoveryRef: 'admin_recovery_attempt',
            startSequence: 3,
            timestamp: TIMESTAMP,
        }),
        context,
    );

    assert.strictEqual(response.ok, false);
    assert.ok(response.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.strictEqual(response.accepted_event_ids.length, 0);
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// failed admin command leaves history and projection unchanged
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const response = executeAdminRequest(
        adminRequest('cmd_admin_failed_rotate', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: deviceIssueProposal(99, 'device_should_fail'),
        }),
        context,
    );

    assert.strictEqual(response.ok, false);
    assert.ok(response.reason_codes.some((code) => code.startsWith('SEQUENCE_MISMATCH')));
    assert.strictEqual(response.accepted_event_ids.length, 0);
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// retry same command_id returns cached execution without duplicate accepted events
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    const executionStore = createCommandExecutionStore();

    const response = executeAdminRequest(
        adminRequest('cmd_admin_bootstrap', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: rootProposal(1),
        }),
        context,
        { executionStore },
    );

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.idempotent_replay, false);
    assert.strictEqual(ledger.event_log.length, 1);

    const retry = executeAdminRequest(
        adminRequest('cmd_admin_bootstrap', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: rootProposal(1),
        }),
        context,
        { executionStore },
    );

    assert.strictEqual(retry.ok, true);
    assert.strictEqual(retry.idempotent_replay, true);
    assert.strictEqual(retry.status, 'already_executed');
    assert.deepStrictEqual(retry.accepted_event_ids, response.accepted_event_ids);
    assert.strictEqual(context.getAcceptCalls(), 1);
    assert.strictEqual(ledger.event_log.length, 1);
}

// same intent with different command_id is a new attempt, not replay
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    const executionStore = createCommandExecutionStore();

    const first = executeAdminRequest(
        adminRequest('cmd_admin_root_a', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: rootProposal(1),
        }),
        context,
        { executionStore },
    );
    assert.strictEqual(first.ok, true);

    const second = executeAdminRequest(
        adminRequest('cmd_admin_root_b', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal: rootProposal(1),
        }),
        context,
        { executionStore },
    );

    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.idempotent_replay, false);
    assert.ok(second.reason_codes.some((code) => code.startsWith('SEQUENCE_MISMATCH')));
    assert.strictEqual(context.getAcceptCalls(), 2);
    assert.strictEqual(ledger.event_log.length, 1);
}

// read-only admin query returns representation only
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const explain = executeAdminRequest(
        adminRequest('cmd_admin_explain', ADMIN_ACTIONS.EXPLAIN_REALM_STATE),
        context,
    );
    const inspect = executeAdminRequest(
        adminRequest('cmd_admin_inspect', ADMIN_ACTIONS.INSPECT_EVENT_HISTORY),
        context,
    );
    const verify = executeAdminRequest(
        adminRequest('cmd_admin_verify', ADMIN_ACTIONS.RUN_INTEGRITY_CHECK),
        context,
    );

    assert.strictEqual(explain.ok, true);
    assert.strictEqual(inspect.ok, true);
    assert.strictEqual(verify.ok, true);
    assert.strictEqual(explain.accepted_event_ids.length, 0);
    assert.strictEqual(inspect.accepted_event_ids.length, 0);
    assert.strictEqual(verify.accepted_event_ids.length, 0);
    assert.ok(explain.representation.summary);
    assert.strictEqual(inspect.representation.trace.length, 2);
    assert.strictEqual(verify.representation.realm_valid, true);
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
    assert.strictEqual(context.getAcceptCalls(), 0);
}

// admin cannot create recovery authority without corresponding authority transition
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const context = adminContext(ledger, applyEvent);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const proposal = recoveryAuthorityIssueProposal(3, 'recovery_from_admin');
    proposal.envelope.signer = ADMIN_REF;
    proposal.envelope.authority_reference = ADMIN_REF;

    const response = executeAdminRequest(
        adminRequest('cmd_admin_recovery_authority', ADMIN_ACTIONS.ROTATE_AUTHORITY, {
            proposal,
        }),
        context,
    );

    assert.strictEqual(response.ok, false);
    assert.ok(response.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// mutating admin actions always route through command types, never direct kernel bypass
{
    const mapped = {
        [ADMIN_ACTIONS.ROTATE_AUTHORITY]: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        [ADMIN_ACTIONS.EXECUTE_RECOVERY]: COMMAND_TYPES.EXECUTE_RECOVERY_CEREMONY,
        [ADMIN_ACTIONS.RECOGNIZE_REALM]: COMMAND_TYPES.RECOGNIZE_REMOTE_REALM,
        [ADMIN_ACTIONS.SUBMIT_DEVICE_EVENT]: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
    };

    for (const [action, expectedType] of Object.entries(mapped)) {
        const request = adminRequest(`cmd_map_${action}`, action, { marker: action });
        const normalized = {
            ok: true,
            command_id: request.command_id,
            requested_action: request.requested_action,
            actor: request.actor,
            payload: request.payload,
            evidence: request.evidence,
        };
        assert.strictEqual(buildAdminCommand(normalized).type, expectedType);
    }
}

console.log('test-admin-operations-boundary: all tests passed');
