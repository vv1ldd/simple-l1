# ADR-0069: Key Hierarchy Implementation Boundary

Status: Accepted

This ADR defines the first implementation boundary after the constitutional
architecture series. It materializes ADR-0064 authority lifecycle concepts into
events, validation rules, and projections without changing the nature of
identity.

ADR-0068 closed the architecture boundary series by freezing the rule that
canonical state is defined by validated history, not by storage
representations. ADR-0069 applies that rule to key hierarchy implementation.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
```

## Acceptance Criteria

ADR-0069 is accepted when the following implementation boundaries are frozen:

```text
key_hierarchy_implements_authority_lifecycle
key_hierarchy_does_not_create_identity_lifecycle
keys_are_authority_instruments
identity_exists_through_realm_continuity
key_state_is_derived_from_authority_events
key_store_is_replaceable_representation
current_authority_state_is_projection
adding_key_requires_valid_authority_event
revoked_keys_remain_historically_visible
all_key_lifecycle_changes_are_realm_events
removing_key_material_does_not_erase_identity_history
recovery_must_produce_authority_events_not_mutate_key_material_directly
```

## Implementation Kernel

```text
Keys are authority instruments.
Identity exists through Realm continuity.
Key state is derived from authority events,
not the source of authority.
```

Guardrail:

```text
Key hierarchy implements authority lifecycle.
It does not create identity lifecycle.
```

## Questions This ADR Answers

```text
Which events implement key hierarchy?
What projection represents current authority?
Which authority roles may perform which transitions?
Why is key storage replaceable?
What must never be inferred from key material alone?
```

This ADR does **not** select a storage backend, hardware enclave, remote signer,
crypto suite, recovery ceremony, or device submission transport.

## Core Boundary

Wrong model:

```text
keys table changed
        |
        v
identity changed
```

Correct model:

```text
authority event
        |
        v
validate transition
        |
        v
update CurrentAuthorityState
```

Identity continuity remains grounded in Realm history.

```text
Realm Event Log
        |
        v
Authority History
        |
        v
CurrentAuthorityState
        |
        v
Allowed Actions
```

Not:

```text
Key Store
        |
        v
Identity
```

## Authority Roles

ADR-0069 materializes the authority roles from ADR-0064:

```text
Root Authority
        |
        +-- Device Authorities
        |
        +-- Session Authorities
```

### Root Authority

Root authority may:

```text
+ rotate authority
+ approve recovery
+ establish governance changes
```

Root authority must not:

```text
- become daily login credential
- bypass event validation
- act as a default device key
```

### Device Authority

Device authority may:

```text
+ authenticate user
+ submit signed event proposals
+ request short-lived sessions
```

Device authority must not:

```text
- create arbitrary root authority
- rewrite history
- bypass current authority state
```

### Session Authority

Session authority may:

```text
+ perform short-lived actions
+ expire automatically
```

Session authority must not:

```text
- change authority graph
- issue durable device authority
- rotate root authority
```

## Event Model

Key hierarchy implementation must use Realm Events.

Initial event set:

```text
ROOT_AUTHORITY_CREATED
DEVICE_KEY_ISSUED
DEVICE_KEY_REVOKED
SESSION_AUTHORITY_ISSUED
SESSION_AUTHORITY_EXPIRED
AUTHORITY_ROTATED
```

Follow-up recovery ADRs may add:

```text
RECOVERY_AUTHORITY_PROVEN
RECOVERY_AUTHORITY_ADDED
RECOVERY_EXECUTED
```

Every authority transition must answer:

```text
Who signed this event?
Was that signer authorized at this point in history?
Is this transition valid for that authority role?
What projection changes after replay?
```

## Projection: CurrentAuthorityState

`CurrentAuthorityState` is a materialized view derived from the Realm Event Log.

Example shape:

```json
{
  "rootAuthority": {
    "status": "active",
    "issuedAt": "2026-06-27T00:00:00.000Z",
    "rotatedAt": null
  },
  "devices": [
    {
      "id": "device_01",
      "status": "active",
      "issuedAt": "2026-06-27T00:00:00.000Z",
      "revokedAt": null
    }
  ],
  "sessions": []
}
```

Invariant:

```text
CurrentAuthorityState != source of truth
```

Source:

```text
Realm Event Log
```

The projection may be rebuilt, cached, stored in a database, or moved to another
format without changing identity.

## Validation Rules

### Adding Authority

```text
Adding a new key requires a valid authority event.
```

No key becomes active merely because it exists in a key store.

### Revoking Authority

```text
Revoked keys remain historically visible.
```

Revocation changes current authority state. It must not delete authority
history.

### Operational Authority

```text
No operational key can mutate authority without authorization.
```

Device and session authorities must be constrained by role and transition
rules.

### Projection Rebuild

```text
Rebuilding CurrentAuthorityState from Event Log produces the same result.
```

If replay and stored projection disagree, replay wins.

## Replaceable Key Store Boundary

```text
Key store is replaceable representation.
```

Possible representations:

```text
local secure storage
        |
        v
hardware enclave
        |
        v
remote signer
```

None of these changes the model:

```text
identity continuity
        |
        v
authority history
```

The key store holds authority instruments. It does not hold identity existence.

## Required Implementation Shape

Implementation should introduce:

```text
Authority Events
        |
        +-- event handlers
        +-- transition validators
        +-- replay projector
        +-- CurrentAuthorityState view
```

Implementation should not introduce:

```text
keys table as source of identity
root key as everyday login
session key as durable authority
projection mutation as authority change
```

## Relationship to ADR-0070

Recovery becomes a special authority transition, not an exception.

```text
RECOVERY_AUTHORITY_PROVEN
        |
        v
DEVICE_KEY_ISSUED
        |
        v
DEVICE_KEY_REVOKED
```

ADR-0070 should define how recovery authority is proven and recorded. It should
not define recovery as database restore or key-store replacement.

## Relationship to ADR-0068

ADR-0068 established the meta-pattern for the constitutional layer:

```text
History defines truth.
Rules define authority.
Representations serve both.
```

ADR-0069 applies that pattern to key hierarchy implementation:

```text
CurrentAuthorityState is a projection.
It is not canonical authority.

Key storage is a representation.
It is not canonical identity.
```

This closes two common loopholes:

1. treating `CurrentAuthorityState` as the source of truth
2. inferring authority from key possession alone (`key exists → authority exists`)

ADR-0068 kernel:

```text
No representation may become a new source of authority.
```

ADR-0069 application:

```text
Key material is representation.
Authority history is canonical.
```

Wrong direction:

```text
private key storage
        |
        v
authentication
        |
        v
"identity"
```

Correct direction:

```text
Realm Event Log
        |
        v
Authority History
        |
        v
CurrentAuthorityState
        |
        v
available key instruments
```

Forbidden inference:

```text
private_key exists
        |
        v
identity exists
```

Valid model:

```text
Identity Realm continuity
        |
        v
Authority History
        |
        v
key is currently authorized
```

Recovery must follow the same rule. Forbidden path:

```text
recovery
        |
        v
replace keys
        |
        v
done
```

Correct path (prepared for ADR-0070):

```text
recovery ceremony
        |
        v
validate authority
        |
        v
append realm events
        |
        v
derive CurrentAuthorityState
        |
        v
new key becomes valid
```

## Consequences

### Positive

- Key storage can evolve without identity reissuance
- Device loss does not erase identity history
- Root authority cannot become accidental daily credential
- Recovery can be implemented as authority transition
- Current authority checks become replayable and auditable

### Negative

- Key lifecycle requires event handlers and validators
- Implementations cannot shortcut through CRUD key tables
- Projection mismatch must be treated as rebuild/verification issue
- Recovery requires authority semantics before UI flow

## Non-Goals

- No recovery ceremony protocol in this ADR
- No device event submission protocol in this ADR
- No federation trust policy implementation in this ADR
- No crypto-suite selection in this ADR
- No secure-storage backend selection in this ADR

## Roadmap Position

```text
ARCHITECTURE
ADR-0063  Truth location
ADR-0064  Mutation authority
ADR-0065  Event ownership
ADR-0066  Replication model
ADR-0067  External trust
ADR-0068  Canonical vs representation

IMPLEMENTATION
ADR-0069  Build authority instruments
ADR-0070  Perform continuity recovery
ADR-0071  Submit authorized mutations
ADR-0072  Establish external trust
```

ADR-0069 starts implementation work while preserving the constitutional
boundary: code materializes authority lifecycle, but does not redefine identity.
