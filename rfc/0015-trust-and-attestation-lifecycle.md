# RFC-0015: Trust & Attestation Lifecycle

Status: Draft

This document defines how trust facts enter, live in, compose within, and leave Simple Layer One.

RFC-0015 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
RFC-0014: Policy Layer v0.2
```

RFC-0015 does not redefine Attestation, Credential, Proof, Capability, ControlGrant, Authorization, Entity, Controller, or Account.

---

## 1. Core Principle

Trust facts may inform policy.

Trust facts must not create authority.

```text
Trust -> Policy
Trust -> Authority  ❌
```

Operational form:

```text
Attestation != Capability
Credential != ControlGrant
Proof != Authorization
Trust != Authority
```

RFC-0015 is a trust ingestion model, not a permission model.

---

## 2. Relationship to Policy Layer

RFC-0014 defines:

```text
Facts -> Policy -> Authority -> Action
```

RFC-0015 defines facts for the first step:

```text
Trust Facts -> Policy
```

It must never define:

```text
Trust Facts -> Authority
```

Example:

```text
Attestation
  verified_merchant

PolicyEvaluation
  evaluates verified_merchant

PolicyDecision
  may allow authority creation

Capability
ControlGrant
Authorization
```

Invalid shortcut:

```text
verified_merchant => may_refund
```

---

## 3. Trust Objects

### Attestation

An Attestation is a claim about a subject.

It answers:

```text
What is trusted?
```

Examples:

```text
verified_merchant
legal_entity_verified
trusted_buyer
kyc_passed
merchant_since_2027
```

Attestations are facts. They are not rights.

### Credential

A Credential transports proof of an attestation.

It answers:

```text
How is trust proven?
```

Credentials may be issued by:

```text
SL1 issuer
marketplace
government authority
corporate registry
enterprise CA
KYC provider
external network
```

Credentials do not mutate state by themselves.

Credentials do not grant authority.

### TrustSignal

A TrustSignal is a policy input derived from observation or risk analysis.

Examples:

```text
seller_dispute_rate
buyer_history_score
device_change
velocity_anomaly
credential_age
issuer_reputation
```

Trust signals are not attestations unless explicitly issued as attestations.

Trust signals are not authority.

### Proof

A Proof may verify an attestation, credential, or trust event.

Proofs verify. They do not create rights.

---

## 4. Attestation Lifecycle

An attestation may move through the following lifecycle:

```text
Issued
  -> Verified
  -> Updated
  -> Revoked
  -> Expired
```

### Issued

An issuer creates a claim about a subject.

Shape:

```text
Attestation
  id
  issuer
  subject
  type
  claims
  issued_at
  expires_at
  source_credential
```

### Verified

A verifier checks the attestation's credential, issuer, validity window, revocation status, and proof material.

Verification does not make the attestation authority.

### Updated

An issuer may update a claim by issuing a new attestation version.

Updates should preserve lineage:

```text
supersedes: previous_attestation_id
```

### Revoked

An issuer or authorized revocation mechanism may revoke an attestation.

Revocation must be explicit and auditable.

Shape:

```text
Revocation
  attestation_id
  revoked_by
  revoked_at
  reason
  proof
```

### Expired

An attestation expires when its validity window ends.

Expired attestations may remain historically true, but they should not be used as active policy inputs unless a policy explicitly allows historical claims.

---

## 5. Credential Lifecycle

A credential may move through:

```text
Issued
  -> Presented
  -> Verified
  -> Revoked
  -> Expired
```

Credential verification may produce:

```text
verified credential fact
issuer identity
subject binding
claim set
validity window
revocation status
verification proof
```

It must not produce:

```text
Capability
ControlGrant
Authorization
```

---

## 6. Composition Rules

Trust facts may compose.

Examples:

```text
verified_merchant
  + low_dispute_rate
  + active_legal_entity
  -> policy input for seller.refund

kyc_passed
  + jurisdiction_allowed
  + credential_not_expired
  -> policy input for regulated action
```

Composition creates policy inputs.

Composition does not create authority.

Invalid composition:

```text
verified_merchant + low_risk => ControlGrant
```

Correct composition:

```text
verified_merchant + low_risk
  -> PolicyEvaluation
  -> PolicyDecision
  -> Capability / ControlGrant / Authorization lineage
```

---

## 7. Trust Boundaries

Trust origin may be internal or external.

Internal examples:

```text
SL1 issuer
SL1 governance process
marketplace service
agent runtime
```

External examples:

```text
government registry
corporate registry
bank receipt issuer
KYC provider
external chain
enterprise CA
```

External origin does not make a claim weaker or stronger by default.

Policy decides whether an issuer, proof format, or verification path is acceptable.

---

## 8. Anti-Patterns

The following patterns violate RFC-0015:

```text
Attestation -> Capability
Credential -> ControlGrant
Proof -> Authorization
TrustSignal -> Permission
verified_merchant -> may_refund
kyc_passed -> may_transfer
bank_receipt -> may_issue_asset
trusted_agent -> may_spend
```

All authority must still pass through RFC-0014 authority lineage.

---

## 9. Interface to Future RFCs

RFC-0015 intentionally does not define:

```text
external proof adapters
bridge finality
credential format
zero-knowledge proof format
issuer registry
trust scoring algorithm
policy language
agent trust model
```

Expected future RFCs:

```text
RFC-0016 Capability & Delegation Model
RFC-0017 External Proof Model
RFC-0018 SL1 Connect & Identity Proof
```

RFC-0017 may define how external facts are verified.

RFC-0018 may define how authenticated controllers produce identity proofs for external applications.

Neither may bypass the rule:

```text
Trust does not create authority.
```

---

## 10. Review Gate

Any RFC that introduces trust, credentials, proofs, reputation, risk, issuer registries, or verification paths must answer:

```text
Does any trust fact create authority directly?
```

If yes, the proposal violates RFC-0015 and RFC-0014.

Valid proposals preserve:

```text
Trust
  -> Policy
  -> Authority
  -> Action
```

Invalid proposals introduce:

```text
Trust
  -> Authority
```
