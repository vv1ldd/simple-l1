'use strict';

const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    rebuildAuthorityStateOnLedger,
} = require('./current-authority-state');
const { latestRealmEventHash, verifyRealmEventHistory } = require('./realm-event-history');
const { verifyRealmIntegrity } = require('./realm-integrity-check');
const { deriveRealmLifecycleState } = require('./realm-lifecycle');
const { calculateProjectionHash } = require('./realm-observability');
const { createRealmSnapshot, verifyRealmSnapshot } = require('./realm-snapshot');

const SUPPORTED_REGISTRY_VERSION = 1;
const SUPPORTED_PROJECTION_VERSION = 1;
const SUPPORTED_RUNTIME_VERSION = '1';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function backupFailure(code, details = {}) {
    return {
        ok: false,
        reason_codes: [code],
        ...details,
    };
}

function historyFromBackup(backup = {}) {
    if (Array.isArray(backup.history)) return backup.history;
    if (Array.isArray(backup.event_log)) return backup.event_log;
    return null;
}

function optionalSnapshotFromBackup(backup = {}) {
    return backup.optional_snapshot
        || backup.snapshot
        || backup.optional?.snapshot
        || null;
}

function createEmptyLedger(options = {}) {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: options.state_root || 'restored-root',
        realm_id: options.realm_id || null,
    };
    ensureAuthorityStateStores(ledger);
    return ledger;
}

function createBackupArtifact(source = {}, options = {}) {
    const ledger = source.event_log ? source : { event_log: source.history || [] };
    const eventLog = clone(ledger.event_log || []);
    verifyRealmEventHistory(eventLog);

    const backup = {
        realm_id: options.realmId || options.realm_id || ledger.realm_id || null,
        history: eventLog,
        history_head: latestRealmEventHash(eventLog),
        runtime_version: String(options.runtimeVersion || options.runtime_version || SUPPORTED_RUNTIME_VERSION),
        registry_version: Number(options.registryVersion || options.registry_version || SUPPORTED_REGISTRY_VERSION),
        projection_version: Number(options.projectionVersion || options.projection_version || SUPPORTED_PROJECTION_VERSION),
        created_at: options.createdAt || new Date().toISOString(),
    };

    if (options.includeSnapshot) {
        backup.optional_snapshot = createRealmSnapshot({ event_log: eventLog }, options.snapshotOptions || {});
    }

    return backup;
}

function verifyRegistryCompatibility(backup = {}) {
    const registryVersion = Number(backup.registry_version);
    const projectionVersion = Number(backup.projection_version);
    const runtimeVersion = String(backup.runtime_version || SUPPORTED_RUNTIME_VERSION);

    if (registryVersion !== SUPPORTED_REGISTRY_VERSION) {
        return backupFailure('BACKUP_REGISTRY_VERSION_UNSUPPORTED', { registry_version: registryVersion });
    }
    if (projectionVersion !== SUPPORTED_PROJECTION_VERSION) {
        return backupFailure('BACKUP_PROJECTION_VERSION_UNSUPPORTED', { projection_version: projectionVersion });
    }
    if (runtimeVersion !== SUPPORTED_RUNTIME_VERSION) {
        return backupFailure('BACKUP_RUNTIME_VERSION_UNSUPPORTED', { runtime_version: runtimeVersion });
    }
    return { ok: true };
}

function verifyBackupArtifact(backup = {}) {
    if (!backup || typeof backup !== 'object') {
        return backupFailure('BACKUP_ARTIFACT_INVALID');
    }

    const history = historyFromBackup(backup);
    const snapshot = optionalSnapshotFromBackup(backup);
    const hasProjectionOnly = Boolean(
        backup.current_authority_state
        || backup.projection
        || backup.CurrentAuthorityState
    ) && !history;

    if (hasProjectionOnly) {
        return backupFailure('CANONICAL_HISTORY_REQUIRED');
    }

    if (!history) {
        if (snapshot) {
            return {
                ok: true,
                cache_only: true,
                reason_codes: ['BACKUP_SNAPSHOT_CACHE_ONLY'],
                warnings: ['BACKUP_SNAPSHOT_CACHE_ONLY'],
            };
        }
        return backupFailure('CANONICAL_HISTORY_REQUIRED');
    }

    const compatibility = verifyRegistryCompatibility(backup);
    if (!compatibility.ok) return compatibility;

    try {
        verifyRealmEventHistory(history);
    } catch (error) {
        return backupFailure(error.message || 'EVENT_CHAIN_BROKEN');
    }

    const expectedHead = latestRealmEventHash(history);
    if (backup.history_head && backup.history_head !== expectedHead) {
        return backupFailure('BACKUP_HISTORY_HEAD_MISMATCH', {
            expected_history_head: expectedHead,
            backup_history_head: backup.history_head,
        });
    }

    if (snapshot) {
        try {
            verifyRealmSnapshot({ event_log: history }, snapshot);
        } catch (error) {
            return backupFailure(error.message || 'SNAPSHOT_HISTORY_MISMATCH');
        }
    }

    return {
        ok: true,
        cache_only: false,
        history_head: expectedHead,
        projection_hash: calculateProjectionHash(buildCurrentAuthorityState(history)),
        event_count: history.length,
    };
}

function restoreRealmFromBackup(backup = {}, options = {}) {
    const verification = verifyBackupArtifact(backup);
    if (!verification.ok) {
        return {
            ok: false,
            reason_codes: verification.reason_codes || ['BACKUP_VERIFICATION_FAILED'],
            verification,
        };
    }

    if (verification.cache_only) {
        return {
            ok: false,
            reason_codes: ['SNAPSHOT_NOT_RESTORE_SOURCE'],
            verification,
        };
    }

    const history = clone(historyFromBackup(backup));
    const ledger = createEmptyLedger({
        realm_id: backup.realm_id || options.realm_id || null,
        state_root: options.state_root,
    });

    ledger.event_log = history;
    rebuildAuthorityStateOnLedger(ledger);

    const snapshot = optionalSnapshotFromBackup(backup);
    const integrity = verifyRealmIntegrity(ledger, {
        snapshot,
        executionStore: options.executionStore,
        commandIds: options.commandIds,
        remoteEvidenceHeads: options.remoteEvidenceHeads,
        verifiedAt: options.verifiedAt,
    });

    const lifecycle = deriveRealmLifecycleState(integrity, options.lifecycleOptions || {});

    if (!integrity.realm_valid) {
        return {
            ok: false,
            reason_codes: integrity.failures || ['RESTORE_INTEGRITY_FAILED'],
            ledger,
            verification,
            integrity,
            lifecycle,
        };
    }

    return {
        ok: true,
        ledger,
        verification,
        integrity,
        lifecycle,
        history_head: integrity.history_head,
        projection_hash: integrity.projection_hash,
    };
}

function compareRestoredIntegrity(original = {}, restored = {}, backup = {}) {
    const originalLedger = original.event_log ? original : { event_log: original.history || [] };
    const restoredLedger = restored.ledger || restored;
    const originalHistory = originalLedger.event_log || [];
    const restoredHistory = restoredLedger.event_log || [];

    const originalHead = latestRealmEventHash(originalHistory);
    const restoredHead = latestRealmEventHash(restoredHistory);
    const originalProjection = originalLedger.current_authority_state
        || buildCurrentAuthorityState(originalHistory);
    const restoredProjection = restoredLedger.current_authority_state
        || buildCurrentAuthorityState(restoredHistory);

    const originalHash = calculateProjectionHash(originalProjection);
    const restoredHash = calculateProjectionHash(restoredProjection);

    return {
        ok: originalHead === restoredHead && originalHash === restoredHash,
        history_head_match: originalHead === restoredHead,
        projection_hash_match: originalHash === restoredHash,
        original_history_head: originalHead,
        restored_history_head: restoredHead,
        original_projection_hash: originalHash,
        restored_projection_hash: restoredHash,
        backup_history_head: backup.history_head || null,
    };
}

module.exports = {
    SUPPORTED_PROJECTION_VERSION,
    SUPPORTED_REGISTRY_VERSION,
    SUPPORTED_RUNTIME_VERSION,
    compareRestoredIntegrity,
    createBackupArtifact,
    restoreRealmFromBackup,
    verifyBackupArtifact,
};
