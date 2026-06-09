#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canonicalizeEthReceipt } = require('../evm-canonicalizer');

const fixturePaths = [
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-eth-transfer-v1.json'),
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-erc20-transfer-v1.json'),
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-reverted-transaction-v1.json'),
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-multi-log-transaction-v1.json'),
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-unknown-event-v1.json'),
    path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-partial-logs-v1.json'),
];
const replayFixturePath = path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-duplicate-log-replay-v1.json');
const reorgFixturePath = path.resolve(__dirname, '..', '..', 'test-vectors', 'evm-reorg-observation-v1.json');

function readFixture(fixturePath) {
    return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function testFrozenFixture(fixturePath) {
    const fixture = readFixture(fixturePath);
    const actual = canonicalizeEthReceipt(fixture.input);
    const expected = fixture.expected;

    assert.equal(fixture.lock.status, 'frozen');
    assert.equal(actual.fact_id, expected.fact_id);
    assert.equal(actual.canonical_fact_json, expected.canonical_fact_json);
    assert.deepStrictEqual(actual.canonical_fact, expected.canonical_fact);
    if (expected.graph_json) assert.equal(actual.graph_json, expected.graph_json);
    if (expected.graph_json_sha256) assert.equal(sha256(actual.graph_json), expected.graph_json_sha256);
    if (expected.graph) assert.deepStrictEqual(actual.graph, expected.graph);
    if (expected.facts) assert.deepStrictEqual(actual.facts, expected.facts);
    if (expected.facts_json) assert.deepStrictEqual(actual.facts_json, expected.facts_json);
    if (expected.ordered_fact_ids) {
        assert.deepStrictEqual(actual.graph.facts.map((fact) => fact.fact_id), expected.ordered_fact_ids);
    }
    if (expected.ordered_node_ids) {
        assert.deepStrictEqual(actual.graph.sdga_projection.nodes.map((node) => node.id), expected.ordered_node_ids);
    }
    if (expected.ordered_edges) {
        assert.deepStrictEqual(
            actual.graph.sdga_projection.edges.map((edge) => [edge.from, edge.to, edge.ordering]),
            expected.ordered_edges,
        );
    }
    if (expected.observation) {
        assert.deepStrictEqual(actual.graph.observation, expected.observation);
    }
    if (Number.isInteger(expected.synthetic_log_fact_count)) {
        assert.equal(
            actual.graph.facts.filter((fact) => fact.fact_type === 'EVM_LOG').length,
            expected.synthetic_log_fact_count,
        );
    }
    if (expected.forbidden_node_types) {
        const actualNodeTypes = actual.graph.sdga_projection.nodes.map((node) => node.node_type);
        for (const forbiddenType of expected.forbidden_node_types) {
            assert.equal(actualNodeTypes.includes(forbiddenType), false);
        }
    }
}

function testReplayFixture(fixturePath) {
    const fixture = readFixture(fixturePath);
    const [firstInput, replayInput] = fixture.observations;
    const first = canonicalizeEthReceipt(firstInput);
    const replay = canonicalizeEthReceipt(replayInput);
    const expected = fixture.expected;

    assert.equal(fixture.lock.status, 'frozen');
    assert.equal(first.fact_id, expected.first_fact_id);
    assert.equal(replay.fact_id, expected.replay_fact_id);
    assert.equal(sha256(first.graph_json), expected.first_graph_json_sha256);
    assert.equal(sha256(replay.graph_json), expected.replay_graph_json_sha256);
    assert.equal(first.graph_json === replay.graph_json, expected.identity_equal);
    assert.deepStrictEqual(first.graph.facts.map((fact) => fact.fact_id), expected.ordered_fact_ids);
    assert.deepStrictEqual(replay.graph.facts.map((fact) => fact.fact_id), expected.ordered_fact_ids);
    assert.deepStrictEqual(first.graph.sdga_projection.nodes.map((node) => node.id), expected.ordered_node_ids);
    assert.deepStrictEqual(replay.graph.sdga_projection.nodes.map((node) => node.id), expected.ordered_node_ids);

    const firstFactIds = new Set(first.graph.facts.map((fact) => fact.fact_id));
    const replayFactIds = new Set(replay.graph.facts.map((fact) => fact.fact_id));
    const newFactCount = [...replayFactIds].filter((factId) => !firstFactIds.has(factId)).length;
    assert.equal(newFactCount, expected.new_fact_count);
}

function testReorgFixture(fixturePath) {
    const fixture = readFixture(fixturePath);
    const [firstInput, secondInput] = fixture.observations;
    const first = canonicalizeEthReceipt(firstInput);
    const second = canonicalizeEthReceipt(secondInput);
    const expected = fixture.expected;

    assert.equal(fixture.lock.status, 'frozen');
    assert.equal(first.canonical_fact.chain_id === second.canonical_fact.chain_id, expected.same_chain_id);
    assert.equal(first.canonical_fact.tx_hash === second.canonical_fact.tx_hash, expected.same_tx_hash);
    assert.equal(first.canonical_fact.block_hash === second.canonical_fact.block_hash, expected.block_hash_equal);
    assert.equal(first.fact_id === second.fact_id, expected.fact_id_equal);
    assert.equal(first.graph_json === second.graph_json, expected.graph_identity_equal);
    assert.equal(first.fact_id, expected.observation_a.fact_id);
    assert.equal(second.fact_id, expected.observation_b.fact_id);
    assert.equal(sha256(first.graph_json), expected.observation_a.graph_json_sha256);
    assert.equal(sha256(second.graph_json), expected.observation_b.graph_json_sha256);
    assert.equal(first.canonical_fact.block_hash, expected.observation_a.block_hash);
    assert.equal(second.canonical_fact.block_hash, expected.observation_b.block_hash);
    assert.equal(first.canonical_fact.block_number, expected.observation_a.block_number);
    assert.equal(second.canonical_fact.block_number, expected.observation_b.block_number);
    assert.equal(expected.verdict, null);
}

function sha256(value) {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

for (const fixturePath of fixturePaths) {
    testFrozenFixture(fixturePath);
}
testReplayFixture(replayFixturePath);
testReorgFixture(reorgFixturePath);

console.log('PASS EVM canonicalization fixtures are byte-stable for frozen ETH, ERC20, revert, multi-log, unknown-event, partial-observation, duplicate-replay, and reorg-observation slices');
