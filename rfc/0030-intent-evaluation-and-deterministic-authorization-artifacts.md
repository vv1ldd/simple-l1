# RFC-0030: Intent Evaluation & Deterministic Authorization Artifacts

Status: Draft

This document defines how human-readable intents become bounded authorization artifacts in Simple Layer One.

RFC-0030 depends on:

```text
RFC-0002: Intent & WebAuthn Serialization Schema
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0020: Execution Consistency & Temporal Safety
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0029: Risk Evaluation & Adaptive Policy
```

RFC-0030 does not define wallet UI.

It defines the boundary between intent understanding and executable authority.

---

## 1. Core Principle

```text
Intent describes requested meaning.
Authorization bounds executable authority.
Execution consumes authorization.
```

Intent is not execution.

IntentApproval is not settlement.

Authorization is not a transaction.

Forbidden collapse:

```text
human prompt -> signature -> settlement mutation
```

Valid chain:

```text
Intent
  -> IntentEvaluation
  -> IntentApproval
  -> PolicyDecision
  -> Capability
  -> Authorization
  -> Execution
  -> SettlementOperation
```

---

## 2. Intent

An Intent describes what the user or application requests.

It answers:

```text
What does the user intend to do?
```

Shape:

```text
Intent
  id
  entity_l1_address
  audience
  intent_type
  capability
  scope
  payload
  nonce
  valid_until
  human_summary
  risk_context
```

Intent must be:

```text
canonical
audience-bound
nonce-bound
time-bound
resource-bound
human-explainable
```

Intent does not by itself grant permission.

---

## 3. IntentEvaluation

IntentEvaluation maps requested meaning to protocol constraints.

It answers:

```text
What exactly would this approval authorize?
```

Shape:

```text
IntentEvaluation
  id
  intent_id
  capability_required
  resource_scope
  constraints
  simulation_result
  risk_signal_ids
  human_readable_effect
  reason_codes
  evaluated_at
```

IntentEvaluation must not create authority.

It is explanatory and constraining.

It may feed `PolicyEvaluation`.

---

## 4. Human-Readable Semantics

Every approval request SHOULD include a human-readable summary.

Bad prompt:

```text
Sign message 0x8f31...
```

Good prompt:

```text
Approve payment of 1,250 SL to merchant meanly.market for order #1042.
This approval expires in 5 minutes.
```

Human-readable text is not the authority object.

The canonical Intent is the object that must be approved.

The prompt must faithfully describe the canonical Intent.

---

## 5. Intent Simulation

IntentSimulation describes expected effects before approval.

It may include:

```text
asset changes
capability consumed
counterparty
fees
expiration
settlement constraints
reversal or compensation path
```

Simulation is not execution.

Simulation must not mutate state.

Simulation output must be bound to the IntentEvaluation if presented to the user.

---

## 6. Bounded Approval

Approval must be bounded.

Required bounds:

```text
audience
entity_l1_address
controller_l1_address
capability
scope
intent_id
nonce
valid_until
resource
```

Approval must not be open-ended.

Forbidden approval:

```text
approve all future payments
approve any action for this wallet
approve unrestricted settlement
```

If broad authority is required, it must be represented as an explicit scoped capability with policy constraints and expiration.

---

## 7. Deterministic Authorization Artifact

Authorization must be deterministic over its immutable inputs.

Inputs:

```text
Intent
IntentApproval
PolicyDecision
Capability
ControlGrant
RiskSignal references
Temporal validity
```

Authorization artifact shape:

```text
Authorization
  id
  intent_id
  intent_approval_id
  policy_decision_id
  capability_id
  control_grant_id
  entity_l1_address
  controller_l1_address
  audience
  scope
  constraints
  valid_from
  valid_until
  replay_domain
  can_execute
  reason_codes
```

Authorization must explain why execution is allowed or denied.

---

## 8. Replay Domains

Replay protection must be domain-separated.

Replay keys must bind:

```text
intent_id
nonce
audience
entity_l1_address
controller_l1_address
capability
scope
resource
valid_until
chain_or_settlement_domain
```

An approval for one audience must not replay in another.

An approval for one resource must not replay against another.

An approval for one settlement domain must not replay into another.

---

## 9. Execution Boundary

Execution consumes Authorization.

It must re-check:

```text
Authorization is valid at execution time
ControlGrant is still active
Capability still matches Intent
Policy window is still valid
Risk requirements are still satisfied
Intent is not expired
Intent is not replayed
Resource state still matches constraints
```

Execution must not rely only on historical approval.

Execution time is authoritative.

---

## 10. Settlement Constraints

Intent evaluation may produce settlement constraints.

Examples:

```text
maximum_amount
asset
counterparty
merchant_id
order_id
expiry
allowed_settlement_domain
compensation_path
```

Settlement constraints must be carried into Authorization.

Execution must reject settlement outside those constraints.

---

## 11. Approval Explainability

Approval UX and audit logs must expose:

```text
requested action
capability required
scope
risk escalation reason
expiration
resource constraints
expected settlement effect
```

Opaque approval is forbidden for high-risk actions.

Bad:

```text
Approve transaction
```

Good:

```text
Approve order settlement.
Merchant: Meanly
Amount: 1,250 SL
Capability: marketplace.order.settle
Expires: 5 minutes
Requires: fresh passkey + standard controller
```

---

## 12. Required Invariants

Implementations MUST enforce:

```text
Intent is not execution
IntentApproval is not settlement
Authorization is not a transaction
human-readable prompt is not authority
simulation is not execution
authorization is bounded
authorization is replay-domain separated
execution revalidates current authority
settlement follows explicit constraints
```

Implementations SHOULD support:

```text
human-readable intent summaries
deterministic intent evaluation
intent simulation
risk-aware approval explanation
bounded authorization artifacts
replay-domain construction
settlement constraint propagation
approval audit trails
```

---

## 13. Non-Goals

This RFC does not define:

```text
application-specific UI
chain-specific transaction encoding
wallet plugin APIs
custodial approval flows
opaque signing prompts
```

Applications may render intent differently.

They must not change the canonical Intent being approved.

---

## 14. Summary

Intent evaluation is the bridge between human meaning and bounded authority.

It must not collapse into execution.

```text
Intent explains request.
IntentEvaluation constrains meaning.
IntentApproval proves controller approval.
PolicyDecision decides authority requirements.
Authorization bounds execution.
Execution consumes authorization.
Settlement mutates state.
```

This keeps approval human-readable, replay-safe, auditable, and non-custodial.
