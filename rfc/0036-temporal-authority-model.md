# RFC-0036: Temporal Authority Model

Status: Draft

This document defines authority time as causal order induced by ledger transitions.

RFC-0036 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0005: Ledger Persistence & Crash Recovery
RFC-0020: Execution Consistency & Temporal Safety
RFC-0034: Authority Lattice Model
RFC-0035: Delegation Algebra
```

---

## 1. Axiom

```text
ledger_time = partial_order(Ledger transitions)
```

Wall-clock time may annotate transitions.

Wall-clock time must not define authority validity.

---

## 2. Core Shift

```text
Authority validity is not evaluated in time.
Authority validity defines authority time.
```

The system does not ask:

```text
Was this valid at external timestamp T?
```

It asks:

```text
Is this valid relative to a causally closed ledger state?
```

---

## 3. Ledger State

`LedgerState[t]` is the causally closed authority state at causal position `t`.

It includes every transition that causally precedes `t`.

It excludes every transition not visible in that causal view.

```text
valid(E, AS, t) = relation(E, AS, LedgerState[t])
```

Validity is a relation over causal ledger state, not a predicate over external time.

---

## 4. Causal Authority Time Theorem

```text
A capability is valid only relative to a causally closed ledger state.
```

If the evaluation state is not causally closed, the proof evaluator must reject or defer.

It must not infer missing authority from:

```text
wall-clock freshness
network observation
UI state
notification delivery
cache recency
```

---

## 5. Annotation Rule

Transitions may include wall-clock fields:

```text
created_at
observed_at
expires_at
not_before
received_at
```

These fields are annotations and constraints inside ledger transitions.

They do not become authority time by themselves.

When a wall-clock constraint is required, it must be evaluated as a ledger-contained constraint over a causally visible edge.

---

## 6. Expiry

Expiry is a constraint on future proof evaluation.

It is not revocation.

```text
expiry(E) => E becomes invalid after its ledger-visible constraint boundary
revocation(E) => ledger transition invalidates E and dependent future evaluation
```

Expiry may be encoded in the edge.

Revocation must be encoded as a ledger transition.

---

## 7. Revocation Causality

A revocation affects evaluations whose ledger state causally includes the revocation transition.

```text
If revoke(E) in LedgerState[t],
then valid(E, AS, t) = false
unless a later valid transition explicitly reconstitutes authority.
```

Revocation propagation follows RFC-0035.

Propagation delay is not authority continuation.

It is view divergence.

---

## 8. Concurrent Commits

Concurrent commits may create incomparable ledger positions.

Incomparable authority states must not be merged by wall-clock order.

They must be reconciled by deterministic ledger ordering, fork-choice, or explicit merge semantics defined by the relevant runtime RFC.

Until reconciliation, proof evaluation must occur against the declared causal view.

---

## 9. Race Between Evaluation and Commit

Execution must evaluate authority against the latest causally available ledger state immediately before action.

If the ledger state changes before commit, the runtime must either:

```text
re-evaluate against the new causally available state
or reject without side effects
```

Execution must not rely on a stale positive evaluation.

---

## 10. Forbidden Patterns

```text
wall_clock_as_authority_time
cached_validity_window
revocation_delay_as_permission
notification_delivery_as_time_boundary
UI_refresh_as_authority_freshness
commit_order_by_request_arrival
proof_evaluation_against_non_causal_view
```

---

## 11. Minimal Form

```text
Authority = ledger-constituted causal state
Time = induced order of authority transitions
Validity = relation over LedgerState[t]
```
