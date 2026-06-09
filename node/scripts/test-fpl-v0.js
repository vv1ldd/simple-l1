#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { canonicalizeEthReceipt } = require('../evm-canonicalizer');
const { evaluateFpl } = require('../finality-policy-language');

const repoRoot = path.resolve(__dirname, '..', '..');
const fplFixturePath = path.join(repoRoot, 'test-vectors', 'fpl-v0-eligibility-v1.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function graphForFixture(ref) {
    const [fileName, observationIndex] = ref.split('#');
    const fixture = readJson(path.join(repoRoot, 'test-vectors', fileName));
    const input = observationIndex === undefined
        ? fixture.input
        : fixture.observations[Number(observationIndex)];
    return canonicalizeEthReceipt(input).graph;
}

function testFplFixtures() {
    const fixture = readJson(fplFixturePath);
    assert.equal(fixture.lock.status, 'frozen');

    for (const testCase of fixture.cases) {
        const graph = graphForFixture(testCase.graph_fixture);
        const actual = evaluateFpl(graph, testCase.context);
        assert.deepStrictEqual(actual, testCase.expected, testCase.id);
        assert.equal(actual.semantic_interpretation_allowed, false);
        assert.equal(actual.ownership_verdict, null);
        assert.equal(actual.reconciliation_output, null);
    }
}

testFplFixtures();

console.log('PASS FPL v0 eligibility fixtures are byte-stable and non-semantic');
