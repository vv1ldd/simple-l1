# RFC-0026: Marketplace Reference Flow

Status: Draft

This document demonstrates end-to-end marketplace execution using existing Simple Layer One protocol primitives.

RFC-0026 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0017: External Proof Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0020: Execution Consistency & Temporal Safety
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0023: Cross-System Settlement & Interoperability Execution
RFC-0025: Runtime Architecture & Responsibility Boundaries
```

RFC-0026 introduces no new protocol primitives.

It is a reference trace for a real economic event.

---

## 1. Purpose

```text
Demonstrate end-to-end execution
using existing protocol primitives.
```

RFC-0026 answers:

```text
How does the whole system behave during a real economic event?
```

It does not define new objects, new relationships, or new authority sources.

---

## 2. Reference Scenario

```text
Buyer purchases digital product.
Payment occurs externally.
Marketplace fulfills order.
Settlement is recorded.
```

Actors:

```text
Buyer Entity
Buyer Controller
Marketplace Entity
Marketplace Controller
Payment Provider
SL1 Runtime
```

Domains:

```text
marketplace domain
payment provider domain
SL1 settlement domain
```

---

## 3. Required Trace Objects

The reference flow uses these existing objects:

```text
Intent
IntentApproval
AuthenticationProof
IdentityProof
ExternalProof
PolicyEvaluation
PolicyDecision
Capability
ControlGrant
Authorization
Transaction
SettlementOperation
SettlementRecognition
ReconciliationRecord
SettlementProof
```

Application-level names such as `PurchaseIntent`, `PaymentReceipt`, and `FulfillmentTransaction` are domain-specific uses of existing objects.

They are not new protocol primitives.

---

## 4. High-Level Flow

```text
Buyer
  -> Purchase Intent

IntentApproval
  -> WebAuthn approval

Authorization
  -> capability lineage validated

ExternalProof
  -> payment provider receipt

PolicyEvaluation
  -> payment matches intent

PolicyDecision
  -> allow fulfillment

ControlGrant
  -> marketplace.fulfill_order

Authorization
  -> fulfillment execution

Transaction
  -> order fulfilled

SettlementOperation
  -> economic mutation

SettlementProof
  -> final record
```

No step may be skipped.

---

## 5. Step Trace

### Step 1: Buyer Connects

Objects:

```text
AuthenticationProof
IdentityProof
```

Component:

```text
Connect Service
```

Meaning:

```text
Buyer Controller authenticated.
Buyer Controller is linked to Buyer Entity.
IdentityProof is audience-bound to marketplace domain.
```

Not proven:

```text
payment authority
purchase authority
fulfillment authority
asset availability
```

### Step 2: Buyer Creates Purchase Intent

Object:

```text
Intent
```

Intent content:

```text
action: marketplace.purchase
buyer_entity: sl1e_buyer
product_id
price
asset
merchant_entity
payment_provider
nonce
valid_until
```

Meaning:

```text
Buyer requested purchase.
```

Not proven:

```text
payment occurred
order should be fulfilled
settlement happened
```

### Step 3: Buyer Approves Intent

Object:

```text
IntentApproval
```

Component:

```text
Intent Approval Service
```

Meaning:

```text
Buyer Controller signed canonical Purchase Intent.
```

Not proven:

```text
buyer has payment authority
marketplace must fulfill
payment provider captured funds
```

### Step 4: Purchase Authority Is Checked

Objects:

```text
Capability
ControlGrant
Authorization
```

Component:

```text
Authority Service
```

Required lineage:

```text
Capability
  marketplace.purchase

ControlGrant
  buyer_controller -> marketplace.purchase

IntentApproval
  buyer_controller signs purchase intent

Authorization
  binds approval to grant
```

Meaning:

```text
The purchase intent may be honored if still valid at execution time.
```

### Step 5: External Payment Is Observed

Application-level event:

```text
PaymentReceipt
```

Protocol object:

```text
ExternalProof
```

Component:

```text
External Proof Adapter
```

Meaning:

```text
Payment provider claims payment was captured or settled.
```

Not proven:

```text
order should be fulfilled
SL1 state should mutate
marketplace authority exists
```

### Step 6: Payment Is Evaluated

Objects:

```text
PolicyEvaluation
PolicyDecision
```

Component:

```text
Policy Engine
```

Inputs:

```text
Purchase Intent
ExternalProof
price
asset
merchant
payment provider finality model
risk constraints
current state
```

Possible decisions:

```text
allow fulfillment
deny fulfillment
require_more_evidence
require_more_authorization
```

PolicyDecision does not authorize fulfillment by itself.

### Step 7: Fulfillment Authority Is Checked

Objects:

```text
Capability
ControlGrant
Authorization
```

Required lineage:

```text
Capability
  marketplace.fulfill_order

ControlGrant
  marketplace_controller -> marketplace.fulfill_order

Authorization
  fulfillment may proceed for this purchase
```

Meaning:

```text
Marketplace controller may execute fulfillment for this order if valid at execution time.
```

### Step 8: Execution Re-Validates

Objects:

```text
Transaction
ExecutionEnvelope
```

Component:

```text
Execution Engine
```

Required checks:

```text
purchase intent fresh
buyer IntentApproval not replayed
purchase Authorization valid at execution time
payment ExternalProof fresh enough for policy
fulfillment Authorization active
product still available
order not already fulfilled
state not conflicting
```

Execution produces a Transaction only after all checks pass.

### Step 9: Settlement Is Recorded

Objects:

```text
SettlementRecognition
SettlementOperation
ReconciliationRecord
SettlementProof
```

Component:

```text
Settlement Engine
```

Meaning:

```text
External payment was recognized.
Marketplace fulfillment was executed.
Economic state changed according to settlement rules.
Final record can be verified.
```

SettlementProof records what settled.

It does not authorize future settlement.

---

## 6. Critical Validation Gates

### Gate 1: Intent Approved?

```text
Is there a valid IntentApproval for the canonical Purchase Intent?
```

### Gate 2: Authority Lineage Valid?

```text
Does Capability -> ControlGrant -> IntentApproval -> Authorization exist?
```

### Gate 3: External Proof Verified?

```text
Is the PaymentReceipt normalized and verified as ExternalProof?
```

### Gate 4: Policy Allows?

```text
Does PolicyEvaluation produce an allow PolicyDecision for this context?
```

### Gate 5: Authority Active at Execution Time?

```text
Are grants, authorizations, and constraints active at execution time?
```

### Gate 6: Intent Not Replayed?

```text
Has this intent, approval, external proof, or idempotency key already been consumed?
```

### Gate 7: Settlement Finalized?

```text
Did SettlementOperation produce a SettlementProof under settlement rules?
```

---

## 7. Explicit Non-Bypass Rules

```text
PaymentReceipt != Fulfillment
ExternalProof != Transaction
PolicyDecision != Authorization
Authorization != Execution
Workflow != Execution
SettlementProof != Future Authority
IdentityProof != Purchase Authority
IntentApproval != Settlement
```

Every shortcut above violates at least one earlier RFC.

---

## 8. Component Responsibility Trace

```text
Connect Service
  creates AuthenticationProof and IdentityProof

Intent Approval Service
  creates IntentApproval

External Proof Adapter
  creates ExternalProof

Policy Engine
  creates PolicyEvaluation and PolicyDecision

Authority Service
  creates Authorization

Execution Engine
  creates Transaction and ExecutionEnvelope

Settlement Engine
  creates SettlementOperation, ReconciliationRecord, and SettlementProof
```

No component may write outside its RFC-0025 boundary.

---

## 9. Failure Examples

### Payment Received, Policy Denies

```text
ExternalProof exists.
PolicyDecision denies fulfillment.
No Authorization for fulfillment.
No Transaction.
No SettlementOperation.
```

### Policy Allows, Grant Revoked

```text
PolicyDecision allows.
ControlGrant revoked before execution.
Execution denied.
No Transaction.
```

### Duplicate PSP Webhook

```text
ExternalProof replay detected.
Idempotency key already consumed.
No second fulfillment.
```

### Identity Proof Only

```text
Buyer has IdentityProof.
No Purchase Intent.
No IntentApproval.
No Authorization.
No fulfillment.
```

---

## 10. Review Gate

Every reference flow, integration, or implementation must answer:

```text
Can each state mutation be traced through:
Intent
  -> IntentApproval
  -> PolicyEvaluation
  -> PolicyDecision
  -> Authorization
  -> Execution
  -> SettlementOperation
  -> SettlementProof?
```

If no, redesign.

---

## 11. Non-Goals

This document does not define:

```text
marketplace database schema
payment provider API
product catalog model
order fulfillment implementation
refund policy
agent runtime
governance process
```

Those belong to applications or later RFCs.

RFC-0026 only demonstrates how existing SL1 primitives compose in a marketplace flow.
