# RFC-0023: Cross-System Settlement & Interoperability Execution

Status: Draft

This document defines how Simple Layer One coordinates settlement across external systems without treating external messages, bridges, or finality claims as direct state mutation.

RFC-0023 depends on:

```text
RFC-0013: Interoperability Principle
RFC-0017: External Proof Model
RFC-0020: Execution Consistency & Temporal Safety
RFC-0021: Workflow & Compensation Semantics
RFC-0022: Economic State & Settlement Graph Kernel
```

RFC-0023 is the cross-system settlement boundary. It coordinates external settlement without collapsing external finality into SL1 state.

---

## 1. Core Principle

```text
External settlement is evidence for reconciliation.
It is not SL1 settlement by itself.
```

Cross-system settlement must pass through:

```text
ExternalProof
  -> PolicyEvaluation
  -> Authority Lineage
  -> Execution-Time Re-validation
  -> Settlement Recognition
  -> Reconciliation
```

Bridge messages, external receipts, and finality claims do not mutate SL1 state directly.

---

## 2. Settlement Boundary

The following shortcuts are forbidden:

```text
bridge message -> account mutation
external finality -> SL1 settlement
external receipt -> release goods
external balance -> SL1 balance
external transfer -> internal custody change
```

Correct form:

```text
external settlement signal
  -> ExternalProof
  -> target-domain policy
  -> settlement authority lineage
  -> execution-time validation
  -> explicit settlement recognition
```

---

## 3. Cross-System Objects

### ExternalSettlementSignal

An ExternalSettlementSignal is an observed claim that settlement happened outside SL1.

Examples:

```text
bank transfer completed
card payment captured
chain transaction finalized
bridge message emitted
custodian transfer confirmed
payment processor webhook delivered
```

An ExternalSettlementSignal is not trusted until verified.

### FinalityModel

A FinalityModel describes how an external system treats settlement as stable.

Examples:

```text
instant finality
probabilistic finality
delayed bank settlement
chargeback window
custodian confirmation
bridge challenge period
manual reconciliation
```

Finality models are policy inputs.

They are not universal truth.

### SettlementRecognition

SettlementRecognition is the SL1-side decision to recognize external settlement for a specific domain purpose.

Shape:

```text
SettlementRecognition
  id
  external_proof
  finality_model
  target_domain
  policy_evaluation
  authority_lineage
  recognized_at
  scope
```

Recognition is not automatic state mutation unless paired with an explicit settlement operation.

### ReconciliationRecord

A ReconciliationRecord records how SL1 reconciled internal state or economic meaning with external settlement evidence.

Shape:

```text
ReconciliationRecord
  id
  settlement_recognition
  internal_reference
  external_reference
  result
  unresolved_differences
  proof
```

Reconciliation may succeed, fail, remain partial, or become disputed.

---

## 4. Finality Mismatch

Different systems have different finality semantics.

RFC-0023 requires finality mismatch to be explicit.

Examples:

```text
SL1 execution is deterministic, but external chain finality is probabilistic.
Payment processor capture exists, but chargeback remains possible.
Bank settlement is delayed, but marketplace fulfillment is immediate.
Bridge message exists, but challenge period is still open.
Custodian receipt exists, but internal ledger has not reconciled.
```

Policy must decide whether a finality claim is sufficient for the requested settlement recognition.

Weak finality must not be silently treated as strong finality.

---

## 5. Bridge Safety

A bridge is an evidence transport layer, not a state authority.

Bridge output must be treated as:

```text
ExternalProof
```

not:

```text
Transaction
Authorization
SettlementOperation
AccountMutation
```

Bridge safety requires:

```text
source domain identification
target domain identification
proof verification
finality model declaration
replay protection
equivocation handling
policy evaluation
authority lineage
```

---

## 6. Reconciliation Semantics

Reconciliation compares internal expectations with external settlement evidence.

It may produce:

```text
recognized
rejected
pending
partially_reconciled
disputed
superseded
```

Reconciliation does not rewrite external history.

Reconciliation does not guarantee future settlement.

Reconciliation records what SL1 recognized, rejected, or left unresolved.

---

## 7. Failure Modes

RFC-0023 exists to prevent:

```text
bridge-as-state
finality-as-truth
receipt-as-permission
external event-as-command
probabilistic finality treated as deterministic
proof replay across systems
proof equivocation ignored
source network confusion
target domain confusion
adapter privilege escalation
chargeback window ignored
delayed settlement treated as final
```

All failures must remain visible as reconciliation state.

---

## 8. Examples

### Payment Processor Capture

Incorrect:

```text
payment captured webhook -> fulfill order
```

Correct:

```text
payment captured webhook
  -> ExternalProof
  -> finality model: capture with chargeback risk
  -> marketplace policy evaluation
  -> fulfillment authority lineage
  -> execution-time validation
  -> fulfillment settlement recognition
```

### Bridge Message

Incorrect:

```text
bridge message -> account balance mutation
```

Correct:

```text
bridge message
  -> ExternalProof
  -> source and target domain verification
  -> finality model check
  -> policy evaluation
  -> settlement recognition
  -> explicit internal settlement operation if valid
```

### Probabilistic Chain Finality

Incorrect:

```text
transaction observed -> final settlement
```

Correct:

```text
transaction observed
  -> confirmations measured
  -> finality threshold evaluated by policy
  -> settlement recognition if sufficient
```

---

## 9. Relationship to RFC-0024

RFC-0023 coordinates settlement across systems.

RFC-0024 enforces semantic isolation across domains.

RFC-0023 must preserve:

```text
source-domain settlement != target-domain state
source-domain proof != target-domain authority
bridge message != semantic transfer
```

Cross-system settlement is always subject to domain isolation.

---

## 10. Review Gate

Every proposal that introduces bridges, payment processors, external ledgers, custodians, cross-chain messages, or cross-system settlement must answer:

```text
Does any external settlement signal mutate SL1 state or trigger settlement recognition without policy, authority lineage, and execution-time re-validation?
```

If yes, the proposal violates RFC-0023.

---

## 11. Non-Goals

This document does not define:

```text
specific bridge protocol
light client construction
payment processor adapter
custodian integration
chain finality algorithm
legal settlement finality
```

Those belong to adapters or later RFCs.

RFC-0023 defines the boundary those mechanisms must preserve.
