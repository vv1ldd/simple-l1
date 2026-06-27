'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { canonicalEncode } = require('../realm-event-history');
const { signDeviceProposal } = require('../device-event-submission-runtime');
const {
    CONFORMANCE_ANCHOR_KEYS,
    deriveConformanceAnchors,
    runProtocolConformanceGate,
} = require('../realm-protocol-conformance');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'realm-history', 'v1');
const historyPath = path.join(fixtureDir, 'authority-basic.jsonl');

const ROOT_REF = 'conformance_root_ref';
const DEVICE_ID = 'conformance_device';
const DEVICE_REF = `device:${DEVICE_ID}`;
const DEVICE_KEY = 'pk_conformance_device';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

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
        payload: { root_id: 'conformance_root', public_key: 'pk_conformance_root' },
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
        payload: { device_id: DEVICE_ID, public_key: DEVICE_KEY, authority_ref: DEVICE_REF },
    };
}

function sessionIssueProposal(sequence = 3) {
    return {
        envelope: {
            type: 'SESSION_AUTHORITY_ISSUED',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            session_id: 'conformance_session',
            device_ref: DEVICE_ID,
            authority_ref: 'session:conformance_session',
        },
    };
}

function buildRealmHistory() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const accept = acceptRealmEventFor(ledger, applyEvent);
    assert.strictEqual(accept(rootProposal(1)).ok, true);
    assert.strictEqual(accept(deviceIssueProposal(2)).ok, true);
    assert.strictEqual(
        accept({
            proposal: sessionIssueProposal(3),
            signature: signDeviceProposal(sessionIssueProposal(3), DEVICE_KEY),
        }.proposal).ok,
        true,
    );
    return clone(ledger.event_log);
}

// 1. compatible pre/post interpreters prove the same semantic Realm
{
    const eventLog = buildRealmHistory();
    const result = runProtocolConformanceGate(eventLog, {
        preRuntime: { version: 'runtime-1.0' },
        postRuntime: { version: 'runtime-1.1-compatible' },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.anchors.realm_valid, true);
    assert.ok(result.anchors.history_head);
    assert.ok(result.anchors.projection_hash);
    for (const key of CONFORMANCE_ANCHOR_KEYS) {
        assert.ok(key in result.anchors, `anchor ${key} must be present`);
    }
}

// 2. fixture history passes the conformance gate across interpreter versions
{
    const eventLog = readJsonl(historyPath);
    const result = runProtocolConformanceGate(eventLog, {
        preRuntime: { version: 'fixture-v1' },
        postRuntime: { version: 'fixture-v1-replayer' },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.anchors.realm_valid, true);
}

// 3. compatible-looking runtime that silently reinterprets history fails the gate
{
    const eventLog = buildRealmHistory();
    const reinterpretingRuntime = {
        version: 'claims-compatible-but-reinterprets',
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    };

    const result = runProtocolConformanceGate(eventLog, {
        preRuntime: { version: 'runtime-1.0' },
        postRuntime: reinterpretingRuntime,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROTOCOL_CONFORMANCE_FAILED'));
    const mismatchedAnchors = result.mismatches.map((entry) => entry.anchor);
    assert.ok(mismatchedAnchors.includes('lifecycle_state'));
    assert.ok(mismatchedAnchors.includes('explanation_projection_hash'));
    assert.strictEqual(result.post_anchors.lifecycle_state, 'SUSPENDED');
}

// 4. running the gate never mutates accepted history bytes
{
    const eventLog = buildRealmHistory();
    const bytesBefore = canonicalEncode(eventLog);
    runProtocolConformanceGate(eventLog, {
        preRuntime: { version: 'runtime-1.0' },
        postRuntime: {
            version: 'reinterprets',
            interpret(history) {
                const projection = buildCurrentAuthorityState(history);
                projection.rootAuthority = { ...projection.rootAuthority, status: 'revoked' };
                return projection;
            },
        },
    });
    assert.strictEqual(canonicalEncode(eventLog), bytesBefore);
}

// 5. tampered history fails closed before any anchor comparison
{
    const eventLog = buildRealmHistory();
    eventLog[1].previous_event_hash = 'fake_previous_hash';
    const result = runProtocolConformanceGate(eventLog, {
        preRuntime: { version: 'runtime-1.0' },
        postRuntime: { version: 'runtime-1.1' },
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROTOCOL_HISTORY_VERIFICATION_FAILED'));
    assert.ok(String(result.error).includes('REALM_EVENT_CHAIN_BROKEN'));
}

// 6. anchors are deterministic: deriving twice yields identical fingerprints
{
    const eventLog = buildRealmHistory();
    const first = deriveConformanceAnchors(eventLog);
    const second = deriveConformanceAnchors(eventLog);
    assert.deepStrictEqual(first, second);
    assert.strictEqual(canonicalEncode(first), canonicalEncode(second));
}

console.log('test-protocol-conformance-suite: all tests passed');
