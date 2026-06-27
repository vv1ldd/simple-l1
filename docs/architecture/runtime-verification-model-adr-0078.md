# ADR-0078: Runtime Verification Model

Status: Accepted

This ADR defines how a Realm proves its own internal consistency at runtime
without turning verification into repair, mutation, or a new source of
authority.

ADR-0077 answered why current state is what it is by deriving explanations from
history, projection, validator results, and operational lineage. ADR-0078
answers whether the Realm is internally valid right now.

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
```

## Acceptance Criteria

ADR-0078 is accepted when the following hardening boundaries are frozen:

```text
realm_can_prove_internal_consistency
verification_observes_consistency
verification_never_repairs_truth
verification_report_is_evidence_not_authority
canonical_failures_invalidate_integrity_report
operational_warnings_do_not_invalidate_canonical_truth
event_history_hash_chain_must_verify
projection_must_equal_replay_from_history
snapshot_must_match_history_head_when_supplied
federation_references_must_point_to_recorded_remote_heads
command_execution_records_must_not_bypass_accepted_history
integrity_failure_must_not_create_mutation_event
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
A Realm must be able to prove its own internal consistency.

Verification observes consistency.
Verification never repairs truth.
```

Supporting kernel:

```text
verify()
        ↓
report
```

Not:

```text
verify()
        ↓
fix projection
        ↓
write state
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0074  snapshot ≠ history
ADR-0077  explanation ≠ state
ADR-0078  verification ≠ repair
```

## Context

After ADR-0077, the Realm can explain:

```text
Why is state what it is?
```

ADR-0078 asks:

```text
Is this Realm internally valid right now?
```

The runtime now has:

```text
External input
      ↓
Command / Evidence
      ↓
Idempotency
      ↓
Dispatcher
      ↓
Registry + Validator
      ↓
Accepted Realm Event
      ↓
Hash-linked History
      ↓
Projection
      ↓
Explanation
```

Operational hardening now requires a self-audit surface that verifies the
internal consistency of those layers without mutating any of them.

Without an explicit verification boundary, teams will be tempted to:

- repair projection drift inside integrity checks
- rewrite event hashes during validation runs
- treat verification reports as authority certificates
- make missing operational caches invalidate canonical truth
- create mutation events from integrity failures
- silently accept stale snapshots or federation references

ADR-0078 prevents that drift.

## Questions This ADR Answers

```text
How can a Realm verify that its event history is intact?
How can a Realm prove its projection matches replay?
How are snapshots checked against canonical history?
How are federation references checked for internal consistency?
How are command execution records checked without becoming truth?
Which failures invalidate Realm integrity and which are operational warnings?
What must verification never repair?
```

This ADR does **not** select monitoring backend, alerting policy, repair
workflow, dashboard design, or storage backend.

## Core Boundary

Wrong model:

```text
integrity check
        ↓
detect drift
        ↓
patch projection / rewrite state
```

Correct model:

```text
integrity check
        ↓
evidence report
        ↓
operator / caller decides next action outside canonical mutation path
```

Verification may observe:

```text
event history
projection
snapshot
federation trust references
command execution records
observability artifacts
```

Verification must not mutate:

```text
event history
projection
CurrentAuthorityState
snapshot
federation trust
command execution record
observability artifact
```

## Verification Classes

### 1. Canonical Integrity

Canonical checks verify the source of truth itself.

```text
Event History
      ↓
hash chain verification
      ↓
event id verification
      ↓
sequence continuity
```

Canonical failures invalidate the integrity report:

```text
EVENT_HASH_MISMATCH
EVENT_CHAIN_BROKEN
EVENT_ID_MISMATCH
EVENT_SEQUENCE_INVALID
```

### 2. Derived Integrity

Derived checks verify that replaceable representations still match canonical
history.

```text
Event History
      +--> projection replay verification
      +--> snapshot verification
      +--> explanation derivation verification
```

Derived failures invalidate the integrity report when current runtime state no
longer follows accepted history:

```text
PROJECTION_REPLAY_MISMATCH
SNAPSHOT_HISTORY_MISMATCH
SNAPSHOT_PROJECTION_MISMATCH
EXPLANATION_DERIVATION_MISMATCH
```

Representation failure does not become authority transition.

### 3. Operational Integrity

Operational checks verify non-canonical ingress and support records.

```text
Command execution records
Federation evidence metadata
Transport delivery metadata
Observability artifacts
```

Operational issues may be warnings when canonical truth remains replayable:

```text
COMMAND_EXECUTION_RECORD_MISSING
OBSERVABILITY_ARTIFACT_MISSING
TRANSPORT_DELIVERY_METADATA_MISSING
```

Operational warnings must not invalidate canonical truth:

```text
execution store ≠ canonical history
observability artifact ≠ canonical history
transport metadata ≠ canonical history
```

## Dependency Shape

```text
Event History
      |
      +--> hash chain verification
      |
      +--> projection replay verification
      |
      +--> snapshot verification
      |
      +--> federation reference verification
      |
      +--> command lineage verification
```

Every verification branch depends on accepted history. No branch writes back to
history.

## Runtime Contract

Recommended entry point:

```text
verifyRealmIntegrity(ledger, options)
```

Required result shape:

```json
{
  "realm_valid": true,
  "history_head": "abc...",
  "projection_hash": "def...",
  "verified_at": "2026-06-27T00:00:00.000Z",
  "checks": [
    {
      "name": "EVENT_CHAIN_OK",
      "status": "pass"
    },
    {
      "name": "PROJECTION_REPLAY_OK",
      "status": "pass"
    }
  ],
  "failures": [],
  "warnings": []
}
```

The report is evidence about consistency. It is not authority.

## Canonical Failures vs Operational Warnings

Canonical failures:

```text
EVENT_HASH_MISMATCH
EVENT_CHAIN_BROKEN
PROJECTION_REPLAY_MISMATCH
SNAPSHOT_HISTORY_MISMATCH
FEDERATION_REFERENCE_INVALID
```

These indicate the Realm cannot prove current validity.

Operational warnings:

```text
COMMAND_EXECUTION_RECORD_MISSING
OBSERVABILITY_ARTIFACT_MISSING
TRANSPORT_DELIVERY_METADATA_MISSING
```

These may reduce explainability or support context. They do not invalidate
canonical truth if accepted history still verifies and projection replay
matches.

## Specific Checks

### Event History Integrity

```text
verifyRealmEventHistory(event_log)
        ↓
EVENT_CHAIN_OK or canonical failure
```

Must verify:

```text
previous_event_hash continuity
current_event_hash recalculation
event_id consistency
sequence order
```

### Projection Replay Integrity

```text
event_log
        ↓
buildCurrentAuthorityState()
        ↓
compare to CurrentAuthorityState
```

Failure:

```text
PROJECTION_REPLAY_MISMATCH
```

Verification must not repair projection during this check.

### Snapshot Integrity

```text
snapshot
        ↓
verifyRealmSnapshot(history, snapshot)
```

Failures:

```text
SNAPSHOT_HISTORY_MISMATCH
SNAPSHOT_PROJECTION_MISMATCH
SNAPSHOT_CORRUPTED
```

Snapshot failure means acceleration artifact is invalid. It does not rewrite
history.

### Federation Reference Integrity

Federation trust projection entries should reference recorded remote evidence:

```text
local federation trust event
        ↓
remote_event_head
        ↓
known verified remote history head / evidence metadata
```

Failure:

```text
FEDERATION_REFERENCE_INVALID
```

This check verifies internal consistency of accepted local trust records and
stored remote evidence references. It must not establish new trust.

### Command Execution Boundary Integrity

Command execution records may be checked for lineage:

```text
command_id
        ↓
execution_result
        ↓
accepted_event_ids
        ↓
events exist in local Event History
```

Failure when a record claims an accepted event absent from history:

```text
COMMAND_EXECUTION_REFERENCE_INVALID
```

Warning when command execution records are missing:

```text
COMMAND_EXECUTION_RECORD_MISSING
```

Missing command execution cache does not invalidate canonical truth.

## Mandatory Acceptance Tests

### 1. Valid Realm Produces Passing Integrity Report

```text
valid event history
        ↓
projection equals replay
        ↓
verifyRealmIntegrity()
        ↓
realm_valid = true
```

Report must include:

```text
history_head
projection_hash
verified_at
checks
failures
warnings
```

### 2. Corrupted Event Hash Fails Without Mutation

```text
corrupt accepted event payload/hash
        ↓
verifyRealmIntegrity()
        ↓
EVENT_HASH_MISMATCH / EVENT_CHAIN_BROKEN
        ↓
no state mutation
```

Integrity failure must not create a mutation event.

### 3. Projection Drift Fails Without Repair

```text
CurrentAuthorityState edited out of band
        ↓
verifyRealmIntegrity()
        ↓
PROJECTION_REPLAY_MISMATCH
        ↓
projection remains unchanged by verifier
```

The verifier reports drift. It does not fix drift.

### 4. Snapshot Verification Reports Cache Failure

```text
snapshot head != history head
        ↓
SNAPSHOT_HISTORY_MISMATCH
```

Snapshot failure must not affect canonical history.

### 5. Federation References Are Checked, Not Trusted

```text
accepted federation trust references remote_event_head X
stored remote evidence lacks X
        ↓
FEDERATION_REFERENCE_INVALID
```

Verification must not create or revoke federation trust.

### 6. Missing Command Execution Cache Is Warning

```text
event history valid
command execution store missing
        ↓
COMMAND_EXECUTION_RECORD_MISSING
        ↓
realm_valid remains true
```

Execution store is operational lineage, not canonical truth.

### 7. Same History Produces Same Integrity Evidence

Mandatory equivalence:

```text
same accepted event history
        ↓
same history_head
same projection_hash
same pass/fail checks
```

`verified_at` may differ. Consistency evidence must not.

## Negative Boundaries

```text
Verification must not append Realm Events.
Verification must not mutate CurrentAuthorityState.
Verification must not rewrite Event History.
Verification must not recompute canonical event hashes in storage.
Verification must not repair snapshots.
Verification must not establish federation trust.
Verification must not treat command execution records as canonical history.
Verification must not turn operational warnings into authority transitions.
Verification reports must not be imported as state.
```

## Relationship to ADR-0077

ADR-0077 explains:

```text
Why is state what it is?
```

ADR-0078 verifies:

```text
Is this Realm internally valid?
```

They share inputs but produce different derived artifacts:

```text
History + Projection
        +--> Explanation
        +--> Integrity Report
```

Neither artifact may mutate truth.

## Consequences

### Positive

- Realms can self-audit internal consistency
- Operators can distinguish canonical failures from operational warnings
- Projection drift becomes detectable without repair-by-verifier
- Snapshot and federation references become continuously checkable
- Runtime health can be reported without adding mutation paths

### Negative

- Verification helpers must remain read-only
- Integrity reports need stable check names
- Some operational warnings require policy decisions outside this ADR
- Large histories may require optimized verification scheduling

## Non-Goals

- No repair workflow in this ADR
- No monitoring backend selection in this ADR
- No alerting policy in this ADR
- No dashboard design in this ADR
- No automated rollback in this ADR
- No consensus protocol in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should create a read-only
integrity checker over existing proof mechanisms:

```text
1. verify event history through verifyRealmEventHistory()
2. verify projection by replaying buildCurrentAuthorityState()
3. verify optional snapshots through verifyRealmSnapshot()
4. verify federation references against supplied remote evidence metadata
5. verify command execution records only as operational lineage
6. return report with failures and warnings
7. add negative tests proving verifier never mutates state
```

Suggested runtime targets:

- `realm-integrity-check.js`
- `verifyRealmIntegrity()`
- `verifyEventHistoryIntegrity()`
- `verifyProjectionReplayIntegrity()`
- `verifySnapshotIntegrity()`
- `verifyFederationReferences()`
- `verifyCommandExecutionBoundary()`

## Summary

ADR-0077 made state explainably derived.

ADR-0078 makes the Realm self-auditable:

```text
history
  ↓
projection
  ↓
explanation

history
  ↓
verification
  ↓
integrity report
```

Verification observes consistency. Verification never repairs truth.
