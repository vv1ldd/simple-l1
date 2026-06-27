# ADR-0080: Backup and Restore Boundary

Status: Accepted

This ADR defines how Realm continuity may be preserved across environment loss
without making backup artifacts a substitute for canonical history, authority
policy, or validator decisions.

ADR-0079 closed the operational lifecycle layer: a Realm derives its operating
mode from integrity verification. ADR-0080 begins operational governance by
answering what must be preserved when everything around the Realm disappears.

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
```

## Acceptance Criteria

ADR-0080 is accepted when the following operational boundaries are frozen:

```text
backup_preserves_evidence
backup_does_not_preserve_authority
restore_is_verification_and_replay_not_state_import
accepted_event_history_is_required_for_canonical_restore
hash_chain_metadata_is_required_for_canonical_restore
registry_runtime_compatibility_metadata_is_required_for_restore
optional_artifact_loss_does_not_imply_realm_identity_loss
current_authority_state_only_restore_is_forbidden
snapshot_without_history_is_cache_only
backup_corruption_fails_closed_without_mutation
restored_history_produces_same_history_head
restored_projection_hash_equals_replayed_projection_hash
restored_lifecycle_state_equals_original_for_same_verified_history
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Backup preserves evidence.
Backup does not preserve authority.
```

Supporting kernel:

```text
Operations manage continuity.
Operations do not define continuity.
```

Wrong:

```text
Stored projection
        ↓
import
        ↓
assume truth
```

Correct:

```text
Backup Artifact
        ↓
Verify canonical evidence
        ↓
Replay accepted history
        ↓
Derive projections
        ↓
Verify integrity
        ↓
Enter lifecycle state
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0073  migration ≠ mutation
ADR-0074  snapshot ≠ history
ADR-0077  explanation ≠ state
ADR-0078  verification ≠ repair
ADR-0079  lifecycle ≠ authority
ADR-0080  backup ≠ authority
```

## Context

After ADR-0079, the Realm can:

```text
prove internal consistency
explain current state
derive operational lifecycle mode
```

Operational governance now needs to answer:

```text
If everything around the Realm disappears,
what must be preserved for the Realm to remain the same Realm?
```

Without an explicit backup and restore boundary, teams will be tempted to:

- back up `CurrentAuthorityState` instead of accepted history
- restore projection JSON as truth
- treat snapshot files as backup-of-record
- skip hash verification during restore
- import database dumps as canonical continuity
- create mutation events during failed restore
- assume a restored Realm is valid because files were copied

ADR-0080 prevents that drift.

## Questions This ADR Answers

```text
What must a backup artifact contain?
What is the minimum canonical restore set?
What optional artifacts may improve restore performance or diagnostics?
How does restore differ from state import?
What happens when backup evidence is corrupted?
How does restore relate to integrity verification and lifecycle state?
What must restore never authorize by itself?
```

This ADR does **not** select backup storage backend, encryption policy, retention
schedule, disaster recovery orchestration, or admin tooling UX.

## Core Boundary

Wrong model:

```text
Admin Tool
        ↓
edit database
        ↓
new reality
```

Correct model:

```text
Operational Action
        ↓
Command / Evidence
        ↓
Existing Kernel
        ↓
Accepted Realm Event
        ↓
New Derived State
```

For backup and restore specifically:

```text
Backup Artifact
        ↓
verify evidence
        ↓
replay history
        ↓
derive state
```

Restore does not create a new Realm. It proves:

```text
This history still describes the same Realm.
```

## Canonical Restore Boundary

Required for canonical restore:

```text
Accepted Realm Event History
Hash chain metadata
Event registry / runtime compatibility metadata
```

Optional:

```text
snapshots
verification reports
command execution lineage
observability artifacts
transport metadata
```

Critical rule:

```text
Optional artifact loss
≠
Realm identity loss
```

Canonical continuity depends on accepted history and replayability. Optional
artifacts may improve speed, diagnostics, or operational context. They must not
be required for identity continuity.

## Backup Artifact Contract

A backup artifact is evidence packaging, not authority packaging.

Recommended shape:

```json
{
  "realm_id": "realm-123",
  "event_log": [],
  "history_head": "abc...",
  "registry_version": 1,
  "projection_version": 1,
  "created_at": "2026-06-27T00:00:00.000Z",
  "optional": {
    "snapshot": {},
    "integrity_report": {},
    "command_execution_records": [],
    "observability_artifacts": []
  }
}
```

Semantic meaning:

```text
backup says:
"Here is preserved accepted history and supporting evidence."

backup does not say:
"Here is current truth."
```

Required fields:

```text
event_log
history_head
registry_version
projection_version
```

Optional fields may include snapshots, integrity reports, command lineage, and
observability artifacts. They must not be required for canonical restore.

## Restore Semantics

Restore is verification and replay, not mutation.

Recommended flow:

```text
restoreRealm(backup)
        ↓
verifyRealmEventHistory()
        ↓
rebuildCurrentAuthorityState()
        ↓
verifyRealmIntegrity()
        ↓
deriveRealmLifecycleState()
```

Restore may:

- verify backup artifact shape
- verify hash chain continuity
- verify registry/runtime compatibility
- replay accepted history
- rebuild projection from history
- verify integrity of restored ledger
- derive lifecycle state from integrity report
- compare restored `history_head` and `projection_hash` to backup metadata

Restore must not:

- import `CurrentAuthorityState` as truth
- append synthetic Realm Events
- rewrite historical event bytes
- repair corrupted history during restore
- treat backup success as authority success
- bypass validator or lifecycle checks after restore

## Relationship to Prior ADRs

ADR-0068 established:

```text
Representation is not authority.
```

ADR-0074 established:

```text
Snapshot is cache, not history.
```

ADR-0078 established:

```text
Verification observes consistency.
Verification never repairs truth.
```

ADR-0079 established:

```text
Lifecycle reacts to verification state.
Lifecycle does not repair verification state.
```

ADR-0080 adds:

```text
Backup preserves evidence.
Backup does not preserve authority.
```

Together:

```text
Projection is consequence.
History is cause.
Backup preserves cause.
Restore proves cause still holds.
```

## Negative Boundaries

### CurrentAuthorityState Only

Forbidden:

```text
CurrentAuthorityState only
        ↓
canonical restore
```

Projection is consequence. History is cause.

### Snapshot Without History

Forbidden as canonical restore:

```text
snapshot only
        ↓
assume truth
```

Allowed only as:

```text
cache artifact
        ↓
verify against history if history exists
```

Snapshot without history may assist performance or diagnostics. It must not
define Realm identity.

### Backup Corruption

Required behavior:

```text
backup corruption
        ↓
failed verification
        ↓
no mutation
```

Restore failure must not partially commit projection or append events.

### Restore Does Not Create Authority

Forbidden:

```text
restore completed
        ↓
new authority transitions allowed without validator
```

Required:

```text
restore completed
        ↓
lifecycle state derived
        ↓
commands still pass through validator
```

## Mandatory Acceptance Tests

### 1. Full Event History Backup Restores Identical Head

```text
accepted event history backup
        ↓
restore
        ↓
same history_head
```

### 2. Restored Projection Hash Equals Replay

```text
restore
        ↓
rebuildCurrentAuthorityState()
        ↓
projection_hash equality
```

### 3. Corrupted Event Hash Rejects Restore

```text
backup event hash corrupted
        ↓
restore rejected
        ↓
no canonical mutation
```

### 4. Snapshot Mismatch Rejects Or Falls Back To Full Replay

```text
snapshot head != history head
        ↓
SNAPSHOT_HISTORY_MISMATCH
        ↓
fallback to full replay if history valid
```

Snapshot mismatch must not create authority.

### 5. Deleting Snapshots Does Not Change Restored Realm

```text
restore from history only
        ↓
delete snapshot
        ↓
same restored Realm identity
```

### 6. Operational Artifact Loss Affects Diagnostics Only

```text
command lineage missing
observability missing
        ↓
canonical restore still valid
        ↓
operational warnings only
```

### 7. Restored Lifecycle Matches Original For Same Verified History

```text
same verified history
        ↓
same integrity evidence
        ↓
same lifecycle state
```

Lifecycle after restore is derived. It is not imported.

## Relationship to Follow-Up Operational ADRs

```text
ADR-0080  What must be preserved to restore the same Realm?
ADR-0081  How does a Realm return to operation after losing availability?
ADR-0082  What may administrative operations do without becoming authority?
ADR-0083  How may runtime deployment change without changing truth?
ADR-0084  How may many independent truth domains be operated safely?
```

ADR-0081 disaster recovery builds on ADR-0080 by defining procedure and
availability return. ADR-0080 defines what continuity evidence must survive.

## Consequences

### Positive

- Realm identity survives environment loss through accepted history
- Backup artifacts become explicit evidence packages
- Restore becomes provable continuity, not file copy
- Snapshot, lineage, and observability remain optional accelerators
- Integrity and lifecycle checks remain mandatory after restore

### Negative

- Backup size may be larger than projection-only dumps
- Restore requires replay and verification time
- Registry/runtime compatibility must be tracked explicitly
- Operators must not treat backup success as authority restoration

## Non-Goals

- No backup storage backend selection in this ADR
- No encryption or retention policy in this ADR
- No disaster recovery runbook in this ADR
- No admin tooling design in this ADR
- No deployment lifecycle in this ADR
- No multi-realm fleet operations in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should create read/verify/replay
helpers, not a new write path:

```text
1. define backup artifact contract
2. add createBackupArtifact() over accepted event history
3. add verifyBackupArtifact() for shape, hash head, compatibility metadata
4. add restoreRealmFromBackup() as verify + replay + integrity + lifecycle
5. add compareRestoredIntegrity() for history_head and projection_hash equality
6. add negative tests for projection-only restore, corrupted history, snapshot mismatch
```

Suggested runtime targets:

- `realm-backup-restore.js`
- `createBackupArtifact()`
- `verifyBackupArtifact()`
- `restoreRealmFromBackup()`
- `compareRestoredIntegrity()`

## Summary

CRUD backup asks:

```text
how do we save current state?
```

Realm backup asks:

```text
what evidence must survive so the same Realm can be proven again?
```

Answer:

```text
Preserve accepted history.
Verify on restore.
Replay to derive state.
Prove integrity.
Enter lifecycle mode.
```

Backup preserves evidence. Backup does not preserve authority.
