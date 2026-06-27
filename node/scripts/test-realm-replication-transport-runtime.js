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
const { createCommandExecutionStore } = require('../realm-command-execution');
const {
    attachRealmEventHashChain,
    latestRealmEventHash,
} = require('../realm-event-history');
const { createRealmSnapshot } = require('../realm-snapshot');
const {
    announceEventHead,
    receiveEventBatch,
    receiveSnapshot,
    requestMissingHistory,
    verifyTransportEnvelope,
} = require('../realm-replication-transport');

const ROOT_REF = 'transport_root_ref';
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

function rootProposal(sequence = 1, rootRef = ROOT_REF, rootId = 'transport_root') {
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

function deviceIssueProposal(sequence, signer = ROOT_REF, deviceId = 'transport_device') {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer,
            authority_reference: signer,
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

function acceptedTransportEvent(proposal, previousEventHash = null) {
    return attachRealmEventHashChain({
        type: proposal.envelope.type,
        realm_event: true,
        version: 1,
        projection_version: 1,
        envelope: proposal.envelope,
        payload: proposal.payload,
        signer: proposal.envelope.signer,
        authority_reference: proposal.envelope.authority_reference,
        sequence: proposal.envelope.sequence,
        timestamp: proposal.envelope.timestamp,
        accepted_at: TIMESTAMP,
    }, previousEventHash);
}

function eventBatch(events, previousEventHash, overrides = {}) {
    const head = events.length > 0
        ? events[events.length - 1].current_event_hash
        : previousEventHash;
    return {
        events,
        previous_event_hash: previousEventHash,
        head_hash: head,
        ...overrides,
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// received does not mean accepted: hash-valid transport evidence can still fail local authority policy
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);

    const beforeLog = clone(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);
    const localHead = latestRealmEventHash(ledger.event_log);
    const unauthorizedEvent = acceptedTransportEvent(
        deviceIssueProposal(2, 'remote_root_authority', 'remote_device'),
        localHead,
    );

    const batch = eventBatch([unauthorizedEvent], localHead, { delivery_id: 'delivery_received_not_accepted' });
    assert.strictEqual(verifyTransportEnvelope(batch, { ledger }).ok, true);

    const result = receiveEventBatch(batch, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    }, {
        executionStore: createCommandExecutionStore(),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// batch previous hash must match local head
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    const beforeLog = clone(ledger.event_log);

    const event = acceptedTransportEvent(deviceIssueProposal(2), 'not_the_local_head');
    const batch = eventBatch([event], 'not_the_local_head', { delivery_id: 'delivery_gap' });
    const result = receiveEventBatch(batch, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    }, {
        executionStore: createCommandExecutionStore(),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('TRANSPORT_HISTORY_GAP'));
    assert.deepStrictEqual(ledger.event_log, beforeLog);
}

// snapshot over transport remains cache: deletion falls back to history replay with same state
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);

    const snapshot = createRealmSnapshot(ledger, { lastSequence: 2 });
    const received = receiveSnapshot(snapshot, { source: ledger });
    assert.strictEqual(received.ok, true);
    assert.strictEqual(received.verification.ok, true);

    const snapshotDeletedReplay = buildCurrentAuthorityState(ledger.event_log);
    assert.deepStrictEqual(snapshotDeletedReplay, ledger.current_authority_state);
}

// remote state injection is rejected before command execution
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const beforeState = clone(ledger.current_authority_state);
    const batch = {
        events: [],
        previous_event_hash: null,
        head_hash: null,
        current_authority_state: {
            rootAuthority: {
                authorityRef: 'remote_root',
                status: 'active',
            },
        },
    };

    const result = receiveEventBatch(batch, {
        ledger,
        acceptRealmEvent: acceptRealmEventFor(ledger, applyEvent),
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('TRANSPORT_STATE_IMPORT_FORBIDDEN'));
    assert.strictEqual(ledger.event_log.length, 0);
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// same transport delivery uses command idempotency and creates a single accepted transition
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const executionStore = createCommandExecutionStore();
    const rootEvent = acceptedTransportEvent(rootProposal(1), null);
    const batch = eventBatch([rootEvent], null, { delivery_id: 'delivery_idempotent_root' });
    let acceptCalls = 0;
    const context = {
        ledger,
        acceptRealmEvent: (proposal) => {
            acceptCalls += 1;
            return acceptRealmEventFor(ledger, applyEvent)(proposal);
        },
    };

    const first = receiveEventBatch(batch, context, { executionStore });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.idempotent_replay, false);
    assert.strictEqual(first.accepted_event_ids.length, 1);
    assert.strictEqual(ledger.event_log.length, 1);

    const second = receiveEventBatch(batch, context, { executionStore });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.idempotent_replay, true);
    assert.deepStrictEqual(second.accepted_event_ids, first.accepted_event_ids);
    assert.strictEqual(acceptCalls, 1);
    assert.strictEqual(ledger.event_log.length, 1);
}

// discovery messages are transport metadata, not trust establishment
{
    const announcement = announceEventHead('head_hash_01', { remoteRealmId: 'remote_realm_01' });
    const request = requestMissingHistory('head_hash_01', { limit: 10 });

    assert.deepStrictEqual(announcement, {
        type: 'EVENT_HEAD_ANNOUNCEMENT',
        head_hash: 'head_hash_01',
        remote_realm_id: 'remote_realm_01',
    });
    assert.deepStrictEqual(request, {
        type: 'MISSING_HISTORY_REQUEST',
        after_hash: 'head_hash_01',
        limit: 10,
    });
}

console.log('test-realm-replication-transport-runtime: all tests passed');
