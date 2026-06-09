function emitResultEnvelope({ context, status = 'completed', completionState = 'deterministic_complete' }) {
  return {
    schema_version: 'simple-l1.execution_result_envelope.v1',
    artifact_type: 'execution_result_envelope',
    kernel_contract: 'EKC_v0',
    sdga_hash: context.sdgaHash,
    guard_artifact_hash: context.guardArtifactHash,
    execution_status: status,
    completion_state: completionState,
    semantic_capability: {
      reads_truth_spec: false,
      evaluates_policy: false,
      evaluates_guards: false,
      branches_on_conditions: false,
      infers_meaning: false,
      modifies_graph: false,
    },
    node_results: context.nodeResults,
  };
}

module.exports = {
  emitResultEnvelope,
};
