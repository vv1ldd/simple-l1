# ADR-0081: Disaster Recovery Procedure Model

Status: Accepted

This ADR defines how operators and systems may return a Realm to operation after
availability loss without turning disaster recovery into state import, authority
creation, or a bypass around the existing kernel.

ADR-0080 established backup and restore as evidence preservation and verified
replay. ADR-0081 defines the operational procedure that invokes those mechanisms
safely when environment, storage, or runtime availability is lost.

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
```

## Acceptance Criteria

ADR-0081 is accepted when the following operational boundaries are frozen:

```text
disaster_recovery_restores_continuity
disaster_recovery_does_not_restore_state
recovery_succeeds_when_verified_history_recreates_realm
operator_can_initiate_recovery
operator_cannot_become_authority
backup_verified_does_not_imply_realm_trusted
operations_resume_only_after_integrity_confirmation
missing_history_blocks_canonical_recovery
corrupted_backup_fails_closed
runtime_incompatibility_blocks_resume_until_compatible
partial_operational_loss_does_not_change_realm_identity
restore_never_writes_synthetic_authority_events
dr_completion_requires_integrity_verification_not_manual_confirmation
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Disaster recovery restores continuity.
Disaster recovery does not restore state.
```

Supporting kernel:

```text
Recovery succeeds when verified history can recreate the Realm.
```

Wrong:

```text
Operator action
        ↓
creates authority
```

Correct:

```text
Operational procedure
        ↓
invokes verification / restore
        ↓
integrity confirmation
        ↓
lifecycle-derived resume
```

Hardening series guardrails:

```text
ADR-0078  verification ≠ repair
ADR-0079  lifecycle ≠ authority
ADR-0080  backup ≠ authority
ADR-0081  recovery ≠ authority
```

## Context

After ADR-0080, the runtime can:

```text
create backup artifacts
verify backup evidence
restore Realm from accepted history
verify integrity
derive lifecycle state
```

The mechanism is proven:

```text
Backup artifact
        ↓
Verify evidence
        ↓
Replay history
        ↓
Rebuild projection
        ↓
Integrity
        ↓
Lifecycle
```

ADR-0081 answers the next question:

```text
How does a Realm safely return to operation after disaster?
```

Not:

```text
How do we recreate state?
```

Without an explicit disaster recovery procedure model, teams will be tempted to:

- treat backup verification as sufficient to resume operations
- let operators import projection JSON during recovery
- manually mark a Realm as healthy after file restore
- create root authority during disaster recovery
- rewrite event history to "fix" corruption
- skip integrity verification before resuming commands
- confuse operational artifact loss with Realm identity loss

ADR-0081 prevents that drift.

## Questions This ADR Answers

```text
What is the disaster recovery procedure lifecycle?
What may operators do during recovery?
What must operators never do during recovery?
When may operations resume?
How do failure modes map to procedure outcomes?
How does disaster recovery relate to backup, verification, and lifecycle?
What counts as successful recovery?
```

This ADR does **not** select orchestration platform, on-call tooling, backup
storage vendor, incident management workflow, or admin UI design.

## Core Boundary

Wrong model:

```text
disaster
        ↓
restore files
        ↓
assume Realm is back
```

Correct model:

```text
disaster
        ↓
locate backup evidence
        ↓
verify backup artifact
        ↓
replay accepted history
        ↓
verify integrity
        ↓
derive lifecycle state
        ↓
resume allowed operations
```

Disaster recovery restores continuity evidence. It does not define continuity.

## Relationship to ADR-0078, ADR-0079, and ADR-0080

```text
ADR-0078  "Is this Realm internally consistent?"
ADR-0079  "What mode may it operate in?"
ADR-0080  "How do we preserve evidence?"
ADR-0081  "How do we safely return to operation?"
```

Procedure stack:

```text
Backup artifact
        ↓
verifyBackupArtifact()
        ↓
restoreRealmFromBackup()
        ↓
verifyRealmIntegrity()
        ↓
deriveRealmLifecycleState()
        ↓
resume operations if allowed
```

Critical distinction:

```text
backup verified
≠
realm trusted
```

Trust appears only after:

```text
history verification
+
projection replay
+
integrity report
+
lifecycle derivation
```

## Disaster Recovery Lifecycle

Recommended procedure states:

```text
INCIDENT_DETECTED
        ↓
BACKUP_LOCATED
        ↓
BACKUP_VERIFIED
        ↓
REALM_REPLAYED
        ↓
INTEGRITY_CONFIRMED
        ↓
OPERATIONS_RESUMED
```

Semantic meaning:

| State | Meaning |
|-------|---------|
| `INCIDENT_DETECTED` | Availability loss or continuity risk identified |
| `BACKUP_LOCATED` | Candidate backup artifact selected |
| `BACKUP_VERIFIED` | Backup evidence passes verification |
| `REALM_REPLAYED` | Accepted history replayed into empty Realm |
| `INTEGRITY_CONFIRMED` | Integrity report passes canonical checks |
| `OPERATIONS_RESUMED` | Lifecycle allows command/operation resume |

`OPERATIONS_RESUMED` does not mean authority is recreated. It means the Realm
may attempt normal operation under lifecycle and validator rules.

## Operator Roles Boundary

Critical rule:

```text
Operator can initiate recovery.
Operator cannot become authority.
```

Operators may:

```text
detect incident
select backup artifact
invoke verifyBackupArtifact()
invoke restoreRealmFromBackup()
review integrity report
review lifecycle state
resume allowed operations
collect recovery evidence
run diagnostics and explanations
```

Operators must not:

```text
create root authority manually
rewrite event history
import CurrentAuthorityState
bypass validator
append synthetic Realm Events
mark Realm healthy without integrity confirmation
use admin privilege as authority source
```

Admin is not root authority.

```text
Admin ≠ Root Authority
```

## Recovery Procedure Flow

### 1. Incident Detected

Trigger examples:

```text
node unavailable
storage loss
corrupted projection cache
integrity failure
lifecycle suspended
backup required for continuity proof
```

Allowed actions:

```text
stop accepting new authority mutations if integrity unknown
collect diagnostics
identify candidate backup artifacts
```

### 2. Backup Located

Operator or automation selects one or more candidate backup artifacts.

Selection criteria:

```text
contains accepted event history
contains history_head metadata
contains registry/runtime compatibility metadata
prefer newest verified artifact with intact hash chain
```

Forbidden selection:

```text
projection-only dump
snapshot-only artifact without history
unverifiable JSON export
```

### 3. Backup Verified

Invoke:

```text
verifyBackupArtifact(backup)
```

Outcomes:

```text
pass
        ↓
candidate acceptable for replay

fail
        ↓
fail closed, select another artifact or halt
```

`verify()` produces a report. It does not repair.

### 4. Realm Replayed

Invoke:

```text
restoreRealmFromBackup(backup)
```

Required behavior:

```text
empty realm
        ↓
load accepted history
        ↓
verify hash chain
        ↓
replay
        ↓
derive projection
```

Forbidden behavior:

```text
load CurrentAuthorityState.json
        ↓
continue
```

### 5. Integrity Confirmed

Invoke:

```text
verifyRealmIntegrity(restoredLedger)
```

Recovery may proceed only when canonical integrity is proven.

Examples:

```text
EVENT_CHAIN_OK
PROJECTION_REPLAY_OK
```

Operational warnings may remain:

```text
COMMAND_EXECUTION_RECORD_MISSING
OBSERVABILITY_ARTIFACT_MISSING
```

Warnings do not invalidate canonical continuity if history replay is valid.

### 6. Operations Resumed

Invoke:

```text
deriveRealmLifecycleState(integrityReport)
```

Resume rules:

```text
VERIFIED
        ↓
normal operations allowed to attempt

DEGRADED
        ↓
limited operations allowed by policy

SUSPENDED
        ↓
no authority mutations
diagnostics and recovery evidence only

RECOVERING
        ↓
recovery ceremony path only through existing kernel
```

Resume is lifecycle-derived. It is not operator-declared.

## Failure Modes

### Missing History

```text
projection exists
history missing
        ↓
canonical restore impossible
```

Result:

```text
CANONICAL_HISTORY_REQUIRED
```

No resume.

### Corrupted Backup

```text
hash mismatch
        ↓
fail closed
        ↓
no resume
```

Examples:

```text
EVENT_HASH_MISMATCH
EVENT_CHAIN_BROKEN
BACKUP_HISTORY_HEAD_MISMATCH
```

Restore must not partially commit canonical state.

### Runtime Incompatibility

```text
history valid
runtime cannot interpret
        ↓
blocked until compatible runtime available
```

Examples:

```text
BACKUP_REGISTRY_VERSION_UNSUPPORTED
BACKUP_RUNTIME_VERSION_UNSUPPORTED
REPLAY_UNSUPPORTED_EVENT_VERSION
```

Recovery waits for compatible runtime. It must not rewrite history.

### Partial Operational Loss

Examples:

```text
observability missing
command cache missing
snapshots missing
transport metadata missing
```

Result:

```text
canonical continuity intact
operational degradation only
```

Optional artifact loss does not change Realm identity.

## Mandatory Acceptance Tests

Future runbook and procedure tests should prove:

### 1. Same Backup Restored Twice Produces Same Head

```text
backup
        ↓
restore #1
        ↓
restore #2
        ↓
same history_head
```

### 2. Restored Lifecycle Matches Source Lifecycle

```text
same verified history
        ↓
same lifecycle state
```

### 3. Restore Never Writes Synthetic Authority Events

```text
restore procedure
        ↓
no new accepted events created
```

### 4. Operator Actions Cannot Bypass Kernel

```text
operator resume command
        ↓
still requires validator path for authority mutation
```

### 5. Optional Artifact Loss Does Not Change Identity

```text
missing observability / command cache / snapshot
        ↓
same restored Realm identity
```

### 6. DR Completion Requires Integrity Verification

```text
manual operator confirmation alone
        ↓
insufficient

integrity report + lifecycle derivation
        ↓
required
```

## Negative Boundaries

```text
Disaster recovery must not import CurrentAuthorityState as truth.
Disaster recovery must not rewrite Event History.
Disaster recovery must not append synthetic Realm Events.
Disaster recovery must not create root authority manually.
Disaster recovery must not bypass validator.
Disaster recovery must not treat backup verification as trust.
Disaster recovery must not resume on corrupted backup evidence.
Disaster recovery must not use operator privilege as authority source.
Disaster recovery completion must not rely on manual health assertion alone.
```

## Relationship to Follow-Up Operational ADRs

```text
ADR-0081  How does one Realm safely return to operation?
ADR-0082  What may administrative operations do without becoming authority?
ADR-0083  How may runtime deployment change without changing truth?
ADR-0084  How may many independent truth domains be operated safely?
```

ADR-0081 is the single-Realm disaster recovery procedure. Multi-Realm fleet
operations come after a single Realm can provably preserve and restore its own
continuity.

## Consequences

### Positive

- Disaster recovery becomes a provable continuity procedure
- Operators have explicit allowed and forbidden actions
- Resume depends on integrity, not manual assertion
- Backup, restore, verification, and lifecycle remain aligned
- Partial operational loss is distinguishable from identity loss

### Negative

- Recovery takes longer than projection import shortcuts
- Operators need runbooks tied to integrity evidence
- Runtime compatibility must be planned before restore
- Incident response must fail closed on corrupted evidence

## Non-Goals

- No orchestration platform selection in this ADR
- No on-call workflow design in this ADR
- No admin UI design in this ADR
- No backup storage vendor selection in this ADR
- No multi-Realm fleet operations in this ADR
- No new recovery authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should document and test procedure
invocation over existing runtime helpers, not add a new write path:

```text
1. define DR procedure state names and transitions
2. map procedure steps to verifyBackupArtifact / restoreRealmFromBackup / verifyRealmIntegrity / deriveRealmLifecycleState
3. add runbook tests for fail-closed corrupted backup and missing history
4. add tests proving operator resume does not bypass validator
5. add tests proving same backup restored twice yields same history_head
```

Suggested operational targets:

- disaster recovery runbook
- procedure state machine documentation
- operator checklist tied to integrity evidence
- automated DR drills using existing backup/restore runtime

## Summary

CRUD disaster recovery asks:

```text
how do we put the database back online?
```

Realm disaster recovery asks:

```text
how do we prove the same Realm still exists?
```

Answer:

```text
Locate evidence.
Verify backup.
Replay history.
Confirm integrity.
Derive lifecycle.
Resume safely.
```

Disaster recovery restores continuity. Disaster recovery does not restore state.
