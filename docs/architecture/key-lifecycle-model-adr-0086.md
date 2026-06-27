# ADR-0086: Key Lifecycle Model

Status: Accepted

This ADR defines how cryptographic key lifecycle is represented, verified, and
operated without making key material, key stores, or current key metadata the
source of Realm identity or authority.

ADR-0069 established that keys are authority instruments, not identity. ADR-0070
established that recovery restores authority continuity, not key material.
ADR-0086 hardens the operational lifecycle of those instruments: key rotation,
expiration, revocation, compromise response, and archival must be caused by
accepted Realm Events and rebuilt through replay.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss without restoring key material?
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
ADR-0086 answers: How may key lifecycle be operated without making keys identity?
```

## Acceptance Criteria

ADR-0086 is accepted when the following key lifecycle boundaries are frozen:

```text
keys_represent_authority_capability
key_lifecycle_records_capability_continuity
keys_themselves_are_not_identity
key_generated_does_not_imply_authority_exists
key_rotated_does_not_rewrite_history
key_destroyed_does_not_erase_authority_history
key_events_are_history
current_keys_are_projection
key_store_is_replaceable_representation
revoked_key_cannot_authorize_new_commands
expired_key_cannot_authorize_new_commands_after_expiry
replaced_key_remains_explainable_in_history
key_rotation_does_not_rewrite_old_signatures
compromised_signer_response_is_recorded_as_events
deleted_operational_key_metadata_does_not_destroy_realm_continuity
replay_produces_same_key_lifecycle_projection
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Keys represent authority capability.
Key lifecycle records capability continuity.
Keys themselves are not identity.
```

Supporting kernel:

```text
Key events are history.
Current keys are projection.
```

Wrong:

```text
key generated
        ↓
authority exists
```

Wrong:

```text
key destroyed
        ↓
authority erased
```

Correct:

```text
accepted key lifecycle event
        ↓
hash-linked history
        ↓
replay
        ↓
current key capability projection
```

Hardening series guardrails:

```text
ADR-0069  key != identity
ADR-0070  recovery != key restoration
ADR-0073  migration != mutation
ADR-0078  verification != repair
ADR-0086  key lifecycle != identity lifecycle
```

## Context

The system already distinguishes:

```text
key possession
        !=
authority scope
```

ADR-0086 adds the production hardening layer:

```text
key lifecycle
        ↓
authority continuity
```

Operational systems must handle:

```text
key rotation
key expiration
multi-device rollover
emergency revocation
compromised signer response
key archival
deleted key-store metadata
```

All of those are lifecycle concerns over authority instruments. None of them
change the rule that Realm identity exists through accepted history.

## Questions This ADR Answers

```text
What does key creation mean?
How is key activation represented?
How does rotation preserve historical explainability?
How are expiration, revocation, and compromise handled?
What happens when key metadata is deleted?
How does replay rebuild current key capability state?
How does this prepare quorum recovery?
```

This ADR does **not** select cryptographic algorithms, hardware enclave design,
key storage backend, secret distribution system, HSM provider, or user recovery
UX.

## Core Boundary

Key lifecycle is event-sourced.

```text
Key lifecycle proposal
        ↓
Registry + Validator
        ↓
Accepted Realm Event
        ↓
History
        ↓
Key lifecycle projection
```

Not:

```text
Key store row update
        ↓
current authority changed
```

Key stores hold operational material. Realm history records authority
capability.

## Minimal Lifecycle Model

The lifecycle state machine is:

```text
KEY_CREATED
        ↓
KEY_ACTIVE
        ↓
KEY_ROTATION_REQUESTED
        ↓
KEY_REPLACED
        ↓
KEY_REVOKED
        ↓
KEY_ARCHIVED
```

These names describe lifecycle semantics. Implementations may map them to
existing authority events or future explicit key lifecycle events, but the cause
must be accepted Realm Event history.

Allowed projection shape:

```json
{
  "keys": [
    {
      "key_id": "key_123",
      "authority_ref": "device:abc",
      "status": "revoked",
      "createdEvent": "evt_001",
      "activatedEvent": "evt_002",
      "replacedEvent": "evt_010",
      "revokedEvent": "evt_011",
      "archivedEvent": "evt_020"
    }
  ]
}
```

The projection explains current capability. It does not create capability.

## Key Creation

Key generation is operational.

```text
generate key material
        ↓
candidate capability
```

Authority exists only after the appropriate accepted Realm Event records the
capability.

```text
candidate key
        ↓
KEY_CREATED / authority issue event accepted
        ↓
key appears in projection
```

Generated but unaccepted keys are not Realm authority.

## Key Activation and Scope

Activation must bind key capability to authority scope:

```text
key_id
authority_ref
allowed event types / capabilities
valid_from
valid_until
issuer authority
accepted event id
```

The validator evaluates current capability from replayed history. Possession of
private key material is necessary for signing but insufficient for authority.

## Key Rotation

Rotation does not rewrite old events.

Wrong:

```text
replace old public key in historical events
        ↓
old signatures now appear signed by new key
```

Correct:

```text
old key signs historical events
        ↓
rotation event accepted
        ↓
new key signs future events
        ↓
old key remains explainable
```

Old signatures remain attributable to the authority state at the time of
acceptance.

## Key Expiration

Expiration is a validation boundary:

```text
current time / event timestamp
        ↓
key validity interval
        ↓
accept or reject proposal
```

Expired keys remain in history. They cannot authorize new commands after expiry
unless an accepted authority event extends or replaces their capability.

Expiration metadata is meaningful only if it is derived from accepted history.

## Key Revocation

Revocation is a forward-looking authority transition.

```text
KEY_REVOKED accepted
        ↓
future proposals by key rejected
        ↓
historical events remain valid and explainable
```

Revocation must not erase:

```text
events signed before revocation
key issuance history
rotation chain
authority decisions made while capability was active
```

## Compromised Signer Handling

Compromise response must be recorded as events:

```text
compromise detected
        ↓
revocation / suspension / recovery proposal
        ↓
validator policy
        ↓
accepted Realm Event
        ↓
future capability blocked or replaced
```

Not:

```text
operator deletes key row
        ↓
pretend signer never existed
```

Historical damage analysis is an explanation and verification problem. It is not
a history rewrite.

## Multi-Device Rollover

Multiple devices may carry separate authority capabilities.

```text
device A key active
device B key active
device A key replaced
device B remains active
```

Rollover must preserve:

```text
per-device attribution
per-key status
per-event signer explainability
authority scope at time of acceptance
```

Device rollover is not identity rollover.

## Key Material and Metadata Loss

Operational key material may be lost, destroyed, archived, or unavailable.

```text
private key missing
        ↓
cannot sign future commands
        ↓
does not erase Realm continuity
```

Key metadata cache loss is operational degradation:

```text
key metadata cache deleted
        ↓
rebuild from history
        ↓
same key lifecycle projection
```

If private material is required for future signing and lost, recovery or
rotation must happen through accepted authority events.

## Failure Modes

### Revoked Key Signs New Command

```text
KEY_REVOKED
        ↓
new proposal signed by revoked key
        ↓
reject
```

Expected result:

```text
AUTHORITY_TRANSITION_DENIED
```

### Expired Key Signs New Command

```text
valid_until passed
        ↓
new proposal signed by expired key
        ↓
reject
```

Expected result:

```text
KEY_EXPIRED
```

### Rotation Attempts to Rewrite History

```text
KEY_REPLACED
        ↓
old signatures rewritten
        ↓
forbidden
```

Expected result:

```text
KEY_ROTATION_HISTORY_REWRITE_FORBIDDEN
```

### Key Store Loss

```text
key metadata table deleted
        ↓
replay history
        ↓
same lifecycle projection
```

Expected result:

```text
KEY_METADATA_REBUILT_FROM_HISTORY
```

### Compromised Key Hidden by Deletion

```text
operator deletes compromised key metadata
        ↓
history still records key
        ↓
future commands remain governed by history-derived status
```

Expected result:

```text
KEY_STORE_DELETION_NOT_AUTHORITY_EVENT
```

## Mandatory Acceptance Tests

Future key lifecycle tests should prove:

### 1. Revoked Key Cannot Authorize New Commands

```text
key active
        ↓
KEY_REVOKED
        ↓
new signed proposal
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 2. Replaced Key Remains Explainable

```text
old key accepted events
        ↓
KEY_REPLACED
        ↓
explain old event signer still works
```

### 3. Rotation Does Not Rewrite Old Signatures

```text
rotation accepted
        ↓
old event bytes unchanged
same old event hashes
```

### 4. Deleted Operational Metadata Does Not Destroy Continuity

```text
delete key metadata cache
        ↓
replay history
        ↓
same key lifecycle projection
```

### 5. Replay Produces Same Key Lifecycle Projection

```text
runtime key projection
        ↓
rebuild from event history
        ↓
same key statuses
same key event references
```

### 6. Generated But Unaccepted Key Has No Authority

```text
key material exists
        ↓
no accepted key event
        ↓
cannot authorize command
```

### 7. Compromise Response Is Event-Based

```text
compromise report
        ↓
revocation / recovery event accepted
        ↓
future signer blocked
```

## Relationship to Quorum Recovery

ADR-0086 prepares ADR-0087.

Quorum recovery must not mean:

```text
N keys sign
        ↓
magic admin override
```

It must mean:

```text
N independent authorities
        ↓
produce valid evidence
        ↓
policy threshold satisfied
        ↓
recovery transition accepted as Realm Events
```

Key lifecycle is the foundation for knowing which recovery authorities are
active, revoked, expired, replaced, or compromised at the time of quorum
evaluation.

## Relationship to Follow-Up ADRs

Production hardening continues:

```text
ADR-0085 Replay & Storage Scaling
ADR-0086 Key Lifecycle Model
ADR-0087 Quorum Recovery
ADR-0088 Attestation Boundary
ADR-0089 Compliance Evidence Export
ADR-0090 SDK Contract
```

The common invariant remains:

```text
Scale improves access to truth.
Scale does not create new truth.
```

## Consequences

### Positive

- Key lifecycle becomes replayable and explainable
- Rotation preserves historical attribution
- Revocation blocks future use without erasing old history
- Key metadata stores remain replaceable
- Quorum recovery can evaluate active authorities instead of raw key possession

### Negative

- Key operations require accepted events, not key-store shortcuts
- Expiration and revocation require careful validation semantics
- Operators cannot repair compromise by deleting metadata
- Historical signer explanation must preserve old key records

## Non-Goals

- No cryptographic algorithm selection in this ADR
- No HSM or enclave design in this ADR
- No key backup vendor selection in this ADR
- No user recovery UX in this ADR
- No quorum threshold policy in this ADR
- No new identity model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should extend key lifecycle
projection and tests, not introduce a mutable key authority table:

```text
1. define explicit key lifecycle projection records
2. map existing authority events to key lifecycle state
3. add future event contract placeholders where needed
4. reject proposals from revoked or expired capabilities
5. prove rotation preserves historical event bytes
6. rebuild key metadata from replay
7. expose key lifecycle explanation from history
```

Suggested test target:

```text
node/scripts/test-key-lifecycle-model.js
```

## Summary

Key lifecycle hardening asks:

```text
How do we operate changing keys without making keys identity?
```

Answer:

```text
Record lifecycle as Realm Events.
Replay lifecycle into projection.
Use projection for current capability checks.
Keep old signatures explainable.
Treat key stores as replaceable.
Never let key material define identity.
```

Keys represent authority capability. Key lifecycle records capability
continuity. Keys themselves are not identity.
