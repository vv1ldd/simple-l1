# RFC-0021: Workflow & Compensation Semantics

Status: Draft

This document defines composition semantics for multi-step execution.

RFC-0021 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0020: Execution Consistency & Temporal Safety
```

RFC-0021 defines structure over already-safe execution units. It does not redefine validity.

---

## 1. Core Principle

```text
Workflow is a coordination structure,
not a semantic container.
```

Workflows compose intents.

They do not reduce, batch, or bypass execution semantics.

Workflows are not execution units.

They are execution graphs.

---

## 2. Hard Invariants

```text
Workflow != Authorization
Workflow != Capability aggregation
Workflow != execution shortcut
Workflow != permission bundle
Workflow != pre-approved execution plan
```

Workflow context must not influence execution validity.

Composition does not modify validity.

Workflow does not reduce checks.

Workflow multiplies checks.

---

## 3. Primitive Model

### Workflow

A Workflow is a graph of intents and dependencies.

It may contain:

```text
references
dependencies
ordering constraints
metadata
compensation links
partial execution state
```

It must not contain executable authority.

### WorkflowStep

A WorkflowStep is:

```text
Intent + full RFC-0020 execution lifecycle
```

Each step is independently validated at execution time.

### WorkflowProof

A WorkflowProof records observed step outcomes.

It is not future authority.

It must not authorize later steps by itself.

### PartialExecutionState

Partial execution is first-class.

Allowed states:

```text
pending
completed
failed
compensating
compensated
unresolved
```

Workflow success must not be treated as binary unless explicitly modeled that way.

---

## 4. Step Execution Rule

Each step must independently satisfy:

```text
RFC-0014 Policy
RFC-0016 Authority
RFC-0020 Temporal Execution
```

Formal form:

```text
for each step in workflow:
  validity(step) == independent_validation(step)
```

No step inherits validity from the workflow.

No step inherits authority from a previous step.

No step becomes valid because another step succeeded.

---

## 5. Compensation Semantics

Compensation is forward correction.

Compensation is not:

```text
undo
rollback
state revert
history rewrite
```

A compensation action is a new intent:

```text
CompensationIntent
  target
  reason
  corrective_action
  authority_lineage
```

Compensation must pass policy, authority, and temporal validation like any other intent.

Compensation may fail.

Compensation may require further compensation.

---

## 6. Safety Rules

```text
No workflow authority collapse.
No temporal authority carryover.
No implicit batching semantics.
No cross-step trust propagation.
No implicit compensation authority.
Failure propagation is explicit.
Partial success is first-class.
```

The following shortcuts are forbidden:

```text
previous step succeeded -> next step valid
workflow approved -> all steps valid
workflow context says trusted -> skip step policy
workflow contains proof -> step authorized
failed step -> automatic rollback
```

---

## 7. Relationship to RFC-0020

```text
RFC-0020 defines validity of a single execution.
RFC-0021 defines composition of independent executions.
```

RFC-0021 does not extend validity.

It only sequences independent validations.

Final mental model:

```text
Workflow = ordering + dependency graph
Intent = executable unit
Execution = fully re-validated event
```

---

## 8. Examples

### Purchase Workflow

```text
Step 1: authorize payment capture intent
Step 2: verify external payment proof
Step 3: authorize fulfillment intent
Step 4: execute fulfillment transaction
```

Each step is independently validated.

The payment proof does not authorize fulfillment by itself.

### Compensation

```text
Payment captured
Fulfillment failed
CompensationIntent created
Refund authority validated
Refund executed if valid
```

Refund is not automatic rollback.

Refund is a new execution path.

---

## 9. Anti-Patterns

The following patterns violate RFC-0021:

```text
workflow-as-authorization batch
step authority propagation
compensation-as-rollback engine
partial execution ignored
workflow proof authorizes future steps
workflow approval bypasses execution-time checks
```

---

## 10. Review Gate

Every proposal that introduces workflows, orchestration, sagas, compensation, or multi-step execution must answer:

```text
Does workflow context change execution validity?
```

If yes, the proposal violates RFC-0021 and RFC-0020.

---

## 11. Non-Goals

This document does not define:

```text
workflow engine implementation
economic settlement graph semantics
cross-system settlement protocol
agent planning runtime
consensus ordering rules
```

Those belong to other RFCs or implementations.
