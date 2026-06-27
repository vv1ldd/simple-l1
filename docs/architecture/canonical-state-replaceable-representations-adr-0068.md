# ADR-0068: Canonical State and Replaceable Representations

Status: Accepted

This ADR generalizes the architectural pattern established across ADR-0063
through ADR-0067. It does not introduce a new platform layer or mechanism. It
names the shared design principle that those ADRs already follow.

ADR-0059 through ADR-0062 froze identity ownership, policy boundaries,
authentication replaceability, and vault ownership. ADR-0063 through ADR-0067
froze the constitutional identity substrate: realm state, authority lifecycle,
event class, replication, and federation trust.

ADR-0068 closes the architecture boundary series by stating the invariant that
connects them.

```text
ADR-0059 answers: Who owns identity and how do clients consume it?
ADR-0060 answers: Who evaluates policy and who decides?
ADR-0061 answers: How may authentication mechanisms evolve?
ADR-0062 answers: Who owns private user state?
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable across the platform?
```

## Acceptance Criteria

ADR-0068 is accepted when the following boundaries are frozen:

```text
canonical_state_is_defined_by_validated_history
representations_are_replaceable
authority_history_is_canonical
no_representation_may_become_new_source_of_authority
projection_mutation_must_not_rewrite_canonical_truth
validation_logic_is_canonical_not_storage_format
implementation_may_change_without_reopening_truth_questions
```

## Constitutional Kernel

```text
Canonical state is defined by validated history,
not by any particular storage representation.

Representations are replaceable.
Authority history is canonical.

Representation may change.
Authority history may not.
```

## Questions This ADR Answers

```text
What is canonical across the platform?
What is only a replaceable representation?
How do ADR-0063 through ADR-0067 fit one pattern?
How should future implementation ADRs avoid reopening truth questions?
```

This ADR does **not** answer which database, transport, UI framework, or crypto
library to use. Those belong in implementation ADRs.

## Core Pattern

```text
Canonical Owner
        │
owns
        ▼
Canonical State
        │
represented by
        ▼
Replaceable Representation
        │
served by
        ▼
Replaceable Runtime
```

The four design questions for any new subsystem:

```text
Who is the canonical owner?
What is the canonical state?
What is only a representation?
What is only a runtime?
```

## Canonical vs Replaceable

```text
Canonical
    │
    ├── Event History
    ├── Authority Rules
    └── Validation Logic

Replaceable
    │
    ├── Storage backend
    ├── Snapshot format
    ├── Transport
    ├── UI
    └── Device implementation
```

Canonical elements define what is true and what may change truth.

Replaceable elements define how truth is stored, displayed, moved, or executed.

## Relationship to ADR-0063

ADR-0063 established:

```text
State is projection.
```

ADR-0068 generalizes:

```text
Projection format is replaceable.
```

```text
realm_state.json
        │
        ├── cache
        ├── snapshot
        └── materialized view
```

These are not identity.

Identity substrate:

```text
realm_event_log
        │
        ▼
validated history
        │
        ▼
canonical state
```

## Central Invariant

```text
No representation may become a new source of authority.
```

Allowed:

```text
JSON snapshot
        ↓
SQLite projection
        ↓
Postgres projection
        ↓
distributed cache
```

Identity does not change because the representation changed.

Forbidden:

```text
modify projection
        ↓
claim identity changed
```

A database update, cache write, or UI edit must never rewrite canonical truth
unless it is the result of validated history replay or an authorized event
append.

## How ADR-0063…0067 Map to the Pattern

```text
ADR-0063  Truth location
          Canonical: Realm State via validated Event Log
          Replaceable: snapshot, issuer runtime, storage backend

ADR-0064  Mutation authority
          Canonical: authority chain and transition rules
          Replaceable: passkey, device key, recovery instrument

ADR-0065  Event ownership
          Canonical: Realm Events vs Domain Events
          Replaceable: marketplace DB, message bus, app indexes

ADR-0066  Replication model
          Canonical: authorized Realm Event history
          Replaceable: device cache, transport, local snapshot

ADR-0067  External trust
          Canonical: federation trust over authority histories
          Replaceable: endpoint discovery, assertion transport

ADR-0068  Canonical vs representation
          Names the pattern all of the above follow
```

Series summary:

```text
ADR-0063  Where does truth live?
ADR-0064  Who can change truth?
ADR-0065  What belongs to this truth?
ADR-0066  How does this truth propagate?
ADR-0067  How do we recognize another truth?
ADR-0068  What is canonical versus replaceable?
```

## Platform Examples

### Identity Realm

```text
Canonical Owner: Identity Realm
Canonical State: Realm State / Authority History
Representation: Event Log, Snapshot
Runtime: Issuer service, device replica
```

### Identity

```text
Canonical Owner: Issuer (within realm policy)
Canonical State: sl1e_* continuity
Representation: Identity Proof
Runtime: Connect ceremony
```

### Vault

```text
Canonical Owner: Entity
Canonical State: Canonical Vault
Representation: Encrypted blob(s)
Runtime: Storage backend
```

### Domain

```text
Canonical Owner: Application
Canonical State: Domain State
Representation: Database tables / indexes
Runtime: Application service
```

### Authentication

```text
Canonical Owner: Subject (control relationship)
Canonical State: Authorized control over identity
Representation: Passkey, bio adapter, hardware token
Runtime: Authentication adapter
```

## Implementation Guidance

After ADR-0068, implementation should follow history-first design.

### Key Hierarchy

Not:

```text
add columns to users table
```

But:

```text
add authority events
        +
validation rules
        +
projection update
```

### Recovery Ceremony

Not:

```text
restore database backup
```

But:

```text
prove authority
        +
append recovery events
        +
rebuild state
```

### Device Sync

Not:

```text
copy database
```

But:

```text
replicate canonical history
```

### Federation

Not:

```text
share storage
```

But:

```text
verify external authority history
```

## Negative Boundaries

```text
Snapshot must not become write authority.
Database row must not become identity existence proof.
UI state must not become canonical truth.
Transport choice must not redefine event meaning.
Storage migration must not require identity reissuance.
Implementation convenience must not bypass event append.
```

## Consequences

### Positive

- Technology choices become safer to replace
- Implementation ADRs can focus on mechanism, not ontology
- Reviews have one test: did we mutate representation or authority history?
- The platform gains a shared architectural language

### Negative

- Every feature must identify its canonical owner and state
- Quick CRUD shortcuts become architecturally visible
- More discipline is required before coding storage or sync

## Non-Goals

- No new identity mechanism in this step
- No implementation protocol in this step
- No storage backend selection in this step
- No replacement of ADR-0063 through ADR-0067

ADR-0068 summarizes them. It does not supersede them.

## End of Architecture Boundary Series

ADR-0068 is the last document in the constitutional architecture boundary
series begun at ADR-0063.

The next ADRs may move into implementation boundaries:

```text
ADR-0069  Key Hierarchy Implementation Boundary
ADR-0070  Recovery Ceremony Protocol
ADR-0071  Device Event Submission Protocol
ADR-0072  Federation Trust Policy Model
```

That transition marks the shift:

```text
before: what is true?
after:  how do we build it?
```

Foundational questions of ownership, trust, and truth should not need to be
reopened inside those implementation ADRs if ADR-0068 is respected.

## Relationship to Follow-Up ADRs

Follow-up work may:

- implement key hierarchy as authority events
- implement recovery as governed event append
- implement device sync as authorized history replication
- implement federation as explicit trust policy over external histories
- reference ADR-0068 in code review and design checklists
