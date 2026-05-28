# RFC-0014: Policy Layer v0.2

Status: Draft

This document defines the Policy Layer for Simple Layer One.

RFC-0014 depends on RFC-0012 and RFC-0013. It may use, extend, constrain, and compose ontology concepts. It must not redefine them.

Policy answers:

```text
How are decisions derived?
```

Policy does not redefine trust, authority, ownership, identity, accounts, controllers, intents, transactions, or proofs.

---

## 1. Core Principle

```text
Policy evaluates.
Authority authorizes.
Actions execute.
```

Policy is an evaluation layer. It is not an authority store.

Authority remains represented by explicit Authority Layer objects:

```text
Capability
ControlGrant
Authorization
```

---

## 2. Inherited Axioms

RFC-0014 inherits the following axioms from RFC-0012:

```text
Properties do not imply authority.
Authority does not imply ownership.
Ownership does not imply control.
Relationships are first-class objects.
Objects define state.
Relationships define meaning.
Wallet is not primitive.
```

RFC-0014 also preserves the interoperability principle from RFC-0013:

```text
SL1 is not an island.
```

Policy may evaluate facts that originate inside or outside Simple Layer One. External origin does not create authority.

---

## 3. Policy Layer Invariants

```text
Trust does not imply authority.
PolicyDecision does not create authority.
Authority must be explicit.
Authority is never inferred.
Authority is always granted.
Facts do not imply authority.
```

Operational form:

```text
No lineage = no authority.
```

---

## 4. Policy Decision Semantics

```text
PolicyDecision != Permission
PolicyDecision != Authority
PolicyDecision = Evaluation Result
```

A policy decision may influence authority creation or authority recognition.

A policy decision does not itself constitute authority.

Example:

```text
PolicyDecision
  decision: allow
  requested_capability: seller.refund
  subject: sl1e_seller
  rationale:
    - verified_merchant
    - risk_score_below_threshold
  constraints:
    max_amount: 5000
    valid_until: 2027-01-01
```

This means:

```text
Authority objects may be created or honored.
```

It does not mean:

```text
Refund is authorized.
```

Authorization still requires explicit authority lineage.

---

## 5. Authority Creation Rule

Authority must have explicit authority lineage.

Every permission must be traceable through:

```text
Capability
  -> ControlGrant
  -> Authorization
```

Authority exists only within this lineage.

Authority must never originate directly from:

```text
Attestation
Credential
Proof
ExternalProof
RiskSignal
PolicyDecision
```

Review question:

```text
For any permission in the system:
Where did this authority come from?
```

If the answer cannot show authority lineage, the permission is invalid.

---

## 6. Policy Flow

Valid flow:

```text
Facts
  Attestation
  Credential
  Proof
  ExternalProof
  RiskSignal
    ↓
PolicyEvaluation
    ↓
PolicyDecision
    ↓
Authority Lineage
  Capability
    ↓
  ControlGrant
    ↓
  Authorization
    ↓
Intent
    ↓
Transaction
    ↓
Proof
```

Prohibited flow:

```text
Facts
  ↓
Authority
```

Facts may influence policy.

Policy may influence authority creation.

Authority may influence actions.

Authority must never emerge directly from facts.

---

## 7. Layer Responsibilities

```text
Facts
  What is known?

Policy
  What should be allowed?

Authority
  Who may do it?

Action
  What actually happened?

Proof
  What can be verified?
```

---

## 8. Policy Objects

### Policy

A Policy defines evaluation logic over facts, ontology relationships, and requested actions.

Policy may consider:

```text
Entity
Controller
Account
Intent
Attestation
Credential
OwnershipClaim
ControlGrant
Proof
ExternalProof
RiskSignal
```

Policy must not mutate protocol state directly.

### PolicyEvaluation

A PolicyEvaluation is an execution of a policy against inputs.

Shape:

```text
PolicyEvaluation
  policy_id
  subject
  controller
  intent
  facts
  evaluated_at
  input_hash
```

### PolicyDecision

A PolicyDecision is the result of policy evaluation.

Shape:

```text
PolicyDecision
  decision
  requested_capability
  subject
  controller
  constraints
  rationale
  evaluation_id
```

Allowed decision values:

```text
allow
deny
require_more_authorization
require_more_evidence
```

### PolicyConstraint

A PolicyConstraint limits capability creation, grant usage, or authorization validity.

Examples:

```text
max_amount
time_window
resource_scope
required_quorum
required_attestation
jurisdiction
risk_threshold
```

### RiskSignal

A RiskSignal is an input fact. It is not authority.

Examples:

```text
velocity_risk
new_device
external_chain_finality_low
merchant_dispute_rate
agent_confidence_low
```

### ExternalProof

An ExternalProof is a fact about an external system. It is not authority.

Examples:

```text
bank_receipt
bitcoin_transaction
ethereum_receipt
government_credential
external_signature
```

---

## 9. Examples

### Merchant Refund Capability

Correct:

```text
Attestation
  verified_merchant

PolicyEvaluation
  evaluates verified_merchant and risk signals

PolicyDecision
  decision: allow
  requested_capability: seller.refund

Capability
  seller.refund

ControlGrant
  controller -> seller.refund

Authorization
  controller approves refund intent
```

Incorrect:

```text
verified_merchant => may_refund
```

### External Bank Receipt

Correct:

```text
ExternalProof
  bank_receipt

PolicyEvaluation
  evaluates bank_receipt

PolicyDecision
  decision: allow
  requested_capability: issue.receipt
```

Incorrect:

```text
bank_receipt => may_issue_asset
```

### Agent Purchasing

Correct:

```text
Attestation
  trusted_agent

PolicyEvaluation
  evaluates trusted_agent, scope, budget, and risk

PolicyDecision
  decision: allow
  requested_capability: purchase.hosting

Capability
  purchase.hosting

ControlGrant
  sl1c_ai_procurement -> purchase.hosting

Authorization
  agent controller approves concrete purchase intent
```

Incorrect:

```text
trusted_agent => may_spend
```

---

## 10. Review Gate

Every RFC that introduces permissions, delegation, agents, trust, governance, external proofs, or automation must answer:

```text
Does authority appear without authority lineage?
```

If yes, the proposal violates RFC-0014.

This gate applies to:

```text
Trust and Attestation
Capability and Delegation
External Proofs
Agent Authorization
Governance
Settlement
Application Integrations
```

---

## 11. Non-Goals

This document does not define:

```text
policy language
policy VM
risk scoring algorithm
governance voting system
agent runtime
external proof adapter
capability issuance mechanics
```

Those belong to later RFCs.

This document only defines the boundary between facts, policy, authority, action, and proof.
