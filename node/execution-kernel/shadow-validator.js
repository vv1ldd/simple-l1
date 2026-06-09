const { stableJson } = require('./canonical-json');
const { sha256 } = require('./hash');

function resultHash(result) {
  return sha256(stableJson(result));
}

function nodeKey(result) {
  return `${result.node_id}:${result.operation}`;
}

function compareNodeResults(kernelResults, runtimeResults) {
  const divergences = [];
  const runtimeByKey = new Map((runtimeResults || []).map((result) => [nodeKey(result), result]));
  const kernelByKey = new Map((kernelResults || []).map((result) => [nodeKey(result), result]));

  for (const result of kernelResults || []) {
    const runtime = runtimeByKey.get(nodeKey(result));
    if (!runtime) {
      divergences.push({
        node_id: result.node_id,
        diff_type: 'missing_node',
      });
      continue;
    }
    if (runtime.status !== result.status) {
      divergences.push({
        node_id: result.node_id,
        diff_type: 'status_mismatch',
      });
    }
    if (runtime.output_ref !== result.output_ref) {
      divergences.push({
        node_id: result.node_id,
        diff_type: 'output_ref_mismatch',
      });
    }
  }

  for (const result of runtimeResults || []) {
    if (!kernelByKey.has(nodeKey(result))) {
      divergences.push({
        node_id: result.node_id,
        diff_type: 'unexpected_node',
      });
    }
  }

  return divergences;
}

function compareShadowExecution({ correlationId, sdga, kernelResult, runtimeObservation, observedAt = '1970-01-01T00:00:00.000Z' }) {
  const divergences = [];
  const kernelHash = resultHash(kernelResult);
  const runtimeHash = resultHash(runtimeObservation);
  const common = {
    schema_version: 'simple-l1.shadow_divergence_record.v1',
    artifact_type: 'shadow_divergence_record',
    phase: 'SEVP_v0',
    correlation_id: correlationId,
    sdga_hash: kernelResult.sdga_hash,
    guard_artifact_hash: kernelResult.guard_artifact_hash || sdga.guard_artifact_hash,
    kernel_result_hash: kernelHash,
    runtime_result_hash: runtimeHash,
    observed_at: observedAt,
    production_effect: 'none',
  };

  const fields = ['execution_status', 'completion_state', 'guard_artifact_hash', 'sdga_hash'];
  for (const field of fields) {
    if (kernelResult[field] !== runtimeObservation[field]) {
      divergences.push({
        ...common,
        divergence_type: 'value_mismatch',
        field,
        expected: kernelResult[field],
        observed: runtimeObservation[field],
        node_level_diff: [],
        severity: field === 'execution_status' ? 'blocker' : 'warn',
      });
    }
  }

  const kernelOrder = (kernelResult.node_results || []).map((result) => result.node_id).join('\n');
  const runtimeOrder = (runtimeObservation.node_results || []).map((result) => result.node_id).join('\n');
  if (kernelOrder !== runtimeOrder) {
    divergences.push({
      ...common,
      divergence_type: 'order_mismatch',
      field: 'node_results',
      expected: kernelOrder,
      observed: runtimeOrder,
      node_level_diff: compareNodeResults(kernelResult.node_results, runtimeObservation.node_results),
      severity: 'blocker',
    });
  } else {
    const nodeDiffs = compareNodeResults(kernelResult.node_results, runtimeObservation.node_results);
    if (nodeDiffs.length > 0) {
      divergences.push({
        ...common,
        divergence_type: 'value_mismatch',
        field: 'node_results',
        expected: kernelResult.node_results,
        observed: runtimeObservation.node_results,
        node_level_diff: nodeDiffs,
        severity: 'warn',
      });
    }
  }

  return {
    ok: divergences.length === 0,
    kernel_result_hash: kernelHash,
    runtime_result_hash: runtimeHash,
    divergences,
  };
}

module.exports = {
  compareShadowExecution,
  resultHash,
};
