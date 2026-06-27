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
const { createCommandExecutionStore, executeCommand } = require('../realm-command-execution');
const { COMMAND_TYPES } = require('../realm-command-runtime');
const { createRealmSnapshot } = require('../realm-snapshot');
const { verifyRealmIntegrity } = require('../realm-integrity-check');

const ROOT_REF = 'integrity_root_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';
const REMOTE_REALM_ID = 'remote_realm_integrity';

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
            root_id: 'integrity_root',
            public_key: 'pk_integrity_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_integrity') {
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

function federationTrustProposal(sequence, remoteHead) {
    return {
        envelope: {
            type: 'FEDERATION_TRUST_ESTABLISHED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            remote_realm_id: REMOTE_REALM_ID,
            trusted_root_authority: 'remote_root',
            allowed_claim_scopes: ['email'],
            trust_scope: 'identity_claims',
            policy_id: 'policy_integrity',
            remote_event_head: remoteHead,
        },
    };
}

function buildValidLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(federationTrustProposal(3, 'remote_head_hash')).ok, true);
    return ledger;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function comparableReport(report) {
    const next = clone(report);
    delete next.verified_at;
    return next;
}

// valid realm produces passing integrity report
{
    const ledger = buildValidLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    const report = verifyRealmIntegrity(ledger, {
        snapshot,
        remoteEvidenceHeads: {
            [REMOTE_REALM_ID]: 'remote_head_hash',
        },
    });

    assert.strictEqual(report.realm_valid, true);
    assert.strictEqual(report.canonical.history, 'ok');
    assert.strictEqual(report.canonical.projection_replay, 'ok');
    assert.strictEqual(report.derived.snapshot, 'ok');
    assert.strictEqual(report.operational.federation_references, 'ok');
    assert.ok(report.history_head);
    assert.ok(report.projection_hash);
}

// corrupted event N fails verification without mutating projection
{
    const ledger = buildValidLedger();
    const beforeState = clone(ledger.current_authority_state);
    const beforeLog = clone(ledger.event_log);

    ledger.event_log[1].payload.device_id = 'tampered_device';

    const report = verifyRealmIntegrity(ledger);
    assert.strictEqual(report.realm_valid, false);
    assert.ok(report.failures.some((code) => code.includes('REALM_EVENT_HASH_MISMATCH')));
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
    assert.notDeepStrictEqual(ledger.event_log, beforeLog);
}

// substituted CurrentAuthorityState fails projection replay check
{
    const ledger = buildValidLedger();
    const beforeLog = clone(ledger.event_log);

    ledger.current_authority_state.devices[0].status = 'revoked';

    const report = verifyRealmIntegrity(ledger);
    assert.strictEqual(report.realm_valid, false);
    assert.ok(report.failures.includes('PROJECTION_REPLAY_MISMATCH'));
    assert.strictEqual(report.canonical.projection_replay, 'fail');
    assert.deepStrictEqual(ledger.event_log, beforeLog);
}

// deleting snapshot does not invalidate canonical integrity
{
    const ledger = buildValidLedger();
    const report = verifyRealmIntegrity(ledger, { snapshot: null });
    assert.strictEqual(report.realm_valid, true);
    assert.strictEqual(report.derived.snapshot, 'skip');
}

// missing command execution cache is operational warning, not canonical failure
{
    const ledger = buildValidLedger();
    const report = verifyRealmIntegrity(ledger);
    assert.strictEqual(report.realm_valid, true);
    assert.strictEqual(report.operational.command_lineage, 'warning');
    assert.ok(report.warnings.includes('COMMAND_EXECUTION_RECORD_MISSING'));
}

// command execution record referencing missing accepted event fails lineage check
{
    const ledger = buildValidLedger();
    const executionStore = createCommandExecutionStore();
    executionStore.set('cmd_invalid_ref', {
        command_id: 'cmd_invalid_ref',
        accepted_event_ids: ['missing_event_id'],
        execution_result: { ok: true },
        intent_fingerprint: 'abc',
        recorded_at: TIMESTAMP,
    });

    const report = verifyRealmIntegrity(ledger, {
        executionStore,
        commandIds: ['cmd_invalid_ref'],
    });

    assert.strictEqual(report.realm_valid, false);
    assert.ok(report.failures.includes('COMMAND_EXECUTION_REFERENCE_INVALID'));
}

// valid command execution lineage passes without mutating canonical history
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();

    executeCommand({
        command_id: 'cmd_integrity_root',
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(1),
        },
    }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    }, { executionStore });

    const beforeLog = clone(ledger.event_log);
    const report = verifyRealmIntegrity(ledger, {
        executionStore,
        commandIds: ['cmd_integrity_root'],
    });

    assert.strictEqual(report.realm_valid, true);
    assert.strictEqual(report.operational.command_lineage, 'ok');
    assert.deepStrictEqual(ledger.event_log, beforeLog);
}

// same event history produces same integrity evidence
{
    const ledger = buildValidLedger();
    const first = comparableReport(verifyRealmIntegrity(ledger));
    const second = comparableReport(verifyRealmIntegrity({
        event_log: clone(ledger.event_log),
        current_authority_state: clone(ledger.current_authority_state),
    }));

    assert.deepStrictEqual(second, first);
}

console.log('test-realm-integrity-check-runtime: all tests passed');
