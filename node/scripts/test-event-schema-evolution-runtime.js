'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    attachRealmEventHashChain,
    verifyRealmEventHistory,
} = require('../realm-event-history');
const { buildCurrentAuthorityState } = require('../current-authority-state');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'realm-history', 'v1');
const historyPath = path.join(fixtureDir, 'authority-basic.jsonl');
const expectedStatePath = path.join(fixtureDir, 'expected-state.json');

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

// Historical v1 fixtures replay under the current registry without rewriting history.
{
    const originalBytes = fs.readFileSync(historyPath, 'utf8');
    const eventLog = readJsonl(historyPath);
    const originalEvents = clone(eventLog);
    const originalHashes = eventLog.map((event) => ({
        id: event.id,
        event_id: event.event_id,
        previous_event_hash: event.previous_event_hash,
        current_event_hash: event.current_event_hash,
    }));
    const expectedState = JSON.parse(fs.readFileSync(expectedStatePath, 'utf8'));

    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const rebuiltState = buildCurrentAuthorityState(eventLog);
    assert.deepStrictEqual(rebuiltState, expectedState);

    assert.deepStrictEqual(eventLog, originalEvents, 'migration adapter must not mutate parsed event log');
    assert.deepStrictEqual(eventLog.map((event) => ({
        id: event.id,
        event_id: event.event_id,
        previous_event_hash: event.previous_event_hash,
        current_event_hash: event.current_event_hash,
    })), originalHashes, 'migration adapter must not change event identity or hashes');
    assert.strictEqual(fs.readFileSync(historyPath, 'utf8'), originalBytes, 'fixture bytes must remain unchanged');
}

// Every historical event version must have an explicit interpretation path.
{
    const timestamp = '2026-06-27T00:00:00.000Z';
    const unsupported = attachRealmEventHashChain({
        type: 'ROOT_AUTHORITY_CREATED',
        realm_event: true,
        version: 0,
        projection_version: 1,
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: 'unsupported_root_ref',
            authority_reference: 'unsupported_root_ref',
            sequence: 1,
            timestamp,
            previous_event_hash: null,
        },
        payload: {
            root_id: 'unsupported_root',
            public_key: 'pk_unsupported_root',
        },
        signer: 'unsupported_root_ref',
        authority_reference: 'unsupported_root_ref',
        sequence: 1,
        timestamp,
        accepted_at: timestamp,
    }, null);

    assert.strictEqual(verifyRealmEventHistory([unsupported]), true);
    assert.throws(
        () => buildCurrentAuthorityState([unsupported]),
        /REPLAY_UNSUPPORTED_EVENT_VERSION:ROOT_AUTHORITY_CREATED:version_0/,
    );
}

console.log('test-event-schema-evolution-runtime: all tests passed');
