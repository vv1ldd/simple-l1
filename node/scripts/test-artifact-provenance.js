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
const {
    assessRuntimeTrust,
    computeProvenanceFingerprint,
    submitProvenancedReleaseForDeployment,
    validateArtifactProvenance,
} = require('../realm-artifact-provenance');
const {
    buildConformanceEvidence,
    computeReleaseFingerprint,
    submitReleaseForDeployment,
} = require('../realm-release-governance');

const ROOT_REF = 'provenance_root_ref';
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
            root_id: 'provenance_root',
            public_key: 'pk_provenance_root',
        },
    };
}

function deviceIssueProposal(sequence = 2) {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: 'provenance_device',
            public_key: 'pk_provenance_device',
            authority_ref: 'device:provenance_device',
        },
    };
}

function buildValidLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const accept = acceptRealmEventFor(ledger, applyEvent);
    assert.strictEqual(accept(rootProposal(1)).ok, true);
    assert.strictEqual(accept(deviceIssueProposal(2)).ok, true);
    return ledger;
}

function baseManifest(overrides = {}) {
    return {
        release_id: 'provenance-release-001',
        runtime_artifact_hash: 'sha256:artifact-provenance-a',
        runtime_version: '1.1.0',
        protocol_version: '1',
        registry_version: '1',
        projection_version: '1',
        supported_event_versions: {
            ROOT_AUTHORITY_CREATED: [1],
            DEVICE_KEY_ISSUED: [1],
        },
        supported_crypto_algorithms: ['v1'],
        migration_declarations: [],
        integrity_evidence: { checked: true },
        rollback_target: {
            runtime_version: '1.0.0',
            runtime_artifact_hash: 'sha256:artifact-rollback',
        },
        approval_evidence: { approved_by: 'artifact-provenance-test' },
        ...overrides,
    };
}

function baseProvenance(manifest, overrides = {}) {
    return {
        source_revision: 'git:abcdef123456',
        build_recipe: {
            toolchain: 'node-v24.4.1',
            command: 'npm test && package-runtime',
        },
        builder_identity: 'builder:realm-release-bot',
        artifact_hash: manifest.runtime_artifact_hash,
        release_fingerprint: computeReleaseFingerprint(manifest),
        supported_protocols: [manifest.protocol_version],
        supported_crypto: manifest.supported_crypto_algorithms,
        supported_registry: [manifest.registry_version],
        build_timestamp: '2026-06-27T00:00:00.000Z',
        reproducibility_proof: { mode: 'deterministic-fixture' },
        signature_chain: ['sig:builder', 'sig:release-approver'],
        ...overrides,
    };
}

function releasePackageForLedger(ledger, manifestOverrides = {}, candidateRuntime = {}, provenanceOverrides = {}) {
    const manifest = baseManifest(manifestOverrides);
    manifest.conformance_evidence = buildConformanceEvidence(manifest, ledger.event_log);
    return {
        manifest,
        provenance: baseProvenance(manifest, provenanceOverrides),
        candidate_runtime: {
            migrationCheck() {
                return { ok: true };
            },
            ...candidateRuntime,
        },
    };
}

// 1. same source + build recipe + release identity yields the same provenance fingerprint
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger);
    const first = computeProvenanceFingerprint(release.provenance);
    const second = computeProvenanceFingerprint({
        ...release.provenance,
        build_timestamp: '2026-06-27T00:01:00.000Z',
        signature_chain: ['sig:other-observer'],
    });

    assert.strictEqual(first, second);
}

// 2. builder or recipe changes provenance, but release semantics remain the same
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger);
    const changedBuilder = {
        ...release.provenance,
        builder_identity: 'builder:other-builder',
    };
    const changedRecipe = {
        ...release.provenance,
        build_recipe: {
            ...release.provenance.build_recipe,
            command: 'npm test && package-runtime --different',
        },
    };

    assert.notStrictEqual(
        computeProvenanceFingerprint(release.provenance),
        computeProvenanceFingerprint(changedBuilder),
    );
    assert.notStrictEqual(
        computeProvenanceFingerprint(release.provenance),
        computeProvenanceFingerprint(changedRecipe),
    );

    const original = submitReleaseForDeployment(ledger, release, {
        currentRuntime: { version: '1.0.0' },
    });
    const withChangedBuilder = submitReleaseForDeployment(ledger, {
        ...release,
        provenance: changedBuilder,
    }, {
        currentRuntime: { version: '1.0.0' },
    });

    assert.strictEqual(original.ok, true);
    assert.strictEqual(withChangedBuilder.ok, true);
    assert.deepStrictEqual(original.conformance.anchors, withChangedBuilder.conformance.anchors);
}

// 3. changing artifact without updating provenance is detected
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger);
    const tamperedManifest = {
        ...release.manifest,
        runtime_artifact_hash: 'sha256:artifact-provenance-tampered',
    };
    const result = validateArtifactProvenance(release.provenance, tamperedManifest);

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROVENANCE_ARTIFACT_HASH_MISMATCH'));
}

// 4. valid provenance cannot bypass protocol conformance
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger, {}, {
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    });

    const result = submitProvenancedReleaseForDeployment(ledger, release, {
        currentRuntime: { version: '1.0.0' },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.runtime_trust.trust_level, 'reproducible');
    assert.ok(result.reason_codes.includes('DEPLOYMENT_PROTOCOL_CONFORMANCE_FAILED'));
    assert.ok(result.conformance.reason_codes.includes('PROTOCOL_CONFORMANCE_FAILED'));
}

// 5. removing provenance degrades runtime trust but does not change history replay
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger);
    const withoutProvenance = {
        manifest: release.manifest,
        candidate_runtime: release.candidate_runtime,
    };

    const trust = assessRuntimeTrust(withoutProvenance);
    assert.strictEqual(trust.ok, true);
    assert.strictEqual(trust.trust_level, 'unverified');
    assert.ok(trust.warnings.includes('PROVENANCE_MISSING'));

    const deployment = submitProvenancedReleaseForDeployment(ledger, withoutProvenance, {
        currentRuntime: { version: '1.0.0' },
    });

    assert.strictEqual(deployment.ok, true);
    assert.strictEqual(deployment.runtime_trust.trust_level, 'unverified');
    assert.strictEqual(deployment.conformance.ok, true);
}

console.log('test-artifact-provenance: all tests passed');
