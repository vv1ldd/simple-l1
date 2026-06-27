# ADR-0065: Realm Event vs Domain Event Boundary

Status: Accepted

This ADR freezes the boundary between Realm Events that evolve Identity Realm
state and Domain Events that evolve Application Domain state.

ADR-0063 froze where Realm truth lives. ADR-0064 froze who may change authority
within a realm. ADR-0065 freezes which events belong to which bounded context
and which state each event class may mutate.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
ADR-0063 answers: What is an Identity Realm, what is Realm State, and what survives runtime failure?
ADR-0064 answers: How does identity preserve authority continuity across device loss, rotation, and recovery?
ADR-0065 answers: Which events belong to Identity Realm evolution versus Application Domain evolution?
```

## Acceptance Criteria

ADR-0065 is accepted when the following boundaries are frozen:

```text
realm_events_define_identity_realm_evolution
domain_events_define_application_domain_evolution
neither_event_class_mutates_the_other_state_boundary
realm_event_is_not_business_event
business_activity_must_not_become_identity_history
identity_authority_changes_must_not_become_business_transactions
realm_log_owner_is_identity_realm
domain_log_owner_is_application
multi_device_sync_applies_to_realm_events_only
```

## Constitutional Kernel

```text
Realm Events define Identity Realm evolution.
Domain Events define Application Domain evolution.
Neither event class may mutate the other's state boundary.
```

## Questions This ADR Answers

```text
What events belong in the Identity Realm Event Log?
What events belong in Application Domain event streams?
May business activity become identity history?
May identity authority changes become business transactions?
What must multi-device sync replicate versus what stays application-local?
```

This ADR does **not** answer how domain events are stored, which message bus is
used, or how marketplace order projections are implemented. Those are
application implementation details.

## Core Problem

```text
What is the source of change for each bounded context?
```

This is not:

```text
How do we name different event types?
```

This is:

```text
Which events may mutate Realm State,
and which events may mutate Domain State?
```

## Decision

Realm Events and Domain Events are different sources of state evolution for
different bounded contexts. They must not be merged into a single undifferentiated
event stream.

```text
Realm Event ≠ Business Event
Business activity must not become identity history.
Identity authority changes must not become business transactions.
```

## Event Boundary Model

```text
Identity Realm
        │
        ├── IDENTITY_ISSUED
        ├── CLAIM_ISSUED
        ├── CLAIM_REVOKED
        ├── AUTHORITY_CHANGED
        ├── DEVICE_KEY_ISSUED
        ├── DEVICE_KEY_REVOKED
        ├── RECOVERY_EXECUTED
        └── ROOT_AUTHORITY_ROTATED
        │
        ▼
Realm State

Application Domain
        │
        ├── ORDER_CREATED
        ├── PAYMENT_SETTLED
        ├── INVENTORY_CHANGED
        └── INVOICE_PAID
        │
        ▼
Domain State
```

Realm Events change identity infrastructure state: authority, identity issuance,
claims, and realm governance.

Domain Events change application business state: orders, payments, inventory,
settlements, and local projections.

## Storage Boundary

Correct separation:

```text
simple-l1
    │
    └── realm_event_log
            │
            ├── authority
            ├── identity
            └── claims

marketplace
    │
    └── domain_events
            │
            ├── orders
            ├── payments
            └── inventory
```

Wrong model:

```text
event_log.jsonl
    USER_CREATED
    ORDER_CREATED
    PASSWORD_CHANGED
    PAYMENT_SETTLED
    CLAIM_REVOKED
```

A mixed log makes ownership, write authority, replication scope, and recovery
semantics unclear within a year.

## Invariants

### Realm Events

```text
Realm Events define Identity Realm evolution.
```

Examples:

- identity issued or continued
- claim issued or revoked
- authority added, rotated, or revoked
- device key issued or revoked
- recovery executed

Realm Events must append to the Identity Realm Event Log and may mutate Realm
State only through `applyEvent()` / replay.

### Domain Events

```text
Domain Events define Application Domain evolution.
```

Examples:

- order created or fulfilled
- payment settled
- inventory changed
- invoice paid

Domain Events must mutate Application Domain State only. They must not append
to the Identity Realm Event Log.

### Cross-Boundary Rule

```text
Neither event class may mutate the other's state boundary.
```

An order created in marketplace must not become identity history.

A claim revoked in the Identity Realm must not become a business transaction
record in the application database as the canonical source of that truth.

Applications may **project** verified identity or claim truth into local domain
state. They must not become the canonical owner of identity authority history.

## Relationship to ADR-0060

ADR-0060 separated truth, policy, decision, and domain projection.

ADR-0065 sharpens that separation at the event level:

```text
Realm Event  → changes Identity Realm truth
Domain Event → changes Application Domain state
Policy       → evaluates verified truth
Decision     → authorizes application action
Projection     → maps verified truth into local domain indexes
```

A payment settled in marketplace is a Domain Event. A claim revoked by an issuer
is a Realm Event. Conflating them breaks both boundaries.

## Relationship to ADR-0063 and ADR-0064

ADR-0063 established:

```text
Event Log = authority
Realm State = materialized projection
Snapshot = optimization only
```

ADR-0064 established:

```text
Authority transitions must become Realm Events.
```

ADR-0065 adds:

```text
Only identity-realm evolution may enter the Realm Event Log.
Business evolution must stay in domain event streams.
```

The correct dependency chain is:

```text
Realm Event Log
        │
        ▼
Authority History
        │
        ▼
Current Authority State
        │
        ▼
Allowed Actions
```

Not:

```text
Key Store
        │
        ▼
Identity
```

And not:

```text
Mixed Event Log
        │
        ▼
Unclear Ownership
```

## Multi-Device Implication

ADR-0066 should synchronize Realm Events only:

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

Business replication remains a separate application concern.

A device receives the right to participate in reproducing identity history. It
does not receive opaque domain state as identity truth.

## Negative Boundaries

```text
ORDER_CREATED must not append to realm_event_log.
CLAIM_REVOKED must not become a marketplace transaction record as canonical truth.
USER_EMAIL_CHANGED in an app database must not rewrite identity authority history.
Realm replication must not imply domain replication.
Domain replication must not imply realm replication.
```

## Consequences

### Positive

- Clear ownership of each event log
- Clear write authority per bounded context
- Clear replication scope for HA and multi-device sync
- Identity history stays constitutional, not commercial
- Marketplace growth does not pollute identity substrate

### Negative

- Systems must maintain two event classes consciously
- Cross-boundary workflows require explicit projection, not log merging
- Developers cannot dump all events into one stream for convenience

## Non-Goals

- No domain event storage implementation in this step
- No message bus selection in this step
- No marketplace schema changes in this step
- No multi-device sync protocol in this step
- No federation trust policy in this step

## Roadmap Position

```text
ADR-0063  Where does truth live?
ADR-0064  Who can change truth?
ADR-0065  What belongs to this truth?
ADR-0066  How does this truth propagate?
ADR-0067  How do we recognize another truth?
```

ADR-0065 protects the identity substrate before replication and federation
expand the system. Without this boundary, later ADRs would replicate the wrong
events.

## Relationship to Follow-Up ADRs

Follow-up ADRs may define:

- Multi-device synchronization of Realm Events only (ADR-0066)
- Federated realm trust without domain-event merging (ADR-0067)
- Domain event contracts for marketplace and other applications
- Projection rules from verified realm truth into application indexes
