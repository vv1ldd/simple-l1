# RFC-0022: Economic State & Settlement Graph Kernel

Status: Draft

This document defines economic graph semantics and settlement-state boundaries.

RFC-0022 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0020: Execution Consistency & Temporal Safety
RFC-0021: Workflow & Compensation Semantics
```

RFC-0022 is an anti-collapse model for economic meaning systems.

---

## 1. Core Principle

```text
Economic graphs describe meaning, not state.
Graph structure does not imply economic state mutation.
Only settlement operations mutate economic state.
```

Top-level rule:

```text
No economic meaning is inferred from graph topology.
```

Economic graphs are non-authoritative representations of intent.

Only settlement operations mutate economic state.

---

## 2. Universal Economic Invariant

```text
Representation does not imply transfer.
Structure does not imply state.
Meaning does not imply execution.
```

This preserves:

```text
Graph != Ledger
Obligation != Balance
SettlementPlan != Settlement
Workflow != Execution
Proof != Authority
Fact != Permission
```

---

## 3. Economic Layers

### Economic Intent Layer

This layer describes what should happen economically.

Primitives:

```text
EconomicIntent
Obligation
ReversalIntent
```

Obligation is not enforceable state.

Obligation is a fact about intended settlement behavior.

### Economic Graph Layer

This layer describes how economic meaning is structured.

Primitives:

```text
SettlementLeg
NettingSet
EscrowRelation
Dependency
CompensationLeg
SettlementPlan
```

Graph structure does not move value.

### Settlement Layer

This is the only mutating economic layer.

Primitives:

```text
SettlementOperation
BalanceMutation
AssetTransfer
EscrowStateTransition
CustodyChange
FinalSettlement
SettlementProof
```

Settlement requires policy, authority, temporal validity, and finality checks.

---

## 4. Primitive Semantics

### EconomicIntent

An EconomicIntent describes desired economic effect.

It is not settlement.

### Obligation

An Obligation describes expected or promised economic behavior.

It is not a balance.

It is not asset ownership.

It is not enforceable state unless an explicit settlement authority and operation make it so.

### SettlementLeg

A SettlementLeg describes one proposed or executed leg of settlement.

Proposed legs are graph structure.

Executed legs require settlement operation records.

### EscrowState

Escrow is a state machine, not a custody claim, unless explicitly activated through settlement authority.

Forbidden shortcut:

```text
escrow node -> custody
```

### NettingSet

A NettingSet describes proposed clearing relationships.

It is not final settlement.

### SettlementProof

A SettlementProof records what settled.

It does not authorize future settlement.

Proof is descriptive, never prescriptive.

---

## 5. Execution Rule

Every settlement operation must pass:

```text
Policy
Authority
Temporal Execution
Settlement finality check
```

Valid settlement flow:

```text
EconomicIntent
  -> EconomicGraph
  -> PolicyEvaluation
  -> Authority Lineage
  -> Execution Validation
  -> SettlementOperation
  -> SettlementProof
```

Invalid flow:

```text
EconomicGraph
  -> BalanceMutation
```

---

## 6. Settlement Finality

Settlement finality must be explicit.

Finality may depend on:

```text
internal state transition
external finality proof
asset transfer confirmation
escrow state transition
policy-defined settlement threshold
```

Finality claims are not final settlement by themselves.

They are inputs to settlement recognition.

---

## 7. Failure Modes

RFC-0022 exists to prevent:

```text
edge becomes transfer
node becomes custody
plan becomes settlement
obligation becomes balance
proof becomes future authority
escrow reference becomes custody
netting mismatch
partial settlement hidden as success
stale quote accepted
conflicting proof accepted
revocation mid-settlement ignored
double fulfillment
escrow release race
```

Partial settlement is first-class.

Failed settlement legs must remain visible.

---

## 8. Reversal and Compensation

Reversal does not rewrite history.

A reversal is a new economic intent and settlement path.

```text
ReversalIntent
  -> Policy
  -> Authority
  -> Execution
  -> SettlementOperation
```

Compensation legs are forward corrections.

They do not erase prior settlement.

---

## 9. Relationship to the RFC Stack

Economic semantics must preserve the existing vertical:

```text
RFC-0014 Policy
  can economic action happen?

RFC-0016 Authority
  who can execute settlement?

RFC-0020 Execution
  when is settlement valid?

RFC-0021 Composition
  how are economic actions structured?

RFC-0022 Economics
  what economic meaning exists?
```

RFC-0022 does not create money semantics.

It describes them safely.

---

## 10. Review Gate

Every proposal that introduces economic graphs, obligations, escrow, clearing, netting, reversals, or settlement must answer:

```text
Does graph structure mutate economic state or imply settlement?
```

If yes, the proposal violates RFC-0022.

---

## 11. Non-Goals

This document does not define:

```text
asset issuance mechanics
cross-ledger bridge protocol
payment rail integration
market pricing
matching engine semantics
accounting standard
tax treatment
```

Those belong to later RFCs, adapters, or applications.
