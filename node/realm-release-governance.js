'use strict';

const crypto = require('crypto');
const { buildCurrentAuthorityState } = require('./current-authority-state');
const {
    activateRuntimeDeployment,
} = require('./realm-deployment-runtime');
const {
    canonicalEncode,
    latestRealmEventHash,
} = require('./realm-event-history');
const { calculateProjectionHash } = require('./realm-observability');
const { deriveConformanceAnchors } = require('./realm-protocol-conformance');

function releaseFailure(code, details = {}) {
    return {
        ok: false,
        reason_codes: [code],
        ...details,
    };
}

function normalizeReleaseManifest(manifest = {}) {
    return {
        release_id: manifest.release_id || null,
        runtime_artifact_hash: String(manifest.runtime_artifact_hash || '').trim() || null,
        runtime_version: String(manifest.runtime_version || manifest.version || '').trim() || null,
        protocol_version: String(manifest.protocol_version || '1'),
        registry_version: String(manifest.registry_version || '1'),
        projection_version: String(manifest.projection_version || '1'),
        supported_event_versions: manifest.supported_event_versions && typeof manifest.supported_event_versions === 'object'
            ? manifest.supported_event_versions
            : {},
        supported_crypto_algorithms: Array.isArray(manifest.supported_crypto_algorithms)
            ? [...manifest.supported_crypto_algorithms]
            : [],
        migration_declarations: Array.isArray(manifest.migration_declarations)
            ? [...manifest.migration_declarations]
            : [],
        conformance_evidence: manifest.conformance_evidence || null,
        integrity_evidence: manifest.integrity_evidence || null,
        rollback_target: manifest.rollback_target && typeof manifest.rollback_target === 'object'
            ? { ...manifest.rollback_target }
            : null,
        approval_evidence: manifest.approval_evidence || null,
        runtime_activated: manifest.runtime_activated === true,
    };
}

function fingerprintMaterial(manifest) {
    const normalized = normalizeReleaseManifest(manifest);
    return {
        runtime_artifact_hash: normalized.runtime_artifact_hash,
        runtime_version: normalized.runtime_version,
        protocol_version: normalized.protocol_version,
        registry_version: normalized.registry_version,
        projection_version: normalized.projection_version,
        supported_event_versions: normalized.supported_event_versions,
        supported_crypto_algorithms: normalized.supported_crypto_algorithms,
        migration_declarations: normalized.migration_declarations,
        rollback_target: normalized.rollback_target,
    };
}

function computeReleaseFingerprint(manifest) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(fingerprintMaterial(manifest)))
        .digest('hex');
}

function requiredEventVersionsFromHistory(eventLog = []) {
    const required = {};
    for (const event of eventLog) {
        const type = String(event.type || event.envelope?.type || '').trim();
        if (!type) continue;
        const version = Number(event.version ?? event.envelope?.version ?? 1);
        if (!required[type]) required[type] = new Set();
        required[type].add(version);
    }
    return required;
}

function validateReleaseProtocolSupport(manifest, eventLog = []) {
    const normalized = normalizeReleaseManifest(manifest);
    const supported = normalized.supported_event_versions || {};
    const required = requiredEventVersionsFromHistory(eventLog);

    for (const [eventType, versions] of Object.entries(required)) {
        const supportedVersions = Array.isArray(supported[eventType]) ? supported[eventType] : [];
        for (const version of versions) {
            if (!supportedVersions.includes(version)) {
                return releaseFailure('RELEASE_PROTOCOL_UNSUPPORTED', {
                    event_type: eventType,
                    required_version: version,
                    supported_versions: supportedVersions,
                });
            }
        }
    }

    return { ok: true };
}

function buildConformanceEvidence(manifest, eventLog, interpret) {
    const anchors = deriveConformanceAnchors(eventLog, interpret);
    return {
        release_fingerprint: computeReleaseFingerprint(manifest),
        anchors,
    };
}

function validateReleaseManifest(manifest, eventLog = []) {
    const normalized = normalizeReleaseManifest(manifest);

    if (!normalized.runtime_artifact_hash) {
        return releaseFailure('RELEASE_ARTIFACT_HASH_REQUIRED');
    }
    if (!normalized.runtime_version) {
        return releaseFailure('RELEASE_RUNTIME_VERSION_REQUIRED');
    }
    if (!normalized.rollback_target?.runtime_version) {
        return releaseFailure('RELEASE_ROLLBACK_TARGET_REQUIRED');
    }
    if (!normalized.conformance_evidence) {
        return releaseFailure('RELEASE_CONFORMANCE_EVIDENCE_REQUIRED');
    }
    if (normalized.runtime_activated === true) {
        return releaseFailure('RELEASE_ACTIVATION_FORBIDDEN');
    }

    const protocol = validateReleaseProtocolSupport(normalized, eventLog);
    if (!protocol.ok) return protocol;

    const releaseFingerprint = computeReleaseFingerprint(normalized);
    const evidenceFingerprint = normalized.conformance_evidence?.release_fingerprint;
    if (evidenceFingerprint && evidenceFingerprint !== releaseFingerprint) {
        return releaseFailure('RELEASE_CONFORMANCE_EVIDENCE_STALE', {
            release_fingerprint: releaseFingerprint,
            evidence_fingerprint: evidenceFingerprint,
        });
    }

    return {
        ok: true,
        manifest: normalized,
        release_fingerprint: releaseFingerprint,
    };
}

function candidateRuntimeFromRelease(releasePackage = {}) {
    const manifest = normalizeReleaseManifest(releasePackage.manifest || releasePackage);
    const candidate = releasePackage.candidate_runtime && typeof releasePackage.candidate_runtime === 'object'
        ? releasePackage.candidate_runtime
        : {};

    return {
        version: manifest.runtime_version,
        runtime_version: manifest.runtime_version,
        runtime_artifact_hash: manifest.runtime_artifact_hash,
        migrations: manifest.migration_declarations,
        migrationCheck: candidate.migrationCheck || candidate.migration_check || null,
        interpret: candidate.interpret || null,
    };
}

function submitReleaseForDeployment(ledger = {}, releasePackage = {}, options = {}) {
    const eventLog = ledger.event_log || [];
    const validation = validateReleaseManifest(releasePackage.manifest || releasePackage, eventLog);
    if (!validation.ok) {
        return validation;
    }

    const candidateRuntime = candidateRuntimeFromRelease(releasePackage);
    return activateRuntimeDeployment(ledger, candidateRuntime, {
        currentRuntime: options.currentRuntime || options.preRuntime,
        integrityOptions: options.integrityOptions,
    });
}

function executeReleaseRollback(ledger = {}, releasePackage = {}, options = {}) {
    const eventLog = ledger.event_log || [];
    const historyHeadBefore = latestRealmEventHash(eventLog);
    const projectionBefore = calculateProjectionHash(buildCurrentAuthorityState(eventLog));

    const manifest = normalizeReleaseManifest(releasePackage.manifest || releasePackage);
    if (!manifest.rollback_target?.runtime_version) {
        return releaseFailure('RELEASE_ROLLBACK_TARGET_REQUIRED');
    }

    const rollbackRuntime = {
        version: manifest.rollback_target.runtime_version,
        runtime_version: manifest.rollback_target.runtime_version,
        runtime_artifact_hash: manifest.rollback_target.runtime_artifact_hash || null,
        ...(releasePackage.rollback_runtime || options.rollbackRuntime || {}),
    };

    const deployment = activateRuntimeDeployment(ledger, rollbackRuntime, {
        currentRuntime: options.failedRuntime || options.currentRuntime,
        integrityOptions: options.integrityOptions,
    });

    if (!deployment.ok) {
        return {
            ...deployment,
            stage: 'rollback',
        };
    }

    const historyHeadAfter = latestRealmEventHash(eventLog);
    const projectionAfter = calculateProjectionHash(buildCurrentAuthorityState(eventLog));

    if (historyHeadBefore !== historyHeadAfter || projectionBefore !== projectionAfter) {
        return releaseFailure('RELEASE_ROLLBACK_TRUTH_MUTATION_FORBIDDEN', {
            history_head_before: historyHeadBefore,
            history_head_after: historyHeadAfter,
            projection_hash_before: projectionBefore,
            projection_hash_after: projectionAfter,
        });
    }

    return {
        ok: true,
        rollback_restored: true,
        interpreter_version: rollbackRuntime.version,
        history_head: historyHeadAfter,
        projection_hash: projectionAfter,
        deployment,
    };
}

module.exports = {
    buildConformanceEvidence,
    candidateRuntimeFromRelease,
    computeReleaseFingerprint,
    executeReleaseRollback,
    normalizeReleaseManifest,
    requiredEventVersionsFromHistory,
    submitReleaseForDeployment,
    validateReleaseManifest,
    validateReleaseProtocolSupport,
};
