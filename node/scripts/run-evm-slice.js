#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { canonicalizeEthReceipt } = require('../evm-canonicalizer');
const { evaluateFpl } = require('../finality-policy-language');
const { reconcile } = require('../reconciliation-layer');

const repoRoot = path.resolve(__dirname, '..', '..');
const testVectorsDir = path.join(repoRoot, 'test-vectors');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function reconciliationFixturePaths() {
    return fs.readdirSync(testVectorsDir)
        .filter((name) => /^reconciliation-v0-.*\.json$/.test(name))
        .sort()
        .map((name) => path.join(testVectorsDir, name));
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

function fplVerdictForCase(graph, testCase) {
    if (!testCase.fpl_context) {
        return testCase.fpl_verdict;
    }

    const actual = evaluateFpl(graph, testCase.fpl_context);
    if (testCase.fpl_verdict) {
        assert.deepStrictEqual(actual, testCase.fpl_verdict, `${testCase.id}: fpl_verdict`);
    }
    return actual;
}

function testFixtureFile(fixturePath) {
    const fixture = readJson(fixturePath);
    assert.equal(fixture.lock.status, 'frozen');
    const resultsById = new Map();

    for (const testCase of fixture.cases) {
        const graph = graphForCase(testCase);
        const fplVerdict = fplVerdictForCase(graph, testCase);
        const actual = reconcile(graph, fplVerdict, testCase.intent);
        assert.deepStrictEqual(actual, testCase.expected, testCase.id);
        assert.equal(actual.ownership_verdict, null, `${testCase.id}: ownership_verdict`);
        assert.equal(actual.state_mutation, null, `${testCase.id}: state_mutation`);

        if (testCase.expected_same_as) {
            const expectedSame = resultsById.get(testCase.expected_same_as.case_id);
            assert.deepStrictEqual(actual, expectedSame, `${testCase.id}: expected_same_as`);
        }
        resultsById.set(testCase.id, actual);
    }
}

for (const fixturePath of reconciliationFixturePaths()) {
    testFixtureFile(fixturePath);
}

console.log('PASS EVM slice fixtures canonicalize, pass FPL, and reconcile without ownership or mutation');
