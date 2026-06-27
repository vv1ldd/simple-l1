'use strict';

const assert = require('assert');
const {
    ensureAuthorityStateStores,
    buildCurrentAuthorityState,
    rebuildAuthorityStateOnLedger,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    REALM_EVENT_SCHEMAS,
    validateRealmEventProposal,
    acceptRealmEventProposal,
} = require('../realm-event-validator');
const {
    CANONICAL_REALM_EVENT_TYPES,
    REALM_EVENT_REGISTRY,
} = require('../realm-event-registry');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { verifyRealmEventHistory } = require('../realm-event-history');
const {
    createRecoveryCeremonyProposals,
    executeRecoveryCeremony,
} = require('../recovery-ceremony-runtime');

const ROOT_REF = 'root_authority_ref';
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
            root_id: 'root_01',
            public_key: 'pk_root',
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
            public_key: 'pk_device',
            authority_ref: `device:${deviceId}`,
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

function deviceRevokeProposal(sequence, deviceId = 'device_01') {
    return {
        envelope: {
            type: 'DEVICE_KEY_REVOKED',
            signer: ROOT_REF,
            authority_reference: `device:${deviceId}`,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: deviceId,
            reason: 'test_revoke',
        },
    };
}

function sessionIssueProposal(sequence, signer, deviceRef = 'device_01') {
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

function acceptRoot(ledger, applyEvent) {
    const result = acceptAndApplyRealmEvent(ledger, rootProposal(1), { applyEvent });
    assert.strictEqual(result.ok, true, `root accept failed: ${JSON.stringify(result.reason_codes)}`);
    return result.event;
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

// registry completeness: canonical events must be fully contracted
{
    for (const type of CANONICAL_REALM_EVENT_TYPES) {
        const contract = REALM_EVENT_REGISTRY[type];
        assert.ok(contract, `${type} missing registry contract`);
        assert.strictEqual(contract.canonicalName, type);
        assert.strictEqual(typeof contract.version, 'number', `${type} missing version`);
        assert.ok(contract.version >= 1, `${type} invalid version`);
        assert.ok(Array.isArray(contract.envelope?.required), `${type} missing envelope contract`);
        assert.ok(contract.envelope.required.includes('type'), `${type} envelope must require type`);
        assert.ok(contract.envelope.required.includes('sequence'), `${type} envelope must require sequence`);
        assert.ok(contract.payloadContract && typeof contract.payloadContract === 'object', `${type} missing payload contract`);
        assert.ok(contract.requiredAuthority, `${type} missing authority rule`);
        assert.strictEqual(typeof contract.validateTransition, 'function', `${type} missing transition validator`);
        assert.strictEqual(typeof contract.apply, 'function', `${type} missing projection handler`);
        assert.strictEqual(typeof contract.projectionVersion, 'number', `${type} missing projection version`);

        const schema = REALM_EVENT_SCHEMAS[type];
        assert.ok(schema, `${type} missing exported schema`);
        assert.strictEqual(schema.version, contract.version);
        assert.strictEqual(schema.projectionVersion, contract.projectionVersion);
    }
}

// valid ROOT_AUTHORITY_CREATED becomes accepted Realm Event
{
    const ledger = createTestLedger();
    const accepted = acceptRealmEventProposal(ledger, rootProposal(1));
    assert.strictEqual(accepted.ok, true);
    assert.strictEqual(accepted.event.realm_event, true);
    assert.strictEqual(accepted.event.version, 1);
    assert.strictEqual(accepted.event.projection_version, 1);
    assert.strictEqual(accepted.event.type, 'ROOT_AUTHORITY_CREATED');
    assert.strictEqual(accepted.event.sequence, 1);
    assert.ok(accepted.event.id.startsWith('realm_evt_1_root_authority_created_'));
    assert.strictEqual(accepted.event.id, accepted.event.event_id);
    assert.strictEqual(accepted.event.previous_event_hash, null);
    assert.strictEqual(typeof accepted.event.current_event_hash, 'string');
    assert.strictEqual(accepted.event.current_event_hash.length, 64);
    assert.deepStrictEqual(accepted.event.envelope.type, 'ROOT_AUTHORITY_CREATED');
}

// DEVICE_KEY_ISSUED requires authorized signer
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);

    const unauthorized = validateRealmEventProposal(ledger, {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: 'unknown_signer',
            authority_reference: ROOT_REF,
            sequence: 2,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: 'device_01',
            public_key: 'pk_device',
        },
    });
    assert.strictEqual(unauthorized.ok, false);
    assert.ok(unauthorized.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));

    const authorized = acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });
    assert.strictEqual(authorized.ok, true);
    assert.strictEqual(authorized.event.previous_event_hash, ledger.event_log[0].current_event_hash);
    assert.strictEqual(ledger.current_authority_state.devices.length, 1);
    assert.strictEqual(ledger.current_authority_state.devices[0].id, 'device_01');
}

// proposal previous_event_hash must match canonical history head when supplied
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);

    const rejected = validateRealmEventProposal(ledger, {
        ...deviceIssueProposal(2),
        previous_event_hash: 'not_the_current_head',
    });
    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.some((code) => code.startsWith('PREVIOUS_EVENT_HASH_MISMATCH')));
}

// revoked device cannot create accepted event
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });

    const deviceAuthority = ledger.current_authority_state.devices[0].authorityRef;
    acceptAndApplyRealmEvent(ledger, deviceRevokeProposal(3), { applyEvent });

    const revokedAttempt = validateRealmEventProposal(ledger, sessionIssueProposal(4, deviceAuthority));
    assert.strictEqual(revokedAttempt.ok, false);
    assert.ok(revokedAttempt.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// invalid sequence is rejected
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);

    const badSequence = validateRealmEventProposal(ledger, deviceIssueProposal(4));
    assert.strictEqual(badSequence.ok, false);
    assert.ok(badSequence.reason_codes.some((code) => code.startsWith('SEQUENCE_MISMATCH')));
}

// failed proposal does not append to event log
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const before = ledger.event_log.length;

    const failed = acceptAndApplyRealmEvent(ledger, deviceIssueProposal(1), { applyEvent });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(ledger.event_log.length, before);
}

// CurrentAuthorityState rebuilds from accepted events
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, deviceRevokeProposal(3), { applyEvent });

    const liveState = cloneState(ledger.current_authority_state);
    const rebuilt = buildCurrentAuthorityState(ledger.event_log);
    assert.deepStrictEqual(rebuilt, liveState);
    assert.strictEqual(rebuilt.lastSequence, 3);
    assert.strictEqual(rebuilt.devices[0].status, 'revoked');
}

// valid recovery ceremony is just a canonical event sequence through the existing pipeline
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, recoveryAuthorityIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(3, 'device_old'), { applyEvent });

    const recoveryAuthority = ledger.current_authority_state.recoveryAuthorities[0];
    const oldDevice = ledger.current_authority_state.devices.find((device) => device.id === 'device_old');
    const recoveryResult = executeRecoveryCeremony({
        recoveryAuthority,
        oldDevice,
        newDevice: {
            id: 'device_new',
            public_key: 'pk_device_new',
            authorityRef: 'device:device_new',
        },
        recoveryRef: 'recovery_case_01',
        startSequence: 4,
        timestamp: TIMESTAMP,
    }, {
        acceptRealmEvent: (proposal) => acceptAndApplyRealmEvent(ledger, proposal, { applyEvent }),
    });

    assert.strictEqual(recoveryResult.ok, true);
    assert.deepStrictEqual(
        recoveryResult.acceptedEvents.map((event) => event.type),
        ['RECOVERY_EXECUTED', 'DEVICE_KEY_ISSUED', 'DEVICE_KEY_REVOKED'],
    );

    const recoveredState = ledger.current_authority_state;
    const oldDeviceAfterRecovery = recoveredState.devices.find((device) => device.id === 'device_old');
    const newDeviceAfterRecovery = recoveredState.devices.find((device) => device.id === 'device_new');

    assert.strictEqual(recoveredState.recoveryAuthorities[0].status, 'active');
    assert.ok(recoveredState.recoveryAuthorities[0].issuedEvent);
    assert.strictEqual(oldDeviceAfterRecovery.status, 'revoked');
    assert.ok(oldDeviceAfterRecovery.issuedEvent);
    assert.ok(oldDeviceAfterRecovery.revokedEvent);
    assert.strictEqual(newDeviceAfterRecovery.status, 'active');
    assert.ok(newDeviceAfterRecovery.issuedEvent);
    assert.strictEqual(newDeviceAfterRecovery.revokedEvent, null);
    assert.strictEqual(recoveredState.lastRecovery.recoveryAuthority, recoveryAuthority.authorityRef);
}

// normal device signer cannot execute recovery
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2, 'device_01'), { applyEvent });

    const deviceAuthority = ledger.current_authority_state.devices[0].authorityRef;
    const rejected = validateRealmEventProposal(ledger, {
        envelope: {
            type: 'RECOVERY_EXECUTED',
            signer: deviceAuthority,
            authority_reference: deviceAuthority,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_ref: 'recovery_case_denied',
            old_device_id: 'device_01',
            old_device_ref: deviceAuthority,
            new_device_id: 'device_new',
            new_device_authority_ref: 'device:device_new',
        },
    });

    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// recovery authority cannot self-escalate into root governance authority
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, recoveryAuthorityIssueProposal(2), { applyEvent });

    const recoveryAuthority = ledger.current_authority_state.recoveryAuthorities[0].authorityRef;
    const rejected = validateRealmEventProposal(ledger, {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: recoveryAuthority,
            authority_reference: recoveryAuthority,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'root_escalated',
        },
    });

    assert.strictEqual(rejected.ok, false);
    assert.ok(rejected.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
}

// recovery ceremony helper creates proposals only; validation/history/projection stay in the kernel
{
    const proposals = createRecoveryCeremonyProposals({
        recoveryAuthority: { authorityRef: 'recovery:recovery_01' },
        oldDevice: { id: 'device_old', authorityRef: 'device:device_old' },
        newDevice: { id: 'device_new', public_key: 'pk_new', authorityRef: 'device:device_new' },
        recoveryRef: 'recovery_case_02',
        startSequence: 10,
        timestamp: TIMESTAMP,
    });

    assert.deepStrictEqual(
        proposals.map((proposal) => proposal.envelope.type),
        ['RECOVERY_EXECUTED', 'DEVICE_KEY_ISSUED', 'DEVICE_KEY_REVOKED'],
    );
    assert.deepStrictEqual(proposals.map((proposal) => proposal.envelope.sequence), [10, 11, 12]);
}

// recovered state is deterministic under hash-chain replay
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, recoveryAuthorityIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(3, 'device_old'), { applyEvent });

    executeRecoveryCeremony({
        recoveryAuthority: ledger.current_authority_state.recoveryAuthorities[0],
        oldDevice: ledger.current_authority_state.devices.find((device) => device.id === 'device_old'),
        newDevice: {
            id: 'device_new',
            public_key: 'pk_device_new',
            authorityRef: 'device:device_new',
        },
        recoveryRef: 'recovery_case_replay',
        startSequence: 4,
        timestamp: TIMESTAMP,
    }, {
        acceptRealmEvent: (proposal) => acceptAndApplyRealmEvent(ledger, proposal, { applyEvent }),
    });

    const projectionA = cloneState(ledger.current_authority_state);
    const eventLog = ledger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const replayLedger = createTestLedger();
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    assert.deepStrictEqual(replayLedger.current_authority_state, projectionA);
}

// accepted event replay equivalence (ADR-0068)
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);

    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, {
        envelope: {
            type: 'FEDERATION_TRUST_ESTABLISHED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence: 3,
            timestamp: TIMESTAMP,
        },
        payload: {
            remote_realm_id: 'remote_realm_01',
            trusted_root_authority: 'remote_root',
            allowed_claim_scopes: ['identity'],
        },
    }, { applyEvent });

    const projectionA = cloneState(ledger.current_authority_state);
    const eventLog = ledger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);
    assert.ok(eventLog.every((event) => event.version === 1));

    const replayLedger = createTestLedger();
    const replayApply = createApplyEvent(replayLedger);
    for (const event of eventLog) {
        replayApply(event, true);
    }
    replayLedger.event_log = eventLog;
    rebuildAuthorityStateOnLedger(replayLedger);

    const projectionB = cloneState(replayLedger.current_authority_state);
    assert.deepStrictEqual(projectionB, projectionA);
}

// hash chain continuity detects broken previous_event_hash links
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, deviceRevokeProposal(3), { applyEvent });

    const brokenLog = ledger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    brokenLog[2].previous_event_hash = 'broken_previous_hash';

    assert.throws(() => verifyRealmEventHistory(brokenLog), /REALM_EVENT_CHAIN_BROKEN:sequence_3/);
    assert.throws(() => buildCurrentAuthorityState(brokenLog), /REALM_EVENT_CHAIN_BROKEN:sequence_3/);
}

// payload mutation changes canonical hash material and is rejected during replay
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });

    const mutatedLog = ledger.event_log.map((event) => JSON.parse(JSON.stringify(event)));
    mutatedLog[1].payload.device_id = 'device_mutated';

    assert.throws(() => verifyRealmEventHistory(mutatedLog), /REALM_EVENT_HASH_MISMATCH:sequence_2/);
    const replayLedger = createTestLedger();
    replayLedger.event_log = mutatedLog;
    assert.throws(() => rebuildAuthorityStateOnLedger(replayLedger), /REALM_EVENT_HASH_MISMATCH:sequence_2/);
}

// history verification happens before projection mutation (no half-replayed projection)
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    acceptRoot(ledger, applyEvent);
    acceptAndApplyRealmEvent(ledger, deviceIssueProposal(2), { applyEvent });
    acceptAndApplyRealmEvent(ledger, deviceRevokeProposal(3), { applyEvent });

    const validProjection = cloneState(ledger.current_authority_state);
    const validSequence = ledger.realm_canonical_sequence;

    // Corrupt event N in the canonical log after a valid projection already exists.
    ledger.event_log[1].payload.device_id = 'device_tampered';

    // Rebuild must reject and must NOT partially mutate the existing projection.
    assert.throws(() => rebuildAuthorityStateOnLedger(ledger), /REALM_EVENT_HASH_MISMATCH:sequence_2/);
    assert.deepStrictEqual(ledger.current_authority_state, validProjection);
    assert.strictEqual(ledger.realm_canonical_sequence, validSequence);
}

console.log('test-realm-validator-engine: all tests passed');
