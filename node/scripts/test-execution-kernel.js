#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { execute } = require('../execution-kernel/executor');

const repoRoot = path.resolve(__dirname, '..', '..');
const nodeRoot = path.resolve(__dirname, '..');
const compiler = path.join(__dirname, 'compile-truth-spec.js');

function generatedSdga() {
  const output = execFileSync(process.execPath, [compiler, '--decision-graph'], {
    cwd: nodeRoot,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function testExecutesGeneratedSdga() {
  const sdga = generatedSdga();
  const result = execute(sdga);
  assert.equal(result.schema_version, 'simple-l1.execution_result_envelope.v1');
  assert.equal(result.kernel_contract, 'EKC_v0');
  assert.equal(result.execution_status, 'completed');
  assert.equal(result.completion_state, 'deterministic_complete');
  assert.equal(result.guard_artifact_hash, sdga.guard_artifact_hash);
  assert.deepEqual(result.semantic_capability, {
    reads_truth_spec: false,
    evaluates_policy: false,
    evaluates_guards: false,
    branches_on_conditions: false,
    infers_meaning: false,
    modifies_graph: false,
  });
  assert.deepEqual(
    result.node_results.map((node) => node.node_id),
    ['emit_guard_artifact', 'emit_invariant_report'],
  );
}

function testRejectsTamperedGraphHash() {
  const sdga = generatedSdga();
  sdga.graph.nodes[0].inputs.guard_artifact_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  assert.throws(() => execute(sdga), /graph hash does not match/);
}

function testRejectsCycles() {
  const sdga = generatedSdga();
  sdga.graph.edges.push({
    from: 'emit_invariant_report',
    to: 'emit_guard_artifact',
    ordering: 'after',
  });
  // Recompute the graph hash so the topology failure is isolated from identity failure.
  const helper = `
const { stableJson } = require(${JSON.stringify(path.join(nodeRoot, 'execution-kernel', 'canonical-json'))});
const { sha256 } = require(${JSON.stringify(path.join(nodeRoot, 'execution-kernel', 'hash'))});
const sdga = JSON.parse(process.argv[1]);
console.log(sha256(stableJson(sdga.graph)));
`;
  sdga.decision_graph_hash = execFileSync(process.execPath, ['-e', helper, JSON.stringify(sdga)], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.throws(() => execute(sdga), /Cycle detected/);
}

testExecutesGeneratedSdga();
testRejectsTamperedGraphHash();
testRejectsCycles();

console.log('PASS Execution Kernel v0 executes SDGA mechanically and rejects invalid artifacts');
