'use strict';

const crypto = require('crypto');
const { canonicalEncode } = require('./realm-event-history');
const {
    computeReleaseFingerprint,
    submitReleaseForDeployment,
} = require('./realm-release-governance');

function provenanceFailure(code, details = {}) {
    return {
        ok: false,
        reason_codes: [code],
        ...details,
    };
}

function normalizeArtifactProvenance(provenance = {}) {
    return {
        source_revision: String(provenance.source_revision || '').trim() || null,
        build_recipe: provenance.build_recipe && typeof provenance.build_recipe === 'object'
            ? provenance.build_recipe
            : null,
        builder_identity: String(provenance.builder_identity || '').trim() || null,
        artifact_hash: String(provenance.artifact_hash || '').trim() || null,
        release_fingerprint: String(provenance.release_fingerprint || '').trim() || null,
        supported_protocols: Array.isArray(provenance.supported_protocols)
            ? [...provenance.supported_protocols]
            : [],
        supported_crypto: Array.isArray(provenance.supported_crypto)
            ? [...provenance.supported_crypto]
            : [],
        supported_registry: Array.isArray(provenance.supported_registry)
            ? [...provenance.supported_registry]
            : [],
        build_timestamp: provenance.build_timestamp || null,
        reproducibility_proof: provenance.reproducibility_proof || null,
        signature_chain: Array.isArray(provenance.signature_chain)
            ? [...provenance.signature_chain]
            : [],
    };
}

function provenanceFingerprintMaterial(provenance = {}) {
    const normalized = normalizeArtifactProvenance(provenance);
    return {
        source_revision: normalized.source_revision,
        build_recipe: normalized.build_recipe,
        builder_identity: normalized.builder_identity,
        artifact_hash: normalized.artifact_hash,
        release_fingerprint: normalized.release_fingerprint,
        supported_protocols: normalized.supported_protocols,
        supported_crypto: normalized.supported_crypto,
        supported_registry: normalized.supported_registry,
        reproducibility_proof: normalized.reproducibility_proof,
    };
}

function computeProvenanceFingerprint(provenance = {}) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(provenanceFingerprintMaterial(provenance)))
        .digest('hex');
}

function validateArtifactProvenance(provenance = {}, releaseManifest = {}) {
    const normalized = normalizeArtifactProvenance(provenance);
    if (!normalized.source_revision) return provenanceFailure('PROVENANCE_SOURCE_REVISION_REQUIRED');
    if (!normalized.build_recipe) return provenanceFailure('PROVENANCE_BUILD_RECIPE_REQUIRED');
    if (!normalized.builder_identity) return provenanceFailure('PROVENANCE_BUILDER_IDENTITY_REQUIRED');
    if (!normalized.artifact_hash) return provenanceFailure('PROVENANCE_ARTIFACT_HASH_REQUIRED');
    if (!normalized.release_fingerprint) return provenanceFailure('PROVENANCE_RELEASE_FINGERPRINT_REQUIRED');

    const releaseArtifactHash = String(releaseManifest.runtime_artifact_hash || '').trim();
    if (releaseArtifactHash && normalized.artifact_hash !== releaseArtifactHash) {
        return provenanceFailure('PROVENANCE_ARTIFACT_HASH_MISMATCH', {
            provenance_artifact_hash: normalized.artifact_hash,
            release_artifact_hash: releaseArtifactHash,
        });
    }

    const releaseFingerprint = computeReleaseFingerprint(releaseManifest);
    if (normalized.release_fingerprint !== releaseFingerprint) {
        return provenanceFailure('PROVENANCE_RELEASE_FINGERPRINT_MISMATCH', {
            provenance_release_fingerprint: normalized.release_fingerprint,
            release_fingerprint: releaseFingerprint,
        });
    }

    return {
        ok: true,
        provenance: normalized,
        provenance_fingerprint: computeProvenanceFingerprint(normalized),
    };
}

function assessRuntimeTrust(releasePackage = {}) {
    const manifest = releasePackage.manifest || releasePackage;
    const provenance = releasePackage.provenance || null;
    if (!provenance) {
        return {
            ok: true,
            trust_level: 'unverified',
            warnings: ['PROVENANCE_MISSING'],
            reason_codes: ['PROVENANCE_MISSING'],
        };
    }

    const validation = validateArtifactProvenance(provenance, manifest);
    if (!validation.ok) return validation;

    return {
        ok: true,
        trust_level: validation.provenance.reproducibility_proof ? 'reproducible' : 'provenanced',
        provenance_fingerprint: validation.provenance_fingerprint,
        warnings: [],
    };
}

function submitProvenancedReleaseForDeployment(ledger = {}, releasePackage = {}, options = {}) {
    const trust = assessRuntimeTrust(releasePackage);
    if (!trust.ok) return trust;

    const deployment = submitReleaseForDeployment(ledger, releasePackage, options);
    return {
        ...deployment,
        runtime_trust: trust,
    };
}

module.exports = {
    assessRuntimeTrust,
    computeProvenanceFingerprint,
    normalizeArtifactProvenance,
    provenanceFingerprintMaterial,
    submitProvenancedReleaseForDeployment,
    validateArtifactProvenance,
};
