# RFC-0027: Identity Control Plane & Recovery Policy

Status: Draft

This document defines the identity-first authority doctrine for Simple Layer One.

RFC-0027 depends on:

```text
RFC-0011: Identity Kernel & Capability Resolution
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0025: Runtime Architecture & Responsibility Boundaries
```

RFC-0027 introduces no settlement primitive.

It defines how authenticators control identity, and how identity control must remain separated from authority and execution.

---

## 1. Core Principle

```text
Wallet is not the root.
Identity is the root authority surface.
```

Wallets are consumers of identity-bound authorization.

They are not the durable root object.

Valid authority chain:

```text
Authenticator
  -> Identity
  -> Policy
  -> Capability
  -> Authorization
  -> Execution
  -> Settlement
```

Forbidden collapse:

```text
private key -> transaction -> settlement mutation
```

Simple Layer One must not degrade into raw key ownership semantics.

---

## 2. Layer Responsibilities

Each layer has one responsibility.

```text
Passkey authenticates.
Identity binds controllers.
Policy decides authority.
Capability scopes action.
Authorization approves intent.
Execution mutates settlement state.
```

Expanded responsibilities:

```text
Authenticator
  proves controller presence

Identity
  binds controllers to durable Entity addresses

Policy
  evaluates rules, risk, recovery, and context

Capability
  defines what action may exist

Authorization
  binds a controller, capability, intent, audience, and time window

Execution
  applies a validated transition

Settlement
  records economic state and lineage
```

No layer may skip the next required layer.

No layer may create objects outside its responsibility boundary.

---

## 3. Architectural Laws

The following laws are normative:

```text
Identity is durable.
Authenticators are replaceable.
Capabilities are scoped.
Authorizations are contextual.
Execution is replaceable.
Settlement is downstream.
```

Additional invariants:

```text
Authenticators never directly mutate settlement state.
Authentication is not authorization.
IdentityProof is not Capability.
Capability is not execution.
Execution must be lineage-complete.
```

An authenticator may prove that a controller is present.

It must not by itself prove that any asset action is allowed.

---

## 4. Identity As Control Plane

An Identity is a durable control plane over authorized controllers.

Example:

```text
Identity
  controller: iPhone passkey
  controller: MacBook passkey
  controller: Android passkey
  controller: YubiKey
  controller: cold recovery key
```

Each controller may have:

```text
controller_l1_address
credential_id
authenticator_type
rp_id
trust_weight
scope
status
created_at
revoked_at
```

Controllers may be added, revoked, rotated, scoped, or weighted.

Controller lifecycle must be represented as identity events, not as direct mutation of wallet state.

---

## 5. Recovery Model

Recovery is not a backup password.

Recovery is policy-controlled proof by another trusted authenticator.

Seed phrase model:

```text
single catastrophic secret
  -> total authority
```

SL1 identity model:

```text
set of authorized authenticators
  -> policy graph
  -> contextual authority
```

Valid recovery examples:

```text
1 of N passkeys approves new device enrollment
2 of 3 trusted controllers approve recovery
YubiKey plus phone approves admin recovery
cold recovery key approves controller rotation
```

Recovery must create or update controller bindings.

Recovery must not directly create settlement operations.

---

## 6. Enrollment Rules

New device enrollment must be policy-gated.

Default rule:

```text
new controller enrollment
  requires fresh approval
  from an existing active controller
```

Casual mode MAY allow:

```text
1 active controller approval
```

High-security mode MAY require:

```text
threshold approval
hardware key approval
cooldown period
out-of-band notification
```

The last active controller MUST NOT be removed unless a separate recovery policy is already active.

---

## 7. Scoped Controllers

Not all authenticators need equal authority.

Examples:

```text
MacBook passkey
  scope: login, low-risk approvals

iPhone passkey
  scope: daily approvals

YubiKey
  scope: admin, recovery

cold recovery key
  scope: catastrophic recovery only
```

Scopes are policy inputs.

They are not direct authority.

Policy must still produce a `PolicyDecision`.

Capability and Authorization must still be constructed before execution.

---

## 8. Weighted Controllers

Identity policy MAY assign weights to controllers.

Example:

```text
phone = 1
laptop = 1
yubikey = 2
cold_recovery_key = 3
```

Example policy:

```text
threshold >= 2
```

This allows human-friendly recovery without returning to single-secret custody.

Compromise of one sync provider or one device should not imply total authority when a higher-security policy is active.

---

## 9. Passkey Sync Provider Boundary

Passkey sync provider is not custody.

Examples:

```text
iCloud Keychain
Google Password Manager
platform authenticator sync
```

These systems may help users move authenticators across devices.

They must not be treated as SL1 asset custodians.

SL1 custody semantics are determined by:

```text
controller binding
policy decision
capability scope
authorization artifact
execution lineage
```

not by the vendor that synchronizes passkey material.

---

## 10. Wallet Boundary

A wallet is a consumer of identity authorization.

It may request:

```text
IdentityProof
IntentApproval
Authorization
Settlement execution
```

It must not become the root authority object.

Identity continuity must survive:

```text
wallet UI replacement
settlement backend migration
chain integration changes
capability system upgrades
application session resets
```

Identity is not account UI.

Identity is the durable control surface.

---

## 11. Regulatory Framing

SL1 does not require unilateral transfer authority.

SL1 coordinates verifiable authorization policies.

Allowed claim:

```text
SL1 manages identity-bound authorization policies.
```

Forbidden claim:

```text
SL1 controls user assets by holding root private keys.
```

A compliant implementation must preserve the distinction between:

```text
authentication
authorization
execution
custody
settlement
```

If those concepts collapse into one private key operation, the implementation violates this RFC.

---

## 12. Required Runtime Checks

Implementations MUST enforce:

```text
last active controller cannot be removed without recovery policy
new controller enrollment is policy-gated
revoked controllers cannot authenticate for new authority
IdentityProof cannot produce Capability directly
Authenticator output cannot mutate settlement state
Authorization must be contextual and time-bound
Execution must consume validated Authorization
```

Implementations SHOULD support:

```text
multi-passkey identity control
QR cross-device continuation
hardware key enrollment
controller scopes
controller weights
threshold recovery
cooldown windows
manual recovery review for high-risk policies
```

---

## 13. Non-Goals

This RFC does not define:

```text
wallet UI
chain-specific transaction formats
custodial account recovery
seed phrase derivation
omnibus balances
banking account ownership
```

It defines the identity control plane that those systems may consume.

---

## 14. Summary

Simple Layer One is not a wallet-first system.

It is an identity-first authorization system.

```text
Authenticators control Identity.
Identity anchors Policy.
Policy produces Capability.
Capability enables Authorization.
Authorization permits Execution.
Execution mutates Settlement.
```

This stratification is a protocol invariant.

It must remain visible in the architecture, runtime, and product language.
