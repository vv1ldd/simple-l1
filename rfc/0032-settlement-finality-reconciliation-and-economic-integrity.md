# RFC-0032: Settlement Finality, Reconciliation & Economic Integrity

Status: Draft

This document defines durable economic truth semantics for Simple Layer One settlement.

RFC-0032 depends on:

```text
RFC-0020: Execution Consistency & Temporal Safety
RFC-0021: Workflow & Compensation Semantics
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0023: Cross-System Settlement & Interoperability Execution
RFC-0031: Execution Runtime & Settlement Safety
```

RFC-0032 does not create authority.

It defines when settlement becomes durable economic truth and how mismatches are reconciled.

---

## 1. Core Principle

```text
Settlement finality must be explicit.
Economic mutation must preserve integrity.
Reconciliation must not rewrite history.
```

Settlement is downstream of execution.

Economic truth must not be inferred from:

```text
intent
authorization
execution request
simulation
external finality claim
workflow plan
```

Only explicit settlement records mutate durable economic state.

---

## 2. Finality States

Settlement finality is a state, not a boolean assumption.

Valid states:

```text
proposed
pending_finality
recognized
final
disputed
reversed
compensated
failed
```

State transitions must be explicit.

Finality state must be visible in receipts, proofs, and reconciliation records.

---

## 3. SettlementOperation

A SettlementOperation is the durable mutation boundary.

It must include:

```text
id
execution_receipt_id
authorization_id
intent_id
settlement_domain
resource_scope
mutation_type
amounts_or_state_delta
finality_state
idempotency_key
created_at
```

SettlementOperation must preserve complete lineage.

No lineage, no settlement.

---

## 4. SettlementProof

SettlementProof records why the mutation is valid.

Shape:

```text
SettlementProof
  id
  settlement_operation_id
  execution_receipt_id
  authorization_id
  policy_decision_id
  capability_id
  finality_model
  finality_state
  state_root_before
  state_root_after
  proof_material
  issued_at
```

SettlementProof is audit evidence.

It is not future authority.

---

## 5. Economic Integrity Invariants

Implementations MUST preserve:

```text
no negative balance unless explicitly modeled as debt
no asset creation without issuance authority
no asset destruction without burn authority
no double mutation for one idempotency key
no hidden custody change
no settlement without complete lineage
no finality upgrade without finality evidence
```

Conservation rules must be domain-specific and explicit.

Examples:

```text
closed asset ledger
  debits == credits

reward issuance
  mint <= policy-defined issuance limit

escrow release
  escrow decrease == recipient increase or compensation state
```

---

## 6. Balance Invariants

Balances are derived state.

They are not primary truth.

Primary truth:

```text
SettlementOperation log
SettlementProof lineage
State root
```

Balance views must be reproducible from settlement operations.

If a balance view diverges from replayed settlement history, the history wins.

---

## 7. Finality Models

Finality model declares how durable a settlement claim is.

Examples:

```text
internal_deterministic
external_instant_finality
external_probabilistic_finality
external_chargeback_window
external_delayed_bank_settlement
manual_reconciliation
```

Weak finality must not be silently upgraded to strong finality.

Policy must decide whether a finality model is sufficient for a requested action.

---

## 8. Reconciliation

Reconciliation compares internal settlement expectations with external evidence.

Valid outcomes:

```text
matched
mismatched
pending
partially_reconciled
disputed
superseded
unresolved
```

Reconciliation must produce a record.

Shape:

```text
ReconciliationRecord
  id
  settlement_operation_id
  external_proof_id
  expected_state
  observed_state
  outcome
  unresolved_differences
  recorded_at
```

Reconciliation does not rewrite completed settlement.

It may trigger compensation or dispute workflows.

---

## 9. Dispute Windows

Some settlement domains have delayed certainty.

Examples:

```text
chargeback period
bank settlement delay
bridge challenge period
probabilistic chain finality
manual review window
```

During a dispute window, settlement may be recognized but not final.

Policy may allow limited downstream action with explicit risk.

Finality state must reflect the dispute window.

---

## 10. Irreversible Mutation Boundary

Once a SettlementOperation reaches `final`, history must not be rewritten.

Corrections require:

```text
ReversalIntent
  -> Policy
  -> Authorization
  -> Execution
  -> SettlementOperation
```

or:

```text
CompensationIntent
  -> Policy
  -> Authorization
  -> Execution
  -> SettlementOperation
```

Reversal and compensation are new forward operations.

They do not erase prior settlement.

---

## 11. Temporal Settlement Guarantees

Settlement validity is time-relative.

The runtime must record:

```text
when authority was checked
when execution occurred
when settlement was recognized
when finality was reached
when reconciliation occurred
```

Temporal ordering is part of settlement truth.

Late evidence must not silently change past finality.

It must create a new reconciliation or compensation record.

---

## 12. Cross-System Integrity

External systems may provide evidence.

They do not directly define SL1 economic truth.

Valid flow:

```text
ExternalSettlementSignal
  -> ExternalProof
  -> FinalityModel
  -> PolicyEvaluation
  -> SettlementRecognition
  -> SettlementOperation
  -> ReconciliationRecord
```

External proof replay across domains is forbidden.

Source and target settlement domains must be explicit.

---

## 13. Failure Visibility

Settlement failure must remain visible.

Failure states include:

```text
failed_execution
failed_finality
failed_reconciliation
partial_settlement
conflicting_evidence
disputed_external_state
compensation_required
```

Failure proof is not future authority.

It may justify a compensation workflow.

---

## 14. Required Invariants

Implementations MUST enforce:

```text
settlement finality is explicit
balances are derived from settlement history
settlement operation is the mutation boundary
settlement proof is evidence, not authority
reconciliation does not rewrite history
final settlement requires forward correction
external finality is evidence, not SL1 settlement
late evidence creates new records, not hidden mutation
conservation rules are explicit per settlement domain
```

Implementations SHOULD support:

```text
finality states
reconciliation records
dispute windows
state roots before and after settlement
domain-specific conservation checks
compensation workflows
cross-system finality models
economic integrity conformance tests
```

---

## 15. Non-Goals

This RFC does not define:

```text
accounting standards
tax treatment
bank ledger integrations
chain-specific finality algorithms
pricing or market models
custodial omnibus reconciliation
```

Those systems may integrate with settlement records.

They must not replace settlement truth.

---

## 16. Summary

Settlement is durable economic truth only when explicitly recorded, proven, and finalized according to its domain.

```text
ExecutionReceipt explains runtime outcome.
SettlementOperation mutates economic state.
SettlementProof preserves lineage.
FinalityModel defines certainty.
ReconciliationRecord handles mismatch.
Compensation preserves history.
```

Economic integrity requires explicit finality, replayable history, visible failures, and forward-only correction.
