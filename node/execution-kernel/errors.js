class KernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
    this.details = details;
  }
}

const FAILURE = Object.freeze({
  INVALID_ARTIFACT: 'INVALID_ARTIFACT',
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  HASH_MISMATCH: 'HASH_MISMATCH',
  PROVENANCE_MISMATCH: 'PROVENANCE_MISMATCH',
  TOPOLOGY_ERROR: 'TOPOLOGY_ERROR',
  UNKNOWN_OPERATION: 'UNKNOWN_OPERATION',
  NODE_EXECUTION_ERROR: 'NODE_EXECUTION_ERROR',
});

module.exports = {
  FAILURE,
  KernelError,
};
