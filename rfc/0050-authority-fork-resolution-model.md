# RFC-0050: Authority Fork Resolution Model

Status: Draft

This document defines constitutional handling of divergent authority histories.

RFC-0050 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0003: Canonical Serialization & Replay Protection
RFC-0008: Network Knowledge and View Divergence Model
RFC-0015: Trust and Attestation Lifecycle
RFC-0034: Authority Lattice Model
RFC-0035: Delegation Algebra
RFC-0036: Temporal Authority Model
RFC-0037: Attack Surface Theorem
RFC-0041: SL1 Distributed Failure Model
RFC-0043: SL1 Constitutional Security Model
RFC-0048: Federated Identity Event Replication
RFC-0049: Constitutional Recovery Model
```

---

## 1. Constitutional Kernel

```text
Fork resolution does not create authority.
Fork resolution determines admissible authority continuity.
```

Peer sync moves evidence.

RFC-0050 defines whether evidence may participate in authority continuity.

The subject of this RFC is not distributed database merge.

The subject is constitutional admissibility of authority continuity under divergence.

---

## 2. Core Problem

In a federated authority graph, peers may observe different signed histories.

Two histories may be:

```text
internally valid
cryptographically signed
causally ordered
locally admissible
```

and still be constitutionally incompatible.

Therefore:

```text
mergeability != consistency
```

Consistency of syntax, signatures, and local order is insufficient for authority continuity.

---

## 3. Fork Definition

An authority fork exists when two or more histories for the same authority subject cannot all be accepted without changing effective authority.

Authority subject may be:

```text
entity
controller
capability
delegation edge
binding
recovery artifact
execution authorization
```

Minimal fork form:

```text
HistoryA(subject, scope) -> authority_state_a
HistoryB(subject, scope) -> authority_state_b

authority_state_a incompatible with authority_state_b
```

---

## 4. Invalid Authority Topologies

The following topologies are invalid unless explicitly resolved by a recovery or fork-resolution transition:

```text
active controller in one branch, revoked controller in another
same nonce consumed by different transitions
same delegation edge assigned incompatible scopes
same binding attested to incompatible subjects
recovery delegation consumed by conflicting delegates
capability expanded from causally incomplete history
execution authorized from stale proof after revocation
```

Invalid topology detection must precede authority expansion.

---

## 5. Mergeability Rules

Histories are mergeable only when their union preserves authority derivation.

Required conditions:

```text
all causal parents known or explicitly non-authoritative
no replay key conflict
no incompatible revocation relation
no duplicated nonce with different semantic effect
no conflicting binding subject
no capability scope expansion from uncertain branch
no recovery artifact consumed twice
```

If these conditions fail, the histories may be stored as evidence but must not be merged into executable authority state.

---

## 6. Revocation Dominance

Revocation is safety-dominant within its causal scope.

If a controller is revoked in one admissible branch and used in another branch, the affected authority scope must freeze unless one of the following is true:

```text
the proof usage is causally before the revocation
the revocation is proven inadmissible
the fork is resolved by a valid recovery transition
the local constitution defines a narrower unaffected scope
```

Default rule:

```text
uncertain revocation relation -> freeze affected authority expansion
```

This prevents stale or partitioned controller use from silently expanding authority.

---

## 7. Causal Closure

Causal closure is the property that all authority-relevant predecessors of a transition are known and admissible.

For a transition `T`:

```text
causally_closed(T) =
  all required parents known
  all parent hashes verified
  all replay domains checked
  all revocation predecessors evaluated
  all binding predecessors evaluated
  no unresolved fork affects T.scope
```

Execution or authority expansion must not depend on a transition that is not causally closed.

---

## 8. Freeze Rule

If causal closure cannot be established, authority expansion must freeze.

Frozen scope:

```text
new delegation
new controller addition
new binding attestation
new recovery delegation
new capability expansion
new execution authorization depending on disputed authority
```

Allowed during freeze:

```text
read-only projection
event ingestion
peer evidence collection
local non-authority diagnostics
revocation or recovery transition if independently admissible
```

Freeze is scoped.

It must not halt unrelated authority scopes unless their causal closure depends on the unresolved fork.

---

## 9. Stale Peer Rejoin

A stale peer may rejoin only by submitting evidence.

Rejoin does not grant authority to the peer.

Required behavior:

```text
accept peer events as candidate evidence
verify signatures and hashes
identify missing parents
detect conflicts with local graph
mark stale branch as admissible, forked, or rejected
apply freeze rules to affected scopes
```

Stale peer count is not consensus.

Peer age is not authority.

Transport availability is not authority.

---

## 10. Attestation Boundary

Attestation is evidence.

Attestation is not permission.

Peer count is not consensus.

Sync is not recovery.

Valid anti-collapse rules:

```text
peer count != consensus
attestation != permission
sync != recovery
transport != authority
```

An attestation may increase confidence that an event was observed.

It does not bypass ProofEvaluator.

---

## 11. Resolution Outcomes

A fork evaluation may return:

```text
mergeable
  histories can be unioned without changing authority derivation

conflicting
  histories cannot both participate in authority continuity

incomplete
  missing causal parents prevent closure

frozen
  affected authority scope is blocked pending recovery or resolution

rejected
  one or more histories violate admissibility rules
```

Only `mergeable` histories may update executable authority projection.

---

## 12. Recovery Interaction

Recovery may resolve a fork only if the recovery transition itself is causally closed or independently admissible under the local constitution.

Invalid recovery:

```text
use disputed controller to resolve its own dispute
use stale binding to repair itself
use peer majority to bypass revocation
erase branch history
rewrite event hash chain
```

Valid recovery must preserve:

```text
fork evidence
revocation evidence
causal parents
audit lineage
scope limits
```

---

## 13. Non-Goals

RFC-0050 does not define:

```text
gossip protocol
peer discovery
database replication
token economics
mining
global total order
universal consensus
network transport format
```

Those are runtime or transport concerns.

RFC-0050 defines authority admissibility under divergence.

---

## 14. Minimal Form

```text
peer sync:
  moves evidence

fork resolution:
  determines admissible authority continuity

mergeability:
  not consistency

if causal closure cannot be established:
  authority expansion MUST freeze
```
