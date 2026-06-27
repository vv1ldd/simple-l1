#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildShadowReport,
    compareAnchors,
    defaultRustBinary,
    ensureRustBinary,
    verifyShadowHistory,
} = require('./realm-shadow-verify');

const repoRoot = path.join(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'docs', 'protocol', 'v1', 'vectors');
const canonicalHistory = path.join(vectorsDir, 'canonical', 'authority-basic', 'history.jsonl');
const brokenHistory = path.join(vectorsDir, 'negative', 'hash-chain-broken', 'history.jsonl');

{
    const rustBinary = ensureRustBinary(defaultRustBinary);
    assert.ok(fs.existsSync(rustBinary));

    const report = verifyShadowHistory(canonicalHistory, { rustBinary });
    assert.strictEqual(report.status, 'OK');
    assert.strictEqual(report.semantic_health, 'OK');
    assert.deepStrictEqual(report.differences, []);
    assert.ok(report.node.history_head);
    assert.ok(report.rust.history_head);
    assert.strictEqual(report.node.history_head, report.rust.history_head);
    assert.strictEqual(report.node.projection_hash, report.rust.projection_hash);
}

{
    const nodeAnchors = {
        history_head: 'aaa',
        projection_hash: 'bbb',
        current_authority: 'alice',
        last_sequence: 2,
        canonical_event_count: 2,
        authority_subjects: [{ kind: 'root', ref: 'alice', status: 'active' }],
    };
    const rustAnchors = {
        ...nodeAnchors,
        current_authority: 'bob',
    };
    const differences = compareAnchors(nodeAnchors, rustAnchors);
    assert.strictEqual(differences.length, 1);
    assert.strictEqual(differences[0].path, 'current_authority');
    assert.strictEqual(differences[0].node, 'alice');
    assert.strictEqual(differences[0].rust, 'bob');
}

{
    const rustBinary = ensureRustBinary(defaultRustBinary);
    const report = verifyShadowHistory(brokenHistory, { rustBinary });
    assert.strictEqual(report.semantic_health, 'FAIL');
    assert.notStrictEqual(report.status, 'OK');
    assert.ok(report.error || report.differences.length > 0);
}

{
    const rustBinary = ensureRustBinary(defaultRustBinary);
    const baseline = verifyShadowHistory(canonicalHistory, { rustBinary });
    const rustAnchors = {
        ...baseline.node,
        current_authority: 'diverged_authority',
    };
    const differences = compareAnchors(baseline.node, rustAnchors);
    const report = buildShadowReport({
        historyPath: canonicalHistory,
        nodeAnchors: baseline.node,
        rustAnchors,
        differences,
    });
    assert.strictEqual(report.status, 'DIVERGED');
    assert.strictEqual(report.semantic_health, 'FAIL');
    assert.ok(report.differences.length > 0);
}

{
    assert.throws(
        () => ensureRustBinary(path.join(os.tmpdir(), 'missing-realm-interpreter'), { build: false }),
        /RUST_BINARY_NOT_FOUND:/,
    );
}

console.log('test-realm-shadow-verify: all tests passed');
