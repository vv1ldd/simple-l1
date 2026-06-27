# ADR-0071: Device Event Submission Protocol

Status: Accepted

This ADR defines how an active device proposes Realm mutations without
becoming a direct writer of canonical Realm State.

ADR-0066 froze multi-device continuity as authorized event replication.
ADR-0069 materialized authority instruments and `CurrentAuthorityState`.
ADR-0070 defined recovery as authority transition. ADR-0071 defines how a
device with valid authority submits mutations through the Realm event pipeline.

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
```

## Acceptance Criteria

ADR-0071 is accepted when the following implementation boundaries are frozen:

```text
device_does_not_mutate_realm_state_directly
device_submits_authorized_event_proposals
realm_validates_and_applies_accepted_events
proposal_is_not_accepted_realm_event_until_validation
possession_of_key_is_insufficient_for_acceptance
failed_submissions_leave_no_authority_mutation
realm_owns_acceptance_not_device
every_accepted_mutation_has_corresponding_realm_event
every_event_validated_against_current_authority_state
revoked_devices_cannot_create_accepted_events
replaying_accepted_events_reconstructs_identical_realm_state
```

## Constitutional Kernel

```text
A device does not mutate Realm State directly.
A device submits authorized event proposals.
The Realm validates and applies accepted events.
```

A device is not a state writer. A device is a participant in the event pipeline.

## Context

ADR-0066 established:

```text
A device does not synchronize identity state.
A device synchronizes authorized realm events
and rebuilds state locally.
```

ADR-0069 established:

```text
Device authority is an instrument of action,
not the source of identity.
```

Therefore a device has no right to mutate canonical Realm State directly.

## Questions This ADR Answers

```text
How does a device propose a realm mutation?
What validation must occur before an event is accepted?
Why is a signed proposal not yet a Realm Event?
Who owns acceptance: device or realm?
What happens when a revoked device submits a proposal?
```

This ADR does **not** select transport (HTTP, WebSocket, gossip), offline queue
storage, retry policy, or UI ceremony details.

## Core Problem

```text
How does an active device perform authorized actions inside the realm?
```

This is not:

```text
How does a device update its local database?
```

This is:

```text
How does a device propose a mutation that the Realm may accept
into canonical history?
```

## Decision

Every mutation passes through the Realm Event pipeline:

```text
Device
        |
        | signed event proposal
        v
Realm Validator
        |
        +-- signer validation
        +-- authority validation
        +-- transition validation
        +-- sequence validation
        v
Realm Event Log
        v
applyEvent()
        v
Current Realm State
```

The device proposes. The Realm accepts or rejects.

## Event Submission Model

A device submits an **Event Proposal**:

```json
{
  "event_type": "DEVICE_KEY_REVOKED",
  "payload": {},
  "signer": "device_authority_ref",
  "authority_reference": "current_authority_ref",
  "sequence_reference": "expected_next_sequence"
}
```

Boundary:

```text
Proposal
        |
        v
Validation
        |
        v
Accepted Realm Event
```

A proposal is not canonical truth until the Realm accepts it.

## Validation Flow

Wrong model:

```text
valid signature
        |
        v
accept
```

Correct model:

```text
signature valid
        +
authority chain valid
        +
transition allowed
        +
sequence valid
        |
        v
accept
```

Possession of a key is insufficient. The key must be currently authorized for
the requested transition.

## Invariants

### 1. Device Cannot Mutate State Directly

Forbidden:

```text
device
        |
        v
update Realm State
```

Required:

```text
device
        |
        v
submit event
        |
        v
realm decides
```

### 2. Possession of Key Is Insufficient

Signature validity alone does not create authority.

The Realm must evaluate:

```text
Who signed?
Was that signer authorized at this sequence point?
Is this transition allowed for that authority role?
Does the proposal conflict with current authority state?
```

### 3. Failed Submissions Leave No Authority Mutation

Example:

```text
revoked device submits event
        |
        v
signature valid
        |
        v
authority invalid
        |
        v
reject
```

```text
attempt ≠ accepted Realm Event
```

Rejected proposals may be logged for audit. They must not mutate canonical
Realm State.

### 4. Realm Owns Acceptance

```text
Device: proposes
Realm: accepts
```

This preserves ADR-0064:

```text
authority decides valid mutation
```

The device does not become a second writer of truth.

## Relationship to ADR-0069 and ADR-0070

```text
ADR-0069  who can act?
        |
        v
ADR-0070  how continuity is restored?
        |
        v
ADR-0071  how active authority performs actions?
```

- ADR-0069 defines authority instruments and `CurrentAuthorityState`
- ADR-0070 defines recovery transitions that restore valid device authority
- ADR-0071 defines how that authority is used for ordinary mutations

Recovery restores the right to propose. Submission governs how proposals
become accepted history.

## Relationship to ADR-0066

ADR-0066 defined replication between devices as authorized event consumption.

ADR-0071 defines the write-side counterpart:

```text
ADR-0066  replica consumes authorized events
ADR-0071  device proposes events for realm acceptance
```

Both sides preserve the same rule:

```text
events are canonical
state is projection
```

## Relationship to ADR-0068

Device-local caches, queues, and transport are replaceable representations.

Canonical acceptance happens only when the Realm appends to the Event Log.

```text
offline queue ≠ accepted Realm Event
local optimistic UI ≠ accepted Realm Event
transport delivery ≠ accepted Realm Event
```

## Negative Boundaries

```text
Device must not PATCH CurrentAuthorityState.
Device must not append directly to Realm Event Log without validation.
Accepted event must not skip authority transition rules.
Revoked device proposal must not become accepted by replay shortcut.
Proposal acceptance must not bypass realm sequence ordering.
Domain events must not be submitted through realm mutation pipeline.
```

## Consequences

### Positive

- Single canonical acceptance point in the Realm
- Revoked devices fail closed
- Device implementations can be replaced without changing truth model
- Offline proposals can exist without corrupting history
- ADR-0072 federation can reuse event-verification semantics

### Negative

- Every mutation requires validator plumbing
- Devices need proposal/accept/reject protocol handling
- Optimistic UI must reconcile with accepted history
- Support cannot "fix state" by editing projections

## Non-Goals

- No transport protocol selection in this ADR
- No offline queue implementation in this ADR
- No federation trust policy in this ADR
- No recovery ceremony details in this ADR
- No crypto-suite selection in this ADR

## Roadmap Position

```text
IMPLEMENTATION
ADR-0069  authority instruments
ADR-0070  continuity recovery
ADR-0071  authorized mutations
ADR-0072  external trust policy
```

```text
ADR-0071  Can this device act inside my Realm?
ADR-0072  Can this other Realm be trusted?
```

The implementation chain remains symmetric: internal authority instruments,
recovery, authorized mutation, then external trust.

## Relationship to Follow-Up ADRs

Follow-up work may define:

- proposal envelope schema and error codes
- realm validator implementation against `CurrentAuthorityState`
- offline proposal queue and replay on reconnect
- ADR-0072 federation assertion acceptance using the same validation model
