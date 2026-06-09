#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execute } = require('../execution-kernel/executor');

function readInput() {
  const inputPath = process.argv[2];
  if (inputPath) {
    return JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  }
  return JSON.parse(fs.readFileSync(0, 'utf8'));
}

try {
  const result = execute(readInput());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const payload = {
    schema_version: 'simple-l1.execution_result_envelope.v1',
    artifact_type: 'execution_result_envelope',
    kernel_contract: 'EKC_v0',
    sdga_hash: null,
    guard_artifact_hash: null,
    execution_status: 'rejected_identity',
    completion_state: 'not_started',
    semantic_capability: {
      reads_truth_spec: false,
      evaluates_policy: false,
      evaluates_guards: false,
      branches_on_conditions: false,
      infers_meaning: false,
      modifies_graph: false,
    },
    node_results: [],
  };
  payload.error = {
    code: error.code || 'INVALID_ARTIFACT',
    message: error.message,
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}
