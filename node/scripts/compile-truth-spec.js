#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..', '..');
const specPath = path.join(repoRoot, 'docs', 'specs', 'sl1-truth-spec.v1.json');
const fixturesPath = path.join(repoRoot, 'docs', 'specs', 'sl1-truth-fixtures.v1.json');
const compilerVersion = '0.1.0';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value), null, 2);
}

function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function sameTransition(a, b) {
  return a.from === b.from && a.to === b.to && a.actor === b.actor;
}

function deriveGuardStubs(spec) {
  return spec.invariants.map((invariant) => ({
    invariant_id: invariant.id,
    violation_code: invariant.violation_code,
    guards: invariant.guards || [],
  }));
}

function deriveRuntimeGuards(spec) {
  return {
    source: 'SL1 Truth Spec v1',
    default_policy: 'reject_unknown_transition',
    allowed_transitions: spec.allowed_transitions.map((transition) => ({
      from: transition.from,
      to: transition.to,
      actor: transition.actor,
      requires: transition.requires || [],
    })),
    rejected_transitions: spec.forbidden_transitions.map((transition) => ({
      from: transition.from,
      to: transition.to,
      actor: transition.actor,
      violation_code: violationForStep(spec, transition) || 'TRUTH_SPEC_VIOLATION',
      reason: transition.reason || null,
    })),
    ownership: Object.fromEntries(
      spec.entities.map((entity) => [
        entity.id,
        {
          owner: entity.owner,
          authority_status: entity.authority_status,
          persistence: entity.persistence,
        },
      ]),
    ),
  };
}

function deriveTransitionTests(spec) {
  return {
    positive: spec.allowed_transitions.map((transition) => ({
      name: `allows_${transition.from}_to_${transition.to}_by_${transition.actor}`,
      transition,
    })),
    negative: spec.forbidden_transitions.map((transition) => ({
      name: `rejects_${transition.from}_to_${transition.to}_by_${transition.actor}`,
      transition,
    })),
  };
}

function violationForStep(spec, step) {
  if (step.to === 'admitted_peer' && step.actor === 'host') {
    return null;
  }
  if (step.from === 'join_request' && step.to === 'admitted_peer') {
    return 'DISCOVERY_MEMBERSHIP_VIOLATION';
  }
  if (step.to === 'admitted_peer' && step.actor === 'bridge') {
    return 'BRIDGE_AUTHORITY_VIOLATION';
  }
  if (step.to === 'admitted_peer' && step.actor === 'ui_projection_layer') {
    return 'UI_AUTHORITY_VIOLATION';
  }
  if (step.to === 'admitted_peer' && step.actor === 'runtime_validation_layer') {
    return 'RUNTIME_AUTHORITY_VIOLATION';
  }
  if (step.from === 'tls_state' && step.to === 'converge') {
    return 'TLS_CONVERGE_GATE_VIOLATION';
  }

  const forbidden = spec.forbidden_transitions.find((transition) => sameTransition(transition, step));
  if (forbidden) {
    const invariant = spec.invariants.find((candidate) => (
      forbidden.reason &&
      candidate.statement.toLowerCase().includes(forbidden.to.replace(/_/g, ' '))
    ));
    return invariant ? invariant.violation_code : 'TRUTH_SPEC_VIOLATION';
  }

  return null;
}

function isAllowedStep(spec, step) {
  return spec.allowed_transitions.some((transition) => sameTransition(transition, step));
}

function validateFixture(spec, fixture, expectedAllowed) {
  const violations = [];

  for (const step of fixture.steps || []) {
    const violation = violationForStep(spec, step);
    if (violation) {
      violations.push(violation);
      continue;
    }

    if (!isAllowedStep(spec, step)) {
      violations.push('UNKNOWN_TRANSITION');
    }
  }

  if (expectedAllowed && violations.length > 0) {
    throw new Error(`${fixture.id} expected allowed but violated ${violations.join(', ')}`);
  }

  if (!expectedAllowed) {
    const expectedCode = fixture.expected && fixture.expected.violation_code;
    if (violations.length === 0) {
      throw new Error(`${fixture.id} expected rejection but no violation was produced`);
    }
    if (expectedCode && !violations.includes(expectedCode)) {
      throw new Error(`${fixture.id} expected ${expectedCode} but got ${violations.join(', ')}`);
    }
  }
}

function validateSpec(spec) {
  const entities = byId(spec.entities);
  const invariants = byId(spec.invariants);

  for (const required of ['join_request', 'verified_candidate', 'admitted_peer', 'visible_mesh_node', 'tls_state']) {
    if (!entities.has(required)) {
      throw new Error(`missing required entity ${required}`);
    }
  }

  for (const required of [
    'ADMITTED_PEER_HOST_AUTHORITY',
    'BRIDGE_NO_ADMISSION',
    'UI_NO_PEER_MUTATION',
    'RUNTIME_NO_ADMISSION_OVERRIDE',
    'POSTFLIGHT_NO_CONVERGE_MUTATION',
    'TLS_NO_CONVERGE_GATE',
    'DISCOVERY_NOT_MEMBERSHIP',
    'VISIBLE_NODE_IS_PROJECTION',
  ]) {
    if (!invariants.has(required)) {
      throw new Error(`missing required invariant ${required}`);
    }
  }

  const admittedPeer = entities.get('admitted_peer');
  if (admittedPeer.owner !== 'host' || admittedPeer.authority_status !== 'exclusive_authority') {
    throw new Error('admitted_peer must be exclusive host authority');
  }

  if (spec.compiler.may_introduce_semantics !== false) {
    throw new Error('compiler must not introduce semantics');
  }
  if (!spec.compiler.deterministic || !spec.compiler.stateless || !spec.compiler.side_effect_free) {
    throw new Error('compiler must be deterministic, stateless, and side-effect free');
  }
}

function buildCompiledArtifacts(spec) {
  return {
    lintable_invariants: spec.invariants.map((invariant) => ({
      id: invariant.id,
      violation_code: invariant.violation_code,
      statement: invariant.statement,
    })),
    transition_tests: deriveTransitionTests(spec),
    runtime_guard_stubs: deriveGuardStubs(spec),
    runtime_guard_definitions: deriveRuntimeGuards(spec),
  };
}

function compile(spec, rawSpec) {
  const generatedArtifacts = buildCompiledArtifacts(spec);
  const guardArtifact = generatedArtifacts.runtime_guard_definitions;
  const guardArtifactHash = sha256(stableJson(guardArtifact));
  const compilerCommit = process.env.SL1_TRUTH_COMPILER_COMMIT || 'unknown';

  return {
    schema_version: 'simple-l1.truth_compiler_output.v1',
    source_spec_id: spec.spec_id,
    determinism: {
      spec_version: spec.schema_version,
      spec_hash: sha256(rawSpec),
      compiler_version: compilerVersion,
      compiler_commit: compilerCommit,
      guard_artifact_hash: guardArtifactHash,
      compiled_output_hash: null,
      output_ordering: 'stable',
      consumers_must_not_regenerate_guards: true,
    },
    guard_artifact: guardArtifact,
    generated_artifacts: generatedArtifacts,
  };
}

function main() {
  const rawSpec = fs.readFileSync(specPath, 'utf8');
  const spec = JSON.parse(rawSpec);
  const fixtures = readJson(fixturesPath);
  const checkOnly = process.argv.includes('--check');
  const hashOnly = process.argv.includes('--hash-only');
  const releaseBundleOnly = process.argv.includes('--release-bundle');
  const decisionGraphOnly = process.argv.includes('--decision-graph');

  validateSpec(spec);

  for (const fixture of fixtures.positive || []) {
    validateFixture(spec, fixture, true);
  }
  for (const fixture of fixtures.negative || []) {
    validateFixture(spec, fixture, false);
  }

  if (checkOnly) {
    const first = compileForOutput(spec, rawSpec);
    const second = compileForOutput(spec, rawSpec);
    if (first.output !== second.output) {
      throw new Error('compiled guard artifact is not byte-stable');
    }
    console.log(`PASS SL1 Truth Spec v1 compiles deterministically (${first.compiled.determinism.guard_artifact_hash})`);
    return;
  }

  const { compiled, output } = compileForOutput(spec, rawSpec);
  if (releaseBundleOnly) {
    process.stdout.write(`${stableJson(releaseBundle(compiled))}\n`);
    return;
  }
  if (decisionGraphOnly) {
    process.stdout.write(`${stableJson(decisionGraphArtifact(compiled))}\n`);
    return;
  }
  if (hashOnly) {
    console.log(compiled.determinism.compiled_output_hash);
    return;
  }

  process.stdout.write(`${output}\n`);
}

function compileForOutput(spec, rawSpec) {
  const compiled = compile(spec, rawSpec);
  const outputWithoutHash = stableJson(compiled);
  compiled.determinism.compiled_output_hash = sha256(outputWithoutHash);
  const output = stableJson(compiled);

  return { compiled, output };
}

function releaseBundle(compiled) {
  const issuedAt = process.env.SL1_GUARD_ARTIFACT_ISSUED_AT || '1970-01-01T00:00:00.000Z';
  const issuer = process.env.SL1_GUARD_ARTIFACT_ISSUER || 'simple-l1-release-boundary';
  const keyId = process.env.SL1_GUARD_ARTIFACT_KEY_ID || 'release-attestation-placeholder-v0';
  const signatureValue = process.env.SL1_GUARD_ARTIFACT_SIGNATURE ||
    sha256([
      compiled.determinism.spec_hash,
      compiled.determinism.compiler_version,
      compiled.determinism.guard_artifact_hash,
      compiled.determinism.compiled_output_hash,
      issuer,
      keyId,
    ].join('\n'));

  return {
    schema_version: 'simple-l1.signed_guard_artifact.v1',
    artifact_type: 'signed_guard_artifact',
    release_boundary: 'SGARP_v0',
    spec_hash: compiled.determinism.spec_hash,
    compiler_version: compiled.determinism.compiler_version,
    compiler_commit: compiled.determinism.compiler_commit,
    guard_artifact_hash: compiled.determinism.guard_artifact_hash,
    compiled_output_hash: compiled.determinism.compiled_output_hash,
    provenance: {
      issued_at: issuedAt,
      issuer,
      source_spec_id: compiled.source_spec_id,
      source_spec_version: compiled.determinism.spec_version,
      output_ordering: compiled.determinism.output_ordering,
    },
    signature: {
      algorithm: process.env.SL1_GUARD_ARTIFACT_SIGNATURE_ALGORITHM || 'release-attestation-placeholder-v0',
      key_id: keyId,
      value: signatureValue,
    },
  };
}

function decisionGraphArtifact(compiled) {
  const issuedAt = process.env.SL1_DECISION_GRAPH_ISSUED_AT || '1970-01-01T00:00:00.000Z';
  const issuer = process.env.SL1_DECISION_GRAPH_ISSUER || 'simple-l1-release-boundary';
  const keyId = process.env.SL1_DECISION_GRAPH_KEY_ID || 'release-attestation-placeholder-v0';
  const graph = {
    nodes: [
      {
        id: 'emit_guard_artifact',
        operation: 'emit_guard_artifact',
        inputs: {
          guard_artifact_hash: compiled.determinism.guard_artifact_hash,
        },
        outputs: {
          artifact_ref: 'guard_artifact',
        },
        metadata: {
          trace: 'pre_resolved',
        },
      },
      {
        id: 'emit_invariant_report',
        operation: 'emit_invariant_report',
        inputs: {
          guard_artifact_hash: compiled.determinism.guard_artifact_hash,
        },
        outputs: {
          report_ref: 'invariant_report',
        },
        metadata: {
          trace: 'pre_resolved',
        },
      },
    ],
    edges: [
      {
        from: 'emit_guard_artifact',
        to: 'emit_invariant_report',
        ordering: 'after',
      },
    ],
  };
  const decisionGraphHash = sha256(stableJson(graph));
  const signatureValue = process.env.SL1_DECISION_GRAPH_SIGNATURE ||
    sha256([
      compiled.determinism.guard_artifact_hash,
      decisionGraphHash,
      issuer,
      keyId,
    ].join('\n'));

  return {
    schema_version: 'simple-l1.signed_decision_graph.v1',
    artifact_type: 'signed_decision_graph',
    release_boundary: 'SDGA_v0',
    guard_artifact_hash: compiled.determinism.guard_artifact_hash,
    decision_graph_hash: decisionGraphHash,
    execution_model: {
      runtime_role: 'non_semantic_executor',
      semantic_interpretation_allowed: false,
      conditional_logic_allowed: false,
      policy_evaluation_allowed: false,
      spec_reference_allowed: false,
      ordering: 'topological',
    },
    graph,
    provenance: {
      issued_at: issuedAt,
      issuer,
      source: 'pre_runtime_semantic_resolver',
      guard_artifact_hash: compiled.determinism.guard_artifact_hash,
    },
    signature: {
      algorithm: process.env.SL1_DECISION_GRAPH_SIGNATURE_ALGORITHM || 'release-attestation-placeholder-v0',
      key_id: keyId,
      value: signatureValue,
    },
  };
}

try {
  main();
} catch (error) {
  console.error(`FAIL SL1 Truth Spec compiler: ${error.message}`);
  process.exit(1);
}
