# ADR-0070: Recovery Ceremony Protocol

Status: Accepted

This ADR defines how authority continuity is restored after device loss, key
loss, or execution-environment failure without treating recovery as key
restoration or database rollback.

ADR-0064 froze recovery as governance over authority continuity. ADR-0069
materialized authority instruments and projections. ADR-0070 defines the
recovery ceremony as a validated authority transition recorded in the Realm
Event Log.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss without restoring key material?
```

## Acceptance Criteria

ADR-0070 is accepted when the following implementation boundaries are frozen:

```text
recovery_restores_authority_continuity_not_key_material
recovery_is_authority_transition_recorded_as_realm_events
recovery_never_mutates_identity_state_directly
successful_recovery_always_emits_realm_events
recovered_identity_has_continuous_authority_history
lost_devices_can_be_revoked_without_destroying_identity
replaying_realm_events_reconstructs_recovered_state
recovery_does_not_transfer_ownership
recovery_cannot_bypass_authority_history
old_authorities_remain_historically_visible
recovery_authority_is_distinct_from_device_authority
```

## Constitutional Kernel

```text
Recovery restores authority continuity.
It does not restore key material.

Recovery is an authority transition,
recorded as Realm Events.
```

## Context

Loss of a device, key, or execution environment must not imply loss of
identity.

ADR-0064 established:

```text
Identity continuity is governed by authority chain,
not by device continuity.
```

Recovery must restore the ability to continue the authority chain. It must not
copy old state, restore a backup, or replace key material as if that were the
source of truth.

## Questions This ADR Answers

```text
How is recovery performed without creating a new identity?
What Realm Events record a successful recovery?
How does recovery differ from everyday device authentication?
What must recovery never do to CurrentAuthorityState or key stores?
```

This ADR does **not** select recovery factors (email, guardian, hardware token),
UI flows, crypto algorithms, or device submission transport. Those are
implementation details constrained by this protocol boundary.

## Core Problem

```text
How does authority continuity get proven and recorded?
```

This is not:

```text
How do we restore keys?
```

This is:

```text
How does the Realm recognize continuation of the same authority chain
after a lost or compromised access instrument?
```

## Decision

Recovery is a governed authority transition.

Wrong model:

```text
restore backup
        |
        v
identity restored
```

Wrong model:

```text
recovery
        |
        v
replace keys
        |
        v
done
```

Correct model:

```text
prove recovery authority
        |
        v
validate recovery policy
        |
        v
append Realm Events
        |
        v
derive CurrentAuthorityState
        |
        v
new authority becomes active
```

Recovery does not mutate state directly. Recovery appends authorized history.

## Recovery Event Model

Minimum Realm Events:

```text
RECOVERY_AUTHORITY_ADDED
RECOVERY_EXECUTED
DEVICE_KEY_ISSUED
DEVICE_KEY_REVOKED
```

Optional supporting events from ADR-0069:

```text
RECOVERY_AUTHORITY_PROVEN
AUTHORITY_ROTATED
```

Recovery must never:

```text
edit CurrentAuthorityState
delete authority history
import foreign realm state
replace key store and skip event append
```

## Authority Flow

Normal scenario:

```text
Lost Device
        |
        v
Recovery Ceremony Started
        |
        v
Recovery Authority Verified
        |
        v
RECOVERY_EXECUTED
        |
        v
DEVICE_KEY_ISSUED (new device)
        |
        v
DEVICE_KEY_REVOKED (old device)
```

After recovery:

```text
same sl1e_* continuity
new active device authority
old device authority revoked in history
authority history preserved
```

Not:

```text
new phone = new identity
```

## Invariants

### 1. Recovery Does Not Transfer Ownership

```text
Recovery proves continuity.
It does not create a new identity owner.
```

Recovery restores the ability to act under the same identity within the same
Realm. It must not reassign identity to a different subject.

### 2. Recovery Cannot Bypass Authority History

Forbidden:

```text
recovery
        |
        v
edit CurrentAuthorityState
```

Required:

```text
recovery
        |
        v
append event
        |
        v
rebuild projection
```

### 3. Old Authorities Remain Historical

After recovery:

```text
old device:
    revoked

history:
    preserved
```

Forbidden:

```text
delete old key
erase revoked authority record
```

Revoked devices remain visible in authority history.

### 4. Recovery Authority Is Distinct

```text
Recovery authority ≠ Device authority
```

Recovery authority proves continuity and authorizes transition. It must not
become another everyday login device by default.

Recovery ceremony is governance. Device authority is operational use.

## Relationship to ADR-0069

```text
ADR-0069 defines authority instruments.
ADR-0070 defines transitions between authority states.
```

```text
Key hierarchy:
    who can act?

Recovery ceremony:
    how continuity is restored?
```

ADR-0069 prepared the rule:

```text
Recovery must produce authority events,
not mutate key material directly.
```

ADR-0070 defines the ceremony that satisfies that rule.

## Relationship to ADR-0068

Recovery must follow the canonical pattern:

```text
Canonical: Realm Event Log / Authority History
Representation: key material, recovery artifacts, ceremony UI
Runtime: issuer recovery endpoint, device enrollment flow
```

No recovery step may make representation into authority.

## Validation Flow

```text
recovery proof presented
        |
        v
identify recovery authority type
        |
        v
verify against recovery policy
        |
        v
verify signer is authorized for recovery transition
        |
        v
append RECOVERY_EXECUTED and related events
        |
        v
replay / derive CurrentAuthorityState
        |
        v
new device authority becomes valid
```

A recovery attempt may fail. Failure must not mutate authority state.

## Negative Boundaries

```text
Recovery must not restore database backup as identity truth.
Recovery must not copy key material from old device as sufficient proof.
Recovery must not issue root authority as convenience.
Recovery must not delete revoked device history.
Recovery must not create a new sl1e_* unless identity issuance is intentional.
Recovery UI success must not precede event append success.
```

## Consequences

### Positive

- Device loss does not destroy identity
- Recovery becomes auditable authority history
- Compromised devices can be revoked cleanly
- New device onboarding reuses same identity continuity
- ADR-0071 device submission can assume valid authority graph

### Negative

- Recovery requires ceremony design before UX shortcuts
- Failed recovery must fail closed
- Support flows cannot "reset account" by deleting history
- Recovery policy must be explicit and testable

## Non-Goals

- No recovery factor selection in this ADR
- No recovery UI wireframes in this ADR
- No device event submission protocol in this ADR
- No federation recovery across realms in this ADR
- No vault key unwrapping in this ADR

## Roadmap Position

```text
IMPLEMENTATION
ADR-0069  Build authority instruments
ADR-0070  Perform continuity recovery
ADR-0071  Submit authorized mutations
ADR-0072  Establish external trust
```

```text
ADR-0070  Who is allowed to recover?
ADR-0071  How does an active device submit mutations?
```

Recovery comes before ordinary device mutation lifecycle: first restore
authority continuity, then operate under valid device authority.

## Relationship to Follow-Up ADRs

Follow-up work may define:

- recovery factor models (guardian, email claim, hardware backup)
- recovery ceremony API and issuer endpoints
- event schemas for `RECOVERY_*` transitions
- ADR-0071 device event submission for post-recovery operation
