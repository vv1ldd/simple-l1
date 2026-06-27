'use strict';

const { canonicalEncode } = require('./realm-event-history');
const { verifyRealmIntegrity } = require('./realm-integrity-check');
const {
    canAcceptCommands,
    deriveRealmLifecycleState,
} = require('./realm-lifecycle');
const { runProtocolConformanceGate } = require('./realm-protocol-conformance');

function deploymentFailure(code, details = {}) {
    return {
        ok: false,
        reason_codes: [code],
        ...details,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function migrationCheckFor(candidateRuntime = {}) {
    if (typeof candidateRuntime.migrationCheck === 'function') {
        return candidateRuntime.migrationCheck;
    }
    if (typeof candidateRuntime.migration_check === 'function') {
        return candidateRuntime.migration_check;
    }
    return null;
}

function declaredMigrations(candidateRuntime = {}) {
    if (Array.isArray(candidateRuntime.migrations)) return candidateRuntime.migrations;
    if (Array.isArray(candidateRuntime.migration_plan)) return candidateRuntime.migration_plan;
    return [];
}

function runMigrationCheck(ledger = {}, candidateRuntime = {}) {
    const migrations = declaredMigrations(candidateRuntime);
    const migrationCheck = migrationCheckFor(candidateRuntime);

    if (migrations.length > 0 && !migrationCheck) {
        return deploymentFailure('DEPLOYMENT_MIGRATION_CHECK_REQUIRED', {
            migrations,
        });
    }

    if (!migrationCheck) {
        return {
            ok: true,
            skipped: true,
            reason_codes: ['DEPLOYMENT_MIGRATION_CHECK_NOT_REQUIRED'],
        };
    }

    const migrationLedger = clone(ledger);
    const bytesBefore = canonicalEncode(migrationLedger.event_log || []);
    const result = migrationCheck(migrationLedger, candidateRuntime);
    if (canonicalEncode(migrationLedger.event_log || []) !== bytesBefore) {
        return deploymentFailure('DEPLOYMENT_HISTORY_MUTATION_FORBIDDEN', {
            stage: 'migration_check',
        });
    }
    if (!result || result.ok !== true) {
        return deploymentFailure('DEPLOYMENT_MIGRATION_CHECK_FAILED', {
            migration_result: result || null,
        });
    }

    return {
        ok: true,
        migration_result: result,
    };
}

function activateRuntimeDeployment(ledger = {}, candidateRuntime = {}, options = {}) {
    const eventLog = ledger.event_log || [];
    const bytesBefore = canonicalEncode(eventLog);
    const currentRuntime = options.currentRuntime || options.preRuntime || { version: 'current' };
    const integrityOptions = options.integrityOptions || {};

    const migration = runMigrationCheck(ledger, candidateRuntime);
    if (!migration.ok) {
        return migration;
    }

    if (canonicalEncode(eventLog) !== bytesBefore) {
        return deploymentFailure('DEPLOYMENT_HISTORY_MUTATION_FORBIDDEN', {
            stage: 'migration_check',
        });
    }

    const conformance = runProtocolConformanceGate(eventLog, {
        preRuntime: currentRuntime,
        postRuntime: candidateRuntime,
    });
    if (!conformance.ok) {
        return deploymentFailure('DEPLOYMENT_PROTOCOL_CONFORMANCE_FAILED', {
            conformance,
        });
    }

    if (canonicalEncode(eventLog) !== bytesBefore) {
        return deploymentFailure('DEPLOYMENT_HISTORY_MUTATION_FORBIDDEN', {
            stage: 'protocol_conformance',
        });
    }

    const integrity = verifyRealmIntegrity(ledger, integrityOptions);
    if (integrity.realm_valid !== true) {
        return deploymentFailure('DEPLOYMENT_INTEGRITY_VERIFICATION_FAILED', {
            integrity,
            lifecycle: deriveRealmLifecycleState(integrity),
        });
    }

    const lifecycle = deriveRealmLifecycleState(integrity);
    if (!canAcceptCommands(lifecycle)) {
        return deploymentFailure('DEPLOYMENT_LIFECYCLE_ACTIVATION_DENIED', {
            integrity,
            lifecycle,
        });
    }

    return {
        ok: true,
        runtime_activated: true,
        active_runtime_version: String(candidateRuntime.version || candidateRuntime.runtime_version || 'candidate'),
        previous_runtime_version: String(currentRuntime.version || currentRuntime.runtime_version || 'current'),
        migration,
        conformance,
        integrity,
        lifecycle,
        activation_summary: 'Runtime activated after migration check, protocol conformance, integrity verification, and lifecycle authorization.',
    };
}

module.exports = {
    activateRuntimeDeployment,
    runMigrationCheck,
};
