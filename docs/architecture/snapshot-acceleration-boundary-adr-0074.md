# ADR-0074: Snapshot Acceleration Boundary

Status: Accepted

This ADR defines how Realm projections may be accelerated through replaceable
snapshots without making snapshots a source of authority or a second path to
state.

ADR-0068 froze the rule that canonical state is defined by validated history,
not by storage representations. ADR-0073 froze schema evolution as
interpretation, not mutation. ADR-0074 extends that hardening series to
performance optimization.

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
```

## Acceptance Criteria

ADR-0074 is accepted when the following hardening boundaries are frozen:

```text
snapshot_accelerates_replay
snapshot_never_replaces_history
snapshot_is_replaceable_cache
snapshot_cannot_create_authority
snapshot_head_must_match_verified_history
corrupted_snapshot_is_rejected
snapshot_deletion_only_affects_performance
replay_from_zero_equals_snapshot_plus_remaining_events
snapshot_is_not_a_realm_event
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Snapshot accelerates replay.
Snapshot never replaces history.
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0073  migration ≠ mutation
ADR-0074  snapshot ≠ history
```

## Context

After ADR-0073, the runtime can replay old accepted histories under current
registry contracts without rewriting stored event bytes. That makes snapshot
acceleration safe to define as a performance boundary rather than a storage
redesign.

Without explicit snapshot rules, teams will be tempted to:

- treat snapshot files as authoritative state
- skip event replay when a snapshot exists
- repair corrupted snapshots by hand-editing projection
- introduce snapshot events into the Realm Event Log
- use transport or cache artifacts as mutation channels

ADR-0074 prevents that drift.

## Questions This ADR Answers

```text
What may a snapshot contain?
How is a snapshot verified against canonical history?
What happens when a snapshot is corrupted or stale?
How does snapshot-accelerated replay differ from full replay?
May snapshots create authority not present in event history?
```

This ADR does **not** select snapshot file format details, storage backend,
replication transport, or API design.

## Core Boundary

Wrong model:

```text
snapshot
        ↓
trust
        ↓
current state
```

Correct model:

```text
snapshot
        ↓
verify against history
        ↓
replay remaining events
        ↓
same CurrentAuthorityState
```

## Relationship to ADR-0068 and ADR-0073

ADR-0068 established:

```text
Canonical:
  Event History
  Authority Rules
  Validation Logic

Replaceable:
  CurrentAuthorityState
  Storage
  Snapshot
```

ADR-0073 established:

```text
Historical event bytes are immutable.
Migration is interpretation, not mutation.
```

ADR-0074 adds:

```text
Snapshot is cache.
Snapshot is not authority.
```

A valid snapshot does not prove a valid history. Snapshot verification must
always remain subordinate to event history verification.

## Snapshot Contract

A snapshot is a replaceable cache artifact, not a Realm Event.

Recommended artifact:

```text
realm_snapshot.json
```

Recommended shape:

```json
{
  "projection": {},
  "last_verified_event_hash": "abc...",
  "last_sequence": 42,
  "projection_version": 1
}
```

Semantic meaning:

```text
snapshot says:
"I was derived from history until event X"

snapshot does not say:
"I am the truth"
```

Required metadata:

```text
projection
last_verified_event_hash
last_sequence
projection_version
```

Optional metadata may include realm id, created_at, or storage format version,
but must not be required for authority decisions.

## Snapshot Is Not a Realm Event

Snapshots must not be represented as canonical Realm Events.

Wrong:

```text
SNAPSHOT_CREATED
        ↓
append to Event Log
```

Correct:

```text
realm_snapshot.json
        ↓
external cache artifact
```

Snapshot creation is not an authority transition. It must not enter the
constitutional write path.

## Runtime Flow

### Without Snapshot

```text
Event Log
        ↓
verify history
        ↓
replay all events
        ↓
CurrentAuthorityState
```

### With Snapshot

```text
Snapshot
        ↓
verify snapshot metadata
        ↓
verify event hash continuity at snapshot head
        ↓
replay remaining events
        ↓
CurrentAuthorityState
```

Both paths must produce:

```text
same CurrentAuthorityState
```

## Verification Rules

Snapshot load must verify:

```text
snapshot metadata is internally consistent
snapshot projection_version is supported
snapshot last_sequence matches a verified event in history
snapshot last_verified_event_hash matches that event's current_event_hash
remaining events continue the hash chain correctly
```

If any check fails, the snapshot must be rejected and the system must fall back
to full replay from event history.

Recommended failure codes:

```text
SNAPSHOT_METADATA_INVALID
SNAPSHOT_HISTORY_MISMATCH
SNAPSHOT_PROJECTION_VERSION_UNSUPPORTED
SNAPSHOT_CORRUPTED
```

## Mandatory Acceptance Tests

### 1. Corrupted Snapshot

```text
snapshot altered
        ↓
projection/hash mismatch
        ↓
reject snapshot
        ↓
fallback to full replay
```

### 2. Snapshot Head Mismatch

```text
snapshot:
  last_sequence = 100
  last_verified_event_hash = AAA

event log:
  sequence 100
  current_event_hash = BBB
        ↓
SNAPSHOT_HISTORY_MISMATCH
```

### 3. Snapshot Cannot Create Authority

Critical negative test:

```text
snapshot:
  device X active

event history:
  device X never issued
        ↓
reject snapshot
```

Snapshot projection must never be able to introduce authority that is not
derivable from verified event history.

### 4. Replay Equivalence

Mandatory equivalence test:

```text
replay from zero
        ==
verified snapshot + remaining events
```

Requirement:

```text
CurrentAuthorityState equality
```

Not approximate similarity. Exact derived-state equality.

### 5. Snapshot Deletion

```text
delete snapshot
        ↓
system still reconstructs identity from event history
```

Difference:

```text
slower, not different identity
```

Deleting snapshots may affect performance only. It must not change canonical
meaning.

## Relationship to ADR-0073

ADR-0073 must remain in force during snapshot use.

```text
stored event bytes
        ↓
hash verification
        ↓
version adapter
        ↓
registry apply
```

Snapshot acceleration must not bypass:

- hash chain verification
- version interpretation
- unsupported version rejection

A snapshot captured at projection version N must only accelerate replay for
histories replayable under that projection version unless full replay from
zero is used to re-derive it.

## Negative Boundaries

```text
Snapshot must not replace Event Log authority.
Snapshot must not skip hash verification.
Snapshot must not introduce authority absent from history.
Snapshot must not be edited to "repair" identity state.
Snapshot must not become a write path for recovery, federation, or device actions.
Snapshot corruption must not partially commit projection state.
Snapshot deletion must not change identity meaning.
```

## Relationship to Follow-Up Hardening ADRs

```text
ADR-0073  Can old truth survive new code?
ADR-0074  Can large truth load faster without changing authority?
ADR-0075  Can truth move between realms safely?
ADR-0076  Can humans/apps interact without bypassing truth?
```

### ADR-0075: Realm Replication Transport

After ADR-0074, transport may safely move:

```text
verified history segments
optional snapshots
```

without transport becoming an authority channel.

```text
Transport moves evidence or cache artifacts.
Kernel decides acceptance.
```

### ADR-0076: Command/API Surface Boundary

APIs may request snapshot generation or load. They may not treat snapshots as
canonical truth or mutate authority through snapshot files.

## Consequences

### Positive

- Large realms can boot faster without changing constitutional model
- Snapshot corruption becomes recoverable through full replay
- Performance optimization stays outside authority semantics
- Transport can later move snapshots as optional acceleration artifacts
- ADR-0068 representation boundary becomes operationally enforceable

### Negative

- Snapshot verification logic must be maintained alongside replay logic
- Projection version changes require snapshot invalidation or regeneration
- Extra tests are required for equivalence and negative authority cases
- Operators must not treat snapshot files as backup-of-record

## Non-Goals

- No snapshot storage backend selection in this ADR
- No snapshot event type in the Realm Event Log
- No replication transport protocol in this ADR
- No API/UI design in this ADR
- No cross-realm snapshot trust in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be snapshot verification
and replay equivalence tests, not new runtime capabilities:

```text
1. define realm_snapshot.json contract
2. add snapshot verification against event history head
3. add snapshot-accelerated replay path
4. add corrupted snapshot / head mismatch / authority-negative tests
5. add replay equivalence test: zero replay == snapshot + tail replay
```

Suggested runtime targets:

- snapshot load/verify helper
- `buildCurrentAuthorityStateFromSnapshot(snapshot, remainingEvents)`
- rejection codes for corrupted or mismatched snapshots
- fixture-backed equivalence tests using ADR-0073 historical logs

## Summary

CRUD systems optimize current state storage.

Realm systems optimize verified history replay.

ADR-0074 allows the second without breaking the first:

```text
History
   |
   +--> full replay
   |
   +--> snapshot acceleration
Both:
      ↓
Same Projection
```

Snapshot accelerates replay. Snapshot never replaces history.
