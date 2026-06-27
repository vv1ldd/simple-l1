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
    COMMAND_TYPES,
    executeRealmCommand,
    normalizeRealmCommand,
} = require('../realm-command-runtime');
const { signDeviceProposal } = require('../device-event-submission-runtime');

const ROOT_REF = 'root_authority_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';
const DEVICE_A_ID = 'device_a';
const DEVICE_A_REF = `device:${DEVICE_A_ID}`;
const DEVICE_A_KEY = 'pk_device_a';

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
            root_id: 'root_01',
            public_key: 'pk_root',
        },
    };
}

function deviceIssueProposal(sequence, deviceId = DEVICE_A_ID, publicKey = DEVICE_A_KEY, authorityRef = DEVICE_A_REF) {
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

function recoveryAuthorityIssueProposal(sequence, recoveryId = 'recovery_01') {
    return {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: recoveryId,
            public_key: 'pk_recovery',
            authority_ref: `recovery:${recoveryId}`,
        },
    };
}

function sessionIssueProposal(sequence, signer = DEVICE_A_REF, deviceRef = DEVICE_A_ID) {
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

function signedProposal(proposal, publicKey) {
    return {
        proposal,
        signature: signDeviceProposal(proposal, publicKey),
    };
}

function setupRootAndDevice(ledger, applyEvent) {
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// command normalization preserves command envelope roles without making commands history
{
    const normalized = normalizeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: { proposal: rootProposal(1) },
        actor: { device: 'api_session_device' },
        evidence: { requestId: 'request_01' },
    });

    assert.strictEqual(normalized.type, COMMAND_TYPES.SUBMIT_REALM_EVENT);
    assert.deepStrictEqual(normalized.actor, { device: 'api_session_device' });
    assert.deepStrictEqual(normalized.evidence, { requestId: 'request_01' });
}

// unsupported commands are rejected without canonical mutation
{
    const ledger = createTestLedger();
    const beforeState = clone(ledger.current_authority_state);

    const result = executeRealmCommand({
        type: 'UNKNOWN_COMMAND',
        payload: {},
    }, {
        acceptRealmEvent: () => {
            throw new Error('acceptRealmEvent must not be called for unknown commands');
        },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('REALM_COMMAND_TYPE_UNSUPPORTED'));
    assert.strictEqual(ledger.event_log.length, 0);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// command runtime has no direct write path; only the supplied kernel callback can mutate
{
    const ledger = createTestLedger();
    const beforeState = clone(ledger.current_authority_state);
    const observedProposals = [];

    const result = executeRealmCommand({
        type: COMMAND_TYPES.EXECUTE_RECOVERY_CEREMONY,
        payload: {
            recoveryAuthority: { authorityRef: 'recovery:recovery_01' },
            oldDevice: { id: 'device_old', authorityRef: 'device:device_old' },
            newDevice: { id: 'device_new', public_key: 'pk_device_new', authorityRef: 'device:device_new' },
            recoveryRef: 'recovery_case_no_direct_write',
            startSequence: 10,
            timestamp: TIMESTAMP,
        },
    }, {
        acceptRealmEvent: (proposal) => {
            observedProposals.push(proposal);
            return {
                ok: true,
                event: {
                    type: proposal.envelope.type,
                    sequence: proposal.envelope.sequence,
                },
            };
        },
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(
        observedProposals.map((proposal) => proposal.envelope.type),
        ['RECOVERY_EXECUTED', 'DEVICE_KEY_ISSUED', 'DEVICE_KEY_REVOKED'],
    );
    assert.strictEqual(ledger.event_log.length, 0);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// failed command isolation: invalid signed device command leaves history and projection unchanged
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const result = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            proposal: sessionIssueProposal(3),
        },
        evidence: {
            signature: 'invalid_signature',
        },
    }, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEVICE_SIGNATURE_INVALID'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// authentication identifies the caller; authority history still decides capability
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const proposal = recoveryAuthorityIssueProposal(3, 'recovery_from_device');
    proposal.envelope.signer = DEVICE_A_REF;
    proposal.envelope.authority_reference = DEVICE_A_REF;

    const result = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            signedProposal: signedProposal(proposal, DEVICE_A_KEY),
        },
        actor: {
            sessionRole: 'admin',
            device: DEVICE_A_REF,
        },
    }, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// command-produced accepted events replay to the same state observed at runtime
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);

    const root = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: rootProposal(1),
        },
        actor: { service: 'bootstrap' },
    }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });
    assert.strictEqual(root.ok, true);

    const device = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_REALM_EVENT,
        payload: {
            proposal: deviceIssueProposal(2),
        },
        actor: { service: 'bootstrap' },
    }, {
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });
    assert.strictEqual(device.ok, true);

    const session = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            signedProposal: signedProposal(sessionIssueProposal(3), DEVICE_A_KEY),
        },
        actor: {
            device: DEVICE_A_REF,
        },
    }, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });
    assert.strictEqual(session.ok, true);

    const projectionA = clone(ledger.current_authority_state);
    const eventLog = clone(ledger.event_log);
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const replayLedger = createTestLedger();
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    assert.deepStrictEqual(replayLedger.current_authority_state, projectionA);
}

console.log('test-realm-command-runtime: all tests passed');
