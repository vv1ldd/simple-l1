# ADR-0064: Identity Key Hierarchy Boundary

Status: Accepted

This ADR freezes the boundary between identity continuity, authority lifecycle,
and the keys or devices that temporarily exercise that authority.

ADR-0063 froze where Realm State lives and how it is recovered from the Event
Log. ADR-0064 freezes who may change that state and how identity preserves
authority continuity when access instruments are lost, rotated, or replaced.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
ADR-0063 answers: What is an Identity Realm, what is Realm State, and what survives runtime failure?
ADR-0064 answers: How does identity preserve authority continuity across device loss, rotation, and recovery?
```

## Acceptance Criteria

ADR-0064 is accepted when the following boundaries are frozen:

```text
identity_exists_independently_from_active_keys
keys_authorize_actions_not_identity_existence
root_authority_is_governance_anchor_not_operational_credential
device_authority_handles_daily_authentication
session_authority_handles_short_lived_actions
device_loss_must_not_imply_identity_loss
recovery_restores_authority_continuity
recovery_does_not_transfer_ownership
authority_transitions_are_realm_events
validation_follows_authority_chain_not_key_possession
```

## Constitutional Kernel

```text
Identity continuity is governed by authority chain,
not by device continuity.

Keys authorize actions.
They do not define identity existence.

Root authority is a governance anchor,
not an operational credential.
```

## Questions This ADR Answers

```text
How does identity preserve authority continuity when devices change or are lost?
Who may authorize changes to the authority chain?
What is the difference between root, device, and session authority?
How is a presented key validated against current authority state?
```

This ADR does **not** answer which cryptographic algorithms are used, how
recovery ceremonies are implemented in UI, or how multi-device replication
propagates events. Those belong in follow-up ADRs.

## Core Problem

```text
How does identity preserve authority continuity when access instruments
are lost, rotated, or replaced?
```

This is not:

```text
How do we recover a password?
```

This is:

```text
How do we prove continuation of the same authority chain?
```

## Decision

Identity continuity is determined by the history of authority changes in the
Realm Event Log.

```text
Identity continuity is governed by authority chain,
not by device continuity.
```

Identity exists as historical continuity within an Identity Realm. Keys are
temporary authority instruments. Devices are execution surfaces. Recovery is a
continuity mechanism. The Event Log is constitutional history.

## Authority Model

```text
Identity Realm
        │
        ├── Root Authority
        │       ├── governance decisions
        │       ├── recovery approval
        │       └── authority rotation
        │
        ├── Device Authority
        │       ├── daily authentication
        │       └── user-facing operations
        │
        └── Session Authority
                └── short-lived execution
```

### Root Authority

Root authority is a governance anchor, not an operational credential.

```text
Root Authority Key
        │
        ├── authorize lifecycle changes
        ├── approve recovery
        └── rotate / revoke authorities
        │
        X
        │
        ├── login every day
        ├── sign every transaction
        └── act as device key
```

### Device Authority

Device authorities handle everyday authentication and user interaction. A device
key may be issued, used, and revoked without creating a new identity.

### Session Authority

Session authorities handle short-lived execution. They derive from device or
recovery authority and must not be treated as durable identity anchors.

## Invariants

### Identity

```text
Identity exists independently from active keys.
```

Identity is not defined by possession of a private key or seed phrase.

```text
Wallet model:
    seed / private key = identity

SL1 model:
    Realm recognizes authority chain
    therefore this key is currently valid
```

### Keys

```text
Keys authorize actions.
They do not define identity existence.
```

A key proves that a signer is currently authorized. It does not create the
identity.

### Root

```text
Root authority is a governance anchor,
not an operational credential.
```

Root authority governs lifecycle changes. It must not become daily login or
routine transaction signing.

### Device

```text
Device loss must not imply identity loss.
```

A lost phone, passkey, or hardware token is an authority instrument failure,
not identity death.

### Recovery

```text
Recovery restores authority continuity.
Recovery does not transfer ownership.
```

Recovery proves continuation of the same authority chain. It does not reassign
identity to a new subject.

## Authority History Model

```text
Identity Realm
        │
        ▼
Authority Chain
        │
        ├── active keys
        ├── revoked keys
        └── recovery path
```

Materialization:

```text
Event Log
        │
        ▼
Authority History
        │
        ▼
Current Authority State
```

All authority transitions are Realm Events. Examples:

```text
ROOT_AUTHORITY_CREATED
DEVICE_KEY_ISSUED
DEVICE_KEY_REVOKED
RECOVERY_AUTHORITY_ADDED
RECOVERY_EXECUTED
ROOT_AUTHORITY_ROTATED
```

Changing keys is part of identity history, not a side effect outside the log.

## Recovery Flow

```text
lost device
        │
        ▼
prove recovery authority
        │
        ▼
issue new device key
        │
        ▼
append DEVICE_KEY_ISSUED
        │
        ▼
revoke old device key
        │
        ▼
append DEVICE_KEY_REVOKED
```

Recovery does not mean:

```text
new phone = new identity
```

Recovery means:

```text
same identity
new authorized device key
old device key revoked in history
```

## Validation Flow

Wrong model:

```text
present key
        │
        ▼
accept identity
```

Correct model:

```text
identity history
        │
        ▼
current authority state
        │
        ▼
is presented key authorized now?
```

The Realm recognizes an authority chain. A key is valid only if it is currently
authorized within that chain.

## Platform Canonicality Pattern

Applied to authority:

```text
Canonical Owner: Identity Realm
Canonical State: Authority Chain / Current Authority State
Representation: Key material, credentials, recovery artifacts
Runtime: Device, Connect ceremony, session execution
```

Identity is not the key. The key is an authority instrument of identity.

## Relationship to ADR-0063

ADR-0063 established:

```text
Event Log = authority
Realm State = materialized projection
Snapshot = optimization only
```

ADR-0064 adds:

```text
Authority transitions must become Realm Events.
No authority change may exist outside the Event Log.
```

Any implementation that mutates authority state without appending a Realm Event
violates both ADR-0063 and ADR-0064.

## Consequences

### Positive

- Device loss does not destroy identity
- Phone replacement does not create a new subject
- Revoked devices remain visible in authority history
- Recovery becomes governance, not account takeover
- Multi-device sync can later trust events, not opaque state blobs

### Negative

- Possession of a seed or key alone is insufficient
- Authority history must be maintained
- Every key lifecycle change becomes a Realm Event
- Validation requires authority-state lookup, not key-only checks

## Negative Boundaries

```text
Recovery does not transfer ownership.
Root authority must not become daily authentication.
Device key revocation does not delete identity history.
Session authority must not be promoted to root authority by default.
```

## Non-Goals

- No multi-device synchronization protocol in this step
- No federation trust policy in this step
- No vault key-wrapping implementation in this step
- No UI recovery ceremony specification in this step
- No cryptographic algorithm selection in this step

## Roadmap Position

```text
ADR-0063  Where does truth live?
ADR-0064  Who can change truth?
ADR-0065  What changes belong to this truth?
ADR-0066  How does truth propagate?
ADR-0067  How do we recognize another truth?
```

ADR-0066 should follow this model:

```text
Not:
    Device A syncs state to Device B

But:
    Device A submits events
    Device B verifies authority
    Device B rebuilds state
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

## Relationship to Follow-Up ADRs

Follow-up ADRs may define:

- Realm Event vs Domain Event boundary (ADR-0065)
- Multi-device synchronization and event submission (ADR-0066)
- Federated realm trust (ADR-0067)
- Recovery ceremony and key-wrapping implementation details
