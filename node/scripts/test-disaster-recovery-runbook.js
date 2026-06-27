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
const { LIFECYCLE_STATES, deriveRealmLifecycleState } = require('../realm-lifecycle');
const { calculateProjectionHash } = require('../realm-observability');
const {
    compareRestoredIntegrity,
    createBackupArtifact,
    restoreRealmFromBackup,
    verifyBackupArtifact,
} = require('../realm-backup-restore');

const ROOT_REF = 'dr_runbook_root_ref';
const OPERATOR_REF = 'operator_console';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

const DR_PROCEDURE_STATES = Object.freeze({
    INCIDENT_DETECTED: 'INCIDENT_DETECTED',
    BACKUP_LOCATED: 'BACKUP_LOCATED',
    BACKUP_VERIFIED: 'BACKUP_VERIFIED',
    REALM_REPLAYED: 'REALM_REPLAYED',
    INTEGRITY_CONFIRMED: 'INTEGRITY_CONFIRMED',
    OPERATIONS_RESUMED: 'OPERATIONS_RESUMED',
});

function createTestLedger() {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: 'test-root',
        realm_id: 'realm_dr_runbook_01',
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
            root_id: 'dr_runbook_root',
            public_key: 'pk_dr_runbook_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_dr_runbook') {
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

function buildSourceRealm() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
    return ledger;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function cleanIntegrityReport(ledger, options = {}) {
    const report = verifyRealmIntegrity(ledger, {
        executionStore: options.executionStore || { list: () => [] },
        snapshot: options.snapshot,
    });
    return {
        ...report,
        realm_valid: true,
        warnings: [],
        operational: {
            federation_references: 'ok',
            command_lineage: 'ok',
        },
        checks: report.checks.map((check) =>
            check.name === 'COMMAND_LINEAGE_OK'
                ? { name: 'COMMAND_LINEAGE_OK', status: 'pass' }
                : check
        ),
    };
}

function hasHashMismatchCode(reasonCodes = []) {
    return reasonCodes.some((code) => String(code).includes('HASH_MISMATCH'));
}

function executeDisasterRecoveryRunbook(backup, options = {}) {
    const trace = [DR_PROCEDURE_STATES.INCIDENT_DETECTED];

    if (!backup || typeof backup !== 'object') {
        return {
            ok: false,
            procedure_state: DR_PROCEDURE_STATES.INCIDENT_DETECTED,
            operations_resumed: false,
            trace,
            reason_codes: ['BACKUP_ARTIFACT_INVALID'],
        };
    }

    trace.push(DR_PROCEDURE_STATES.BACKUP_LOCATED);

    const verification = verifyBackupArtifact(backup);
    if (!verification.ok) {
        return {
            ok: false,
            procedure_state: DR_PROCEDURE_STATES.BACKUP_LOCATED,
            operations_resumed: false,
            trace,
            verification,
            reason_codes: verification.reason_codes || [],
        };
    }

    trace.push(DR_PROCEDURE_STATES.BACKUP_VERIFIED);

    const restored = restoreRealmFromBackup(backup, options);
    if (!restored.ok) {
        return {
            ok: false,
            procedure_state: DR_PROCEDURE_STATES.BACKUP_VERIFIED,
            operations_resumed: false,
            trace,
            verification,
            restored,
            reason_codes: restored.reason_codes || [],
        };
    }

    trace.push(DR_PROCEDURE_STATES.REALM_REPLAYED);

    if (!restored.integrity?.realm_valid) {
        return {
            ok: false,
            procedure_state: DR_PROCEDURE_STATES.REALM_REPLAYED,
            operations_resumed: false,
            trace,
            verification,
            restored,
            reason_codes: restored.integrity?.failures || ['RESTORE_INTEGRITY_FAILED'],
        };
    }

    trace.push(DR_PROCEDURE_STATES.INTEGRITY_CONFIRMED);

    const operationsResumed = restored.lifecycle?.state === LIFECYCLE_STATES.VERIFIED;
    if (operationsResumed) {
        trace.push(DR_PROCEDURE_STATES.OPERATIONS_RESUMED);
    }

    return {
        ok: true,
        procedure_state: operationsResumed
            ? DR_PROCEDURE_STATES.OPERATIONS_RESUMED
            : DR_PROCEDURE_STATES.INTEGRITY_CONFIRMED,
        operations_resumed: operationsResumed,
        trace,
        verification,
        restored,
    };
}

function executionStoreForLedger(ledger) {
    return {
        list: () => ledger.event_log.map((event) => ({
            command_id: `cmd_${event.sequence}`,
            event_id: event.event_id || event.id,
        })),
    };
}

function simulateOperatorAuthorityAttempt(ledger, proposal) {
    const beforeLogLength = ledger.event_log.length;
    const rejected = validateRealmEventProposal(ledger, proposal);
    assert.strictEqual(ledger.event_log.length, beforeLogLength);
    return rejected;
}

// 1. full restore ceremony preserves history head, projection hash, and lifecycle
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source, { includeSnapshot: true });
    const runbook = executeDisasterRecoveryRunbook(backup, {
        executionStore: executionStoreForLedger(source),
    });

    assert.strictEqual(runbook.ok, true);
    assert.strictEqual(runbook.procedure_state, DR_PROCEDURE_STATES.OPERATIONS_RESUMED);
    assert.strictEqual(runbook.operations_resumed, true);

    const sourceIntegrity = cleanIntegrityReport(source);
    const sourceLifecycle = deriveRealmLifecycleState(sourceIntegrity);
    const comparison = compareRestoredIntegrity(source, runbook.restored, backup);

    assert.strictEqual(comparison.history_head_match, true);
    assert.strictEqual(comparison.projection_hash_match, true);
    assert.strictEqual(runbook.restored.history_head, sourceIntegrity.history_head);
    assert.strictEqual(runbook.restored.projection_hash, sourceIntegrity.projection_hash);
    assert.strictEqual(
        calculateProjectionHash(runbook.restored.ledger.current_authority_state),
        calculateProjectionHash(source.current_authority_state),
    );
    assert.strictEqual(runbook.restored.lifecycle.state, sourceLifecycle.state);
    assert.strictEqual(runbook.restored.integrity.realm_valid, true);
}

// 2. double restore determinism from the same backup
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source);

    const runbookA = executeDisasterRecoveryRunbook(clone(backup), {
        executionStore: { list: () => [] },
    });
    const runbookB = executeDisasterRecoveryRunbook(clone(backup), {
        executionStore: { list: () => [] },
    });

    assert.strictEqual(runbookA.ok, true);
    assert.strictEqual(runbookB.ok, true);
    assert.strictEqual(
        runbookA.restored.history_head,
        runbookB.restored.history_head,
    );
    assert.strictEqual(
        runbookA.restored.projection_hash,
        runbookB.restored.projection_hash,
    );
    assert.strictEqual(
        runbookA.restored.lifecycle.state,
        runbookB.restored.lifecycle.state,
    );
}

// 3. operator can initiate recovery but cannot become authority
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source);
    const runbook = executeDisasterRecoveryRunbook(backup, {
        executionStore: { list: () => [] },
    });
    assert.strictEqual(runbook.ok, true);

    const rejected = simulateOperatorAuthorityAttempt(
        runbook.restored.ledger,
        rootProposal(3, OPERATOR_REF),
    );
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// 4. projection-only disaster artifact cannot start canonical restore
{
    const runbook = executeDisasterRecoveryRunbook({
        CurrentAuthorityState: {},
    });

    assert.strictEqual(runbook.ok, false);
    assert.ok(runbook.reason_codes.includes('CANONICAL_HISTORY_REQUIRED'));
    assert.strictEqual(runbook.operations_resumed, false);
    assert.ok(!runbook.trace.includes(DR_PROCEDURE_STATES.OPERATIONS_RESUMED));
}

// 5. corrupted backup fails closed without ledger mutation or lifecycle resume
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source);
    backup.history[1].payload.modified = true;

    const verification = verifyBackupArtifact(backup);
    assert.strictEqual(verification.ok, false);
    assert.ok(hasHashMismatchCode(verification.reason_codes));

    const runbook = executeDisasterRecoveryRunbook(backup);
    assert.strictEqual(runbook.ok, false);
    assert.ok(hasHashMismatchCode(runbook.reason_codes));
    assert.strictEqual(runbook.operations_resumed, false);
    assert.strictEqual(runbook.restored, undefined);
    assert.ok(!runbook.trace.includes(DR_PROCEDURE_STATES.REALM_REPLAYED));
    assert.ok(!runbook.trace.includes(DR_PROCEDURE_STATES.OPERATIONS_RESUMED));
}

// 6. partial operational loss keeps canonical continuity and degrades operationally
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source, { includeSnapshot: true });
    delete backup.optional_snapshot;
    delete backup.observability;
    delete backup.command_execution_cache;

    const runbook = executeDisasterRecoveryRunbook(backup, {
        executionStore: { list: () => [] },
    });

    assert.strictEqual(runbook.ok, true);
    assert.strictEqual(runbook.restored.integrity.realm_valid, true);
    assert.strictEqual(runbook.restored.integrity.canonical.history, 'ok');
    assert.strictEqual(runbook.restored.integrity.canonical.projection_replay, 'ok');
    assert.strictEqual(runbook.restored.lifecycle.state, LIFECYCLE_STATES.DEGRADED);
    assert.ok(runbook.restored.integrity.warnings.length > 0);
    assert.strictEqual(runbook.operations_resumed, false);
}

// 7. recovery completion gate: restore complete does not imply operations resumed
{
    const source = buildSourceRealm();
    const backup = createBackupArtifact(source);

    const degradedRunbook = executeDisasterRecoveryRunbook(clone(backup), {
        executionStore: { list: () => [] },
    });
    assert.strictEqual(degradedRunbook.ok, true);
    assert.strictEqual(degradedRunbook.procedure_state, DR_PROCEDURE_STATES.INTEGRITY_CONFIRMED);
    assert.strictEqual(degradedRunbook.operations_resumed, false);
    assert.ok(degradedRunbook.trace.includes(DR_PROCEDURE_STATES.REALM_REPLAYED));
    assert.ok(!degradedRunbook.trace.includes(DR_PROCEDURE_STATES.OPERATIONS_RESUMED));

    const restoredOnly = restoreRealmFromBackup(clone(backup), {
        executionStore: { list: () => [] },
    });
    assert.strictEqual(restoredOnly.ok, true);
    assert.strictEqual(restoredOnly.integrity.realm_valid, true);
    assert.notStrictEqual(restoredOnly.lifecycle.state, LIFECYCLE_STATES.VERIFIED);

    const verifiedRunbook = executeDisasterRecoveryRunbook(clone(backup), {
        executionStore: executionStoreForLedger(source),
    });
    assert.strictEqual(verifiedRunbook.ok, true);
    assert.strictEqual(verifiedRunbook.restored.integrity.realm_valid, true);
    assert.strictEqual(verifiedRunbook.restored.lifecycle.state, LIFECYCLE_STATES.VERIFIED);
    assert.strictEqual(verifiedRunbook.procedure_state, DR_PROCEDURE_STATES.OPERATIONS_RESUMED);
    assert.strictEqual(verifiedRunbook.operations_resumed, true);
    assert.ok(verifiedRunbook.trace.includes(DR_PROCEDURE_STATES.OPERATIONS_RESUMED));
}

console.log('test-disaster-recovery-runbook: all tests passed');
