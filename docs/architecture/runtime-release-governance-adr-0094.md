# ADR-0094: Runtime Release Governance

Status: Accepted

This ADR defines a Realm runtime release as a verified interpretation package,
not merely a binary artifact.

ADR-0093 established protocol evolution governance: protocol changes may alter
future interpretation rules only with compatibility proof. The protocol
conformance suite and deployment runtime then made that proof executable. ADR-0094
defines what must be present in a release before deployment may ask for runtime
activation.

```text
ADR-0091 answers: How does the Realm preserve causality when every non-kernel layer may lie?
ADR-0092 answers: What exactly is cryptographic proof of continuity?
ADR-0093 answers: Who may change the protocol rules that interpret history?
ADR-0094 answers: What evidence makes a runtime release eligible for activation?
```

## Acceptance Criteria

ADR-0094 is accepted when the following release governance boundaries are frozen:

```text
release_is_verified_interpretation_package
release_artifact_hash_identifies_code_not_authority
release_declares_protocol_registry_and_projection_versions
release_declares_migration_requirements
release_includes_protocol_conformance_evidence
release_includes_integrity_evidence
release_declares_rollback_interpreter
release_approval_does_not_replace_conformance
release_manifest_may_not_mutate_history
release_activation_requires_deployment_gate
failed_release_leaves_history_and_projection_unchanged
rollback_restores_interpreter_not_truth
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
A release is not a binary artifact.
A release is a verified interpretation package.
```

Supporting kernel:

```text
A runtime earns activation.
It does not inherit authority by being deployed.
```

Wrong:

```text
new binary
        ↓
start process
        ↓
assume compatible
```

Correct:

```text
build
        ↓
release evidence package
        ↓
protocol conformance proof
        ↓
deployment gate
        ↓
activation
```

## Context

After ADR-0093 and the conformance/deployment executable proofs, Realm runtime
changes follow:

```text
Candidate Runtime
        ↓
Migration Compatibility
        ↓
Protocol Conformance
        ↓
Integrity Verification
        ↓
Lifecycle Permission
        ↓
Activation
```

ADR-0094 governs the artifact that enters that pipeline.

The release pipeline must prove:

```text
new version still understands the same Realm
```

Not merely:

```text
new version started successfully
```

## Questions This ADR Answers

```text
What is a Realm runtime release?
What evidence must be packaged with a release?
Which version declarations are mandatory?
How are migration declarations represented?
What conformance evidence must be retained?
What rollback target is required?
What does approval prove?
What must deployment verify again before activation?
```

This ADR does **not** select CI/CD tooling, artifact registries, signing vendors,
container formats, orchestration systems, or release approval software.

## Core Boundary

A release may package a candidate interpreter and evidence. It may not activate
itself and may not mutate Realm history.

```text
release package
        ↓
deployment gate
        ↓
activation decision
```

Not:

```text
release package
        ↓
write projection / rewrite events
        ↓
declare activation
```

Release governance prepares evidence. Deployment verifies evidence against the
actual Realm before activation.

## Release Package

Minimum release manifest:

```json
{
  "release_id": "realm-runtime-2026.06.27",
  "runtime_artifact_hash": "sha256:...",
  "runtime_version": "1.1.0",
  "protocol_version": "1",
  "registry_version": "1",
  "projection_version": "1",
  "supported_event_versions": {
    "ROOT_AUTHORITY_CREATED": [1],
    "DEVICE_KEY_ISSUED": [1]
  },
  "supported_crypto_algorithms": ["v1", "v2"],
  "migration_declarations": [],
  "conformance_evidence": "...",
  "integrity_evidence": "...",
  "rollback_target": {
    "runtime_version": "1.0.0",
    "runtime_artifact_hash": "sha256:..."
  },
  "approval_evidence": "..."
}
```

The manifest is operational evidence. It is not Realm authority history.

```text
release_manifest != Realm Event
release_approval != accepted transition
artifact_hash != authority
```

## Required Evidence

### Runtime Artifact Hash

The runtime artifact hash identifies the interpreter code being proposed.

It proves:

```text
which artifact is being evaluated
```

It does not prove:

```text
the artifact is compatible
the artifact may accept commands
the artifact is authority
```

Compatibility still comes from conformance evidence and deployment verification.

### Protocol and Registry Versions

Every release must declare:

```text
protocol_version
registry_version
projection_version
supported_event_versions
supported_crypto_algorithms
SDK contract version, if SDK-facing
```

Version labels are evidence selectors. They do not replace replay proof.

### Migration Declarations

Migration declarations must be explicit:

```text
none
adapter_added
adapter_removed
registry_rule_changed
projection_rule_changed
crypto_algorithm_deprecated
SDK_contract_changed
```

Any non-empty migration declaration requires a migration compatibility check
before deployment activation.

Migration may inspect. Migration may prove. Migration may not rewrite history.

### Conformance Evidence

A release must include conformance evidence against the relevant fixture corpus
and baseline histories:

```text
history_head equal
projection_hash equal
lifecycle equal
explanations equal
attestation anchors equal
```

The release package may carry this evidence, but deployment must re-run the
conformance gate against the target Realm.

### Integrity Evidence

Release integrity evidence records that the artifact, manifest, and declared
evidence are internally consistent.

It does not prove Realm integrity. Realm integrity is checked during deployment
against the current event log and projection.

### Rollback Target

Every release must declare a rollback interpreter:

```text
previous runtime version
previous artifact hash
supported protocol/registry versions
rollback conformance expectation
```

Rollback restores an interpreter. It does not restore truth.

If new events were accepted by a compatible runtime before rollback, they remain
accepted history.

### Approval and Evidence Chain

Approval signatures prove that the release governance process endorsed the
package. They do not prove compatibility.

```text
approval evidence
        ↓
package endorsed

conformance evidence
        ↓
history meaning preserved

deployment gate
        ↓
runtime may activate
```

## Release Lifecycle

```text
Build
        ↓
Package release manifest
        ↓
Attach artifact hashes
        ↓
Declare protocol / registry / projection versions
        ↓
Declare migrations
        ↓
Run conformance suite
        ↓
Attach integrity and approval evidence
        ↓
Submit to deployment gate
        ↓
Activate only if deployment verifies target Realm
```

Activation remains a deployment decision, not a release decision.

## Failure Modes

### Missing Artifact Hash

```text
release lacks runtime_artifact_hash
        ↓
cannot identify interpreter
```

Expected result:

```text
RELEASE_ARTIFACT_HASH_REQUIRED
```

### Missing Migration Declaration

```text
runtime changes registry / projection
        +
manifest declares no migration
```

Expected result:

```text
RELEASE_MIGRATION_DECLARATION_REQUIRED
```

### Conformance Evidence Missing

```text
release approved
        +
no conformance evidence
```

Expected result:

```text
RELEASE_CONFORMANCE_EVIDENCE_REQUIRED
```

### Approval Without Replay Proof

```text
approval signatures valid
        +
fixture replay differs
```

Expected result:

```text
RELEASE_COMPATIBILITY_PROOF_REQUIRED
```

### Rollback Target Missing

```text
release has no rollback interpreter
```

Expected result:

```text
RELEASE_ROLLBACK_TARGET_REQUIRED
```

### Release Attempts Activation

```text
release script
        ↓
marks runtime active without deployment gate
```

Expected result:

```text
RELEASE_ACTIVATION_FORBIDDEN
```

## Mandatory Acceptance Tests

Future runtime release governance tests should prove:

### 1. Complete Release Package Is Validated

```text
manifest + artifact hash + versions + evidence + rollback target
        ↓
release accepted as deployable candidate
```

### 2. Release Approval Does Not Bypass Conformance

```text
valid approval
        +
missing / failing conformance evidence
        ↓
release rejected
```

### 3. Migration Declaration Drives Deployment Check

```text
manifest declares migration
        ↓
deployment requires migrationCheck
```

### 4. Runtime Artifact Hash Is Evidence Only

```text
valid artifact hash
        +
incompatible interpretation
        ↓
deployment conformance failure
```

### 5. Rollback Restores Interpreter

```text
rollback target selected
        ↓
same accepted history replayed
        ↓
truth unchanged
```

### 6. Release Cannot Activate Runtime

```text
release package tries to mark active
        ↓
RELEASE_ACTIVATION_FORBIDDEN
```

## Relationship to Prior ADRs

```text
ADR-0073  migration != mutation
ADR-0074  snapshot != history
ADR-0083  deployment != history
ADR-0092  cryptography != authority
ADR-0093  protocol change != reinterpretation
ADR-0094  release != activation
```

ADR-0094 completes the operational chain:

```text
History
  ↓
Protocol
  ↓
Conformance
  ↓
Release
  ↓
Deployment
  ↓
Operation
```

## Consequences

### Positive

- Releases become auditable interpretation packages
- Deployment receives structured evidence instead of informal release notes
- Rollback target is mandatory before activation
- Approval, conformance, integrity, and activation remain separate checks
- Runtime changes can be governed without creating a second path to truth

### Negative

- Releases require more metadata than a binary hash
- Runtime changes must maintain fixture and baseline evidence
- Emergency releases still require rollback and conformance decisions
- Release approval cannot paper over missing compatibility proof

## Non-Goals

- No CI/CD implementation in this ADR
- No package registry selection in this ADR
- No artifact signing vendor in this ADR
- No orchestration rollout strategy in this ADR
- No feature flag governance in this ADR
- No new authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be release manifest
validation wired to the existing deployment gate:

```text
1. define runtime release manifest schema
2. validate artifact hash and version declarations
3. validate migration declarations
4. require conformance evidence
5. require rollback target
6. feed candidate runtime metadata into deployment activation
7. reject release packages that attempt activation directly
```

Suggested targets:

```text
node/realm-release-governance.js
node/scripts/test-runtime-release-governance.js
```

## Summary

Runtime release governance asks:

```text
What makes a new interpreter eligible to ask for activation?
```

Answer:

```text
A complete evidence package:
artifact identity,
protocol declarations,
migration declarations,
conformance proof,
integrity evidence,
rollback target,
approval chain.
```

A release is not a binary artifact. A release is a verified interpretation
package.
