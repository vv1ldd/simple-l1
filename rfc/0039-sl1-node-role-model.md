# RFC-0039: SL1 Node Role Model

Status: Draft

This document defines the role-composed node model for distributed SL1 runtimes.

RFC-0039 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0034: Authority Lattice Model
RFC-0035: Delegation Algebra
RFC-0036: Temporal Authority Model
RFC-0038: Cross-System Composition Theorem
```

---

## 1. Constitutional Kernel

```text
Authority = f(Ledger[t], ProofEvaluator)
```

ProofEvaluator is not an authority source.

ProofEvaluator is a deterministic function over committed ledger state.

Authority does not exist in nodes, roles, or proofs.

Authority exists only as the evaluation result over `Ledger[t]`.

---

## 2. Core Axiom

```text
A node is not a role.
A node is a composition of roles in the authority lifecycle.
```

Nodes host roles.

Nodes do not contain authority.

No node is authoritative by role alone.

---

## 3. Node Model

```text
node_roles[] subset_of {
  Gateway,
  Authority,
  Ledger,
  Execution,
  Validator,
  Observer,
  Coordinator
}
```

`node_role` may be used as a single classification axis for display, filtering, or topology grouping.

`node_roles[]` is the runtime composition set.

Meaning:

```text
taxonomy is flat
nodes are multi-role actors
roles do not imply authority possession
```

---

## 4. Role Taxonomy

### Gateway

Ingress role.

May capture identity, intent, API calls, and external transport.

Must not define authority.

### Authority

Authority-evaluation role.

May participate in proof evaluation and grant verification.

Must not execute workloads by virtue of that role.

### Ledger

Causal truth storage role.

Owns the append interface for committed authority history.

Must validate append requests before mutation.

### Execution

Action runtime role.

May execute signed intents only after ledger-height-bound proof evaluation.

Must emit signed result envelopes.

### Validator

Correctness enforcement role.

May verify proof validity, ledger consistency, and execution compliance.

Must not issue authority.

### Observer

Epistemic role.

May read ledger, health, topology, and status.

Must not execute or issue authority.

### Coordinator

Optional multi-node orchestration role.

May route validated intents to execution nodes.

Must rely on authority proof and must not become an authority source.

---

## 5. Role Separation Rule

```text
Execution != Authority != Validation != Storage != Observation
```

Co-location is allowed.

Collapse is forbidden.

A physical server may host several roles, but no role may inherit powers from another role by co-location.

---

## 6. Ledger Mutation Rule

An Execution Node must not mutate ledger storage directly.

An Execution Node may submit:

```text
SignedExecutionEnvelope -> Ledger.appendAPI
```

Ledger is mutated only through:

```text
Ledger Node append interface
  + Proof validation
  + causal ordering
  + replay protection
```

Direct database writes from an execution role are invalid.

---

## 7. Execution Flow

```text
Intent
  -> Proof
  -> Execution
  -> SignedResultEnvelope
  -> Ledger Append (validated)
```

Execution is valid only if the proof is bound to the ledger state used for evaluation.

---

## 8. Two-Server Reference Topology

### Server A

```text
node_roles = [Gateway, Authority, Ledger]
```

Functions:

```text
identity ingress
authority evaluation
canonical ledger append
```

### Server B

```text
node_roles = [Execution, Validator]
```

Functions:

```text
run workloads
require proof before action
verify execution compliance
submit signed execution results
```

Server B must not:

```text
issue authority
mutate ledger storage directly
bypass proof evaluation
derive authority from runtime role
```

---

## 9. Minimal Node Registry State

```text
node_id
node_roles[]
identity_subject
capabilities
ledger_height
attestation_state
last_seen
```

Registry state is epistemic until constituted by ledger-valid authority.

Node registration must not itself create authority.

---

## 10. Minimal Form

```text
Coolify = Execution substrate
SL1 = Authority substrate
Ledger = Causal truth substrate
```

SL1 is a role-composed distributed execution system over a single causal authority ledger.
