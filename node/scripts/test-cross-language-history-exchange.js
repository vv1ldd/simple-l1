#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    attachRealmEventHashChain,
    canonicalEncode,
    verifyRealmEventHistory,
} = require('../realm-event-history');

const repoRoot = path.join(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'docs', 'protocol', 'v1', 'vectors');
const fixtureHistoryPath = path.join(vectorsDir, 'canonical', 'authority-basic', 'history.jsonl');
const expectedAnchorsPath = path.join(vectorsDir, 'canonical', 'authority-basic', 'expected-anchors.json');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const rustBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function parseJsonl(content) {
    return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, events) {
    fs.writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function buildNodeAuthorityBasicHistory() {
    const root = attachRealmEventHashChain({
        type: 'ROOT_AUTHORITY_CREATED',
        realm_event: true,
        version: 1,
        projection_version: 1,
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: 'fixture_root_ref',
            authority_reference: 'fixture_root_ref',
            sequence: 1,
            timestamp: '2026-06-27T00:00:00.000Z',
            previous_event_hash: null,
        },
        payload: {
            root_id: 'fixture_root',
            public_key: 'pk_fixture_root',
        },
        signer: 'fixture_root_ref',
        authority_reference: 'fixture_root_ref',
        sequence: 1,
        timestamp: '2026-06-27T00:00:00.000Z',
        accepted_at: '2026-06-27T00:00:00.000Z',
    }, null);

    const device = attachRealmEventHashChain({
        type: 'DEVICE_KEY_ISSUED',
        realm_event: true,
        version: 1,
        projection_version: 1,
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: 'fixture_root_ref',
            authority_reference: 'fixture_root_ref',
            sequence: 2,
            timestamp: '2026-06-27T00:00:00.000Z',
            previous_event_hash: null,
        },
        payload: {
            device: 'fixture_device_01',
            publicKey: 'pk_fixture_device',
            device_authority: 'device:fixture_device_01',
        },
        signer: 'fixture_root_ref',
        authority_reference: 'fixture_root_ref',
        sequence: 2,
        timestamp: '2026-06-27T00:00:00.000Z',
        accepted_at: '2026-06-27T00:00:00.000Z',
    }, root.current_event_hash);

    return [root, device];
}

function nodeReplayAnchors(historyPath) {
    return JSON.parse(execFileSync(process.execPath, [
        path.join(__dirname, 'emit-independent-anchors.js'),
        historyPath,
    ], { encoding: 'utf8' }));
}

function rustReplayAnchors(historyPath) {
    return JSON.parse(execFileSync(rustBinary, ['--replay', historyPath], { encoding: 'utf8' }));
}

if (!fs.existsSync(rustBinary)) {
    execFileSync('cargo', ['build', '--release'], {
        cwd: rustDir,
        stdio: 'inherit',
    });
}

const expectedAnchors = readJson(expectedAnchorsPath);
const fixtureHistory = readJsonl(fixtureHistoryPath);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-history-exchange-'));

const nodeHistoryPath = path.join(tmpDir, 'node-exported-history.jsonl');
const rustHistoryPath = path.join(tmpDir, 'rust-exported-history.jsonl');

const nodeHistory = buildNodeAuthorityBasicHistory();
verifyRealmEventHistory(nodeHistory);
writeJsonl(nodeHistoryPath, nodeHistory);

const rustExportedHistory = parseJsonl(execFileSync(rustBinary, ['--export-authority-basic'], {
    encoding: 'utf8',
}));
verifyRealmEventHistory(rustExportedHistory);
writeJsonl(rustHistoryPath, rustExportedHistory);

assert.strictEqual(canonicalEncode(nodeHistory), canonicalEncode(fixtureHistory));
assert.strictEqual(canonicalEncode(rustExportedHistory), canonicalEncode(fixtureHistory));

assert.deepStrictEqual(rustReplayAnchors(nodeHistoryPath), expectedAnchors);
assert.deepStrictEqual(nodeReplayAnchors(rustHistoryPath), expectedAnchors);
assert.deepStrictEqual(rustReplayAnchors(rustHistoryPath), nodeReplayAnchors(nodeHistoryPath));

console.log('test-cross-language-history-exchange: all tests passed');
