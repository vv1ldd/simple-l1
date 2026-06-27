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
const {
    createCommandExecutionStore,
    executeCommand,
} = require('../realm-command-execution');

const ROOT_REF = 'root_authority_ref';
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
            root_id: 'root_01',
            public_key: 'pk_root',
        },
    };
}

function submitRootCommand(commandId) {
    return {
        command_id: commandId,
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(1),
        },
        actor: {
            service: 'bootstrap',
        },
    };
}

// same command_id twice returns previous result without mutating canonical history
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    let acceptCalls = 0;

    const context = {
        acceptRealmEvent: (proposal) => {
            acceptCalls += 1;
            return acceptRealmEventFor(ledger, applyEvent)(proposal);
        },
    };

    const first = executeCommand(submitRootCommand('cmd_root_01'), context, { executionStore });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.idempotent_replay, false);
    assert.strictEqual(first.accepted_event_ids.length, 1);
    assert.strictEqual(ledger.event_log.length, 1);

    const second = executeCommand(submitRootCommand('cmd_root_01'), context, { executionStore });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.idempotent_replay, true);
    assert.deepStrictEqual(second.accepted_event_ids, first.accepted_event_ids);
    assert.strictEqual(acceptCalls, 1);
    assert.strictEqual(ledger.event_log.length, 1);
}

// different command_id with same payload is a new intent, not a cached replay
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    let acceptCalls = 0;

    const context = {
        acceptRealmEvent: (proposal) => {
            acceptCalls += 1;
            return acceptRealmEventFor(ledger, applyEvent)(proposal);
        },
    };

    const first = executeCommand(submitRootCommand('cmd_root_a'), context, { executionStore });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.idempotent_replay, false);

    const second = executeCommand(submitRootCommand('cmd_root_b'), context, { executionStore });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.idempotent_replay, false);
    assert.ok(second.reason_codes.some((code) => code.startsWith('SEQUENCE_MISMATCH')));
    assert.strictEqual(acceptCalls, 2);
    assert.strictEqual(ledger.event_log.length, 1);
}

// same command_id with different intent is rejected
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    const context = {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    };

    const first = executeCommand(submitRootCommand('cmd_root_conflict'), context, { executionStore });
    assert.strictEqual(first.ok, true);

    const conflicting = {
        command_id: 'cmd_root_conflict',
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(2),
        },
        actor: {
            service: 'bootstrap',
        },
    };

    const second = executeCommand(conflicting, context, { executionStore });
    assert.strictEqual(second.ok, false);
    assert.ok(second.reason_codes.includes('COMMAND_ID_INTENT_MISMATCH'));
    assert.strictEqual(ledger.event_log.length, 1);
}

// failed command execution is cached operationally and does not mutate history on retry
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    let acceptCalls = 0;

    const context = {
        acceptRealmEvent: (proposal) => {
            acceptCalls += 1;
            return acceptRealmEventFor(ledger, applyEvent)(proposal);
        },
    };

    const failedCommand = {
        command_id: 'cmd_root_failed',
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(2),
        },
        actor: {
            service: 'bootstrap',
        },
    };

    const first = executeCommand(failedCommand, context, { executionStore });
    assert.strictEqual(first.ok, false);
    assert.strictEqual(first.accepted_event_ids.length, 0);
    assert.strictEqual(ledger.event_log.length, 0);

    const second = executeCommand(failedCommand, context, { executionStore });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.idempotent_replay, true);
    assert.strictEqual(acceptCalls, 1);
    assert.strictEqual(ledger.event_log.length, 0);
}

// command execution records are operational cache, not canonical history
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    executeCommand(submitRootCommand('cmd_operational_only'), {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    }, { executionStore });

    assert.strictEqual(executionStore.has('cmd_operational_only'), true);
    assert.strictEqual(Array.isArray(ledger.event_log), true);
    assert.strictEqual('command_execution_store' in ledger, false);
}

console.log('test-realm-command-execution-runtime: all tests passed');
