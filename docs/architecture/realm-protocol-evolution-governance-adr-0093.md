# ADR-0093: Realm Protocol Evolution Governance

Status: Accepted

This ADR defines how Realm protocol changes are proposed, approved, proven, and
rolled out without silently changing the meaning of accepted history.

ADR-0092 closed the cryptographic assurance boundary: signatures, hashes, and
algorithm metadata protect evidence, but do not create authority. ADR-0093
defines the next boundary: who may change the rules by which historical evidence
is interpreted.

```text
ADR-0091 answers: How does the Realm preserve causality when every non-kernel layer may lie?
ADR-0092 answers: What exactly is cryptographic proof of continuity?
ADR-0093 answers: Who may change the protocol rules that interpret history?
```

## Acceptance Criteria

ADR-0093 is accepted when the following protocol evolution boundaries are frozen:

```text
protocol_evolution_changes_interpretation_not_history
protocol_change_requires_compatibility_proof
compatible_runtime_preserves_projection_meaning
compatible_runtime_preserves_authority_interpretation
compatible_runtime_preserves_integrity_anchors
old_history_must_not_be_reinterpreted_arbitrarily
event_schema_changes_require_versioned_registry_rules
registry_rule_changes_require_before_after_replay_evidence
migration_adapters_are_protocol_artifacts_not_runtime_shortcuts
cryptographic_algorithm_deprecation_preserves_historical_verification
sdk_contract_changes_cannot_create_kernel_bypass
version_negotiation_must_fail_closed_on_unknown_breaking_versions
breaking_changes_require_explicit_upgrade_evidence
governance_approval_does_not_itself_accept_events
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
History creates truth.
Protocol defines how truth is interpreted.
Governance protects protocol continuity.
```

Supporting kernel:

```text
Protocol evolution changes interpretation.
Protocol evolution must not silently change history.
```

Wrong:

```text
new runtime
        ↓
reinterpret old events arbitrarily
        ↓
new truth
```

Correct:

```text
old history
        ↓
new runtime
        ↓
compatibility proof
        ↓
same meaning
```

## Context

The pre-production invariant baseline after ADR-0092 established:

```text
Everything can be copied.
Everything can be signed.
Everything can be transported.
Only accepted history creates Realm truth.
```

After this point, the highest-risk change is no longer only a runtime bug. It is
a change to the language in which the Realm proves causality:

```text
event schema
registry rule
projection rule
cryptographic verifier
SDK contract
compatibility promise
```

ADR-0093 governs those changes.

## Questions This ADR Answers

```text
Who may change event schemas?
Who may change registry validation rules?
Who may introduce migration adapters?
Who may deprecate cryptographic algorithms?
Who may change SDK contracts?
How are compatible and breaking protocol changes distinguished?
How does a new runtime prove it preserves old history meaning?
What evidence is required before a protocol upgrade is accepted?
```

This ADR does **not** select a standards body, legal governance structure,
foundation model, voting implementation, or release management tool.

## Core Boundary

Protocol governance may approve how future runtimes interpret history. It may
not rewrite accepted history or bypass the acceptance kernel.

```text
protocol proposal
        ↓
compatibility evidence
        ↓
governance approval
        ↓
versioned runtime release
        ↓
replay proof against accepted history
```

Not:

```text
governance approval
        ↓
mutate event log / projection
```

Governance changes rules. It does not create Realm events unless it enters the
same proposal, validator, and acceptance path as every other authority action.

## Governed Surfaces

### Event Schema Governance

Event schemas define canonical event bytes and their meaning.

Rules:

```text
new fields require versioned schema semantics
removed fields require explicit deprecation semantics
renamed fields require migration adapter evidence
default values must not change old event meaning
canonical encoding changes require replay equivalence proof
```

Compatible:

```text
schema v1 history
        ↓
runtime supports v1 and v2
        ↓
same v1 projection meaning
```

Breaking:

```text
schema v1 history
        ↓
runtime treats v1 fields differently
        ↓
new authority interpretation
```

### Registry Rule Changes

Registry rules define which events are valid, who may sign them, and how payloads
are interpreted. Registry changes are protocol changes, not local refactors.

Every registry rule change must include:

```text
old registry version
new registry version
affected event types
affected signer scopes
before/after replay result
before/after rejected-case result
compatibility classification
```

The default requirement is:

```text
same accepted history
        ↓
same authority interpretation
```

### Migration Adapter Governance

Migration adapters translate old protocol material into new runtime
understanding. They are protocol artifacts, not convenience code.

Rules:

```text
adapter input is accepted history, not projection
adapter output is interpretation evidence, not rewritten history
adapter must be deterministic
adapter must be versioned
adapter must be testable against fixtures
adapter must not synthesize accepted events
```

Wrong:

```text
adapter
        ↓
rewrites event log
```

Correct:

```text
adapter
        ↓
explains how old event version maps to new interpretation
        ↓
replay preserves meaning
```

### Cryptographic Algorithm Deprecation

Algorithm deprecation changes future verification policy. It must not erase or
reinterpret historical evidence.

Rules:

```text
historical events keep algorithm metadata
historical verification selects verifier by event metadata
new events may require a newer algorithm
deprecated algorithms may be disallowed for new proposals
old events are not rehashed
old events are not resigned
```

If a legacy algorithm can no longer be verified by the default runtime, the
protocol must preserve an archival verifier or evidence path. Lack of a current
implementation is not permission to rewrite history.

### SDK Contract Compatibility

SDKs expose protocol intent. They must not define their own interpretation of
Realm truth.

Compatible SDK changes:

```text
add helper around existing command/evidence flow
add typed wrapper for existing event proposal
add explicit protocol version negotiation
```

Breaking SDK changes:

```text
change signing material
change default authority scope
change event payload meaning
hide protocol version mismatch
introduce force accept / direct projection mutation
```

SDK compatibility is proven by executing the same kernel contract, not by SDK
package tests alone.

### Version Negotiation

Version negotiation determines whether two protocol participants may exchange
meaningful evidence.

Rules:

```text
unknown compatible minor version may continue only with declared support
unknown breaking major version must fail closed
runtime must expose supported event versions
runtime must expose supported registry versions
runtime must expose supported crypto algorithms
runtime must expose SDK contract version
```

Negotiation failure is operational interruption, not partial acceptance.

## Breaking vs Non-Breaking Changes

Non-breaking changes preserve old accepted history meaning:

```text
same history
        ↓
new compatible runtime
        ↓
same projection meaning
same authority interpretation
same integrity anchors
```

Breaking changes alter interpretation and require explicit governance evidence:

```text
breaking proposal
        ↓
compatibility impact statement
        ↓
fixture replay comparison
        ↓
affected SDK/runtime declaration
        ↓
approval evidence
        ↓
explicit upgrade path
```

Breaking changes must never be hidden inside optimization, refactoring,
deployment, or SDK release notes.

## Approval and Evidence Model

Protocol upgrades require evidence, not trust in release authority.

Minimum evidence package:

```text
protocol change proposal
affected surfaces
compatibility classification
fixture corpus before/after replay
invariant baseline comparison
reason-code changes
migration adapter hash, if any
cryptographic verifier metadata, if any
SDK compatibility report, if any
approval signatures / quorum evidence
rollback or fail-closed behavior
```

Approval signatures prove the governance process endorsed the upgrade. They do
not prove the upgrade is compatible. Compatibility is proven by replay evidence.

## Acceptance Invariant

The mandatory invariant for compatible protocol evolution is:

```text
same accepted history
        +
different compatible runtime
        ↓
same projection meaning
same authority interpretation
same integrity anchors
```

If any of these differ, the change is breaking or invalid.

## Failure Modes

### Silent Schema Reinterpretation

```text
old event field
        ↓
new runtime assigns new meaning
        ↓
projection changes
```

Expected result:

```text
PROTOCOL_COMPATIBILITY_FAILED
```

### Registry Scope Expansion

```text
old signer scope rejected event type
        ↓
new registry accepts it without upgrade evidence
```

Expected result:

```text
REGISTRY_RULE_UPGRADE_EVIDENCE_REQUIRED
```

### Migration Adapter Synthesizes Events

```text
adapter reads history
        ↓
creates accepted event without validator
```

Expected result:

```text
MIGRATION_EVENT_SYNTHESIS_FORBIDDEN
```

### Algorithm Deprecation Rewrites History

```text
legacy algorithm deprecated
        ↓
old events rehashed or resigned
```

Expected result:

```text
CRYPTO_HISTORY_REWRITE_FORBIDDEN
```

### SDK Contract Drift

```text
new SDK signs different material
        ↓
runtime silently accepts
```

Expected result:

```text
SDK_PROTOCOL_CONTRACT_MISMATCH
```

### Version Negotiation Bypass

```text
unknown breaking version
        ↓
runtime accepts partial interpretation
```

Expected result:

```text
PROTOCOL_VERSION_NEGOTIATION_FAILED
```

## Mandatory Acceptance Tests

Future protocol governance tests should prove:

### 1. Compatible Runtime Preserves Meaning

```text
fixture history
        ↓
runtime A replay
runtime B replay
        ↓
same projection meaning
same authority interpretation
same integrity anchors
```

### 2. Schema Reinterpretation Is Rejected

```text
old event schema fixture
        ↓
new runtime changes field meaning
        ↓
PROTOCOL_COMPATIBILITY_FAILED
```

### 3. Registry Scope Expansion Requires Evidence

```text
new registry rule accepts old-forbidden transition
        ↓
missing upgrade evidence
        ↓
REGISTRY_RULE_UPGRADE_EVIDENCE_REQUIRED
```

### 4. Migration Adapter Cannot Create Events

```text
adapter attempts event append
        ↓
MIGRATION_EVENT_SYNTHESIS_FORBIDDEN
```

### 5. Crypto Deprecation Preserves Historical Verification

```text
history contains algorithm v1 event
runtime supports algorithm v2 for new events
        ↓
old event verified by v1 metadata
new event verified by v2 metadata
```

### 6. SDK Contract Drift Fails Closed

```text
SDK signs non-canonical material
        ↓
runtime rejects proposal
```

### 7. Unknown Breaking Version Fails Closed

```text
event version unsupported as breaking
        ↓
PROTOCOL_VERSION_NEGOTIATION_FAILED
        ↓
no accepted event
```

### 8. Approval Does Not Replace Replay Proof

```text
upgrade approval signatures valid
        +
fixture replay differs
        ↓
PROTOCOL_COMPATIBILITY_FAILED
```

## Relationship to Prior ADRs

```text
ADR-0073  event schema evolution requires replayable meaning
ADR-0083  deployment changes runtime, not history
ADR-0085  optimization must preserve meaning
ADR-0088  attestation proves observation, not validity
ADR-0090  SDK exposes intent, not mutation
ADR-0091  every non-kernel layer may lie
ADR-0092  cryptography protects evidence, not authority
ADR-0093  governance protects protocol continuity
```

ADR-0093 does not weaken ADR-0092. A protocol upgrade may change future
cryptographic policy, but it may not make a cryptographically valid artifact an
accepted transition without registry and validator approval.

## Consequences

### Positive

- Protocol changes become reviewable as causality changes
- Compatible runtimes must prove equivalence against accepted history
- Breaking changes require explicit evidence and upgrade paths
- SDK, registry, schema, and crypto changes share one governance model
- Runtime optimization can proceed against a stable invariant baseline

### Negative

- Protocol changes require fixture replay evidence before release
- Some convenience SDK changes become breaking protocol changes
- Algorithm deprecation requires archival verification discipline
- Governance approval is insufficient without executable compatibility proof

## Non-Goals

- No voting implementation in this ADR
- No legal governance structure in this ADR
- No standards-body selection in this ADR
- No release automation implementation in this ADR
- No new authority model in this ADR
- No event-log rewrite mechanism in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be compatibility proof
fixtures, not new protocol power:

```text
1. add protocol compatibility fixture corpus
2. add old-runtime vs new-runtime replay equivalence test
3. add registry rule before/after evidence checks
4. add migration adapter no-event-synthesis test
5. add SDK signing-material drift test
6. add unknown breaking version fail-closed test
7. bind protocol upgrades to invariant baseline comparison
```

Suggested test target:

```text
node/scripts/test-protocol-evolution-governance.js
```

## Summary

Protocol governance asks:

```text
Who may change the rules by which history is interpreted?
```

Answer:

```text
Only an explicitly approved, versioned protocol change with replay evidence.
```

Realm protocol evolution must preserve this final line:

```text
History creates truth.
Protocol defines how truth is interpreted.
Governance protects protocol continuity.
```
