# ADR-0085: Replay and Storage Scaling

Status: Accepted

This ADR defines how Realm Event History may be indexed, segmented, archived,
and replayed efficiently without changing what history means or creating a
second source of authority.

ADR-0084 completed the operating model for many independent Realms. ADR-0085
begins production hardening: history remains authority, but history grows
forever. Full replay must always remain correct, even when optimized replay is
needed for operational scale.

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
ADR-0084 answers: How may many Realms be operated without merging authority domains?
ADR-0085 answers: How may history replay and storage scale without changing truth?
```

## Acceptance Criteria

ADR-0085 is accepted when the following production hardening boundaries are
frozen:

```text
optimization_may_change_how_history_is_read
optimization_must_not_change_what_history_means
full_replay_remains_canonical_reference
indexed_replay_must_equal_full_replay
partial_replay_requires_verified_prefix
prefix_verification_must_preserve_hash_chain
archival_segments_remain_canonical_history
segment_metadata_is_not_authority_history
history_compaction_is_representation_not_mutation
compaction_cannot_delete_required_canonical_events
corrupted_index_falls_back_to_history_verification
corrupted_segment_blocks_canonical_replay
archive_unavailable_blocks_required_replay_ranges
storage_layout_changes_do_not_recompute_historical_hashes
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Optimization may change how we read history.
It may not change what history means.
```

Supporting kernel:

```text
History is authority.
History grows forever.
```

Wrong:

```text
compacted state
        ↓
assume truth
        ↓
discard old history meaning
```

Correct:

```text
history segment / index / snapshot
        ↓
verify against hash chain
        ↓
replay needed range
        ↓
same projection as full replay
```

Hardening series guardrails:

```text
ADR-0073  migration != mutation
ADR-0074  snapshot != history
ADR-0078  verification != repair
ADR-0080  backup != authority
ADR-0085  optimization != meaning
```

## Context

The current Realm model is intentionally conservative:

```text
Accepted Realm Event
        ↓
Hash-linked Event History
        ↓
Replay
        ↓
Projection
```

That is the correct semantic model. It is not always the cheapest operational
model once history is large.

Production systems need:

```text
event range indexes
efficient prefix verification
partial replay
archival segments
storage layout migration
history compaction as representation / cache
```

These optimizations are safe only if they preserve the same answer as full
history replay.

## Questions This ADR Answers

```text
What may be indexed?
What is a verified prefix?
When is partial replay safe?
What may be archived?
What does compaction mean if history is authority?
What happens when indexes, segments, or archives are corrupted?
How do storage layout changes avoid becoming migrations of truth?
```

This ADR does **not** select database engine, object storage provider, index file
format, compression algorithm, or archival retention policy.

## Core Boundary

Full replay is the canonical reference behavior.

```text
full history
        ↓
verify hash chain
        ↓
replay all events
        ↓
projection
```

Optimized replay is acceptable only when it proves equivalence:

```text
verified prefix
        ↓
trusted derived checkpoint
        ↓
replay remaining events
        ↓
same history_head
same projection_hash
```

If optimized replay and full replay disagree, full replay wins and the
optimization is invalid.

## Event Range Indexes

Indexes may accelerate lookup by:

```text
sequence range
event_id
event type
authority reference
subject reference
timestamp
history head
segment id
```

Indexes must not:

```text
define event order
invent missing events
rewrite event payloads
change sequence semantics
replace hash-chain verification
```

Index corruption is operational degradation.

```text
index corrupted
        ↓
discard / rebuild index
        ↓
verify canonical history
```

## Efficient Prefix Verification

A verified prefix is a contiguous event range whose terminal hash is known and
whose internal chain has already been verified.

```text
events 1..N
        ↓
verified terminal hash H(N)
```

Prefix verification is reusable evidence. It is not authority by itself.

Safe use:

```text
verified prefix 1..N
        ↓
verify event N+1 previous_event_hash == H(N)
        ↓
continue chain verification
```

Unsafe use:

```text
prefix metadata says verified
        ↓
skip unavailable events
        ↓
trust projection
```

The events covered by a required prefix must remain retrievable or provably
preserved in canonical archival storage.

## Partial Replay

Partial replay is safe when:

```text
prefix is verified
checkpoint projection matches prefix head
remaining event range verifies from prefix head
final projection hash equals full replay expectation when checked
```

Partial replay is not safe when:

```text
prefix missing
checkpoint unverified
event range has gap
archive segment unavailable
projection hash mismatch
```

Partial replay changes cost, not meaning.

## Archival Segments

History may be stored in immutable segments:

```text
segment_0001: events 1..10_000
segment_0002: events 10_001..20_000
segment_0003: events 20_001..30_000
```

Segment metadata may include:

```text
realm_id
first_sequence
last_sequence
first_event_hash
last_event_hash
event_count
byte_hash
created_at
storage_uri
```

But:

```text
segment metadata != authority history
archive manifest != event log
storage URI != proof of truth
```

Segments are canonical only because they contain accepted events whose hash
chain verifies.

## History Compaction

Compaction may create representations:

```text
checkpoint projection
summary index
subject materialization
range manifest
compressed segment
```

Compaction must not:

```text
delete required canonical events without archival preservation
replace event history with projection
rewrite event bytes
recompute historical hashes
collapse multiple events into one synthetic authority event
```

Compaction is cache and storage layout. It is not mutation.

## Storage Layout Changes

Storage layout may evolve:

```text
single JSONL file
        ↓
segmented files
        ↓
object storage archive
        ↓
indexed event store
```

The following must remain stable:

```text
event bytes used for hashing
sequence order
previous_event_hash linkage
current_event_hash values
registry interpretation
projection replay result
```

Storage migration is acceptable only as movement of evidence, not rewriting of
history.

## Failure Modes

### Corrupted Index

```text
index points to wrong event range
        ↓
discard index
        ↓
rebuild from canonical history
```

Expected result:

```text
INDEX_CORRUPTED_REBUILD_REQUIRED
```

### Missing Segment

```text
required history range unavailable
        ↓
canonical replay blocked
```

Expected result:

```text
HISTORY_SEGMENT_REQUIRED
```

### Segment Hash Mismatch

```text
archived segment bytes mismatch manifest
        ↓
fail closed
```

Expected result:

```text
HISTORY_SEGMENT_HASH_MISMATCH
```

### Prefix Verification Mismatch

```text
stored prefix head
        ↓
does not match verified range head
        ↓
prefix rejected
```

Expected result:

```text
PREFIX_VERIFICATION_MISMATCH
```

### Compaction Attempts to Replace History

```text
compacted projection
        ↓
used as canonical restore source
        ↓
forbidden
```

Expected result:

```text
COMPACTION_IS_NOT_HISTORY
```

## Mandatory Acceptance Tests

Future replay and storage tests should prove:

### 1. Indexed Replay Equals Full Replay

```text
full history replay
        ↓
projection_hash A

indexed replay
        ↓
projection_hash B

A == B
```

### 2. Partial Replay Requires Verified Prefix

```text
partial replay request
        ↓
missing / invalid prefix
        ↓
rejected
```

### 3. Segment Archive Preserves History Head

```text
segmented history
        ↓
verify all segments
        ↓
same history_head as unsegmented history
```

### 4. Corrupted Index Does Not Corrupt Realm

```text
corrupted index
        ↓
fallback to canonical history
        ↓
same projection
```

### 5. Missing Required Segment Blocks Replay

```text
required segment unavailable
        ↓
canonical replay impossible
        ↓
no projection import
```

### 6. Compaction Is Representation Only

```text
compacted checkpoint
        ↓
delete checkpoint
        ↓
full history still restores same Realm
```

### 7. Storage Migration Does Not Rehash History

```text
old storage layout
        ↓
new storage layout
        ↓
same event bytes
same history_head
same projection_hash
```

## Relationship to Follow-Up ADRs

ADR-0085 is the first production hardening ADR after the operating model.
Follow-up tracks should remain independent:

```text
ADR-0086 Key Lifecycle Model
ADR-0087 Quorum Recovery
ADR-0088 Attestation Boundary
ADR-0089 Compliance Evidence Export
ADR-0090 SDK Contract
```

The common invariant for this next series is:

```text
Scale improves access to truth.
Scale does not create new truth.
```

## Consequences

### Positive

- Large histories can be operated without weakening replay semantics
- Indexes and segments become replaceable performance structures
- Archive failures are distinguishable from identity changes
- Full replay remains the reference implementation
- Storage migrations can be tested by head and projection equivalence

### Negative

- Optimized replay requires proof machinery
- Archival durability becomes operationally critical
- Compaction cannot remove canonical evidence unless preservation is proven
- Index design must tolerate rebuild and corruption detection

## Non-Goals

- No database engine selection in this ADR
- No compression format selection in this ADR
- No archival vendor selection in this ADR
- No retention policy selection in this ADR
- No new authority model in this ADR
- No replacement for full replay in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should add storage verification
helpers and focused tests, not replace the event log:

```text
1. define history segment metadata
2. verify segment byte hashes and chain continuity
3. build range indexes from canonical events
4. support verified prefix metadata
5. prove partial replay equals full replay
6. reject missing required segments
7. keep compaction artifacts outside authority history
```

Suggested test target:

```text
node/scripts/test-replay-storage-scaling.js
```

## Summary

Replay and storage hardening asks:

```text
How do we keep history authoritative when it becomes large?
```

Answer:

```text
Index it.
Segment it.
Archive it.
Verify prefixes.
Replay partially when proven safe.
Keep full replay canonical.
Never change what history means.
```

Optimization may change how we read history. It may not change what history
means.
