# RFC-0031: Execution Runtime & Settlement Safety

Status: Draft

This document defines how execution consumes bounded authorization and safely produces settlement effects in Simple Layer One.

RFC-0031 depends on:

```text
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0020: Execution Consistency & Temporal Safety
RFC-0021: Workflow & Compensation Semantics
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0023: Cross-System Settlement & Interoperability Execution
RFC-0030: Intent Evaluation & Deterministic Authorization Artifacts
```

RFC-0031 does not define new authority.

It defines runtime safety requirements for consuming authority.

---

## 1. Core Principle

```text
Execution consumes Authorization.
Execution does not create authority.
Settlement mutates state only through explicit settlement operations.
```

Execution is downstream.

It must not infer permission from:

```text
signature
identity proof
risk signal
workflow membership
external proof
simulation result
```

Execution may only proceed from current valid authorization lineage.

---

## 2. Valid Execution Chain

Valid flow:

```text
Authorization
  -> ExecutionRequest
  -> ExecutionValidation
  -> ResourceLock
  -> SettlementOperation
  -> ExecutionReceipt
  -> SettlementProof
```

Forbidden shortcuts:

```text
Authorization -> direct balance mutation
IntentApproval -> SettlementOperation
ExternalProof -> SettlementOperation
Workflow -> batch mutation without per-step validation
```

---

## 3. ExecutionRequest

An ExecutionRequest asks the runtime to consume an Authorization.

Shape:

```text
ExecutionRequest
  id
  authorization_id
  intent_id
  entity_l1_address
  requested_at
  idempotency_key
  resource_scope
  settlement_domain
  payload
```

ExecutionRequest is not authority.

It is a request to evaluate current authority.

---

## 4. ExecutionValidation

ExecutionValidation records the current-time safety check.

Required checks:

```text
Authorization exists
Authorization is valid at execution time
ControlGrant is active
Capability matches Intent
Policy window is still valid
Risk requirements are still satisfied
Intent is not expired
Intent is not replayed
Resource state matches constraints
Settlement domain matches authorization
Idempotency key has not been consumed
```

ExecutionValidation must produce reason codes.

Failure must be explicit.

Failure must not silently become success.

---

## 5. Resource Locking

Resource locking prevents concurrent unsafe execution.

Locks may bind:

```text
entity_l1_address
account
asset
order_id
settlement_domain
intent_id
idempotency_key
```

Resource locks are runtime coordination objects.

They are not authority.

They must expire or be released through deterministic state transitions.

Lock acquisition order must be deterministic when multiple resources are involved.

---

## 6. Atomicity

Execution must define atomic boundaries.

Atomic unit:

```text
one authorized settlement operation
```

If an operation cannot complete atomically, it must enter a workflow state:

```text
pending
completed
failed
compensating
compensated
unresolved
```

Partial execution must be visible.

Partial execution must not be represented as full success.

---

## 7. Rollback and Compensation

Rollback is allowed only before durable settlement mutation.

After settlement mutation, correction must be modeled as compensation.

```text
before settlement operation
  -> rollback possible

after settlement operation
  -> compensation required
```

Compensation is forward correction.

It requires its own authority lineage unless explicitly pre-authorized by bounded policy.

---

## 8. Execution Sandbox

Execution runtime must sandbox action handlers.

Handlers may:

```text
read validated inputs
produce proposed settlement operation
produce receipt metadata
emit audit events
```

Handlers must not:

```text
mutate ledger state directly
create authority
change policy decisions
ignore resource locks
consume unrelated idempotency keys
```

All state mutation must pass through the settlement operation boundary.

---

## 9. ExecutionReceipt

ExecutionReceipt records the result of execution.

Shape:

```text
ExecutionReceipt
  id
  execution_request_id
  authorization_id
  settlement_operation_id
  status
  reason_codes
  resource_locks
  started_at
  completed_at
  state_root_before
  state_root_after
```

ExecutionReceipt is evidence.

It is not future authority.

It may support audit, reconciliation, or compensation workflows.

---

## 10. SettlementOperation

SettlementOperation is the only allowed economic mutation boundary.

It must include:

```text
id
authorization_id
intent_id
resource_scope
settlement_domain
mutation_type
amounts_or_state_delta
idempotency_key
created_at
```

SettlementOperation must preserve lineage back to:

```text
Intent
IntentApproval
PolicyDecision
Capability
ControlGrant
Authorization
ExecutionValidation
```

No settlement operation may exist without complete lineage.

---

## 11. Temporal Safety

Execution time is authoritative.

The runtime must re-check:

```text
current grant status
current revocation status
current policy window
current risk requirements
current resource state
current idempotency state
```

Historical approval explains why execution was requested.

It does not guarantee execution is still valid.

---

## 12. Idempotency

Every settlement-affecting execution must consume an idempotency key.

Idempotency key must bind:

```text
intent_id
authorization_id
resource_scope
settlement_domain
operation_type
```

Duplicate idempotency keys must not mutate state twice.

Idempotent replay may return the existing ExecutionReceipt.

---

## 13. Cross-System Safety

External settlement evidence must pass through the same execution safety boundary.

Valid flow:

```text
ExternalProof
  -> PolicyEvaluation
  -> Authorization
  -> ExecutionValidation
  -> SettlementRecognition
  -> SettlementOperation
```

External finality is evidence.

It is not SL1 settlement by itself.

---

## 14. Required Invariants

Implementations MUST enforce:

```text
execution consumes authorization
execution does not create authority
execution revalidates at current time
resource locks are deterministic
idempotency prevents duplicate mutation
partial execution is visible
rollback stops at durable mutation
compensation is forward correction
handlers cannot mutate ledger directly
settlement operation is the only economic mutation boundary
settlement operation requires complete lineage
```

Implementations SHOULD support:

```text
execution receipts
resource lock records
state root before and after execution
deterministic handler sandboxing
compensation workflows
cross-system settlement recognition
idempotent receipt replay
```

---

## 15. Non-Goals

This RFC does not define:

```text
consensus ordering protocol
database transaction implementation
chain-specific execution VMs
external bridge logic
wallet UI
policy language
```

Those systems may implement execution.

They must preserve this boundary.

---

## 16. Summary

Execution is a bounded runtime consumer of authorization.

It is not authority.

```text
Authorization bounds action.
Execution validates current safety.
SettlementOperation mutates state.
ExecutionReceipt records outcome.
SettlementProof preserves lineage.
```

Safe execution requires explicit authority, deterministic validation, idempotent mutation, and auditable receipts.
