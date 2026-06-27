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
const { attachRealmEventHashChain, latestRealmEventHash } = require('../realm-event-history');
const {
    buildConformanceEvidence,
    computeReleaseFingerprint,
    executeReleaseRollback,
    submitReleaseForDeployment,
    validateReleaseManifest,
} = require('../realm-release-governance');

const ROOT_REF = 'release_root_ref';
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
            root_id: 'release_root',
            public_key: 'pk_release_root',
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
            device_id: 'release_device',
            public_key: 'pk_release_device',
            authority_ref: 'device:release_device',
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
        release_id: 'release-test-001',
        runtime_artifact_hash: 'sha256:artifact-a',
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
        approval_evidence: { approved_by: 'release-governance-test' },
        ...overrides,
    };
}

function releasePackageForLedger(ledger, manifestOverrides = {}, candidateRuntime = {}) {
    const manifest = baseManifest(manifestOverrides);
    manifest.conformance_evidence = buildConformanceEvidence(manifest, ledger.event_log);
    return {
        manifest,
        candidate_runtime: {
            migrationCheck() {
                return { ok: true };
            },
            ...candidateRuntime,
        },
    };
}

function unsupportedVersionEvent() {
    return attachRealmEventHashChain({
        type: 'ROOT_AUTHORITY_CREATED',
        realm_event: true,
        version: 2,
        projection_version: 1,
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: 'unsupported_release_root',
            authority_reference: 'unsupported_release_root',
            sequence: 1,
            timestamp: TIMESTAMP,
            previous_event_hash: null,
        },
        payload: {
            root_id: 'unsupported_release_root',
            public_key: 'pk_unsupported_release_root',
        },
        signer: 'unsupported_release_root',
        authority_reference: 'unsupported_release_root',
        sequence: 1,
        timestamp: TIMESTAMP,
        accepted_at: TIMESTAMP,
    }, null);
}

// 1. artifact hash change changes release identity and stale evidence is rejected
{
    const ledger = buildValidLedger();
    const shared = {
        protocol_version: '1',
        registry_version: '1',
        projection_version: '1',
        supported_event_versions: {
            ROOT_AUTHORITY_CREATED: [1],
            DEVICE_KEY_ISSUED: [1],
        },
        migration_declarations: [],
        rollback_target: {
            runtime_version: '1.0.0',
            runtime_artifact_hash: 'sha256:artifact-rollback',
        },
        runtime_version: '1.1.0',
        conformance_evidence: { release_fingerprint: 'placeholder' },
    };

    const fingerprintA = computeReleaseFingerprint({
        ...shared,
        runtime_artifact_hash: 'sha256:artifact-a',
    });
    const fingerprintB = computeReleaseFingerprint({
        ...shared,
        runtime_artifact_hash: 'sha256:artifact-b',
    });

    assert.notStrictEqual(fingerprintA, fingerprintB);

    const stale = validateReleaseManifest({
        ...shared,
        runtime_artifact_hash: 'sha256:artifact-b',
        conformance_evidence: { release_fingerprint: fingerprintA },
    }, ledger.event_log);

    assert.strictEqual(stale.ok, false);
    assert.ok(stale.reason_codes.includes('RELEASE_CONFORMANCE_EVIDENCE_STALE'));

    const fresh = releasePackageForLedger(ledger, {
        runtime_artifact_hash: 'sha256:artifact-b',
    });
    assert.strictEqual(validateReleaseManifest(fresh.manifest, ledger.event_log).ok, true);
}

// 2. release claiming unsupported protocol is rejected before deployment
{
    const eventLog = [unsupportedVersionEvent()];
    const manifest = baseManifest({
        supported_event_versions: {
            ROOT_AUTHORITY_CREATED: [1],
        },
    });
    manifest.conformance_evidence = {
        release_fingerprint: computeReleaseFingerprint(manifest),
    };

    const result = validateReleaseManifest(manifest, eventLog);
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('RELEASE_PROTOCOL_UNSUPPORTED'));
    assert.strictEqual(result.required_version, 2);
}

// 3. release lying about migration fails at conformance, not by trusting declarations
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger, {
        migration_declarations: [],
    }, {
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    });

    const result = submitReleaseForDeployment(ledger, release, {
        currentRuntime: { version: '1.0.0' },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_PROTOCOL_CONFORMANCE_FAILED'));
    assert.ok(result.conformance.reason_codes.includes('PROTOCOL_CONFORMANCE_FAILED'));
}

// 4. same release package yields the same release fingerprint
{
    const ledger = buildValidLedger();
    const release = releasePackageForLedger(ledger);
    const first = computeReleaseFingerprint(release.manifest);
    const second = computeReleaseFingerprint(release.manifest);

    assert.strictEqual(first, second);
    assert.strictEqual(release.manifest.conformance_evidence.release_fingerprint, first);
}

// 5. rollback restores interpreter without rewinding truth
{
    const ledger = buildValidLedger();
    const historyHeadBefore = latestRealmEventHash(ledger.event_log);
    const projectionBefore = buildCurrentAuthorityState(ledger.event_log);

    const rejected = submitReleaseForDeployment(ledger, releasePackageForLedger(ledger, {
        runtime_version: '1.2.0-bad',
        runtime_artifact_hash: 'sha256:artifact-bad',
    }, {
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    }), {
        currentRuntime: { version: '1.0.0' },
    });

    assert.strictEqual(rejected.ok, false);

    const rollback = executeReleaseRollback(ledger, releasePackageForLedger(ledger), {
        currentRuntime: { version: '1.2.0-bad' },
        rollbackRuntime: {
            migrationCheck() {
                return { ok: true };
            },
        },
    });

    assert.strictEqual(rollback.ok, true);
    assert.strictEqual(rollback.rollback_restored, true);
    assert.strictEqual(rollback.history_head, historyHeadBefore);
    assert.deepStrictEqual(buildCurrentAuthorityState(ledger.event_log), projectionBefore);
    assert.strictEqual(ledger.event_log.length, 2);
}

console.log('test-runtime-release-governance: all tests passed');
