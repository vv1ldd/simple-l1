const { KernelError, FAILURE } = require('./errors');

const operationTable = Object.freeze({
  emit_guard_artifact(node) {
    return {
      outputRef: node.outputs.artifact_ref,
      output: {
        artifact_ref: node.outputs.artifact_ref,
        guard_artifact_hash: node.inputs.guard_artifact_hash,
      },
    };
  },
  emit_invariant_report(node) {
    return {
      outputRef: node.outputs.report_ref,
      output: {
        report_ref: node.outputs.report_ref,
        guard_artifact_hash: node.inputs.guard_artifact_hash,
      },
    };
  },
  emit_projection_report(node) {
    return {
      outputRef: node.outputs.report_ref,
      output: {
        report_ref: node.outputs.report_ref,
      },
    };
  },
  noop(node) {
    return {
      outputRef: node.outputs.output_ref || null,
      output: null,
    };
  },
});

function dispatch(node) {
  const operation = operationTable[node.operation];
  if (!operation) {
    throw new KernelError(FAILURE.UNKNOWN_OPERATION, `Unknown operation: ${node.operation}`, {
      node_id: node.id,
    });
  }
  try {
    return operation(node);
  } catch (error) {
    if (error instanceof KernelError) {
      throw error;
    }
    throw new KernelError(FAILURE.NODE_EXECUTION_ERROR, error.message, {
      node_id: node.id,
    });
  }
}

module.exports = {
  dispatch,
  operationTable,
};
