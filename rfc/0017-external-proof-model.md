# RFC-0017: External Proof Model

Status: Draft

This document defines how external reality enters Simple Layer One as verifiable evidence.

RFC-0017 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
RFC-0014: Policy Layer v0.2
RFC-0015: Trust & Attestation Lifecycle
RFC-0016: Capability & Delegation Model
```

RFC-0017 is the world boundary layer. It observes external reality without allowing it to command SL1.

---

## 1. Core Principle

```text
ExternalProof verifies facts.
ExternalProof does not create authority.
ExternalProof does not mutate state.
ExternalProof does not bypass policy.
```

External reality is observed, not obeyed.

ExternalProof is evidence, not authority.

ExternalProof is evidence, not state transition.

---

## 2. Valid Pipeline

External facts may enter policy only through verification:

```text
External reality
  -> ExternalProof
  -> Fact
  -> PolicyEvaluation
  -> PolicyDecision
  -> Authority Lineage
  -> Action
```

Forbidden shortcuts:

```text
ExternalProof -> Capability
ExternalProof -> ControlGrant
ExternalProof -> Authorization
ExternalProof -> Transaction
ExternalProof -> Account Mutation
ExternalProof -> Settlement
```

---

## 3. External Proof Objects

### ExternalReference

An ExternalReference identifies an external object, event, or state claim.

Examples:

```text
bitcoin transaction id
ethereum receipt hash
bank payment reference
government registry record
document signature id
marketplace fulfillment id
```

### ExternalEvent

An ExternalEvent describes what an external system claims happened.

Examples:

```text
payment captured
transaction finalized
credential issued
registry entry active
document signed
order fulfilled
```

An ExternalEvent is not trusted until verified.

### VerificationPath

A VerificationPath records how an external event was verified.

Shape:

```text
VerificationPath
  source_system
  proof_type
  verifier
  verification_material
  assumptions
  verified_at
```

### FinalityClaim

A FinalityClaim describes the confidence or finality model of an external event.

Examples:

```text
bank settlement confirmed
chain confirmations >= 12
registry response signed
issuer credential valid
webhook authenticated
```

Finality is an input to policy. It is not settlement inside SL1.

### ExternalProof

An ExternalProof binds an external reference, event, verification path, and finality claim into a policy input.

Shape:

```text
ExternalProof
  id
  external_reference
  external_event
  verification_path
  finality_claim
  subject
  observed_at
  verified_at
  expires_at
```

---

## 4. Lifecycle

An ExternalProof may move through:

```text
Observed
  -> Normalized
  -> Verified
  -> Finalized
  -> Expired
  -> Superseded
  -> Disputed
```

### Observed

An external signal is received.

Observation does not imply validity.

### Normalized

The external signal is converted into SL1-compatible evidence shape.

Normalization does not imply truth.

### Verified

The verification path is checked.

Verification produces a fact for policy.

Verification does not produce authority.

### Finalized

The proof satisfies a policy-relevant finality threshold.

Finality does not mutate SL1 state by itself.

### Expired, Superseded, Disputed

External proofs may become unusable as active policy inputs due to time, stronger evidence, or conflict.

Historical proof records may remain verifiable.

---

## 5. Verification Model

Verification must specify:

```text
source system
proof format
verification path
issuer or verifier identity
finality assumptions
risk assumptions
validity window
revocation or dispute status
```

The verifier may be internal or external.

The verifier's authority to verify must itself be acceptable to policy.

---

## 6. Interface to Policy

ExternalProof enters the system as facts:

```text
ExternalProof
  -> Fact
  -> PolicyEvaluation
```

Policy may consider:

```text
proof type
source system
verification path
finality claim
issuer or verifier reputation
freshness
dispute status
risk assumptions
```

Policy may reject a valid external proof if it is insufficient for the requested action.

---

## 7. Examples

### Bank Receipt

Correct:

```text
ExternalProof
  bank payment captured

PolicyEvaluation
  evaluates receipt freshness and finality

PolicyDecision
  decision: allow
  requested_capability: fulfill.order

Authorization
  controller approves fulfillment intent
```

Incorrect:

```text
bank_receipt => fulfill_order
```

### External Chain Transaction

Correct:

```text
ExternalProof
  ethereum receipt finalized

PolicyEvaluation
  evaluates chain finality and event data

PolicyDecision
  may allow settlement recognition
```

Incorrect:

```text
ethereum_receipt => account_balance_mutation
```

---

## 8. Anti-Patterns

The following patterns violate RFC-0017:

```text
webhook -> state change
oracle result -> capability
bank receipt -> settlement without policy
external transaction -> SL1 transaction
government credential -> access right
document signature -> authorization
```

All external evidence must pass through policy and authority lineage before any action.

---

## 9. Review Gate

Every RFC or implementation that consumes external evidence must answer:

```text
Does an external proof create authority or mutate state directly?
```

If yes, the proposal violates RFC-0017.

Valid proposals preserve:

```text
ExternalProof
  -> Fact
  -> Policy
  -> Authority
  -> Action
```

---

## 10. Non-Goals

This document does not define:

```text
bridge protocol
light client verification
oracle network design
bank API integration
credential format
settlement finality semantics
economic state mutation
```

Those belong to later RFCs or adapters.
