const { stableJson } = require('./canonical-json');
const { KernelError, FAILURE } = require('./errors');
const { sha256 } = require('./hash');

function verifyArtifact(sdga) {
  if (!sdga || typeof sdga !== 'object') {
    throw new KernelError(FAILURE.INVALID_ARTIFACT, 'SDGA must be an object');
  }
  if (sdga.schema_version !== 'simple-l1.signed_decision_graph.v1') {
    throw new KernelError(FAILURE.INVALID_ARTIFACT, 'Unexpected SDGA schema_version');
  }
  if (sdga.release_boundary !== 'SDGA_v0') {
    throw new KernelError(FAILURE.INVALID_ARTIFACT, 'Unexpected SDGA release boundary');
  }
  if (!sdga.signature || !sdga.signature.algorithm || !sdga.signature.key_id || !sdga.signature.value) {
    throw new KernelError(FAILURE.SIGNATURE_MISMATCH, 'SDGA signature metadata is incomplete');
  }
  if (!sdga.provenance || sdga.provenance.guard_artifact_hash !== sdga.guard_artifact_hash) {
    throw new KernelError(FAILURE.PROVENANCE_MISMATCH, 'SDGA provenance does not link to guard artifact hash');
  }
  if (!sdga.graph || !Array.isArray(sdga.graph.nodes) || !Array.isArray(sdga.graph.edges)) {
    throw new KernelError(FAILURE.INVALID_ARTIFACT, 'SDGA graph must include nodes and edges');
  }
  if (sdga.execution_model?.runtime_role !== 'non_semantic_executor') {
    throw new KernelError(FAILURE.INVALID_ARTIFACT, 'SDGA execution model must target non_semantic_executor');
  }
  for (const flag of [
    'semantic_interpretation_allowed',
    'conditional_logic_allowed',
    'policy_evaluation_allowed',
    'spec_reference_allowed',
  ]) {
    if (sdga.execution_model?.[flag] !== false) {
      throw new KernelError(FAILURE.INVALID_ARTIFACT, `SDGA execution model must set ${flag}=false`);
    }
  }

  const graphHash = sha256(stableJson(sdga.graph));
  if (graphHash !== sdga.decision_graph_hash) {
    throw new KernelError(FAILURE.HASH_MISMATCH, 'SDGA graph hash does not match decision_graph_hash', {
      expected: sdga.decision_graph_hash,
      received: graphHash,
    });
  }

  return {
    guardArtifactHash: sdga.guard_artifact_hash,
    sdgaHash: sha256(stableJson(sdga)),
  };
}

module.exports = {
  verifyArtifact,
};
