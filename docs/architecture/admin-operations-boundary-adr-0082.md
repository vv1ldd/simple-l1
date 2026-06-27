# ADR-0082: Admin Operations Boundary

Status: Accepted

This ADR defines how administrative operations may request Realm work without
making administrators, consoles, runbooks, or operational tooling an authority
source, event writer, or projection owner.

ADR-0081 defined disaster recovery as an operational procedure that invokes
verification and restore. ADR-0082 generalizes the governance rule for all
administrative operations: admin actions are commands, and commands are intent.
Realm history remains the only cause of authority state.

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
```

## Acceptance Criteria

ADR-0082 is accepted when the following operational governance boundaries are
frozen:

```text
administrative_action_is_intent
authority_transition_is_accepted_realm_event
admin_does_not_operate_outside_kernel
admin_is_not_authority_source
admin_is_not_event_writer
admin_is_not_projection_owner
admin_command_goes_through_execute_command
event_log_changes_only_after_accepted_event
admin_cannot_append_event_log_directly
admin_cannot_mutate_current_authority_state_directly
admin_cannot_bypass_validator
admin_cannot_create_root_without_authority_transition
admin_cannot_create_recovery_authority_without_authority_transition
failed_admin_command_leaves_no_history_change
failed_admin_command_leaves_no_projection_change
same_admin_command_id_is_idempotent
read_admin_operations_are_read_only
admin_audit_record_is_not_authority_history
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Administrative action is an intent.
Authority transition is an accepted Realm Event.
Admin does not operate outside the kernel.
```

Supporting kernel:

```text
Admin has capability to request.
Realm history decides what happens.
```

Wrong:

```text
Admin
        ↓
direct database action
        ↓
state changed
```

Correct:

```text
Admin Command
        ↓
Command Execution
        ↓
Validator + Registry
        ↓
Accepted Realm Event
        ↓
Projection
```

Hardening series guardrails:

```text
ADR-0076  API command != mutation
ADR-0077  audit / explanation != state
ADR-0081  operator procedure != authority
ADR-0082  admin operation != authority
```

## Context

The operational governance stack now has three intent boundaries:

```text
ADR-0076 API:
external interface is intent

ADR-0081 DR:
operator procedure is intent

ADR-0082 Admin:
operator authority is intent
```

The common invariant is:

```text
Operators, APIs, devices, federation, and transport are all callers.
Realm Event History remains the only cause.
```

Administrative tooling is especially risky because it often arrives with
privileged database access, operational urgency, and the expectation that "admin"
means "can fix state." In this system, admin means "can request operational
work." It does not mean "can define truth."

ADR-0082 prevents admin surfaces from becoming hidden write paths.

## Questions This ADR Answers

```text
What may an administrator request?
What must an administrator never mutate directly?
How do admin commands reach existing runtime behavior?
How is admin command idempotency enforced?
How are admin operations audited without making audit state authoritative?
How do admin read operations remain read-only?
How do failed admin commands preserve history and projection?
```

This ADR does **not** select an admin UI, RBAC provider, incident tooling,
operator console, ticketing system, or audit storage backend.

## Core Boundary

Administrative operations are commands.

```text
Admin Request
        ↓
Command
        ↓
Idempotency Boundary
        ↓
Dispatcher
        ↓
Existing Runtime
```

If the command proposes an authority transition, that transition still follows
the normal kernel:

```text
Proposal / Evidence
        ↓
Registry contract
        ↓
Validator
        ↓
Accepted Realm Event
        ↓
Hash-linked history
        ↓
Projection
```

Admin capability can authorize use of an operational command surface. It cannot
authorize a Realm authority transition by itself.

## Admin Role Boundary

```text
Admin != Authority Source
Admin != Event Writer
Admin != Projection Owner
```

Admins may:

```text
initiate operational commands
run diagnostics
request backup creation
invoke disaster recovery procedures
request federation operations
request integrity verification
request explanation / inspection reports
request authority transition proposals
review command results and lineage
```

Admins must not:

```text
mutate CurrentAuthorityState
append to event_log
bypass validator
bypass registry contracts
write accepted Realm Events directly
create root authority by admin privilege
create recovery authority by admin privilege
import projection as truth
mark authority transition accepted manually
```

Administrative privilege belongs to the operational plane. Realm authority
belongs to accepted Realm Event history.

## Command Model

All admin actions should enter the system as commands:

```text
{
  "command_id": "cmd_admin_...",
  "actor": "admin:...",
  "type": "RUN_INTEGRITY_CHECK",
  "payload": {}
}
```

Representative admin command types:

```text
CREATE_BACKUP
RUN_INTEGRITY_CHECK
EXECUTE_RECOVERY
RECOGNIZE_REALM
ROTATE_AUTHORITY
EXPLAIN_REALM_STATE
INSPECT_EVENT_HISTORY
```

Command semantics:

```text
CREATE_BACKUP
        ↓
read history and package evidence

RUN_INTEGRITY_CHECK
        ↓
verify and report

EXECUTE_RECOVERY
        ↓
invoke ADR-0081 procedure

RECOGNIZE_REALM
        ↓
request federation acceptance through existing policy

ROTATE_AUTHORITY
        ↓
request authority transition
        ↓
registry decides contract
        ↓
validator accepts or rejects
```

`ROTATE_AUTHORITY` does not mean:

```text
admin rotates key
```

It means:

```text
admin requests transition
        ↓
registry decides event contract
        ↓
validator evaluates current authority
        ↓
event accepted or rejected
```

## Idempotency Boundary

Admin commands must have stable command IDs.

```text
same command_id
        ↓
same command result
        ↓
no duplicate accepted events
```

Different command IDs represent different attempts, even if the payload is the
same.

Idempotency applies to the command execution record. It does not create
authority and does not replace event history.

## Audit Boundary

Admin operations require lineage:

```json
{
  "command_id": "cmd_admin_123",
  "actor": "admin:alice",
  "requested_action": "ROTATE_AUTHORITY",
  "result": "rejected",
  "accepted_event_ids": []
}
```

Audit records may explain:

```text
who requested an operation
which command was executed
what result was returned
which Realm Events were accepted, if any
which reason codes rejected the request
```

But:

```text
audit record != authority history
```

An audit store can be missing, corrupted, or rebuilt without changing Realm
identity. Accepted Realm Event history remains canonical.

This extends ADR-0077:

```text
Explanation != State
Audit != Authority
```

## Read Operations

Read-only admin operations include:

```text
EXPLAIN_REALM_STATE
RUN_INTEGRITY_CHECK
INSPECT_EVENT_HISTORY
LIST_BACKUPS
VERIFY_BACKUP
SHOW_LIFECYCLE
```

These operations may read canonical history, projections, snapshots, lifecycle
reports, and operational artifacts. They must not append Realm Events, mutate
projection, or mark lifecycle state by assertion.

Read operations produce reports. Reports are evidence for humans and automation;
they are not state transitions.

## Write-Like Requests

Some admin commands may request work that can result in accepted Realm Events:

```text
ROTATE_AUTHORITY
REVOKE_DEVICE
EXECUTE_RECOVERY
RECOGNIZE_REALM
```

These commands are not write paths. They are proposal paths.

```text
Admin Command
        ↓
proposal / evidence
        ↓
validateRealmEventProposal()
        ↓
acceptRealmEvent()
        ↓
event_log append only on success
```

Rejected commands must leave:

```text
history unchanged
projection unchanged
lifecycle unchanged unless separately derived from integrity
```

## Failure Modes

### Direct Projection Mutation

```text
admin console
        ↓
CurrentAuthorityState.devices.push(...)
        ↓
forbidden
```

Result:

```text
ADMIN_PROJECTION_MUTATION_FORBIDDEN
```

### Direct Event Append

```text
admin console
        ↓
event_log.push(...)
        ↓
forbidden
```

Result:

```text
ADMIN_EVENT_APPEND_FORBIDDEN
```

### Self-Escalation

```text
ADMIN_COMMAND
        ↓
ROOT_AUTHORITY_CREATED
```

Expected:

```text
AUTHORITY_TRANSITION_DENIED
```

Admin identity does not satisfy Realm authority policy.

### Failed Admin Command

```text
admin request
        ↓
validator rejects
        ↓
no history change
no projection change
```

### Audit Loss

```text
audit records missing
        ↓
operational degradation
        ↓
Realm identity unchanged
```

Audit is operational lineage, not canonical authority.

## Mandatory Acceptance Tests

Future runtime tests should prove:

### 1. Admin Command Goes Through `executeCommand()`

```text
admin request
        ↓
executeCommand()
        ↓
event_log changes only after accepted event
```

### 2. Direct Mutation Is Not a Path

```text
admin
        ↓
event_log.push()
        ↓
absent from admin implementation
```

Admin code must not contain direct event log appends or direct projection
mutation.

### 3. Admin Cannot Self-Escalate

```text
ADMIN_COMMAND
        ↓
ROOT_AUTHORITY_CREATED
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 4. Failed Admin Command Isolation

```text
rejected command
        ↓
no history change
no projection change
```

### 5. Same Admin Command Retry Is Idempotent

```text
same command_id
        ↓
same result
        ↓
no duplicate accepted events
```

### 6. Read Operations Remain Read-Only

```text
admin explain
admin verify
admin inspect
        ↓
no authority mutation
```

## Relationship to Follow-Up ADRs

ADR-0082 governs operational administration of a single Realm. The next layer is
deployment lifecycle:

```text
ADR-0083 Deployment Lifecycle Boundary:
How may runtime and registry versions change without creating a new truth source?
```

After deployment lifecycle, fleet-level governance can define how many Realms
are operated without collapsing their independent truth domains.

## Consequences

### Positive

- Administrative surfaces remain thin command callers
- Admin privilege cannot become Realm authority
- Failed admin requests leave canonical history untouched
- Read-only admin tooling can be broad without becoming dangerous
- Audit lineage improves operations without becoming canonical state

### Negative

- Admin tooling cannot use shortcut database writes
- Operational fixes require valid commands and accepted events
- Admin UX must expose rejection reasons instead of silently applying changes
- Audit systems must be designed as evidence stores, not truth stores

## Non-Goals

- No admin UI design in this ADR
- No RBAC provider selection in this ADR
- No incident management workflow selection in this ADR
- No audit storage backend selection in this ADR
- No deployment rollout model in this ADR
- No new authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be a thin admin command
adapter and focused tests, not a new runtime path:

```text
1. define admin command request normalization
2. route admin commands through executeCommand()
3. map read operations to existing diagnostic helpers
4. map write-like requests to existing proposal / command paths
5. persist audit lineage outside canonical Realm Event history
6. test self-escalation, idempotency, and failed command isolation
```

Suggested test target:

```text
node/scripts/test-admin-operations-boundary.js
```

## Summary

Administrative governance asks:

```text
How may operators manage the Realm?
```

Answer:

```text
As callers.
Through commands.
Through idempotency.
Through existing runtime.
Through validator and registry.
Never through direct state mutation.
```

Admin has capability to request. Realm history decides what happens.
