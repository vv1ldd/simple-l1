# RFC-0000: Constitutional Summary

Status: Draft

This document summarizes the constitutional layer of Simple Layer One.

It defines the highest-level invariants that later RFCs must preserve.

---

## 1. Definition

Simple Layer One is a domain-isolated, temporally re-validated execution system that prevents semantic, authority, and state collapse across representational boundaries.

Short form:

```text
SL1 is not a system of execution.
It is a system that prevents execution from being inferred.
```

Operational form:

```text
SL1 ensures that reality is always re-validated
before it can be acted upon,
never inferred from representation.
```

---

## 2. Core Invariant

```text
Nothing becomes real without explicit,
re-validated transition through all layers.
```

Canonical transition:

```text
meaning
  -> policy
  -> authority lineage
  -> temporal re-validation
  -> execution
  -> settlement
```

Every transition is required.

No layer may be skipped by treating the previous layer as semantically equivalent to the next one.

---

## 3. Constitutional Authority Theorem

```text
No actor, key, runtime, proof, oracle, executor, model, or interface
may implicitly obtain sovereign authority.

All authority must be explicit,
bounded,
contextual,
replay-constrained,
and lineage-auditable.
```

This is the root validation filter for every RFC, runtime component, API, UX, automation, and governance process.

If a component implicitly obtains sovereign authority, the architecture has collapsed.

If a component only contributes bounded evidence, context, policy input, or lineage-preserving execution, the boundary is preserved.

### Forbidden Sovereignty

The following collapses are constitutionally forbidden:

```text
private key -> sovereign authority
passkey -> unrestricted authority
hardware key -> god key
admin role -> ambient authority
risk engine -> hidden governance
oracle -> settlement truth
proof -> future permission
prompt -> authority
executor -> authority creation
balance view -> primary economic truth
```

### Authority Requirements

Every authority artifact must be:

```text
explicit
  it is represented as an artifact, not implied by possession or context

bounded
  it has scope, resource, capability, and validity limits

contextual
  it binds audience, domain, entity, controller, policy, and time

replay-constrained
  it cannot drift across nonce, resource, domain, or settlement context

lineage-auditable
  it can be traced through policy, capability, authorization, execution, and settlement
```

### Root Primitive

The root primitive of SL1 is not:

```text
wallet
account
transaction
signature
balance
```

The root primitive is:

```text
bounded authority lineage
```

Legacy transaction-first model:

```text
valid signature
  -> valid transaction
  -> state mutation
```

SL1 bounded-authority model:

```text
identity-bound controller assertion
  -> trust and risk inputs
  -> policy evaluation
  -> bounded capability authorization
  -> current-time execution validation
  -> explicit settlement operation
  -> replayable economic lineage
```

Short form:

```text
SL1 is not transaction-first.
SL1 is bounded-authority-first.
```

---

## 4. Four Planes

### Representation

Representation describes meaning.

Examples:

```text
facts
graphs
obligations
proofs
intents
```

### Authority

Authority is relational and must have lineage.

Examples:

```text
capabilities
control grants
authorizations
authority lineage
```

### Execution

Execution is temporal and must be re-validated at time of action.

Examples:

```text
intent
transaction
proof
```

### Settlement

Settlement is the only layer that mutates economic state.

Examples:

```text
state mutation
asset transfer
balance mutation
escrow state transition
final settlement
```

---

## 5. Forbidden Collapses

### Representation Collapse

Representation cannot become reality.

Forbidden examples:

```text
Graph -> Ledger
Obligation -> Balance
Proof -> State Change
Description -> Action
```

### Authority Collapse

Trust cannot become power.

Forbidden examples:

```text
Attestation -> Permission
Trust -> Capability
ExternalProof -> Access Right
Proof -> Permission
```

### Temporal Collapse

Past validity cannot become current authority.

Forbidden examples:

```text
Past Approval -> Current Validity
Cached Authorization -> Execution Permission
Workflow Approval -> Step Validity
```

### Semantic Leakage

Cross-domain semantics cannot carry authority, state, or settlement.

Forbidden examples:

```text
Domain A proof -> Domain B authority
Domain A trust -> Domain B capability
Domain A settlement -> Domain B state
Domain A asset semantics -> Domain B economic truth
```

---

## 6. Axiomatic Kernel

```text
Nothing is executable by representation alone.
Nothing is authoritative without lineage.
Nothing is valid outside of time.
Nothing obtains sovereign authority implicitly.
```

---

## 7. Canonical Pipeline

The only valid high-level pipeline is:

```text
Representation
  -> Policy
  -> Authority
  -> Re-validation
  -> Execution
  -> Settlement
```

This rejects shortcut systems:

```text
representation -> execution
trust -> authority
graph -> state
observation -> command
proof -> permission
past validity -> current authority
domain A meaning -> domain B power
```

---

## 8. Constitutional Documents

The constitutional layer consists of:

```text
RFC-0000: Constitutional Summary
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
```

These documents define the vocabulary, invariants, and boundary philosophy of the system.

They define what SL1 is.

They are not mechanisms.

They are not negotiable by later RFCs.

They should change rarely and only through major constitutional revision.

---

## 9. Mechanism RFCs

Mechanism RFCs define how SL1 behaves.

Examples:

```text
RFC-0014: Policy Layer
RFC-0015: Trust & Attestation Lifecycle
RFC-0016: Capability & Delegation
RFC-0017: External Proof Model
RFC-0020: Execution Consistency
RFC-0021: Workflow & Compensation
RFC-0022: Economic State & Settlement Graph
RFC-0024: Semantic Isolation & Domain Integrity
```

Mechanism RFCs may extend, constrain, or compose constitutional concepts.

Mechanism RFCs must not redefine constitutional concepts.

Constitutional RFCs may be referenced by mechanisms, but never reinterpreted by them.

If a mechanism RFC requires redefining a constitutional term, it is not an update. It is a constitutional failure signal.

---

## 9. Manifesto Boundary

A manifesto may explain the philosophy of SL1.

A manifesto may describe the system in human language.

A manifesto must not define protocol constraints.

The manifesto is an interpretation layer, not a source of invariants.

Normative constraints belong in RFCs and conformance artifacts.

---

## 10. Summary

Simple Layer One is a formal prevention system against unintended transformation of representation into power or state change.

Its central guarantee is not that every action executes.

Its central guarantee is that execution cannot be inferred.
