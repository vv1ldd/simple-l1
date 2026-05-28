# RFC-0016: Capability & Delegation Model

Status: Draft

This document defines the authority construction layer for Simple Layer One.

RFC-0016 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
RFC-0014: Policy Layer v0.2
RFC-0015: Trust & Attestation Lifecycle
```

RFC-0016 constructs authority structures. It does not decide what is true, and it does not decide policy outcomes.

---

## 1. Core Principle

```text
Authority is not a property.
Authority is a graph.
```

Authority is constructed only from authority primitives:

```text
Capability
  -> ControlGrant
  -> Authorization
```

No authority may be created without policy evaluation.

No authority may be created from trust alone.

---

## 2. Layer Role

The preceding RFCs produce inputs:

```text
RFC-0015 Trust
  produces facts

RFC-0014 Policy
  produces decisions

RFC-0016 Delegation
  produces authority structures
```

Delegation consumes `PolicyDecision`.

Delegation does not consume trust directly.

Valid flow:

```text
Trust Fact
  -> PolicyEvaluation
  -> PolicyDecision
  -> Capability
  -> ControlGrant
  -> Authorization
```

Forbidden shortcuts:

```text
verified_merchant -> ControlGrant
trusted_agent -> ControlGrant
kyc_passed -> Authorization
ExternalProof -> Capability
```

---

## 3. Authority Primitives

### Capability

A Capability describes what may be done.

It answers:

```text
What action may exist?
```

Shape:

```text
Capability
  id
  action
  resource_scope
  constraints
  issued_from_policy_decision
  valid_from
  valid_until
```

A Capability is a right definition. It is not a grant to any controller by itself.

### ControlGrant

A ControlGrant binds a controller to a capability for an entity or account scope.

It answers:

```text
Who may use this capability?
```

Shape:

```text
ControlGrant
  id
  entity
  controller
  capability
  constraints
  source_policy_decision
  valid_from
  valid_until
  revoked_at
```

A ControlGrant is active only while its constraints, validity window, and revocation state allow it.

### DelegationChain

A DelegationChain records how authority moved from one authorized subject to another.

Shape:

```text
DelegationChain
  root_capability
  grants
  constraints
  depth
  source_policy_decisions
```

Delegation may only narrow authority.

Delegation must not expand authority beyond the parent grant.

### Authorization

An Authorization binds one IntentApproval to active authority lineage.

It answers:

```text
Was this approved intent authorized by valid authority?
```

Shape:

```text
Authorization
  id
  intent
  intent_approval
  controller
  control_grant
  capability
  authorized_at
  valid_until
  constraints
```

Authorization proves that a controller approval was accepted through authority lineage.

Authorization does not guarantee future execution.

Authorization is not the raw WebAuthn signature.

The signature belongs to `IntentApproval`.

---

## 4. Modal Semantics

RFC-0016 preserves the authority ladder:

```text
Capability = MAY
ControlGrant = CAN
IntentApproval = DID SIGN
Authorization = WAS AUTHORIZED
```

This separates:

```text
what may exist
who may use it
what was signed
what was authorized
```

Authority is valid only when the whole lineage is valid.

---

## 5. Authority Construction Rule

Every authority object must have explicit lineage.

Valid authority lineage:

```text
PolicyDecision
  -> Capability
  -> ControlGrant
  -> IntentApproval
  -> Authorization
```

Invalid authority lineage:

```text
Attestation
  -> Capability

Credential
  -> ControlGrant

ExternalProof
  -> Authorization

Signature
  -> Authorization

PolicyDecision
  -> permission boolean
```

PolicyDecision may allow authority creation.

PolicyDecision is not authority.

---

## 6. Delegation Safety

Delegation must preserve the following invariants:

```text
Delegated authority cannot exceed parent authority.
Delegated authority cannot outlive parent authority.
Delegated authority cannot bypass policy constraints.
Delegated authority cannot survive revocation of required lineage.
Delegated authority cannot become trust.
```

If a parent grant is revoked, dependent grants become unusable unless a separate valid authority lineage exists.

---

## 7. Revocation

Authority may be revoked at capability, grant, or authorization scope.

Shape:

```text
Revocation
  target
  revoked_by
  revoked_at
  reason
  source_authority
  proof
```

Revocation affects future execution validity.

Revocation does not rewrite historical approvals or completed transactions.

---

## 8. Examples

### Merchant Refund

Correct:

```text
Attestation
  verified_merchant

PolicyEvaluation
  evaluates verified_merchant and refund risk

PolicyDecision
  decision: allow
  requested_capability: seller.refund

Capability
  seller.refund

ControlGrant
  sl1c_operator -> seller.refund

IntentApproval
  sl1c_operator signs refund intent

Authorization
  signed intent binds to seller.refund grant
```

Incorrect:

```text
verified_merchant => may_refund
```

### Agent Purchasing

Correct:

```text
PolicyDecision
  decision: allow
  requested_capability: purchase.hosting

Capability
  purchase.hosting

ControlGrant
  sl1c_ai_procurement -> purchase.hosting

IntentApproval
  agent controller signs purchase intent

Authorization
  signed intent binds to purchase.hosting grant
```

Incorrect:

```text
trusted_agent => may_spend
```

---

## 9. Review Gate

Every proposal that creates, delegates, revokes, or recognizes authority must answer:

```text
Can every permission be traced through Capability -> ControlGrant -> IntentApproval -> Authorization lineage?
```

If no, the proposal violates RFC-0016 and RFC-0014.

---

## 10. Non-Goals

This document does not define:

```text
policy language
risk scoring
trust verification
external proof verification
execution timing rules
workflow composition
settlement semantics
```

Those belong to other RFCs.
