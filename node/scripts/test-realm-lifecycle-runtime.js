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
const { validateRealmEventProposal } = require('../realm-event-validator');
const { verifyRealmIntegrity } = require('../realm-integrity-check');
const {
    LIFECYCLE_STATES,
    OPERATIONS,
    canAcceptAuthorityMutations,
    canOperate,
    deriveRealmLifecycleState,
    explainLifecycleTransition,
    getLifecycleExplanation,
} = require('../realm-lifecycle');

const ROOT_REF = 'lifecycle_root_ref';
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
            root_id: 'lifecycle_root',
            public_key: 'pk_lifecycle_root',
        },
    };
}

function deviceIssueProposal(sequence, signer = ROOT_REF, deviceId = 'device_lifecycle') {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer,
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

function buildValidLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
    return ledger;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// no integrity report means bootstrapping, not trusted authority operation
{
    const lifecycle = deriveRealmLifecycleState(null);
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.BOOTSTRAPPING);
    assert.strictEqual(lifecycle.can_accept_commands, false);
    assert.strictEqual(canOperate(lifecycle, OPERATIONS.RUN_DIAGNOSTICS), true);
    assert.strictEqual(canOperate(lifecycle, OPERATIONS.ACCEPT_AUTHORITY_MUTATION), false);
}

// valid integrity with no warnings becomes verified
{
    const ledger = buildValidLedger();
    const report = verifyRealmIntegrity(ledger, {
        executionStore: {
            list: () => [],
        },
    });
    // Empty execution store reports a lineage warning; use a manual report to test clean VERIFIED mapping.
    const verifiedReport = {
        ...report,
        realm_valid: true,
        warnings: [],
        operational: {
            ...report.operational,
            command_lineage: 'ok',
        },
        checks: report.checks.map((check) =>
            check.name === 'COMMAND_LINEAGE_OK' ? { name: 'COMMAND_LINEAGE_OK', status: 'pass' } : check
        ),
    };

    const lifecycle = deriveRealmLifecycleState(verifiedReport);
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.VERIFIED);
    assert.strictEqual(lifecycle.can_accept_commands, true);
    assert.strictEqual(canAcceptAuthorityMutations(lifecycle), true);
}

// warning is degraded, not suspended
{
    const ledger = buildValidLedger();
    const report = verifyRealmIntegrity(ledger);
    const lifecycle = deriveRealmLifecycleState(report);

    assert.strictEqual(report.realm_valid, true);
    assert.ok(report.warnings.includes('COMMAND_EXECUTION_RECORD_MISSING'));
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.DEGRADED);
    assert.strictEqual(lifecycle.can_accept_commands, true);
    assert.strictEqual(canOperate(lifecycle, OPERATIONS.RUN_DIAGNOSTICS), true);
}

// corrupted history suspends without lifecycle repair
{
    const ledger = buildValidLedger();
    const beforeState = clone(ledger.current_authority_state);
    const beforeLogLength = ledger.event_log.length;

    ledger.event_log[1].payload.device_id = 'tampered_lifecycle_device';
    const report = verifyRealmIntegrity(ledger);
    const lifecycle = deriveRealmLifecycleState(report);

    assert.strictEqual(report.realm_valid, false);
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.SUSPENDED);
    assert.strictEqual(lifecycle.can_accept_commands, false);
    assert.strictEqual(canOperate(lifecycle, OPERATIONS.ACCEPT_AUTHORITY_MUTATION), false);
    assert.strictEqual(canOperate(lifecycle, OPERATIONS.RUN_DIAGNOSTICS), true);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
    assert.strictEqual(ledger.event_log.length, beforeLogLength);
}

// recovery evidence may put failed integrity into recovering, not verified
{
    const ledger = buildValidLedger();
    ledger.current_authority_state.devices[0].status = 'revoked';
    const report = verifyRealmIntegrity(ledger);
    const lifecycle = deriveRealmLifecycleState(report, { recoveryAuthorityValidated: true });

    assert.strictEqual(report.realm_valid, false);
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.RECOVERING);
    assert.strictEqual(lifecycle.can_accept_commands, true);
    assert.match(lifecycle.explanation, /recovery/i);
}

// lifecycle artifact deletion rebuilds same state from same integrity report
{
    const ledger = buildValidLedger();
    const report = verifyRealmIntegrity(ledger);
    const first = deriveRealmLifecycleState(report);
    let artifact = clone(first);
    artifact = null;
    const second = deriveRealmLifecycleState(report);

    assert.strictEqual(artifact, null);
    assert.deepStrictEqual(second, first);
}

// lifecycle status does not grant authority; validator still decides
{
    const ledger = buildValidLedger();
    const report = {
        realm_valid: true,
        failures: [],
        warnings: [],
        canonical: { history: 'ok', projection_replay: 'ok' },
        derived: { snapshot: 'ok' },
        operational: { command_lineage: 'ok' },
    };
    const lifecycle = deriveRealmLifecycleState(report);
    assert.strictEqual(lifecycle.state, LIFECYCLE_STATES.VERIFIED);

    const rejected = validateRealmEventProposal(ledger, deviceIssueProposal(3, 'fake_admin', 'device_fake'));
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.strictEqual(ledger.event_log.length, 2);
}

// lifecycle transition explanation is derived representation
{
    const previous = { state: LIFECYCLE_STATES.DEGRADED };
    const current = { state: LIFECYCLE_STATES.SUSPENDED };
    const transition = explainLifecycleTransition(previous, current, { failures: ['EVENT_HASH_MISMATCH'] });
    const explanation = getLifecycleExplanation(current, {
        realm_valid: false,
        failures: ['EVENT_HASH_MISMATCH'],
        warnings: [],
        canonical: { history: 'fail' },
    });

    assert.strictEqual(transition.previous_state, LIFECYCLE_STATES.DEGRADED);
    assert.strictEqual(transition.current_state, LIFECYCLE_STATES.SUSPENDED);
    assert.match(transition.explanation, /transitioned/);
    assert.strictEqual(explanation.state, LIFECYCLE_STATES.SUSPENDED);
    assert.match(explanation.explanation, /EVENT_HASH_MISMATCH/);
}

console.log('test-realm-lifecycle-runtime: all tests passed');
