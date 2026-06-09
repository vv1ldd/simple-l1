class ExecutionContext {
  constructor({ sdgaHash, guardArtifactHash }) {
    this.sdgaHash = sdgaHash;
    this.guardArtifactHash = guardArtifactHash;
    this.nodeResults = [];
    this.outputs = new Map();
  }

  recordNodeResult(node, status, outputRef, output = null) {
    const result = {
      node_id: node.id,
      operation: node.operation,
      status,
      output_ref: outputRef,
    };
    this.nodeResults.push(result);
    if (outputRef) {
      this.outputs.set(outputRef, output);
    }
    return result;
  }
}

module.exports = {
  ExecutionContext,
};
