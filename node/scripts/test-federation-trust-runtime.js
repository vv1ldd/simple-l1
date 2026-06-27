'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    rebuildAuthorityStateOnLedger,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { verifyRealmEventHistory } = require('../realm-event-history');
const {
    createFederationTrustProposal,
    evaluateFederationPolicy,
    recognizeRemoteRealm,
    verifyRemoteRealmHistory,
} = require('../federation-trust-runtime');

const TIMESTAMP = '2026-06-27T00:00:00.000Z';
const LOCAL_ROOT_REF = 'local_root_authority';
const REMOTE_ROOT_REF = 'remote_root_authority';
const REMOTE_REALM_ID = 'remote_realm_01';

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

function rootProposal(sequence, rootRef, rootId = 'root_01') {
    return {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: rootRef,
            authority_reference: rootRef,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: rootId,
            public_key: `pk_${rootId}`,
        },
    };
}

function remoteDeviceProposal(sequence) {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: REMOTE_ROOT_REF,
            authority_reference: REMOTE_ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: 'remote_device_01',
            public_key: 'pk_remote_device',
            authority_ref: 'device:remote_device_01',
        },
    };
}

function createRemoteRealm() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const root = acceptAndApplyRealmEvent(ledger, rootProposal(1, REMOTE_ROOT_REF, 'remote_root_01'), { applyEvent });
    assert.strictEqual(root.ok, true);
    const device = acceptAndApplyRealmEvent(ledger, remoteDeviceProposal(2), { applyEvent });
    assert.strictEqual(device.ok, true);
    return ledger;
}

function createLocalRealm() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const root = acceptAndApplyRealmEvent(ledger, rootProposal(1, LOCAL_ROOT_REF, 'local_root_01'), { applyEvent });
    assert.strictEqual(root.ok, true);
    return { ledger, applyEvent };
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

// valid remote chain becomes local federation trust only through a local accepted event
{
    const remoteLedger = createRemoteRealm();
    const { ledger: localLedger, applyEvent } = createLocalRealm();

    const remoteVerification = verifyRemoteRealmHistory({
        realmId: REMOTE_REALM_ID,
        eventLog: remoteLedger.event_log,
        claimedRootAuthority: REMOTE_ROOT_REF,
    });
    assert.strictEqual(remoteVerification.ok, true);
    assert.strictEqual(remoteVerification.evidence.rootAuthority.authorityRef, REMOTE_ROOT_REF);

    const policyEvaluation = evaluateFederationPolicy({
        trustedRealmId: REMOTE_REALM_ID,
        acceptedAuthorityRoot: REMOTE_ROOT_REF,
        allowedClaimScopes: ['email', 'profile'],
        trustScope: 'identity_claims',
        policyId: 'policy_remote_identity_claims',
    }, remoteVerification);
    assert.strictEqual(policyEvaluation.ok, true);

    const proposal = createFederationTrustProposal({
        localRootAuthority: localLedger.current_authority_state.rootAuthority,
        remoteRealmEvidence: remoteVerification,
        policyDecision: policyEvaluation,
        sequence: 2,
        timestamp: TIMESTAMP,
    });
    assert.strictEqual(localLedger.current_authority_state.federationTrusts.length, 0);

    const accepted = acceptAndApplyRealmEvent(localLedger, proposal, { applyEvent });
    assert.strictEqual(accepted.ok, true);
    assert.strictEqual(localLedger.current_authority_state.federationTrusts.length, 1);
    assert.deepStrictEqual(localLedger.current_authority_state.federationTrusts[0].allowedClaimScopes, ['email', 'profile']);
    assert.strictEqual(localLedger.current_authority_state.federationTrusts[0].trustScope, 'identity_claims');
    assert.strictEqual(localLedger.current_authority_state.federationTrusts[0].trustedRootAuthority, REMOTE_ROOT_REF);
    assert.strictEqual(localLedger.current_authority_state.federationTrusts[0].remoteEventHead, remoteVerification.evidence.eventHead);
}

// corrupted remote history is rejected and does not mutate local federation state
{
    const remoteLedger = createRemoteRealm();
    const { ledger: localLedger, applyEvent } = createLocalRealm();
    const before = cloneState(localLedger.current_authority_state);
    const corruptedRemoteLog = remoteLedger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    corruptedRemoteLog[1].payload.device_id = 'tampered_remote_device';

    const result = recognizeRemoteRealm({
        remoteRealm: {
            realmId: REMOTE_REALM_ID,
            eventLog: corruptedRemoteLog,
            claimedRootAuthority: REMOTE_ROOT_REF,
        },
        localPolicy: {
            trustedRealmId: REMOTE_REALM_ID,
            acceptedAuthorityRoot: REMOTE_ROOT_REF,
            allowedClaimScopes: ['email'],
        },
        localRootAuthority: localLedger.current_authority_state.rootAuthority,
        sequence: 2,
        timestamp: TIMESTAMP,
    }, {
        acceptRealmEvent: (proposal) => acceptAndApplyRealmEvent(localLedger, proposal, { applyEvent }),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.some((code) => code.includes('REALM_EVENT_HASH_MISMATCH:sequence_2')));
    assert.deepStrictEqual(localLedger.current_authority_state, before);
}

// root mismatch between remote claim and derived history is rejected
{
    const remoteLedger = createRemoteRealm();
    const verification = verifyRemoteRealmHistory({
        realmId: REMOTE_REALM_ID,
        eventLog: remoteLedger.event_log,
        claimedRootAuthority: 'claimed_wrong_root',
    });

    assert.strictEqual(verification.ok, false);
    assert.ok(verification.reason_codes.includes('REMOTE_ROOT_AUTHORITY_MISMATCH'));
}

// local policy remains scoped; unlisted realms are denied
{
    const remoteLedger = createRemoteRealm();
    const remoteVerification = verifyRemoteRealmHistory({
        realmId: REMOTE_REALM_ID,
        eventLog: remoteLedger.event_log,
        claimedRootAuthority: REMOTE_ROOT_REF,
    });
    assert.strictEqual(remoteVerification.ok, true);

    const denied = evaluateFederationPolicy({
        trustedRealmId: 'different_realm',
        acceptedAuthorityRoot: REMOTE_ROOT_REF,
        allowedClaimScopes: ['email'],
    }, remoteVerification);

    assert.strictEqual(denied.ok, false);
    assert.ok(denied.reason_codes.includes('FEDERATION_POLICY_REALM_DENIED'));
}

// local federation projection is deterministic under hash-chain replay
{
    const remoteLedger = createRemoteRealm();
    const { ledger: localLedger, applyEvent } = createLocalRealm();

    const recognized = recognizeRemoteRealm({
        remoteRealm: {
            realmId: REMOTE_REALM_ID,
            eventLog: remoteLedger.event_log,
            claimedRootAuthority: REMOTE_ROOT_REF,
        },
        localPolicy: {
            trustedRealmId: REMOTE_REALM_ID,
            acceptedAuthorityRoot: REMOTE_ROOT_REF,
            allowedClaimScopes: ['email'],
            trustScope: 'identity_claims',
        },
        localRootAuthority: localLedger.current_authority_state.rootAuthority,
        sequence: 2,
        timestamp: TIMESTAMP,
    }, {
        acceptRealmEvent: (proposal) => acceptAndApplyRealmEvent(localLedger, proposal, { applyEvent }),
    });
    assert.strictEqual(recognized.ok, true);

    const projectionA = cloneState(localLedger.current_authority_state);
    const eventLog = localLedger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const replayLedger = createTestLedger();
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    assert.deepStrictEqual(replayLedger.current_authority_state, projectionA);
}

console.log('test-federation-trust-runtime: all tests passed');
