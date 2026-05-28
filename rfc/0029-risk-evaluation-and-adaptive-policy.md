# RFC-0029: Risk Evaluation & Adaptive Policy

Status: Draft

This document defines risk evaluation semantics for Simple Layer One authorization.

RFC-0029 depends on:

```text
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0027: Identity Control Plane & Recovery Policy
RFC-0028: Controller Trust Model & Recovery Escalation
```

RFC-0029 does not define authority.

It defines contextual risk signals that policy may evaluate.

---

## 1. Core Principle

```text
Risk signal is policy input.
Risk signal is not denial or authority by itself.
```

Risk evaluation must not become an opaque authority engine.

Risk may change policy requirements.

Risk must not directly:

```text
grant capability
deny identity
execute settlement
freeze assets
revoke controllers
```

Those outcomes require explicit policy and authority artifacts.

---

## 2. Valid Pipeline

Risk belongs before policy decision.

Valid flow:

```text
Controller
  -> TrustSignal
  -> RiskSignal
  -> PolicyEvaluation
  -> PolicyDecision
  -> Capability
  -> Authorization
  -> Execution
```

Forbidden shortcut:

```text
RiskSignal -> Authorization
RiskSignal -> Execution
RiskSignal -> AssetFreeze
RiskSignal -> ControllerRevocation
```

RiskSignal is evidence.

PolicyDecision is the authority boundary.

---

## 3. RiskSignal

A RiskSignal describes contextual uncertainty or sensitivity.

It answers:

```text
What contextual risk should policy consider?
```

Shape:

```text
RiskSignal
  id
  subject_type
  subject_id
  signal_type
  severity
  confidence
  evidence
  observed_at
  expires_at
```

RiskSignal must be auditable.

RiskSignal must be time-bounded.

RiskSignal must include reason codes or evidence references.

---

## 4. Signal Categories

Valid categories include:

```text
controller_freshness
device_history
session_anomaly
geographic_anomaly
velocity_anomaly
capability_risk
intent_sensitivity
settlement_sensitivity
recovery_context
```

Categories are descriptive.

They do not imply automatic denial.

---

## 5. Controller Freshness

Controller freshness describes how recently and strongly a controller authenticated.

Inputs may include:

```text
last_successful_auth_at
last_seen_at
credential_age
device_attestation_age
recent_recovery_use
recent_scope_change
```

Example policy effect:

```text
controller freshness low
  -> require fresh WebAuthn assertion
  -> require second controller for high-risk action
```

Freshness may escalate requirements.

It must not itself revoke the controller.

---

## 6. Action Sensitivity

Action sensitivity describes the risk of the requested capability or intent.

Examples:

```text
login
identity_management
new_controller_enrollment
high_value_payment
recovery_mode_entry
governance_change
settlement_execution
```

Example policy effects:

```text
low sensitivity
  -> one active controller

medium sensitivity
  -> fresh controller assertion

high sensitivity
  -> weighted quorum
  -> hardware-backed approval
  -> cooldown window
```

Sensitivity affects requirements.

It does not create ownership.

---

## 7. Adaptive Escalation

Adaptive escalation changes what policy requires.

It does not change who owns authority.

Escalation may require:

```text
fresh assertion
additional controller
stronger controller class
weighted quorum
cooldown period
scope reduction
manual review for recovery
```

Example:

```text
high_value_payment
  + new device
  + low controller freshness
  -> require 2 of 3 controllers
  -> require one hardware-backed controller
```

Identity continuity remains intact.

Authority requirements become stronger.

---

## 8. Explainability

Risk-driven policy changes must be explainable.

Bad output:

```text
access denied
```

Good output:

```text
Action requires elevated approval because:
  controller_freshness_low
  new_device_context
  capability_risk_high
```

PolicyDecision SHOULD include:

```text
reason_codes
risk_signal_ids
required_next_steps
human_readable_explanation
```

Explainability is part of auditability.

---

## 9. No Opaque Decision Blob

Risk engine, authentication engine, and policy engine must remain separate.

Forbidden architecture:

```text
opaque risk/auth/policy service
  -> allow_or_deny
```

Required architecture:

```text
AuthenticationProof
TrustSignal
RiskSignal
PolicyEvaluation
PolicyDecision
```

Each artifact must be inspectable.

Each artifact must have a bounded responsibility.

---

## 10. Centralized Oracle Boundary

Risk evaluation must not become a centralized behavioral oracle.

Risk signals are:

```text
advisory
contextual
policy-scoped
time-bounded
explainable
```

Risk signals are not:

```text
sovereign authority
silent confiscation mechanism
hidden moderation layer
uncontestable denial
```

Systems may choose strict policies.

Strict policies must still produce explicit `PolicyDecision` artifacts.

---

## 11. Restricted Mode

Restricted mode is a policy outcome.

It is not a raw risk outcome.

Valid path:

```text
RiskSignal
  -> PolicyEvaluation
  -> PolicyDecision(restricted)
```

Restricted mode may:

```text
block high-risk capabilities
require recovery quorum
require cooldown
require hardware-backed controller
disable new controller enrollment
```

Restricted mode must not mutate settlement state by itself.

---

## 12. Required Invariants

Implementations MUST enforce:

```text
risk signal is not authority
risk signal is not denial by itself
risk signal cannot bypass policy
risk signal cannot execute settlement
risk signal cannot revoke controllers directly
policy decision remains the authority boundary
risk-driven escalation must be explainable
```

Implementations SHOULD support:

```text
controller freshness signals
device history signals
action sensitivity scores
capability risk scores
geographic anomaly signals
velocity anomaly signals
adaptive quorum escalation
cooldown triggers
restricted mode triggers
human-readable policy explanations
```

---

## 13. Non-Goals

This RFC does not define:

```text
machine learning models
fraud vendor integrations
geolocation providers
device fingerprinting standards
custodial freeze mechanisms
centralized moderation policy
```

Those systems may provide evidence.

Evidence must enter the protocol as bounded RiskSignals.

---

## 14. Summary

Simple Layer One supports adaptive authorization.

It does not collapse risk into authority.

```text
Risk evaluates context.
Policy decides requirements.
Capability scopes action.
Authorization binds approval.
Execution mutates state.
```

This preserves:

```text
explainability
contestability
auditability
least privilege
non-custodial authority
identity continuity
```

Risk is context.

Policy is the authority boundary.
