'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    rebuildAuthorityStateOnLedger,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    validateRealmEventProposal,
} = require('../realm-event-validator');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { verifyRealmEventHistory } = require('../realm-event-history');
const {
    signDeviceProposal,
    submitDeviceEvent,
    verifyDeviceSignature,
} = require('../device-event-submission-runtime');

const ROOT_REF = 'root_authority_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';
const DEVICE_A_ID = 'device_a';
const DEVICE_A_REF = `device:${DEVICE_A_ID}`;
const DEVICE_A_KEY = 'pk_device_a';
const DEVICE_B_ID = 'device_b';
const DEVICE_B_REF = `device:${DEVICE_B_ID}`;

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
            root_id: 'root_01',
            public_key: 'pk_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId, publicKey, authorityRef) {
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
            public_key: publicKey,
            authority_ref: authorityRef,
        },
    };
}

function acceptRoot(ledger, applyEvent) {
    const result = acceptAndApplyRealmEvent(ledger, rootProposal(1), { applyEvent });
    assert.strictEqual(result.ok, true);
    return result.event;
}

function signedProposal(proposal, publicKey) {
    return {
        proposal,
        signature: signDeviceProposal(proposal, publicKey),
    };
}

function sessionIssueProposal(sequence, signer, deviceRef) {
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
            device_ref: deviceRef,
            authority_ref: 'session:session_01',
        },
    };
}

function deviceSelfRevokeProposal(sequence, signer, deviceId, authorityRef) {
    return {
        envelope: {
            type: 'DEVICE_KEY_REVOKED',
            signer,
            authority_reference: authorityRef,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: deviceId,
            authority_ref: authorityRef,
            reason: 'device_self_revoke',
        },
    };
}

function setupDeviceA(ledger, applyEvent) {
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2, DEVICE_A_ID, DEVICE_A_KEY, DEVICE_A_REF), { applyEvent });
    return ledger.current_authority_state.devices.find((device) => device.id === DEVICE_A_ID);
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

// valid device proposal accepted through submission boundary
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    const proposal = sessionIssueProposal(3, DEVICE_A_REF, DEVICE_A_ID);
    const result = submitDeviceEvent(ledger, signedProposal(proposal, DEVICE_A_KEY), {
        acceptRealmEvent: (acceptedProposal) => acceptAndApplyRealmEvent(ledger, acceptedProposal, { applyEvent }),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.event.type, 'SESSION_AUTHORITY_ISSUED');
    assert.strictEqual(ledger.current_authority_state.sessions.length, 1);
    assert.strictEqual(ledger.current_authority_state.sessions[0].deviceRef, DEVICE_A_ID);
}

// invalid signature rejected before realm validator
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);
    const before = ledger.event_log.length;

    const proposal = sessionIssueProposal(3, DEVICE_A_REF, DEVICE_A_ID);
    const result = submitDeviceEvent(ledger, {
        proposal,
        signature: 'invalid_signature',
    }, {
        acceptRealmEvent: (acceptedProposal) => acceptAndApplyRealmEvent(ledger, acceptedProposal, { applyEvent }),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEVICE_SIGNATURE_INVALID'));
    assert.strictEqual(ledger.event_log.length, before);
}

// device cannot mint authority for another device
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    const proposal = deviceIssueProposal(3, DEVICE_B_ID, 'pk_device_b', DEVICE_B_REF);
    proposal.envelope.signer = DEVICE_A_REF;
    proposal.envelope.authority_reference = DEVICE_A_REF;

    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_A_KEY));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// device cannot create recovery authority
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    const proposal = {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer: DEVICE_A_REF,
            authority_reference: DEVICE_A_REF,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: 'recovery_from_device',
            public_key: 'pk_recovery',
            authority_ref: 'recovery:recovery_from_device',
        },
    };

    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_A_KEY));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// device cannot touch root governance authority
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    const proposal = {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: DEVICE_A_REF,
            authority_reference: DEVICE_A_REF,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'root_escalated',
        },
    };

    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_A_KEY));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// device self revoke allowed
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    const proposal = deviceSelfRevokeProposal(3, DEVICE_A_REF, DEVICE_A_ID, DEVICE_A_REF);
    const result = submitDeviceEvent(ledger, signedProposal(proposal, DEVICE_A_KEY), {
        acceptRealmEvent: (acceptedProposal) => acceptAndApplyRealmEvent(ledger, acceptedProposal, { applyEvent }),
    });

    assert.strictEqual(result.ok, true);
    const device = ledger.current_authority_state.devices.find((entry) => entry.id === DEVICE_A_ID);
    assert.strictEqual(device.status, 'revoked');
    assert.ok(device.issuedEvent);
    assert.ok(device.revokedEvent);
}

// device cannot revoke another device
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(3, DEVICE_B_ID, 'pk_device_b', DEVICE_B_REF), { applyEvent });

    const proposal = deviceSelfRevokeProposal(4, DEVICE_A_REF, DEVICE_B_ID, DEVICE_B_REF);
    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_A_KEY));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('DEVICE_REVOKE_TARGET_NOT_SELF'));
}

// device submission state is deterministic under hash-chain replay
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupDeviceA(ledger, applyEvent);

    submitDeviceEvent(ledger, signedProposal(sessionIssueProposal(3, DEVICE_A_REF, DEVICE_A_ID), DEVICE_A_KEY), {
        acceptRealmEvent: (acceptedProposal) => acceptAndApplyRealmEvent(ledger, acceptedProposal, { applyEvent }),
    });

    const projectionA = cloneState(ledger.current_authority_state);
    const eventLog = ledger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const replayLedger = createTestLedger();
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    assert.deepStrictEqual(replayLedger.current_authority_state, projectionA);
}

console.log('test-device-event-submission-runtime: all tests passed');
