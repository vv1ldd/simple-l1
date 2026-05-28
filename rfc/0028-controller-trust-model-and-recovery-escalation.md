# RFC-0028: Controller Trust Model & Recovery Escalation

Status: Draft

This document defines controller trust semantics for Simple Layer One identities.

RFC-0028 depends on:

```text
RFC-0011: Identity Kernel & Capability Resolution
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0027: Identity Control Plane & Recovery Policy
```

RFC-0028 does not create direct authority.

It defines trust signals that policy may consume.

---

## 1. Core Principle

```text
Controller trust is policy input.
Controller trust is not authority.
```

A trusted controller may increase confidence.

It may contribute to quorum.

It may permit escalation into a stronger ceremony.

It must not bypass:

```text
PolicyDecision
Capability
Authorization
Execution validation
Settlement lineage
```

Forbidden shortcut:

```text
high_trust_controller -> direct settlement mutation
```

---

## 2. Controller Classes

Controller class describes the kind of authenticator.

Valid classes include:

```text
platform_passkey
synced_passkey
hardware_key
cold_recovery_controller
organizational_controller
service_controller
```

Class is descriptive.

Class is not authority.

Example:

```text
hardware_key
  may be high confidence
  may be recovery-scoped
  must still pass policy
```

---

## 3. Trust Levels

Trust level describes policy confidence in a controller.

Suggested levels:

```text
low
standard
elevated
recovery
governance
```

Trust level must be interpreted by policy.

Trust level must not directly grant capability.

Example:

```text
cold recovery controller
  trust_level: recovery
  scope: recovery
```

This controller may help re-establish trusted control.

It must not automatically approve daily payments.

---

## 4. Controller Scope

Scope limits the operations for which a controller may be considered.

Common scopes:

```text
login
identity_management
payment_approval
recovery
governance
service_execution
```

Scope is a policy input.

It does not create direct permission.

Examples:

```text
MacBook passkey
  class: platform_passkey
  trust_level: standard
  scope: login, low_risk_approval

iPhone passkey
  class: synced_passkey
  trust_level: standard
  scope: login, daily_approval

YubiKey
  class: hardware_key
  trust_level: elevated
  scope: identity_management, recovery

cold recovery controller
  class: cold_recovery_controller
  trust_level: recovery
  scope: recovery
```

---

## 5. Enrollment Ceremonies

Enrollment is a high-risk operation.

It must be explicit.

Valid ceremonies include:

```text
self_enrollment
existing_controller_approval
threshold_enrollment
cooldown_enrollment
attested_hardware_enrollment
organizational_approval
```

Default rule:

```text
new controller enrollment
  requires fresh approval
  by at least one active controller
```

High-risk enrollment SHOULD require:

```text
threshold approval
cooldown window
notification to existing controllers
scope limitation until cooldown expires
```

Enrollment must produce an auditable controller lifecycle event.

---

## 6. Cooldown Enrollment

Cooldown enrollment creates a temporal security boundary.

Example:

```text
new elevated controller requested
  -> pending for 24 hours
  -> existing controllers notified
  -> policy revalidates at activation time
  -> controller becomes active
```

During cooldown, the pending controller must not contribute to:

```text
recovery quorum
governance quorum
high-value payment approval
last-controller removal
```

Cooldown gives existing controllers time to react to malicious enrollment.

---

## 7. Quorum Semantics

Quorum defines how multiple controllers contribute to policy confidence.

Supported forms:

```text
1 of N
M of N
weighted_threshold
scope_specific_quorum
time_delayed_quorum
```

Weighted example:

```text
phone = 1
laptop = 1
yubikey = 2
cold_recovery_key = 3

required_threshold = 2
```

Quorum output is still a policy result.

It must not directly execute an action.

---

## 8. Controller Decay

Trust should not be eternal.

Inactive controllers may decay.

Decay signals include:

```text
last_seen_at
last_successful_auth_at
days_since_use
device_attestation_age
missed_rotation_check
reported_lost
```

Decay effects may include:

```text
reduced trust weight
reduced scope
freshness challenge required
cooldown required for sensitive actions
manual recovery review required
```

Example:

```text
controller inactive for 180 days
  -> cannot approve recovery alone
  -> may still approve low-risk login
```

---

## 9. Compromise Handling

Compromise must be represented as a controller state transition.

States:

```text
active
suspected_compromise
restricted
revoked
recovery_pending
```

Compromise response may include:

```text
revoke controller
freeze identity management
reduce capability scope
require stronger quorum
enter recovery mode
notify active controllers
start cooldown before reactivation
```

Revoked controllers must not authenticate for new authority.

Previously issued artifacts must still be checked by expiry, replay, revocation, and audience rules.

---

## 10. Recovery Escalation State Machine

Recovery is a state machine.

It is not a backup phrase prompt.

```text
normal
  -> suspected_compromise
  -> restricted
  -> recovery
  -> re_established_trust
```

### normal

Identity uses ordinary policy.

### suspected_compromise

Risk signals indicate possible controller compromise.

Policy may reduce scope or require stronger quorum.

### restricted

High-risk actions are blocked.

Identity management may require recovery-scoped controllers.

### recovery

Recovery policy evaluates trusted controllers, quorum, cooldown, and context.

### re_established_trust

New controller set is active.

Revoked or stale controllers remain excluded.

---

## 11. Device Attestation Boundary

Device attestation may improve trust confidence.

It must not create direct authority.

Examples:

```text
hardware-backed credential evidence
platform authenticator metadata
enterprise device posture
security key attestation
```

Attestation is evidence.

Evidence feeds policy.

Policy creates decisions.

Decisions may support capability construction.

---

## 12. Required Invariants

Implementations MUST enforce:

```text
controller trust is not authority
controller scope is not permission
controller class is not permission
high-trust controllers cannot bypass policy
recovery controllers cannot directly execute settlement
pending controllers cannot satisfy high-risk quorum
revoked controllers cannot produce new authority
last active controller cannot be removed without recovery policy
```

Implementations SHOULD support:

```text
controller trust levels
controller scopes
weighted quorum
cooldown enrollment
inactive controller decay
compromise state transitions
recovery escalation workflows
hardware key attestation inputs
```

---

## 13. Non-Goals

This RFC does not define:

```text
hardware vendor trust lists
specific attestation formats
consumer wallet UI
custodial recovery
seed phrase derivation
chain-specific multisig contracts
```

Those systems may consume controller trust outputs.

They must not replace the policy layer.

---

## 14. Summary

Controller trust is part of identity governance.

It is not direct ownership.

```text
Controller
  -> TrustSignal
  -> PolicyEvaluation
  -> PolicyDecision
  -> Capability
  -> Authorization
  -> Execution
```

This preserves:

```text
identity continuity
operational authority separation
recovery safety
auditability
settlement integrity
```

The strongest controller is still not a god key.
