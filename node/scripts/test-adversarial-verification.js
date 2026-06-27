'use strict';

const assert = require('assert');
const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { COMMAND_TYPES } = require('../realm-command-runtime');
const { createCommandExecutionStore, executeCommand } = require('../realm-command-execution');
const { createRealmSnapshot, verifyRealmSnapshot } = require('../realm-snapshot');
const { latestRealmEventHash } = require('../realm-event-history');
const { calculateProjectionHash } = require('../realm-observability');
const { receiveEventBatch } = require('../realm-replication-transport');
const { signDeviceProposal } = require('../device-event-submission-runtime');
const { verifyRealmIntegrity } = require('../realm-integrity-check');

const ROOT_REF = 'adversarial_root_ref';
const DEVICE_ID = 'device_adversarial';
const DEVICE_REF = `device:${DEVICE_ID}`;
const DEVICE_KEY = `pk_${DEVICE_ID}`;
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
            root_id: 'adversarial_root',
            public_key: 'pk_adversarial_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = DEVICE_ID) {
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

function recoveryAuthorityIssueProposal(sequence, signer = ROOT_REF) {
    return {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer,
            authority_reference: signer,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: 'recovery_from_stolen_device',
            public_key: 'pk_recovery_from_stolen_device',
            authority_ref: 'recovery:from_stolen_device',
        },
    };
}

function buildValidLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
    return { ledger, applyEvent };
}

function createSafeSdkFacade(context, executionStore = createCommandExecutionStore()) {
    return Object.freeze({
        createCommand(intent) {
            return {
                command_id: intent.command_id,
                type: intent.type,
                payload: intent.payload || {},
                actor: intent.actor || { sdk: 'safe_facade' },
                evidence: intent.evidence || {},
            };
        },
        submit(command) {
            return executeCommand(command, context, { executionStore });
        },
        observe() {
            return clone(context.ledger.current_authority_state);
        },
    });
}

function replayProjectionHash(eventLog) {
    return calculateProjectionHash(buildCurrentAuthorityState(eventLog));
}

function corruptedIndexReplayOrFallback(ledger, index) {
    const expectedCount = ledger.event_log.length;
    const indexLooksValid = index
        && Array.isArray(index.events)
        && index.events.length === expectedCount
        && index.history_head === latestRealmEventHash(index.events);

    const eventLog = indexLooksValid ? index.events : ledger.event_log;
    return {
        used_fallback: !indexLooksValid,
        projection: buildCurrentAuthorityState(eventLog),
        history_head: latestRealmEventHash(eventLog),
    };
}

// projection tampering is detected by replay and does not mutate history
{
    const { ledger } = buildValidLedger();
    const beforeLog = clone(ledger.event_log);

    ledger.current_authority_state.devices[0].status = 'revoked';

    const report = verifyRealmIntegrity(ledger);
    assert.strictEqual(report.realm_valid, false);
    assert.ok(report.failures.includes('PROJECTION_REPLAY_MISMATCH'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
}

// snapshot tampering is detected by snapshot verification
{
    const { ledger } = buildValidLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    snapshot.projection.devices[0].status = 'revoked';

    assert.throws(
        () => verifyRealmSnapshot(ledger, snapshot),
        /SNAPSHOT_PROJECTION_MISMATCH/,
    );
}

// compromised transport cannot import CurrentAuthorityState as accepted truth
{
    const { ledger, applyEvent } = buildValidLedger();
    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const result = receiveEventBatch({
        CurrentAuthorityState: {
            rootAuthority: { id: 'attacker_root', status: 'active' },
        },
        events: [],
        previous_event_hash: latestRealmEventHash(ledger.event_log),
        head_hash: latestRealmEventHash(ledger.event_log),
    }, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('TRANSPORT_STATE_IMPORT_FORBIDDEN'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// stolen device key with valid signature still cannot exceed history-derived scope
{
    const { ledger, applyEvent } = buildValidLedger();
    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const proposal = recoveryAuthorityIssueProposal(3, DEVICE_REF);
    const signature = signDeviceProposal(proposal, DEVICE_KEY);

    const result = executeCommand({
        command_id: 'cmd_stolen_device_scope',
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            signedProposal: {
                proposal,
                signature,
            },
        },
        actor: {
            attacker: 'stolen_device_key',
        },
    }, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// compromised SDK facade exposes no privileged write methods; submit still uses kernel
{
    const { ledger, applyEvent } = buildValidLedger();
    const context = {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    };
    const sdk = createSafeSdkFacade(context);
    const beforeLog = clone(ledger.event_log);

    assert.strictEqual(typeof sdk.writeState, 'undefined');
    assert.strictEqual(typeof sdk.forceAccept, 'undefined');
    assert.strictEqual(typeof sdk.replaceProjection, 'undefined');

    const command = sdk.createCommand({
        command_id: 'cmd_sdk_root_escalation',
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(3, 'sdk_attacker'),
        },
    });
    const result = sdk.submit(command);

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
}

// corrupted optimization index falls back to canonical full replay with same meaning
{
    const { ledger } = buildValidLedger();
    const canonicalProjectionHash = replayProjectionHash(ledger.event_log);
    const canonicalHistoryHead = latestRealmEventHash(ledger.event_log);

    const corruptedIndex = {
        history_head: 'attacker_head',
        events: [ledger.event_log[1]],
    };

    const result = corruptedIndexReplayOrFallback(ledger, corruptedIndex);
    assert.strictEqual(result.used_fallback, true);
    assert.strictEqual(result.history_head, canonicalHistoryHead);
    assert.strictEqual(calculateProjectionHash(result.projection), canonicalProjectionHash);
}

console.log('test-adversarial-verification: all tests passed');
