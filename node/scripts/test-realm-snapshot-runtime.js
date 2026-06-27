'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    buildCurrentAuthorityState,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const {
    createRealmSnapshot,
    rebuildFromSnapshot,
    verifyRealmSnapshot,
} = require('../realm-snapshot');

const ROOT_REF = 'snapshot_root_ref';
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
            root_id: 'snapshot_root',
            public_key: 'pk_snapshot_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = 'device_01') {
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

function sessionIssueProposal(sequence, signer = 'device:device_01') {
    return {
        envelope: {
            type: 'SESSION_AUTHORITY_ISSUED',
            signer,
            authority_reference: signer,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            session_id: 'session_01',
            device_ref: 'device_01',
            authority_ref: 'session:session_01',
        },
    };
}

function federationTrustProposal(sequence) {
    return {
        envelope: {
            type: 'FEDERATION_TRUST_ESTABLISHED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            remote_realm_id: 'snapshot_remote_realm',
            trusted_root_authority: 'snapshot_remote_root',
            allowed_claim_scopes: ['email'],
            trust_scope: 'identity_claims',
            policy_id: 'snapshot_policy',
            remote_event_head: 'remote_head_hash',
        },
    };
}

function buildLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptAndApplyRealmEvent(ledger, rootProposal(1), { applyEvent }).ok, true);
    assert.strictEqual(acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent }).ok, true);
    assert.strictEqual(acceptAndApplyRealmEvent(ledger, sessionIssueProposal(3), { applyEvent }).ok, true);
    assert.strictEqual(acceptAndApplyRealmEvent(ledger, federationTrustProposal(4), { applyEvent }).ok, true);
    return ledger;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// valid snapshot + remaining events equals full replay from zero
{
    const ledger = buildLedger();
    const fullReplay = buildCurrentAuthorityState(ledger.event_log);
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    const verification = verifyRealmSnapshot(ledger, snapshot);

    assert.strictEqual(verification.ok, true);
    assert.strictEqual(snapshot.last_sequence, 2);
    assert.strictEqual(snapshot.last_verified_event_hash, ledger.event_log[1].current_event_hash);
    assert.deepStrictEqual(verification.remainingEvents.map((event) => event.sequence), [3, 4]);

    const accelerated = rebuildFromSnapshot(ledger, snapshot);
    assert.deepStrictEqual(accelerated, fullReplay);
}

// corrupted snapshot is rejected and does not become projection state
{
    const ledger = buildLedger();
    const originalProjection = clone(ledger.current_authority_state);
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    snapshot.projection.devices[0].status = 'revoked';

    assert.throws(() => verifyRealmSnapshot(ledger, snapshot), /SNAPSHOT_PROJECTION_MISMATCH/);
    assert.deepStrictEqual(ledger.current_authority_state, originalProjection);
}

// snapshot head mismatch is rejected
{
    const ledger = buildLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    snapshot.last_verified_event_hash = ledger.event_log[0].current_event_hash;

    assert.throws(() => verifyRealmSnapshot(ledger, snapshot), /SNAPSHOT_HISTORY_MISMATCH/);
}

// snapshot cannot create authority absent from event history
{
    const ledger = buildLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    snapshot.projection.devices.push({
        id: 'attacker_device',
        authority: 'device:attacker_device',
        authorityRef: 'device:attacker_device',
        status: 'active',
        publicKey: 'pk_attacker',
        issuedAt: TIMESTAMP,
        issuedEvent: 'not_in_history',
        revokedAt: null,
        revokedEvent: null,
    });

    assert.throws(() => rebuildFromSnapshot(ledger, snapshot), /SNAPSHOT_PROJECTION_MISMATCH/);
}

// deleting snapshot only affects performance; full replay still reconstructs identity
{
    const ledger = buildLedger();
    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    const accelerated = rebuildFromSnapshot(ledger, snapshot);
    const noSnapshotReplay = buildCurrentAuthorityState(ledger.event_log);

    assert.deepStrictEqual(noSnapshotReplay, accelerated);
}

console.log('test-realm-snapshot-runtime: all tests passed');
