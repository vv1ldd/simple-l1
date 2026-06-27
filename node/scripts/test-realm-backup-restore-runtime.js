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
const { createRealmSnapshot } = require('../realm-snapshot');
const { deriveRealmLifecycleState } = require('../realm-lifecycle');
const { verifyRealmIntegrity } = require('../realm-integrity-check');
const { calculateProjectionHash } = require('../realm-observability');
const {
    compareRestoredIntegrity,
    createBackupArtifact,
    restoreRealmFromBackup,
    verifyBackupArtifact,
} = require('../realm-backup-restore');

const ROOT_REF = 'backup_root_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

function createTestLedger() {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: 'test-root',
        realm_id: 'realm_backup_01',
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
            root_id: 'backup_root',
            public_key: 'pk_backup_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_backup') {
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

function cleanIntegrityReport(ledger) {
    return {
        ...verifyRealmIntegrity(ledger, {
            executionStore: { list: () => [] },
        }),
        warnings: [],
        operational: {
            federation_references: 'ok',
            command_lineage: 'ok',
        },
        checks: verifyRealmIntegrity(ledger, {
            executionStore: { list: () => [] },
        }).checks.map((check) =>
            check.name === 'COMMAND_LINEAGE_OK'
                ? { name: 'COMMAND_LINEAGE_OK', status: 'pass' }
                : check
        ),
    };
}

// full backup restore preserves history and projection
{
    const ledger = buildValidLedger();
    const backup = createBackupArtifact(ledger, { includeSnapshot: true });
    const restored = restoreRealmFromBackup(backup, {
        executionStore: { list: () => [] },
    });

    assert.strictEqual(restored.ok, true);
    assert.deepStrictEqual(restored.ledger.event_log, backup.history);
    assert.deepStrictEqual(
        restored.ledger.current_authority_state,
        ledger.current_authority_state,
    );

    const comparison = compareRestoredIntegrity(ledger, restored, backup);
    assert.strictEqual(comparison.ok, true);
    assert.strictEqual(comparison.history_head_match, true);
    assert.strictEqual(comparison.projection_hash_match, true);
}

// corrupted backup is rejected without creating a valid restored realm
{
    const ledger = buildValidLedger();
    const backup = createBackupArtifact(ledger);
    backup.history[1].payload.device_id = 'tampered_device';

    const verification = verifyBackupArtifact(backup);
    assert.strictEqual(verification.ok, false);
    assert.ok(verification.reason_codes.some((code) => code.includes('REALM_EVENT_HASH_MISMATCH')));

    const restored = restoreRealmFromBackup(backup);
    assert.strictEqual(restored.ok, false);
    assert.ok(restored.reason_codes.some((code) => code.includes('REALM_EVENT_HASH_MISMATCH')));
}

// projection-only backup is rejected as canonical restore source
{
    const ledger = buildValidLedger();
    const rejected = verifyBackupArtifact({
        current_authority_state: clone(ledger.current_authority_state),
    });

    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('CANONICAL_HISTORY_REQUIRED'));
}

// snapshot-only backup is cache evidence, not restore source
{
    const ledger = buildValidLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    const verification = verifyBackupArtifact({ optional_snapshot: snapshot });
    assert.strictEqual(verification.ok, true);
    assert.strictEqual(verification.cache_only, true);
    assert.ok(verification.reason_codes.includes('BACKUP_SNAPSHOT_CACHE_ONLY'));

    const restored = restoreRealmFromBackup({ optional_snapshot: snapshot });
    assert.strictEqual(restored.ok, false);
    assert.ok(restored.reason_codes.includes('SNAPSHOT_NOT_RESTORE_SOURCE'));
}

// deleting optional snapshot from backup does not change restored realm identity
{
    const ledger = buildValidLedger();
    const backup = createBackupArtifact(ledger, { includeSnapshot: true });
    delete backup.optional_snapshot;

    const restored = restoreRealmFromBackup(backup, {
        executionStore: { list: () => [] },
    });
    assert.strictEqual(restored.ok, true);

    const comparison = compareRestoredIntegrity(ledger, restored, backup);
    assert.strictEqual(comparison.ok, true);
}

// same verified history produces same head, projection hash, and lifecycle
{
    const ledger = buildValidLedger();
    const backup = createBackupArtifact(ledger);
    const restored = restoreRealmFromBackup(backup, {
        executionStore: { list: () => [] },
    });

    const originalIntegrity = cleanIntegrityReport(ledger);
    const restoredIntegrity = cleanIntegrityReport(restored.ledger);
    const originalLifecycle = deriveRealmLifecycleState(originalIntegrity);
    const restoredLifecycle = deriveRealmLifecycleState(restoredIntegrity);

    assert.strictEqual(restored.integrity.history_head, originalIntegrity.history_head);
    assert.strictEqual(restored.integrity.projection_hash, originalIntegrity.projection_hash);
    assert.strictEqual(
        calculateProjectionHash(restored.ledger.current_authority_state),
        calculateProjectionHash(ledger.current_authority_state),
    );
    assert.strictEqual(restoredLifecycle.state, originalLifecycle.state);
}

console.log('test-realm-backup-restore-runtime: all tests passed');
