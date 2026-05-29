# RFC-0035: Delegation Algebra

Status: Draft

This document defines how authority edges are constituted, composed, narrowed, and revoked in Simple Layer One.

RFC-0035 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0016: Capability & Delegation Model
RFC-0030: Intent Evaluation & Deterministic Authorization Artifacts
RFC-0034: Authority Lattice Model
```

---

## 1. Axiom

```text
Ledger is the only admissible constructor of AuthorityState.
```

No derived index, cache, projection, UI state, tag, notification, materialized view, or runtime memory may construct authority.

Authority cannot be drafted.

Authority can only be constituted.

---

## 2. Authority Space

```text
CapabilityEdge exists iff committed in Ledger.

For every E:
  E not in Ledger => E not in AuthoritySpace
```

A `CapabilityEdge` does not contain ambient authority.

It contains conditions under which authority may be derived by proof evaluation.

---

## 3. Pre-Authority Space

The following artifacts are epistemic only:

```text
EdgeIntent
EdgeProposal
DelegationRequest
DraftCapability
UnsignedCapabilityDraft
```

They may represent intention.

They must not:

```text
be evaluated by ProofEvaluator
be executable
be treated as pending authority
influence Execution
grant access
```

Pre-ledger artifacts describe possible authority construction.

They are not authority.

---

## 4. No Pre-Authority Theorem

```text
There is no observable state E such that:
  E is evaluable by ProofEvaluator
  and E is not committed in Ledger.
```

If such an `E` exists, the system contains an implicit authority channel and is constitutionally invalid.

Required form:

```text
All evaluable authority state must be ledger-constituted.
```

---

## 5. Edge Constitution Lifecycle

Authority generation follows one path:

```text
DelegationIntent
  -> ProofEvaluator(grant_authority)
  -> LedgerCommit
  -> CapabilityEdge in AuthoritySpace
```

Generation has two phases:

```text
Phase 1: Constitution Request
  DelegationIntent + ProofEvaluator(grant_authority)
  -> proposed edge state

Phase 2: Constitution
  LedgerCommit(proposed edge state)
  -> CapabilityEdge in AuthoritySpace
```

The proposed edge does not exist in any authority space.

---

## 6. Delegation Algebra

Delegation may compose only by narrowing authority.

Valid composition:

```text
Edge(A -> B, scope=X)
Edge(B -> C, scope=Y)
Y subset_of X
=> Edge(A -> B -> C, scope=Y)
```

Invalid composition:

```text
Edge(A -> B, scope=X)
Edge(B -> C, scope=Y)
Y expands X
=> invalid
```

Delegation chains must preserve:

```text
origin_subject
intermediate_subjects
current_subject
parent_edges
narrowed_scope
policy_decisions
revocation_state
```

Without delegation lineage, an edge is not audit-complete.

---

## 7. Monotonic Narrowing Rule

A child edge must not expand:

```text
action class
resource scope
domain scope
time constraints
risk tolerance
delegation depth
subject population
```

Broadening authority requires a new grant-authority proof and a new ledger commit from an authorized grantor.

---

## 8. Revocation Semantics

Revocation is a ledger transition.

It is not deletion.

```text
revoke(E) => LedgerTransition
revoke(E) != delete(E)
```

A revoked edge remains part of causal authority history.

Future evaluations must treat it as invalid once the revocation transition is included in the causally closed ledger state.

---

## 9. Revocation Propagation

Revocation propagates through dependent edges unless an RFC explicitly defines a narrower survivability rule.

Default rule:

```text
If parent edge E is revoked,
then every child edge whose authority depends on E
is invalid for future proof evaluation.
```

Propagation does not delete child edges.

It changes future validity by changing ledger state.

---

## 10. Conflict Rule

Concurrent delegation intents do not become authority until committed.

If two committed transitions conflict, the conflict is resolved by proof evaluation over the causally closed ledger state, not by UI ordering, wall-clock ordering, or request arrival ordering.

---

## 11. Forbidden Patterns

```text
pending_role_as_authority
soft_grant_as_authority
optimistic_permission_window
cached_delegation_authority
draft_capability_in_proof_evaluator
revocation_by_deletion
child_edge_expands_parent_scope
delegation_without_lineage
```

---

## 12. Minimal Form

```text
create_edge(intent) != edge
commit(create_edge(intent)) => edge
revoke_edge(edge) != delete(edge)
revoke_edge(edge) => new ledger transition invalidating future evaluation
```
