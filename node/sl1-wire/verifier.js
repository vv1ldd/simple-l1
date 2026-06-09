'use strict';

const { canonicalJson, withoutSignature } = require('./canonical-json');
const { objectHash } = require('./hash');
const { FailureCodes } = require('./errors');

function reject(code, trace = []) {
  return {
    verdict: 'REJECT',
    code,
    policy_trace: trace,
  };
}

function accept(proof, trace) {
  return {
    verdict: 'ACCEPT',
    code: FailureCodes.ACCEPT,
    identity: proof.identity,
    key: proof.key,
    state_root: proof.state_root,
    capability_id: proof.capability_id,
    policy_trace: trace,
    session_max_ttl: 'PT1H',
  };
}

function parseTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildNonceKey(proof, request) {
  return [
    proof.identity,
    proof.key,
    request.context?.client_id || '',
    proof.capability_id,
    proof.state_root,
    proof.request_hash,
    proof.nonce,
  ].join('|');
}

function fixtureSignatureIsValid(proof) {
  const unsigned = withoutSignature(proof);
  const hash = objectHash(unsigned);
  return proof.signature === `fixture:${hash}`;
}

function requestMatchesCapability(request, capability) {
  const context = request.context || {};
  return (
    capability.client_id === context.client_id &&
    capability.request_host === context.request_host &&
    capability.intent_type === request.intent_type &&
    (!capability.resource || capability.resource === request.resource)
  );
}

function evaluatePolicy(policy, capability, request) {
  if (!policy || policy.state !== 'active') return { ok: false, reason: FailureCodes.POLICY_DENIED };
  if (policy.operator === 'CAP') {
    return policy.capability_id === capability.id
      ? { ok: true, trace: [`CAP(${capability.id})`] }
      : { ok: false, reason: FailureCodes.POLICY_DENIED };
  }
  if (policy.operator === 'BOUND') {
    if (policy.capability_id !== capability.id) return { ok: false, reason: FailureCodes.POLICY_DENIED };
    const constraints = policy.constraints || {};
    if (constraints.request_host && constraints.request_host !== request.context?.request_host) {
      return { ok: false, reason: FailureCodes.POLICY_DENIED };
    }
    if (constraints.intent_type && constraints.intent_type !== request.intent_type) {
      return { ok: false, reason: FailureCodes.POLICY_DENIED };
    }
    return { ok: true, trace: [`CAP(${capability.id})`, 'BOUND(context)'] };
  }
  return { ok: false, reason: FailureCodes.POLICY_DENIED };
}

function verifyProof(input, nonceStore = new Set()) {
  const {
    proof,
    request,
    state,
    verifier_context: context,
  } = input;
  const trace = [];

  try {
    canonicalJson(proof);
    canonicalJson(request);
  } catch (error) {
    return reject(FailureCodes.BAD_CANONICALIZATION, trace);
  }

  if (!proof || proof.type !== 'sl1.proof.v1') return reject(FailureCodes.BAD_CANONICALIZATION, trace);
  if (!proof.identity || !proof.key || !proof.state_root || !proof.ruleset_hash || !proof.canonicalization_hash) {
    return reject(FailureCodes.BAD_CANONICALIZATION, trace);
  }
  if (!context?.trusted_rulesets?.includes(proof.ruleset_hash)) return reject(FailureCodes.UNKNOWN_RULESET, trace);
  if (!context?.trusted_canonicalizations?.includes(proof.canonicalization_hash)) {
    return reject(FailureCodes.UNKNOWN_CANONICALIZATION, trace);
  }
  trace.push('RULESET_OK');

  if (!fixtureSignatureIsValid(proof)) return reject(FailureCodes.BAD_SIGNATURE, trace);
  trace.push('SIGNATURE_OK');

  if (state.root !== proof.state_root) return reject(FailureCodes.STATE_ROOT_MISMATCH, trace);
  if (state.forked === true) return reject(FailureCodes.EPOCH_FORKED, trace);
  trace.push('STATE_ROOT_OK');

  const device = state.devices?.[proof.key];
  if (!device || device.identity !== proof.identity || device.state !== 'active') {
    return reject(FailureCodes.DEVICE_NOT_BOUND, trace);
  }
  if (state.revocations?.[proof.key]) return reject(FailureCodes.DEVICE_REVOKED, trace);
  trace.push('DEVICE_OK');

  const capability = state.capabilities?.[proof.capability_id];
  if (!capability || capability.state !== 'active') return reject(FailureCodes.CAPABILITY_NOT_FOUND, trace);
  if (capability.subject !== proof.key) return reject(FailureCodes.POLICY_DENIED, trace);
  if (!requestMatchesCapability(request, capability)) return reject(FailureCodes.REQUEST_MISMATCH, trace);
  trace.push('CAPABILITY_OK');

  const requestHash = objectHash(request);
  if (proof.request_hash !== requestHash) return reject(FailureCodes.REQUEST_MISMATCH, trace);
  trace.push('REQUEST_OK');

  const policy = state.policies?.[capability.policy_id];
  const policyResult = evaluatePolicy(policy, capability, request);
  if (!policyResult.ok) return reject(policyResult.reason, trace);
  trace.push(...policyResult.trace);

  const now = parseTime(context.now);
  const issuedAt = parseTime(proof.issued_at);
  const expiresAt = parseTime(proof.expires_at);
  const skewMs = (context.clock_skew_seconds ?? 0) * 1000;
  if (now === null || issuedAt === null || expiresAt === null) return reject(FailureCodes.PROOF_EXPIRED, trace);
  if (issuedAt > now + skewMs || expiresAt < now - skewMs) return reject(FailureCodes.PROOF_EXPIRED, trace);
  if ((expiresAt - issuedAt) > ((context.max_proof_ttl_seconds ?? 0) * 1000)) {
    return reject(FailureCodes.PROOF_EXPIRED, trace);
  }
  trace.push('TIME_OK');

  if (context.freshness_mode === 'strict' && context.latest_state_root !== proof.state_root) {
    return reject(FailureCodes.STATE_STALE, trace);
  }
  if (context.freshness_mode === 'soft') {
    const observedAt = parseTime(state.observed_at);
    if (observedAt === null || now - observedAt > ((context.max_state_staleness_seconds ?? 0) * 1000)) {
      return reject(FailureCodes.STATE_STALE, trace);
    }
  }
  trace.push('FRESHNESS_OK');

  const nonceKey = buildNonceKey(proof, request);
  if (nonceStore.has(nonceKey)) return reject(FailureCodes.NONCE_REPLAY, trace);
  nonceStore.add(nonceKey);
  trace.push('NONCE_OK');

  return accept(proof, trace);
}

module.exports = {
  buildNonceKey,
  verifyProof,
};
