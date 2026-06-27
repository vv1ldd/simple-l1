'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
    rebuildAuthorityStateOnLedger,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const {
    calculateRealmEventHash,
    canonicalEncode,
    realmEventHashMaterial,
    verifyRealmEventHistory,
} = require('../realm-event-history');
const { validateRealmEventProposal } = require('../realm-event-validator');
const { calculateProjectionHash } = require('../realm-observability');
const {
    deviceProposalSigningMaterial,
    signDeviceProposal,
    submitDeviceEvent,
    verifyDeviceSignature,
} = require('../device-event-submission-runtime');

const ROOT_REF = 'crypto_root_ref';
const DEVICE_ID = 'device_crypto';
const DEVICE_REF = `device:${DEVICE_ID}`;
const DEVICE_KEY_OLD = 'pk_device_crypto_old';
const DEVICE_KEY_NEW = 'pk_device_crypto_new';
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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
            root_id: 'crypto_root',
            public_key: 'pk_crypto_root',
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
            session_id: `session_${sequence}`,
            device_ref: deviceRef,
            authority_ref: `session:session_${sequence}`,
        },
    };
}

function deviceRootEscalationProposal(sequence) {
    return {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'crypto_root_escalation',
            public_key: 'pk_escalation',
        },
    };
}

function deviceRevokeProposal(sequence, signer, deviceId, authorityRef) {
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
            reason: 'crypto_test_revoke',
        },
    };
}

function signedProposal(proposal, publicKey) {
    return {
        proposal,
        signature: signDeviceProposal(proposal, publicKey),
    };
}

function setupRootAndDevice(ledger, applyEvent, publicKey = DEVICE_KEY_OLD) {
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(
        acceptRealmEventFor(ledger, applyEvent)(
            deviceIssueProposal(2, DEVICE_ID, publicKey, DEVICE_REF),
        ).ok,
        true,
    );
}

function verifyAlgorithmMetadata(event) {
    const algorithm = event.signature_algorithm || 'v1';
    if (algorithm === 'v1' || algorithm === 'v2') {
        return { ok: true, algorithm };
    }
    return { ok: false, reason_codes: ['CRYPTO_ALGORITHM_UNSUPPORTED'] };
}

function replayWithAlgorithmMetadata(eventLog) {
    for (const event of eventLog) {
        const verification = verifyAlgorithmMetadata(event);
        if (!verification.ok) {
            throw new Error(verification.reason_codes[0]);
        }
    }
    return buildCurrentAuthorityState(eventLog);
}

function signCurrentAuthorityState(state, publicKey) {
    return crypto
        .createHmac('sha256', String(publicKey || ''))
        .update(canonicalEncode(state))
        .digest('hex');
}

function chainBrokenCode(error) {
    return String(error?.message || error || '');
}

// 1. event hash material binds semantic bytes, not projection
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const event = ledger.event_log[1];
    const previousHash = event.previous_event_hash;
    const hashBefore = calculateRealmEventHash(event, previousHash);

    event.payload.device_id = 'tampered_device_id';
    const hashAfterTamper = calculateRealmEventHash(event, previousHash);
    assert.notStrictEqual(hashBefore, hashAfterTamper);

    event.payload.device_id = 'device_crypto';
    const projectionBefore = calculateProjectionHash(ledger.current_authority_state);
    ledger.current_authority_state.devices[0].status = 'revoked';
    const hashAfterProjectionMutation = calculateRealmEventHash(event, previousHash);
    const projectionAfter = calculateProjectionHash(ledger.current_authority_state);

    assert.strictEqual(hashAfterProjectionMutation, hashBefore);
    assert.notStrictEqual(projectionBefore, projectionAfter);
    assert.notStrictEqual(
        calculateProjectionHash(buildCurrentAuthorityState(ledger.event_log)),
        projectionAfter,
    );
}

// 2. hash chain continuity rejects fake previous_hash without repair
{
    const { ledger } = (() => {
        const ledger = createTestLedger();
        const applyEvent = createApplyEvent(ledger);
        setupRootAndDevice(ledger, applyEvent);
        return { ledger };
    })();

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const tamperedLog = clone(ledger.event_log);
    tamperedLog[1].previous_event_hash = 'fake_previous_hash';

    // ADR-0092 EVENT_HASH_CHAIN_INVALID → runtime REALM_EVENT_CHAIN_BROKEN
    assert.throws(
        () => verifyRealmEventHistory(tamperedLog),
        (error) => chainBrokenCode(error).includes('REALM_EVENT_CHAIN_BROKEN'),
    );
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// 3. valid signature with unknown authority scope is rejected by kernel policy
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const proposal = {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: 'recovery_crypto',
            public_key: 'pk_recovery_crypto',
            authority_ref: 'recovery:recovery_crypto',
        },
    };

    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_KEY_OLD));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// 4. proposal signing is not state signing; signed state import is rejected
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const proposal = sessionIssueProposal(3, DEVICE_REF, DEVICE_ID);
    const stateSignature = signCurrentAuthorityState(ledger.current_authority_state, DEVICE_KEY_OLD);
    const proposalSignature = signDeviceProposal(proposal, DEVICE_KEY_OLD);

    assert.notStrictEqual(stateSignature, proposalSignature);
    assert.notDeepStrictEqual(
        deviceProposalSigningMaterial(proposal),
        deviceProposalSigningMaterial({
            envelope: {
                type: 'CURRENT_AUTHORITY_STATE',
                signer: DEVICE_REF,
                authority_reference: DEVICE_REF,
                sequence: 3,
                timestamp: TIMESTAMP,
            },
            payload: ledger.current_authority_state,
        }),
    );

    const rejected = validateRealmEventProposal(ledger, {
        envelope: {
            type: 'CURRENT_AUTHORITY_STATE',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: clone(ledger.current_authority_state),
    });
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('UNKNOWN_REALM_EVENT_TYPE'));
}

// 5. key rotation preserves historical signatures and replay equivalence
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const eventAProposal = sessionIssueProposal(3, DEVICE_REF, DEVICE_ID);
    const eventASignature = signDeviceProposal(eventAProposal, DEVICE_KEY_OLD);
    const eventAResult = submitDeviceEvent(ledger, signedProposal(eventAProposal, DEVICE_KEY_OLD), {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });
    assert.strictEqual(eventAResult.ok, true);

    assert.strictEqual(
        acceptRealmEventFor(ledger, applyEvent)(
            deviceRevokeProposal(4, DEVICE_REF, DEVICE_ID, DEVICE_REF),
        ).ok,
        true,
    );
    assert.strictEqual(
        acceptRealmEventFor(ledger, applyEvent)(
            deviceIssueProposal(5, DEVICE_ID, DEVICE_KEY_NEW, DEVICE_REF),
        ).ok,
        true,
    );

    const eventBProposal = sessionIssueProposal(6, DEVICE_REF, DEVICE_ID);
    const eventBResult = submitDeviceEvent(ledger, signedProposal(eventBProposal, DEVICE_KEY_NEW), {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });
    assert.strictEqual(eventBResult.ok, true);

    const projectionAtRuntime = clone(ledger.current_authority_state);
    const eventLog = clone(ledger.event_log);

    const replayLedger = createTestLedger();
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    assert.deepStrictEqual(replayLedger.current_authority_state, projectionAtRuntime);
    assert.strictEqual(signDeviceProposal(eventAProposal, DEVICE_KEY_OLD), eventASignature);
    assert.notStrictEqual(
        signDeviceProposal(eventAProposal, DEVICE_KEY_NEW),
        eventASignature,
    );
}

// 6. revoked key may still produce a valid signature material, but current capability is denied
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    assert.strictEqual(
        acceptRealmEventFor(ledger, applyEvent)(
            deviceRevokeProposal(3, DEVICE_REF, DEVICE_ID, DEVICE_REF),
        ).ok,
        true,
    );

    const proposal = sessionIssueProposal(4, DEVICE_REF, DEVICE_ID);
    const signature = signDeviceProposal(proposal, DEVICE_KEY_OLD);
    assert.ok(signature);

    const rejected = submitDeviceEvent(ledger, { proposal, signature }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(rejected.ok, false);
    // ADR-0092 KEY_SCOPE_REVOKED → runtime DEVICE_SIGNER_NOT_ACTIVE
    assert.ok(rejected.reason_codes.includes('DEVICE_SIGNER_NOT_ACTIVE'));
    assert.strictEqual(ledger.event_log.length, 3);
}

// 7. algorithm metadata migration replays to the same projection without rewriting history
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const eventAResult = submitDeviceEvent(
        ledger,
        signedProposal(sessionIssueProposal(3, DEVICE_REF, DEVICE_ID), DEVICE_KEY_OLD),
        { acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent) },
    );
    assert.strictEqual(eventAResult.ok, true);

    const eventBResult = submitDeviceEvent(
        ledger,
        signedProposal(sessionIssueProposal(4, DEVICE_REF, DEVICE_ID), DEVICE_KEY_OLD),
        { acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent) },
    );
    assert.strictEqual(eventBResult.ok, true);

    const eventLog = clone(ledger.event_log);
    const hashesBefore = eventLog.map((event, index) => {
        const previousHash = index === 0 ? null : eventLog[index - 1].current_event_hash;
        return calculateRealmEventHash(event, previousHash);
    });

    eventLog[1].signature_algorithm = 'v1';
    eventLog[2].signature_algorithm = 'v1';
    eventLog[3].signature_algorithm = 'v2';

    const hashesAfterMetadata = eventLog.map((event, index) => {
        const previousHash = index === 0 ? null : eventLog[index - 1].current_event_hash;
        return calculateRealmEventHash(event, previousHash);
    });

    assert.deepStrictEqual(hashesAfterMetadata, hashesBefore);

    const projectionFromMetadataReplay = replayWithAlgorithmMetadata(eventLog);
    const projectionFromCanonicalReplay = buildCurrentAuthorityState(eventLog);

    assert.deepStrictEqual(projectionFromMetadataReplay, projectionFromCanonicalReplay);
    assert.deepStrictEqual(
        calculateProjectionHash(projectionFromMetadataReplay),
        calculateProjectionHash(ledger.current_authority_state),
    );
}

// cryptographically valid artifact is not automatically a valid Realm transition
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);
    const beforeLogLength = ledger.event_log.length;

    const proposal = deviceRootEscalationProposal(3);
    const verified = verifyDeviceSignature(ledger, signedProposal(proposal, DEVICE_KEY_OLD));
    assert.strictEqual(verified.ok, true);

    const rejected = validateRealmEventProposal(ledger, verified.proposal);
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.strictEqual(ledger.event_log.length, beforeLogLength);
}

console.log('test-cryptographic-assurance: all tests passed');
