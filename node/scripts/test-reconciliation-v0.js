#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { canonicalizeEthReceipt } = require('../evm-canonicalizer');
const { reconcile } = require('../reconciliation-layer');

const repoRoot = path.resolve(__dirname, '..', '..');
const testVectorsDir = path.join(repoRoot, 'test-vectors');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function graphForCase(testCase) {
    const fileName = testCase.graph_fixture;
    const fixture = readJson(path.join(testVectorsDir, fileName));
    if (Array.isArray(fixture.observations)) {
        const observationIndex = Number(testCase.graph_observation_index ?? 0);
        return canonicalizeEthReceipt(fixture.observations[observationIndex]).graph;
    }
    return canonicalizeEthReceipt(fixture.input).graph;
}

function reconciliationFixturePaths() {
    return fs.readdirSync(testVectorsDir)
        .filter((name) => /^reconciliation-v0-.*\.json$/.test(name))
        .sort()
        .map((name) => path.join(testVectorsDir, name));
}

function testReconciliationFixtures(fixturePath) {
    const fixture = readJson(fixturePath);
    assert.equal(fixture.lock.status, 'frozen');
    const resultsById = new Map();

    for (const testCase of fixture.cases) {
        const graph = graphForCase(testCase);
        const actual = reconcile(graph, testCase.fpl_verdict, testCase.intent);
        assert.deepStrictEqual(actual, testCase.expected, testCase.id);
        assert.equal(actual.ownership_verdict, null);
        assert.equal(actual.state_mutation, null);

        if (testCase.expected_same_as) {
            const expectedSame = resultsById.get(testCase.expected_same_as.case_id);
            assert.deepStrictEqual(actual, expectedSame, `${testCase.id}: expected_same_as`);
        }
        resultsById.set(testCase.id, actual);
    }
}

for (const fixturePath of reconciliationFixturePaths()) {
    testReconciliationFixtures(fixturePath);
}

console.log('PASS Reconciliation v0 fixture files are byte-stable and non-mutating');
