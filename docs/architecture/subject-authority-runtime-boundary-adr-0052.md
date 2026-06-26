# ADR-0052: Subject Authority Runtime Boundary

Status: Accepted

This ADR defines how subject authority from RFC-0052 is represented at runtime.

```text
RFC-0052 answers: What is a subject?
ADR-0052 answers: How is subject authority represented in runtime?
```

RFC-0052 states that a subject is continuous authority existence.

ADR-0052 states that the runtime must preserve the evidence of that continuity.

## Acceptance Criteria

ADR-0052 is accepted when the following runtime boundaries are frozen:

```text
Canonical/derived runtime boundary frozen.
Runtime storage classification frozen.
Projection recovery rule frozen.
Application/profile boundary frozen.
Contract naming boundary frozen.
```

Canonical subject state MUST be reproducible from authority history.

If a runtime cannot rebuild subject state by replaying authority history, it has introduced a hidden source of truth.

## Constitutional Kernel

```text
Canonicality follows causality.
```

Canonical is not "what lives in the main database".

Canonical is "what causes a change of state".

```text
authority_event
  -> causes
projection
  -> displays
application view
```

The reverse direction is forbidden:

```text
application view
  -> updates
truth            # INVALID
```

## Canonical And Derived Layers

```text
CANONICAL
authority_events.log
  -> validation engine
  -> subject_authority_graph

DERIVED
  -> identity_projection
  -> device_view
  -> application_view
  -> UX / APIs
```

The runtime MUST treat authority history as the only source of truth.

The runtime MAY materialize projections for performance, UX, and application integration.

## Runtime Rules

```text
Runtime MUST NOT store a subject as a mutable profile row.
Runtime MUST derive subject state from authority history.
Runtime MAY materialize projections.
Runtime MUST keep projection lineage auditable.
Runtime MUST NOT let projection writes mutate canonical authority history implicitly.
```

## Forbidden Pattern: Projection Mutation

A projection field must never be edited as if it were a fact.

Invalid:

```json
{
  "device_owner": "alice"
}
```

Editing this field does not create a new fact.

Valid:

```json
{
  "type": "authority_event",
  "domain": "device",
  "action": "bind_device",
  "subject": "sl1:id:alice",
  "target": "sl1:device:pixel-7a"
}
```

The event causes the state. The projection only displays it.

## Status, Not Format

The problem with a materialized store is its status, not its file format.

```text
materialized store as truth        # INVALID
materialized store as projection   # VALID
```

A materialized projection:

```text
may be deleted
may be rebuilt
may be verified
may be compared against authority history
```

`node/ledger_db.json` is therefore classified as a materialized projection, not canonical identity truth, under this boundary.

## Projection Recovery Rule

```text
Any derived projection MUST be reconstructible from canonical authority history.
```

Valid recovery:

```text
replay(authority_events.log)
  -> rebuild projection
```

Invalid recovery:

```text
restore backup of mutable identity table
```

## Application Boundary

```text
Applications consume projections.
Applications do not own identity state.
```

An application may keep its own profile view:

```json
{
  "display_name": "Alice",
  "avatar": "...",
  "preferences": {}
}
```

This is an application profile.

It is not subject identity.

## Runtime Invariants

```text
stored_projection != authority_truth
mutable_profile != subject
projection_update != authority_event
canonical_layer = authority_history
derived_layer = materialized_views
projection_rebuild = replay(authority_history)
application_profile != subject_identity
canonical_subject_state = replay(authority_history)
```

## Contract Naming Boundary

Future contracts MUST use subject authority terminology for canonical primitives:

```text
subject
authority_event
authority_domain
claim
relationship
agent
delegation
projection
```

Future contracts MUST NOT use the following terms as canonical identity primitives:

```text
user
account
profile
wallet
provider_account
```

`user` is allowed only at UI and application boundaries.

Examples of valid application-boundary names:

```text
ChatAppUserView
CustomerProfileView
ApplicationUserPreferences
```

Examples of invalid canonical names:

```text
CanonicalUser
IdentityUser
UserAuthority
```

Names are part of the architecture. They must not pull the runtime back into account-centric semantics.

## Pipeline

```text
RFC-0052: Subject Authority And Identity Continuity
  -> ADR-0052: Subject Authority Runtime Boundary
  -> authority_events
  -> evaluation engine
  -> subject_authority_graph
  -> projections
  -> applications
```

After this boundary, the system cannot silently become:

```text
users table + more fields = identity system
```

The system must answer:

```text
not: where is the user stored?
but: which provable authority transitions made this subject the same subject over time?
```

## Sequencing

This ADR precedes schema definition.

```text
RFC
  -> runtime boundary (this ADR)
  -> evaluation boundary (ADR-0053)
  -> contracts/schema
  -> validation model
  -> implementation
  -> migration
```

Schemas such as `authority-event`, `claim`, `relationship`, `delegation`, and `projection` are defined only after this boundary is accepted, and they describe authority transitions, evidence, relationships, and derived views, not user data rows.

The interpreter that turns canonical authority history into derived subject state is constrained separately by ADR-0053: Authority Event Evaluation Boundary.
