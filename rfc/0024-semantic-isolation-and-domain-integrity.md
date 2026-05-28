# RFC-0024: Semantic Isolation & Domain Integrity

Status: Draft

This document defines domain boundary enforcement for Simple Layer One.

RFC-0024 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0017: External Proof Model
RFC-0020: Execution Consistency & Temporal Safety
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0023: Cross-System Settlement & Interoperability Execution
```

RFC-0024 prevents semantic objects from carrying authority, state, settlement, or trust across domain boundaries without explicit re-validation.

---

## 1. Core Principle

```text
No semantic object may carry authority across domains
without explicit re-validation through policy
and authority lineage.
```

Domain boundaries are semantic boundaries.

Cross-domain meaning is admissible as representation.

Cross-domain authority is never inferred.

---

## 2. System Definition

RFC-0024 enforces the constitutional definition:

```text
SL1 is a domain-isolated, temporally re-validated
execution system that prevents semantic, authority,
and state collapse across representational boundaries.
```

It protects the canonical pipeline:

```text
Representation
  -> Policy
  -> Authority
  -> Re-validation
  -> Execution
  -> Settlement
```

No domain may skip this pipeline by importing meaning from another domain.

---

## 3. Forbidden Cross-Domain Collapses

The following shortcuts are forbidden:

```text
Domain A proof != Domain B authority
Domain A trust != Domain B capability
Domain A settlement != Domain B state
Domain A asset semantics != Domain B economic truth
Domain A workflow != Domain B execution validity
Domain A approval != Domain B authorization
```

Cross-domain data may become evidence.

It must not become power.

---

## 4. Domain Objects

### Domain

A Domain is a semantic boundary in which meanings, policies, assets, proofs, or settlement assumptions are interpreted.

Examples:

```text
SL1 core
marketplace application
external payment processor
external chain
banking rail
enterprise identity system
government registry
agent runtime
```

### DomainFact

A DomainFact is a fact observed or asserted within one domain.

It may enter another domain only as evidence.

### DomainPolicy

A DomainPolicy defines how a receiving domain evaluates incoming facts, proofs, claims, and settlement signals.

### DomainAuthority

DomainAuthority is authority valid only inside its issuing domain unless re-derived through receiving-domain authority lineage.

### BoundaryProof

A BoundaryProof records how a fact crossed a domain boundary.

Shape:

```text
BoundaryProof
  source_domain
  target_domain
  object
  verification_path
  policy_evaluation
  authority_lineage
  observed_at
```

BoundaryProof is descriptive.

It is not authority by itself.

---

## 5. Re-Validation Rule

Every cross-domain import must be re-validated by the receiving domain.

Required steps:

```text
identify source domain
identify target domain
normalize representation
verify proof or claim
evaluate target-domain policy
derive target-domain authority if needed
re-validate at execution time
settle only through target-domain settlement rules
```

The receiving domain owns the decision about whether imported meaning is usable.

The source domain does not command the target domain.

---

## 6. Semantic Leakage

Semantic leakage occurs when meaning from one domain becomes authority, state, or settlement in another domain without explicit re-validation.

Examples:

```text
payment processor receipt -> marketplace fulfillment
external chain balance -> SL1 account balance
government credential -> application admin right
agent confidence score -> execution permission
workflow status -> settlement finality
```

Correct form:

```text
external meaning
  -> evidence
  -> target-domain policy
  -> target-domain authority lineage
  -> execution-time validation
  -> target-domain settlement if applicable
```

---

## 7. Domain Integrity Invariants

```text
Meaning is domain-scoped.
Authority is domain-scoped.
Settlement is domain-scoped.
Validity is time-scoped.
Imported representation is non-authoritative by default.
```

Domain transfer must be explicit.

Domain transfer must be auditable.

Domain transfer must not preserve authority unless the target domain re-creates authority through its own lineage.

---

## 8. Examples

### Bank Payment to Marketplace Fulfillment

Incorrect:

```text
bank payment captured -> order fulfilled
```

Correct:

```text
bank payment captured
  -> ExternalProof
  -> marketplace policy evaluation
  -> fulfillment authority lineage
  -> execution-time validation
  -> fulfillment transaction
```

### External Chain Asset

Incorrect:

```text
external balance -> SL1 balance
```

Correct:

```text
external balance proof
  -> target-domain evidence
  -> policy evaluation
  -> settlement recognition authority
  -> explicit settlement operation
```

### Government Credential

Incorrect:

```text
government credential -> admin capability
```

Correct:

```text
government credential
  -> attestation fact
  -> policy evaluation
  -> capability creation or grant recognition
  -> authorization for concrete intent
```

---

## 9. Review Gate

Every proposal that crosses domains must answer:

```text
Does meaning, proof, trust, settlement, or authority from one domain become authority or state in another domain without target-domain re-validation?
```

If yes, the proposal violates RFC-0024.

---

## 10. Non-Goals

This document does not define:

```text
specific bridge protocol
domain registry governance
cross-chain finality algorithm
payment rail implementation
identity federation format
```

Those belong to later RFCs or adapters.

RFC-0024 defines the boundary rule that those mechanisms must preserve.
