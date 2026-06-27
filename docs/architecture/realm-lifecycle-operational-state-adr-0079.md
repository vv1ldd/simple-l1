# ADR-0079: Realm Lifecycle Operational State Model

Status: Accepted

This ADR defines how a Realm derives its operational lifecycle state from
verification results without making lifecycle state a substitute for canonical
history, authority policy, or validator decisions.

ADR-0078 introduced self-verification: a Realm can report whether its event
history, projection, snapshot, federation references, and operational lineage
are internally consistent. ADR-0079 defines how the runtime should behave when
verification passes, warns, or fails.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss?
ADR-0071 answers: How does an active device submit authorized mutations?
ADR-0072 answers: How is external authority acceptance implemented as local policy?
ADR-0073 answers: How may event contracts evolve without rewriting history?
ADR-0074 answers: How may replay be accelerated without replacing history?
ADR-0075 answers: How may verified histories move without becoming a copy?
ADR-0076 answers: How may actors request transitions without bypassing truth?
ADR-0077 answers: How may current truth be explained without becoming state?
ADR-0078 answers: How may a Realm prove its own internal consistency?
ADR-0079 answers: How should a Realm operate when integrity is verified, degraded, or failed?
```

## Acceptance Criteria

ADR-0079 is accepted when the following operational boundaries are frozen:

```text
lifecycle_reacts_to_verification_state
lifecycle_does_not_repair_verification_state
realm_operational_state_is_derived_from_integrity
lifecycle_state_is_not_authority_source
verified_mode_requires_canonical_integrity
degraded_mode_requires_canonical_integrity_with_operational_or_derived_warnings
suspended_mode_blocks_new_authority_mutations
bootstrapping_mode_blocks_external_authority_mutations
recovering_mode_requires_valid_recovery_evidence
lifecycle_artifact_deletion_does_not_change_canonical_truth
integrity_failure_must_not_create_mutation_event
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Lifecycle reacts to verification state.
Lifecycle does not repair verification state.
```

Supporting kernel:

```text
Realm operational state is derived from observed integrity,
not a replacement for canonical history.
```

Wrong:

```text
Integrity Report
        ↓
modify history
        ↓
become valid again
```

Correct:

```text
verifyRealmIntegrity()
        ↓
Integrity Report
        ↓
Realm Lifecycle State
        ↓
allowed operational behavior
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0077  explanation ≠ state
ADR-0078  verification ≠ repair
ADR-0079  lifecycle ≠ authority
```

## Context

After ADR-0078, the runtime can distinguish:

```text
canonical failure
derived artifact failure
operational warning
```

That creates a new operational question:

```text
How should a Realm behave when it cannot prove truth?
```

ADR-0079 answers that question without introducing a service-level truth path.

Without an explicit lifecycle boundary, teams will be tempted to:

- treat `realm_status = VERIFIED` as authorization
- keep accepting authority mutations after canonical integrity failure
- auto-repair projection or history during health checks
- turn snapshot or command cache failures into mutation events
- use lifecycle records as canonical state
- bypass validators because the Realm is marked healthy

ADR-0079 prevents that drift.

## Questions This ADR Answers

```text
Which operational states may a Realm enter?
What does each state permit or block?
How are lifecycle states derived from integrity reports?
When is a Realm degraded versus suspended?
How does recovery interact with suspended operation?
What must lifecycle state never authorize by itself?
```

This ADR does **not** select orchestration platform, alerting policy, repair
workflow, admin UI, consensus protocol, or recovery ceremony UX.

## Lifecycle States

```text
BOOTSTRAPPING
      ↓
VERIFIED
      ↓
DEGRADED
      ↓
SUSPENDED
```

Optional recovery path:

```text
SUSPENDED
      ↓
RECOVERY_AUTHORITY_VALIDATED
      ↓
RECOVERING
      ↓
VERIFIED
```

`RECOVERING` is only valid when recovery evidence has already passed the
existing recovery authority validation path. It is not an emergency override.

## BOOTSTRAPPING

Meaning:

```text
History is still loading or verification has not completed.
Trusted current state has not yet been established.
```

Allowed:

```text
load event history
verify hash chain
build projection from history
verify snapshot metadata
produce diagnostics
```

Not allowed:

```text
external authority mutations
device submissions
federation trust acceptance
transport event acceptance into local truth
API command acceptance for authority transitions
```

Bootstrap may prepare state. It must not assert authority before verification.

## VERIFIED

Meaning:

```text
event history is valid
projection matches replay
canonical integrity checks pass
no blocking derived integrity failures exist
```

Allowed:

```text
commands
device submissions
federation recognition
transport evidence ingestion
snapshot acceleration
observability and integrity checks
```

Even in `VERIFIED`, lifecycle state does not authorize transitions. The
validator and authority history still decide.

## DEGRADED

Meaning:

```text
canonical history verifies
projection replay matches
one or more derived/operational artifacts are missing or invalid
```

Examples:

```text
snapshot invalid or missing
command execution cache missing
transport metadata missing
observability artifact missing
non-blocking federation evidence metadata unavailable
```

Allowed:

```text
canonical replay
diagnostics
limited command handling if validator can prove authority from history
snapshot rebuild
observability rebuild
transport metadata repair outside canonical write path
```

Not allowed:

```text
treat missing operational artifacts as authority
repair canonical history from derived artifacts
skip validator because canonical history is valid
```

Degraded mode means the Realm may operate with reduced confidence or reduced
features. It does not mean canonical truth is invalid.

## SUSPENDED

Meaning:

```text
canonical integrity failed
or current projection does not match replay
or Realm cannot prove accepted history continuity
```

Examples:

```text
EVENT_HASH_MISMATCH
EVENT_CHAIN_BROKEN
EVENT_ID_MISMATCH
PROJECTION_REPLAY_MISMATCH
FEDERATION_REFERENCE_INVALID when required for active trust
```

Allowed:

```text
diagnostics
integrity reports
event trace export
recovery evidence collection
read-only support views
explicit recovery ceremony preparation
```

Not allowed:

```text
new accepted authority mutations
device submission acceptance
federation trust establishment
transport event acceptance into local truth
projection repair by lifecycle logic
history rewrite by lifecycle logic
```

Suspended mode may stop trust. It may never create a new truth.

## RECOVERING

Meaning:

```text
Realm was suspended or degraded,
and a valid recovery path is being executed through existing recovery authority rules.
```

Precondition:

```text
RECOVERY_AUTHORITY_VALIDATED
```

Allowed:

```text
recovery diagnostics
recovery evidence verification
recovery ceremony proposals
acceptRealmEvent() only for recovery transitions valid under current authority history
post-recovery integrity verification
```

Not allowed:

```text
manual state patch
direct projection mutation
history rewrite
authority escalation outside recovery policy
```

Recovery remains event-based. Lifecycle state does not transfer ownership.

## Lifecycle Derivation

Lifecycle state is derived from integrity report evidence.

Recommended mapping:

```text
no integrity report yet
        ↓
BOOTSTRAPPING

realm_valid = true
warnings = []
        ↓
VERIFIED

realm_valid = true
warnings != []
        ↓
DEGRADED

realm_valid = false
canonical failure present
        ↓
SUSPENDED

realm_valid = false
valid recovery evidence in progress
        ↓
RECOVERING
```

Lifecycle derivation must be deterministic for the same integrity evidence.

## Runtime Contract

Suggested module:

```text
realm-lifecycle.js
```

Suggested functions:

```text
deriveRealmLifecycleState(integrityReport, options)
canAcceptCommands(lifecycleState)
canAcceptAuthorityMutations(lifecycleState)
canRunDiagnostics(lifecycleState)
getLifecycleExplanation(lifecycleState, integrityReport)
```

Recommended result shape:

```json
{
  "state": "VERIFIED",
  "can_accept_commands": true,
  "can_accept_authority_mutations": true,
  "can_run_diagnostics": true,
  "derived_from": {
    "realm_valid": true,
    "failures": [],
    "warnings": []
  },
  "explanation": "Realm integrity is valid and no operational warnings are present."
}
```

This result is operational state. It is not canonical authority.

## Lifecycle Is Not Authorization

Critical invariant:

```text
Lifecycle state is a projection of verification results.
It is not an authority source.
```

Forbidden:

```text
realm_status = VERIFIED
        ↓
allow mutation
```

Required:

```text
current history
        ↓
validator
        ↓
accepted event
```

Lifecycle may decide whether a class of operation is allowed to attempt
execution. It must not decide whether an authority transition is valid.

## Mandatory Acceptance Tests

### 1. Corrupted History Suspends Without Mutation

```text
corrupted event history
        ↓
verifyRealmIntegrity() = false
        ↓
derive lifecycle
        ↓
SUSPENDED
        ↓
no state mutation
```

### 2. Missing Snapshot Does Not Suspend

```text
canonical history valid
snapshot missing
        ↓
VERIFIED or DEGRADED
        ↓
canonical operation may continue if policy allows
```

Snapshot absence is not canonical failure.

### 3. Missing Command Cache Is Warning

```text
canonical history valid
command execution cache missing
        ↓
DEGRADED or VERIFIED by policy
        ↓
canonical truth remains valid
```

Execution store is operational lineage, not canonical history.

### 4. Lifecycle Artifact Deletion Rebuilds Same State

```text
delete lifecycle artifact
        ↓
derive from same integrity report
        ↓
same lifecycle state
```

Lifecycle artifacts are derived representations.

### 5. Lifecycle Cannot Be Used As Authority

```text
status = VERIFIED
fake unauthorized command
        ↓
validator still rejects
        ↓
no accepted event
```

### 6. Suspended Blocks New Authority Mutations

```text
SUSPENDED
        ↓
new device/federation/recovery command
        ↓
blocked before acceptance attempt
```

Diagnostics and recovery evidence collection remain allowed.

### 7. Recovering Requires Valid Recovery Evidence

```text
SUSPENDED
        ↓
invalid recovery claim
        ↓
remain SUSPENDED
```

Only existing recovery authority validation may move the Realm into
`RECOVERING`.

## Negative Boundaries

```text
Lifecycle must not append Realm Events.
Lifecycle must not mutate CurrentAuthorityState.
Lifecycle must not rewrite Event History.
Lifecycle must not repair projection drift.
Lifecycle must not repair snapshot artifacts.
Lifecycle must not establish federation trust.
Lifecycle must not use VERIFIED as authority.
Lifecycle must not turn warnings into mutation events.
Lifecycle must not import lifecycle artifacts as canonical state.
```

## Relationship to ADR-0078

ADR-0078 produces integrity reports:

```text
verifyRealmIntegrity()
        ↓
Integrity Report
```

ADR-0079 consumes integrity reports:

```text
Integrity Report
        ↓
Lifecycle State
        ↓
operational permissions / restrictions
```

Verification is evidence. Lifecycle is operational reaction. Neither is truth.

## Consequences

### Positive

- Realms can stop accepting mutations when canonical integrity fails
- Operators can distinguish degraded operation from suspended trust
- Bootstrap behavior becomes explicit and testable
- Recovery mode remains event-based instead of manual repair
- Service orchestration can use lifecycle state without gaining authority

### Negative

- Runtime entry points must check lifecycle before accepting commands
- Degraded-mode policy requires careful product decisions
- Recovery UX must not become an emergency mutation path
- Lifecycle reports need stable state names and explanations

## Non-Goals

- No repair workflow in this ADR
- No orchestration platform design in this ADR
- No admin UI in this ADR
- No alerting policy in this ADR
- No consensus or quorum protocol in this ADR
- No new recovery authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should create a read-only lifecycle
derivation helper over ADR-0078 reports:

```text
1. derive lifecycle state from integrity report
2. expose canAcceptCommands() and canRunDiagnostics()
3. distinguish canonical failures from operational warnings
4. add tests proving lifecycle never mutates history/projection
5. add tests proving VERIFIED is not authorization
6. add tests for BOOTSTRAPPING, VERIFIED, DEGRADED, SUSPENDED, RECOVERING
```

Suggested runtime targets:

- `realm-lifecycle.js`
- `deriveRealmLifecycleState()`
- `canAcceptCommands()`
- `canAcceptAuthorityMutations()`
- `canRunDiagnostics()`
- `getLifecycleExplanation()`

## Summary

ADR-0078 made the Realm self-auditable.

ADR-0079 makes the Realm operationally self-aware:

```text
Create truth
   ↓
Validate truth
   ↓
Replicate truth
   ↓
Explain truth
   ↓
Verify truth
   ↓
Operate safely
```

Lifecycle reacts to verification state. Lifecycle does not repair verification
state.
