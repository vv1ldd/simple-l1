# RFC-0034: Authority Lattice Model

Status: Draft

This document defines the constitutional execution kernel for authority-bearing runtime surfaces.

RFC-0034 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0016: Capability & Delegation Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0020: Execution Consistency & Temporal Safety
RFC-0024: Semantic Isolation & Domain Integrity
RFC-0030: Intent Evaluation & Deterministic Authorization Artifacts
RFC-0033: Notification Transport Boundary
```

---

## 1. Global Kernel

```text
Authority = f(Ledger[t])
t = causal position in the ledger transition order
```

Authority is not produced by a UI surface, role label, token possession, notification, tag, session, cache, or runtime memory.

Authority is produced only by evaluating ledger-constituted authority state through the protocol proof evaluator at execution time.

---

## 2. Axiom

```text
UI, Authority Surface Registry, notifications, tags, and runtime state
are epistemic artifacts only.

Authority is exclusively defined by:
  Ledger + CapabilityEdge + ProofEvaluator at execution time.

No other system component may define authority.
```

This axiom is the root boundary for product surfaces that project operational state.

---

## 3. Authority Lattice

The authority lattice is the ledger-valid graph of subjects, capability edges, scopes, constraints, and causal transitions.

```text
Subject -- CapabilityEdge --> ActionScope
```

A `CapabilityEdge` is not a permission record.

A `CapabilityEdge` is a delegation relation whose authority can become effective only under fresh deterministic proof evaluation.

---

## 4. ProofEvaluator

The proof evaluator is a pure deterministic function over authoritative state.

```text
ProofEvaluator:
  (subject, capability_edge, ledger_state, action_scope) -> boolean
```

It must be:

```text
deterministic
side-effect free
independent of UI state
independent of Authority Surface Registry state
independent of notifications and tags
independent of execution history cache
```

Proof is not data.

A cached proof object must never be treated as current authority.

---

## 5. Single Authority Gate

There exists exactly one authority evaluation path:

```text
Execution(A) => ProofEvaluator(E, S, AS, LedgerState[t])
```

Any alternative path is a constitutional kernel violation.

Forbidden alternatives include:

```text
middleware-cached authority
helper-service authority
session authority
UI-rendered-button authority
tag-inferred authority
notification-inferred authority
Authority Surface Registry authority
```

---

## 6. Execution Contract

To execute action `A`:

```text
1. Resolve subject S from request context.
2. Resolve capability_edge E from Ledger.
3. Construct action_scope AS from request intent.
   UI may influence this step only.
4. Freeze AS.
   No further modification is allowed.
5. Evaluate:
   valid(E, S, AS, t) = ProofEvaluator(E, S, AS, LedgerState[t])
6. If false:
   reject with no side effects.
7. If true:
   execute action and commit causally to Ledger.
```

Execution must not accept precomputed validity.

Execution must re-evaluate authority at call time.

---

## 7. UI Contract

```text
UI = non-authoritative compiler of intent
```

UI may:

```text
suggest action_scope
format intent
display capability graph
display surface state
```

UI must not:

```text
assert validity
infer authority
pre-filter capabilities as proof
participate in ProofEvaluator
```

UI is an epistemic projection, not an authority source.

---

## 8. Surface States

Runtime surfaces must be classified by execution eligibility, not by menu visibility.

```text
SurfaceState =
  ActiveAuthorityBound
  SovereignPending
  ForbiddenLegacyBridge
  EpistemicOnly
  AnnotationOnly
  ShadowEvaluated
```

### ActiveAuthorityBound

The surface participates in the execution graph only through ledger-valid capability edges.

### SovereignPending

The surface exists and may be observable, but is non-participating in the execution graph.

### ForbiddenLegacyBridge

The surface implies authority from a legacy source and must be demolished or isolated.

### EpistemicOnly

The surface may disclose or organize knowledge, but cannot mutate authority.

### AnnotationOnly

The surface may attach metadata, but metadata cannot become a policy predicate without explicit promotion to authority scope.

### ShadowEvaluated

The capability exists in the lattice and may be valid, but is intentionally not projected into UI.

Shadow-evaluated surfaces must not be discoverable through:

```text
UI enumeration
tag inference
notification inference
error-message inference
```

They may appear only by explicit capability reference or ledger-authorized query.

---

## 9. Authority Surface Registry

An Authority Surface Registry may group and display surface states.

It is not configuration authority.

```text
ASR must not:
  store state independently of Ledger
  influence ProofEvaluator
  cache authority decisions

ASR may only:
  reflect Ledger state
  group surfaces for observation
```

If ASR becomes an authority source, the lattice has collapsed.

---

## 10. Forbidden States

```text
stored_permission_as_authority
cached_proof_object
trusted_session_authority
ui_rendered_button_as_authority
implicit_authority_from_observation
notification_as_execution_trigger
tag_as_policy_predicate_without_promotion
execution_without_ledger_commit
ledger_entry_without_causal_authority_lineage
```

---

## 11. Compliance Rule

```text
No surface may participate in the execution graph
unless it is bound to a ledger-valid capability edge
evaluated at execution time.
```

Short form:

```text
surface != authority source
authority = explicit, verifiable, ledger-bound construct
```
