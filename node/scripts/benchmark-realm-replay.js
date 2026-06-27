'use strict';

const assert = require('assert');
const { performance } = require('perf_hooks');
const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { createRealmSnapshot, rebuildFromSnapshot, verifyRealmSnapshot } = require('../realm-snapshot');
const { calculateProjectionHash } = require('../realm-observability');
const { latestRealmEventHash } = require('../realm-event-history');
const { verifyRealmIntegrity } = require('../realm-integrity-check');

const ROOT_REF = 'benchmark_root_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

function createLedger() {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: 'benchmark-root',
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
            root_id: 'benchmark_root',
            public_key: 'pk_benchmark_root',
        },
    };
}

function deviceIssueProposal(sequence) {
    const deviceId = `bench_device_${sequence}`;
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

function elapsedMs(fn) {
    const started = performance.now();
    const value = fn();
    return {
        value,
        ms: performance.now() - started,
    };
}

function parseEventCounts() {
    return String(process.env.REALM_BENCH_EVENTS || '10000')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function buildHistory(eventCount) {
    const ledger = createLedger();
    const applyEvent = createApplyEvent(ledger);
    const acceptRealmEvent = acceptRealmEventFor(ledger, applyEvent);

    assert.strictEqual(acceptRealmEvent(rootProposal(1)).ok, true);
    for (let sequence = 2; sequence <= eventCount; sequence += 1) {
        const result = acceptRealmEvent(deviceIssueProposal(sequence));
        if (!result.ok) {
            throw new Error(`BENCHMARK_EVENT_ACCEPTANCE_FAILED:${sequence}:${(result.reason_codes || []).join(',')}`);
        }
    }

    return ledger.event_log;
}

function buildSequenceIndex(eventLog) {
    const index = new Map();
    for (const event of eventLog) {
        index.set(Number(event.sequence ?? event.envelope?.sequence), event);
    }
    return index;
}

function indexedRange(index, fromSequence, toSequence) {
    const events = [];
    for (let sequence = fromSequence; sequence <= toSequence; sequence += 1) {
        const event = index.get(sequence);
        if (!event) {
            throw new Error(`INDEX_RANGE_MISSING_SEQUENCE:${sequence}`);
        }
        events.push(event);
    }
    return events;
}

function runBenchmark(eventCount) {
    const historyBuild = elapsedMs(() => buildHistory(eventCount));
    const eventLog = historyBuild.value;
    const expectedHistoryHead = latestRealmEventHash(eventLog);

    const fullReplay = elapsedMs(() => buildCurrentAuthorityState(eventLog));
    const fullProjectionHash = calculateProjectionHash(fullReplay.value);

    const snapshotSequence = Math.max(1, Math.floor(eventCount * Number(process.env.REALM_BENCH_SNAPSHOT_PREFIX || 0.9)));
    const snapshotCreate = elapsedMs(() => createRealmSnapshot({ event_log: eventLog }, { lastSequence: snapshotSequence }));
    const snapshotVerify = elapsedMs(() => verifyRealmSnapshot({ event_log: eventLog }, snapshotCreate.value));
    const snapshotReplay = elapsedMs(() => rebuildFromSnapshot({ event_log: eventLog }, snapshotCreate.value));
    const snapshotProjectionHash = calculateProjectionHash(snapshotReplay.value);

    const indexBuild = elapsedMs(() => buildSequenceIndex(eventLog));
    const indexedRangeRead = elapsedMs(() => indexedRange(indexBuild.value, 1, eventCount));
    const indexedReplay = elapsedMs(() => buildCurrentAuthorityState(indexedRangeRead.value));
    const indexedProjectionHash = calculateProjectionHash(indexedReplay.value);

    const integrityCheck = elapsedMs(() => verifyRealmIntegrity({
        event_log: eventLog,
        current_authority_state: fullReplay.value,
    }, {
        snapshot: snapshotCreate.value,
        executionStore: { list: () => [] },
    }));

    const projectionHashEqual = fullProjectionHash === snapshotProjectionHash
        && fullProjectionHash === indexedProjectionHash;
    const historyHeadEqual = expectedHistoryHead === latestRealmEventHash(indexedRangeRead.value);

    assert.strictEqual(projectionHashEqual, true);
    assert.strictEqual(historyHeadEqual, true);
    assert.strictEqual(integrityCheck.value.realm_valid, true);

    return {
        events: eventCount,
        history_build_ms: Number(historyBuild.ms.toFixed(3)),
        full_replay_ms: Number(fullReplay.ms.toFixed(3)),
        snapshot_create_ms: Number(snapshotCreate.ms.toFixed(3)),
        snapshot_verify_ms: Number(snapshotVerify.ms.toFixed(3)),
        snapshot_restore_ms: Number(snapshotReplay.ms.toFixed(3)),
        index_build_ms: Number(indexBuild.ms.toFixed(3)),
        indexed_range_read_ms: Number(indexedRangeRead.ms.toFixed(3)),
        indexed_replay_ms: Number(indexedReplay.ms.toFixed(3)),
        verify_ms: Number(integrityCheck.ms.toFixed(3)),
        events_per_second_full_replay: Number((eventCount / (fullReplay.ms / 1000)).toFixed(2)),
        events_per_second_indexed_replay: Number((eventCount / (indexedReplay.ms / 1000)).toFixed(2)),
        projection_hash_equal: projectionHashEqual,
        history_head_equal: historyHeadEqual,
        integrity_realm_valid: integrityCheck.value.realm_valid,
        history_head: expectedHistoryHead,
        projection_hash: fullProjectionHash,
        snapshot_sequence: snapshotSequence,
    };
}

const results = parseEventCounts().map(runBenchmark);
console.log(JSON.stringify({
    benchmark: 'realm-replay',
    generated_at: new Date().toISOString(),
    event_counts: results.map((result) => result.events),
    results,
}, null, 2));
