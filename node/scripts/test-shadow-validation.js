#!/usr/bin/env node

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { execute } = require('../execution-kernel/executor');
const { compareShadowExecution } = require('../execution-kernel/shadow-validator');

const nodeRoot = path.resolve(__dirname, '..');
const compiler = path.join(__dirname, 'compile-truth-spec.js');

function generatedSdga() {
  const output = execFileSync(process.execPath, [compiler, '--decision-graph'], {
    cwd: nodeRoot,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function testNoDivergence() {
  const sdga = generatedSdga();
  const kernelResult = execute(sdga);
  const comparison = compareShadowExecution({
    correlationId: 'identity-execution',
    sdga,
    kernelResult,
    runtimeObservation: JSON.parse(JSON.stringify(kernelResult)),
  });
  assert.equal(comparison.ok, true);
  assert.deepEqual(comparison.divergences, []);
}

function testOrderingDivergence() {
  const sdga = generatedSdga();
  const kernelResult = execute(sdga);
  const runtimeObservation = JSON.parse(JSON.stringify(kernelResult));
  runtimeObservation.node_results = runtimeObservation.node_results.slice().reverse();
  const comparison = compareShadowExecution({
    correlationId: 'execution-ordering',
    sdga,
    kernelResult,
    runtimeObservation,
  });
  assert.equal(comparison.ok, false);
  assert(comparison.divergences.some((record) => record.divergence_type === 'order_mismatch'));
  assert(comparison.divergences.every((record) => record.production_effect === 'none'));
}

function testFailureParityDivergence() {
  const sdga = generatedSdga();
  const kernelResult = execute(sdga);
  const runtimeObservation = JSON.parse(JSON.stringify(kernelResult));
  runtimeObservation.execution_status = 'execution_failed';
  runtimeObservation.completion_state = 'partial_failure';
  const comparison = compareShadowExecution({
    correlationId: 'failure-parity',
    sdga,
    kernelResult,
    runtimeObservation,
  });
  assert.equal(comparison.ok, false);
  assert(comparison.divergences.some((record) => record.field === 'execution_status'));
  assert(comparison.divergences.every((record) => record.production_effect === 'none'));
}

testNoDivergence();
testOrderingDivergence();
testFailureParityDivergence();

console.log('PASS Shadow validation detects identity, ordering, and failure parity divergences without production effects');
