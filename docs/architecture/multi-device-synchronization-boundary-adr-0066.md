# ADR-0066: Multi Device Synchronization Boundary

Status: Accepted

This ADR freezes the boundary for how multiple devices maintain identity
continuity within one Identity Realm.

ADR-0063 froze Realm State as projection from the Event Log. ADR-0064 froze
who may authorize mutations. ADR-0065 froze which events belong to the realm.
ADR-0066 freezes what may be replicated between devices and how replicas
reconstruct state.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
ADR-0063 answers: What is an Identity Realm, what is Realm State, and what survives runtime failure?
ADR-0064 answers: How does identity preserve authority continuity across device loss, rotation, and recovery?
ADR-0065 answers: Which events belong to Identity Realm evolution versus Application Domain evolution?
ADR-0066 answers: How do multiple devices stay continuous with the same identity without syncing opaque state?
```

## Acceptance Criteria

ADR-0066 is accepted when the following boundaries are frozen:

```text
multi_device_continuity_uses_event_replication_not_state_sync
replica_verifies_authority_before_applying_events
realm_state_is_reconstructed_from_accepted_realm_events
state_is_never_synced_as_authority
events_require_authority_validation
offline_device_is_allowed_conflicting_authority_is_not
device_is_replica_not_owner_of_realm
device_hosts_authorized_view_not_canonical_identity
domain_events_are_out_of_scope_for_multi_device_realm_sync
```

## Constitutional Kernel

```text
Multi-device continuity is achieved through event replication,
not state synchronization.

A replica must verify authority before applying events.
Realm State is reconstructed from accepted Realm Events.

A device does not synchronize identity state.
A device synchronizes authorized realm events and rebuilds state locally.
```

## Questions This ADR Answers

```text
What is the object of multi-device replication?
May devices exchange Realm State directly?
How must a replica validate an incoming Realm Event?
How do offline devices reconcile without last-writer-wins?
Does a device own identity, or host a view of it?
```

This ADR does **not** answer which transport is used (WebSocket, gossip, push,
CRDT mesh), which sync protocol is implemented, or how federation between realms
works. Those belong in implementation ADRs or ADR-0067.

## Core Problem

```text
What is replicated between devices in one Identity Realm?
```

This is not:

```text
How do we sync JSON between phones?
```

This is:

```text
How do multiple devices converge on the same identity history
without treating local state as canonical truth?
```

## Decision

A device does not synchronize identity state. A device synchronizes authorized
Realm Events and rebuilds Realm State locally.

```text
same history
        │
        ▼
same state
```

Not:

```text
same state
        │
        ▼
hope history matches
```

## Continuation of Prior ADRs

```text
ADR-0063  state is projection
ADR-0064  authority decides valid mutation
ADR-0065  only realm events mutate realm
ADR-0066  replicas consume authorized realm events
```

Replication boundary:

```text
ADR-0066  How do I trust my other device?
ADR-0067  How do I trust another realm?
```

## Replication Model

```text
              Realm Event Log
                    │
        +-----------+-----------+
        │                       │
        ▼                       ▼
     Device A                Device B
        │                       │
 verify authority          verify authority
        │                       │
   applyEvent()             applyEvent()
        │                       │
 Realm State A            Realm State B
```

A replica does not trust state. A replica trusts valid events.

```text
event
  │
  ├── signature
  ├── authority reference
  └── realm sequence
        │
        ▼
verify
        │
        ▼
applyEvent()
        │
        ▼
rebuild Realm State
```

## Invariant 1: State Is Never Synced as Authority

Forbidden:

```text
Device A:
    send realm_state.json

Device B:
    replace local state
```

If state is exchanged as authority, the snapshot becomes the source of truth
and ADR-0063 is violated.

Allowed:

```text
Device A:
    submit authorized Realm Event

Device B:
    verify authority
    applyEvent()
    rebuild local Realm State
```

Snapshots may still exist locally as optimization. They must never be accepted
as replication authority.

## Invariant 2: Events Require Authority Validation

Each Realm Event must be evaluable as an authorized mutation before application.

Minimum conceptual envelope:

```text
event
 │
 ├── realm_id
 ├── sequence
 ├── timestamp
 ├── signer
 ├── authority reference
 └── payload
```

Validation flow:

```text
receive event
        │
        ▼
verify signer
        │
        ▼
verify authority chain
        │
        ▼
accept / reject
        │
        ▼
applyEvent()
```

A device may receive an event and reject it. Rejection is correct behavior when
authority is invalid.

## Invariant 3: Offline Device Is Allowed, Conflicting Authority Is Not

Offline operation is permitted. Conflicting authority is resolved by rules, not
by transport convenience.

Example:

```text
Device A emits:
    DEVICE_KEY_ISSUED

Device B emits:
    DEVICE_KEY_REVOKED
```

Resolution must use:

```text
authority chain order
        +
realm sequence
        +
valid transition rules
```

Not:

```text
last writer wins
        or
merge local state blobs
```

An offline device may queue events for later submission. It must not silently
become a second canonical writer of realm truth.

## Invariant 4: Device Is Replica, Not Owner of Realm

```text
Device does not own identity.
Device hosts an authorized view of identity.
```

The Identity Realm owns canonical truth. Devices are execution surfaces and
local replicas. They may cache projections, but they do not own the realm.

## Relationship to ADR-0065

Multi-device synchronization applies to Realm Events only.

```text
Device A
        │
        │ realm events
        ▼
Device B
        │
        │ verify authority
        ▼
rebuild Realm State
```

Domain events such as `ORDER_CREATED` or `PAYMENT_SETTLED` remain outside this
boundary. Business replication is a separate application concern.

## Relationship to ADR-0063 HA Replication

ADR-0063 primary-standby replication and ADR-0066 multi-device replication share
the same object:

```text
authorized Realm Events
```

They differ in deployment role:

```text
ADR-0063  issuer runtime / realm durability
ADR-0066  user device continuity
```

Both must reject state-as-authority and both must rebuild from accepted events.

## Negative Boundaries

```text
Device must not publish realm_state.json as sync payload.
Replica must not skip authority validation for convenience.
Offline queue must not bypass realm sequence rules.
Multi-device sync must not include domain events.
Device cache must not be treated as canonical identity truth.
Federation must not be implied by device-to-device sync.
```

## Consequences

### Positive

- Multiple devices can converge on one identity history
- State divergence is detectable through replay mismatch
- Revoked devices remain visible in shared history
- Offline use remains possible without inventing a second identity
- Federation can later reuse event-verification semantics

### Negative

- Devices need event validation logic, not just file copy
- Conflict resolution requires authority rules, not CRUD timestamps
- Local caches are projections only and may be rebuilt
- Transport choice is deferred until invariants are stable

## Non-Goals

- No WebSocket, gossip, CRDT, or push protocol selection in this step
- No device pairing UI specification in this step
- No federation trust policy in this step
- No domain-event replication in this step
- No encrypted vault sync in this step

## Roadmap Position

```text
ADR-0063  Where does truth live?
ADR-0064  Who can change truth?
ADR-0065  What belongs to this truth?
ADR-0066  How does this truth propagate?
ADR-0067  How do we recognize another truth?
```

ADR-0067 becomes the natural next layer:

```text
now:
    one realm
    many devices

later:
    many realms
    trust relationship
```

## Relationship to Follow-Up ADRs

Follow-up ADRs or implementations may define:

- Federated realm trust (ADR-0067)
- Device event submission transport
- Offline queue and replay policies
- Local snapshot cache formats for fast boot on device
- Conflict rejection reason codes and operator recovery flows
