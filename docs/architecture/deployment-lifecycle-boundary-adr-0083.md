# ADR-0083: Deployment Lifecycle Boundary

Status: Accepted

This ADR defines how runtime, registry, and deployment changes may be operated
without making software rollout a source of Realm truth, a history migration, or
a shortcut around lifecycle verification.

ADR-0082 established that administrative operations can request controlled work
but cannot become authority. ADR-0083 applies the same governance rule to
software deployment: deployment may change the interpreter that runs the Realm,
but it must not change the Realm's accepted history or projection by assertion.

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
ADR-0080 answers: What must be preserved to restore the same Realm after loss?
ADR-0081 answers: How may a Realm safely return to operation after disaster?
ADR-0082 answers: How may administrators operate a Realm without becoming authority?
ADR-0083 answers: How may runtime deployment change without changing truth?
```

## Acceptance Criteria

ADR-0083 is accepted when the following deployment boundaries are frozen:

```text
deployment_changes_runtime
deployment_does_not_change_history
new_runtime_must_prove_history_compatibility
new_registry_must_interpret_existing_events
migration_adapters_are_required_before_accepting_commands
boot_verification_runs_before_command_acceptance
runtime_incompatibility_blocks_operations
rollback_restores_runnable_interpreter_not_history
deployment_metadata_is_not_authority_history
deployment_status_is_not_lifecycle_authority
deployment_cannot_rewrite_event_log
deployment_cannot_import_projection_as_truth
deployment_cannot_recompute_historical_hashes
deployment_cannot_bypass_validator
old_history_replays_to_same_projection_under_new_runtime
failed_deployment_leaves_history_and_projection_unchanged
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Deployment changes runtime.
Deployment does not change history.
```

Supporting kernel:

```text
New runtime must prove it can interpret existing history
before it may accept new commands.
```

Wrong:

```text
new version
        ↓
rewrite state
        ↓
resume
```

Correct:

```text
new binary / runtime
        ↓
prove compatibility
        ↓
replay existing history
        ↓
verify integrity
        ↓
derive lifecycle
        ↓
accept commands only if allowed
```

Hardening series guardrails:

```text
ADR-0073  code evolves; meaning must remain replayable
ADR-0078  verification != repair
ADR-0079  lifecycle reacts to verification
ADR-0082  admin operation != authority
ADR-0083  deployment != history
```

## Context

Operational governance now distinguishes several caller and procedure layers:

```text
0080 Backup/Restore
        ↓
preserve evidence

0081 Disaster Recovery
        ↓
restore continuity

0082 Admin Operations
        ↓
request controlled transitions

0083 Deployment Lifecycle
        ↓
operate software changes safely
```

Software deployment is uniquely dangerous because it can change:

```text
event registry contracts
validation logic
projection builders
migration adapters
integrity checks
lifecycle derivation
command dispatch behavior
```

Those changes are allowed only if existing accepted history remains canonical
and replayable.

ADR-0073 established:

```text
Code evolves.
Meaning must remain replayable.
```

ADR-0083 turns that into an operational deployment rule.

## Questions This ADR Answers

```text
What must a runtime prove before it accepts commands?
How are registry compatibility and migration adapters checked?
What happens when a new runtime cannot interpret existing history?
What does rollback mean if history must not roll back?
Where does deployment metadata belong?
How does deployment status relate to lifecycle state?
What must never be changed by rollout tooling?
```

This ADR does **not** select CI/CD tooling, package format, orchestration
platform, deployment topology, feature flag provider, or release management
process.

## Core Boundary

Deployment may replace software. It may not replace truth.

Wrong model:

```text
deploy new runtime
        ↓
run data migration
        ↓
rewrite event history / projection
        ↓
declare Realm upgraded
```

Correct model:

```text
deploy new runtime
        ↓
load event registry
        ↓
check migration adapter availability
        ↓
replay existing history
        ↓
verify integrity
        ↓
derive lifecycle
        ↓
open command intake only if lifecycle allows
```

Deployment success is operational. Realm truth remains historical.

## Boot Verification Gate

Before accepting commands, a deployed runtime must perform boot verification:

```text
load runtime version
        ↓
load registry version
        ↓
verify event history hash chain
        ↓
verify every historical event is interpretable
        ↓
replay projection
        ↓
verify integrity
        ↓
derive lifecycle
```

Command intake opens only when:

```text
history valid
+ registry compatible
+ migration adapters available
+ projection replay valid
+ lifecycle permits commands
```

If any canonical compatibility check fails:

```text
runtime_incompatible
        ↓
operations blocked
        ↓
diagnostics and rollback allowed
```

## Runtime Version Compatibility

Runtime version metadata may describe:

```text
binary version
registry version
projection version
supported event versions
supported migration adapters
integrity model version
```

Runtime version metadata does not define authority.

```text
runtime_version != realm_identity
runtime_version != authority_source
```

A new runtime must be able to interpret every accepted historical event needed
to rebuild the Realm. If it cannot, it must fail closed before command intake.

## Registry Compatibility

The registry is the event contract interpreter for accepted history.

Allowed:

```text
add new event contract
add explicit adapter for old version
add stricter validation for future proposals
add projection support for old event versions
```

Forbidden:

```text
remove historical event meaning
rename old event type without adapter
change old payload semantics silently
recompute old event hashes
reject old accepted history because current schema changed
```

Registry compatibility is proven by replay, not by version label alone.

## Migration Adapter Availability

Migration adapters interpret old accepted events under current runtime.

```text
old event
        ↓
compatibility adapter
        ↓
current semantic contract
        ↓
same projection result
```

Missing adapter outcome:

```text
history valid
runtime cannot interpret
        ↓
deployment blocked
        ↓
commands not accepted
```

The fix is to deploy a compatible interpreter or adapter. The fix is not to
rewrite history.

## Rollback Boundary

Rollback means restoring a runnable interpreter, not rolling back Realm history.

Wrong:

```text
bad deploy
        ↓
delete events accepted before deploy
        ↓
restore old projection
```

Correct:

```text
bad deploy
        ↓
stop command intake
        ↓
restore compatible runtime
        ↓
verify same history
        ↓
replay projection
        ↓
derive lifecycle
```

If new commands were accepted by a compatible runtime before rollback, those
accepted events remain part of history. Rollback cannot erase them.

## Deployment Metadata Boundary

Deployment metadata may record:

```json
{
  "deployment_id": "deploy_2026_06_27_001",
  "runtime_version": "2.4.0",
  "registry_version": 3,
  "started_at": "2026-06-27T00:00:00.000Z",
  "result": "verified",
  "history_head_checked": "..."
}
```

But:

```text
deployment metadata != authority history
deployment status != lifecycle authority
release record != Realm Event
```

Deployment metadata is operational evidence. It can help explain which runtime
interpreted history at a point in time, but it does not cause Realm state.

## Lifecycle Relationship

Deployment status and lifecycle state are separate.

```text
deployment succeeded
        ↓
not sufficient
        ↓
lifecycle must still be derived from integrity
```

Examples:

```text
deploy successful + integrity verified
        ↓
VERIFIED or DEGRADED according to report

deploy successful + history incompatibility
        ↓
SUSPENDED / blocked operations

deploy failed before command intake
        ↓
no Realm mutation
```

Lifecycle reacts to verification. Deployment does not declare lifecycle truth.

## Failure Modes

### Runtime Cannot Interpret History

```text
history valid
new runtime cannot interpret event version
        ↓
operations blocked
```

Expected result:

```text
RUNTIME_HISTORY_COMPATIBILITY_FAILED
```

### Registry Contract Missing

```text
accepted event type exists in history
registry has no contract or adapter
        ↓
deployment blocked
```

Expected result:

```text
REGISTRY_CONTRACT_MISSING
```

### Projection Replay Mismatch

```text
same history
new projection logic
different projection_hash
        ↓
deployment blocked
```

Expected result:

```text
DEPLOYMENT_PROJECTION_REPLAY_MISMATCH
```

### Migration Rewrites History

```text
deployment migration
        ↓
modifies event bytes or hash chain
        ↓
forbidden
```

Expected result:

```text
DEPLOYMENT_HISTORY_REWRITE_FORBIDDEN
```

### Deployment Metadata Loss

```text
deployment audit metadata missing
        ↓
operational degradation
        ↓
Realm identity unchanged
```

## Mandatory Acceptance Tests

Future deployment lifecycle tests should prove:

### 1. Boot Verification Before Commands

```text
new runtime boot
        ↓
verify history + replay projection + derive lifecycle
        ↓
commands accepted only after pass
```

### 2. Same History Replays Under New Runtime

```text
old accepted history
        ↓
new runtime
        ↓
same history_head
same projection_hash
```

### 3. Missing Adapter Blocks Operations

```text
historical event version
        ↓
no adapter
        ↓
commands rejected before intake
```

### 4. Deployment Cannot Rewrite History

```text
deployment migration
        ↓
attempt event rewrite
        ↓
rejected
```

### 5. Rollback Does Not Roll Back History

```text
restore old runtime
        ↓
same current event history
        ↓
replay and verify
```

### 6. Deployment Metadata Is Not Authority

```text
missing / corrupted deployment record
        ↓
diagnostic warning only
        ↓
no authority mutation
```

### 7. Failed Deployment Leaves Realm Unchanged

```text
incompatible runtime
        ↓
no command intake
no event append
no projection mutation
```

## Relationship to Follow-Up ADRs

ADR-0083 governs safe software change for one Realm. The next operational layer
is fleet governance:

```text
ADR-0084 Multi-Realm Operations:
How may many Realms be operated without merging authority domains?
```

Multi-Realm operations must assume each Realm has its own independently
verified history, lifecycle, admin boundary, and deployment compatibility gate.

## Consequences

### Positive

- Deployments cannot become hidden history migrations
- Runtime compatibility becomes testable before command intake
- Rollback preserves canonical history
- Registry evolution remains tied to replay proof
- Deployment metadata improves operations without becoming authority

### Negative

- Deployments require compatibility checks before serving commands
- Removing old adapters is harder because old history remains valuable
- Projection changes must be proven against existing histories
- Rollback procedures must distinguish runtime rollback from history rollback

## Non-Goals

- No CI/CD platform selection in this ADR
- No orchestration platform selection in this ADR
- No feature flag system selection in this ADR
- No release approval workflow selection in this ADR
- No multi-Realm fleet rollout model in this ADR
- No new authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be deployment verification
helpers and focused tests, not a new write path:

```text
1. define runtime / registry compatibility metadata
2. verify historical event interpretability at boot
3. verify migration adapter availability
4. replay history and compare projection hash
5. derive lifecycle before command intake
6. reject command intake on incompatible runtime
7. record deployment metadata outside Realm Event history
```

Suggested test target:

```text
node/scripts/test-deployment-lifecycle-boundary.js
```

## Summary

Deployment governance asks:

```text
How may software change without changing truth?
```

Answer:

```text
Deploy runtime.
Prove compatibility.
Replay history.
Verify integrity.
Derive lifecycle.
Then accept commands if allowed.
```

Deployment changes runtime. Deployment does not change history.
