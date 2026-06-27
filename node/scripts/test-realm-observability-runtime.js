'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    rebuildAuthorityStateOnLedger,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { validateRealmEventProposal } = require('../realm-event-validator');
const { createCommandExecutionStore, executeCommand } = require('../realm-command-execution');
const { COMMAND_TYPES } = require('../realm-command-runtime');
const {
    buildEventTrace,
    calculateProjectionHash,
    explainAuthorityForSubject,
    explainCommandExecution,
    explainCurrentAuthorityState,
    explainEventCausality,
    explainRejection,
} = require('../realm-observability');
const {
    createRecoveryCeremonyProposals,
    executeRecoveryCeremony,
} = require('../recovery-ceremony-runtime');

const ROOT_REF = 'obs_root_ref';
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
            root_id: 'obs_root',
            public_key: 'pk_obs_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_obs') {
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

function recoveryAuthorityIssueProposal(sequence, recoveryId = 'recovery_obs') {
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
            public_key: 'pk_recovery',
            authority_ref: `recovery:${recoveryId}`,
        },
    };
}

function buildRecoveryLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(recoveryAuthorityIssueProposal(2)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(3, 'device_old')).ok, true);

    executeRecoveryCeremony({
        recoveryAuthority: ledger.current_authority_state.recoveryAuthorities[0],
        oldDevice: ledger.current_authority_state.devices.find((device) => device.id === 'device_old'),
        newDevice: {
            id: 'device_new',
            public_key: 'pk_device_new',
            authorityRef: 'device:device_new',
        },
        recoveryRef: 'recovery_case_obs',
        startSequence: 4,
        timestamp: TIMESTAMP,
    }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    return ledger;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// explanation is generated from history/projection only
{
    const ledger = buildRecoveryLedger();
    const explanation = explainCurrentAuthorityState(ledger);
    const deviceExplanation = explainAuthorityForSubject(ledger, 'device:device_new');

    assert.strictEqual(explanation.derivation_source.event_history, true);
    assert.strictEqual(explanation.derivation_source.projection, true);
    assert.strictEqual(explanation.derived_from.length, ledger.event_log.length);
    assert.strictEqual(explanation.history_head, ledger.event_log[ledger.event_log.length - 1].current_event_hash);
    assert.strictEqual(explanation.projection_hash, calculateProjectionHash(ledger.current_authority_state));

    assert.strictEqual(deviceExplanation.status, 'active');
    assert.ok(deviceExplanation.derived_from.some((entry) => entry.type === 'DEVICE_KEY_ISSUED'));
    assert.ok(deviceExplanation.derived_from.some((entry) => entry.type === 'RECOVERY_EXECUTED'));
    assert.match(deviceExplanation.summary, /active because DEVICE_KEY_ISSUED was accepted/);
}

// deleting observability artifacts does not change canonical truth
{
    const ledger = buildRecoveryLedger();
    const projectionA = clone(ledger.current_authority_state);

    let explanation = explainCurrentAuthorityState(ledger);
    explanation = null;

    rebuildAuthorityStateOnLedger(ledger);
    const projectionB = clone(ledger.current_authority_state);

    assert.deepStrictEqual(projectionB, projectionA);
}

// explanation cannot be imported as state
{
    const ledger = buildRecoveryLedger();
    const explanation = explainAuthorityForSubject(ledger, 'device:device_new');
    const beforeState = clone(ledger.current_authority_state);

    explanation.status = 'revoked';
    explanation.derived_from.push({
        event_id: 'fabricated_event',
        type: 'DEVICE_KEY_REVOKED',
        sequence: 999,
    });

    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
    assert.strictEqual(ledger.current_authority_state.devices.find((device) => device.id === 'device_new').status, 'active');
}

// same event history produces same explanation
{
    const ledger = buildRecoveryLedger();
    const first = explainCurrentAuthorityState(ledger);
    const second = explainCurrentAuthorityState({
        event_log: clone(ledger.event_log),
        current_authority_state: clone(ledger.current_authority_state),
    });

    assert.deepStrictEqual(second.derived_from, first.derived_from);
    assert.strictEqual(second.projection_hash, first.projection_hash);
    assert.strictEqual(second.history_head, first.history_head);
    assert.deepStrictEqual(buildEventTrace(ledger.event_log), first.derived_from);
}

// rejection explanation preserves validator reason codes
{
    const ledger = buildRecoveryLedger();
    const rejected = validateRealmEventProposal(ledger, {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: 'unauthorized_signer',
            authority_reference: ROOT_REF,
            sequence: 7,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: 'device_blocked',
            public_key: 'pk_blocked',
            authority_ref: 'device:device_blocked',
        },
    });

    const explanation = explainRejection(rejected, { ledger });
    assert.strictEqual(explanation.ok, false);
    assert.deepStrictEqual(explanation.reason_codes, rejected.reason_codes);
    assert.ok(explanation.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.strictEqual(explanation.explanation.derived_from.validator, 'validateRealmEventProposal');
}

// command lineage references execution records, not canonical history
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    executeCommand({
        command_id: 'obs_cmd_root',
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(1),
        },
    }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    }, { executionStore });

    const lineage = explainCommandExecution('obs_cmd_root', executionStore);
    assert.strictEqual(lineage.ok, true);
    assert.strictEqual(lineage.derivation_source.command_execution_store, true);
    assert.strictEqual(lineage.accepted_event_ids.length, 1);
    assert.strictEqual(lineage.accepted_event_ids[0], ledger.event_log[0].event_id);

    executionStore.set('obs_cmd_root', null);
    const missing = explainCommandExecution('obs_cmd_root', executionStore);
    assert.strictEqual(missing.ok, false);
    assert.ok(missing.reason_codes.includes('COMMAND_EXECUTION_NOT_FOUND'));
    assert.strictEqual(ledger.event_log.length, 1);
}

// corrupted observability input is ignored and rebuilt from history
{
    const ledger = buildRecoveryLedger();
    const eventId = ledger.event_log[ledger.event_log.length - 1].event_id;
    const valid = explainEventCausality(ledger, eventId);

    const corrupted = explainEventCausality(ledger, 'nonexistent_event');
    assert.strictEqual(corrupted.ok, false);
    assert.ok(corrupted.reason_codes.includes('OBSERVABILITY_EVENT_NOT_FOUND'));

    const rebuilt = explainEventCausality(ledger, eventId);
    assert.deepStrictEqual(rebuilt, valid);
}

console.log('test-realm-observability-runtime: all tests passed');
