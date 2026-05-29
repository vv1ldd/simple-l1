# RFC-0041: SL1 Distributed Failure Model

Status: Draft

This document defines distributed failure classes for SL1 authority-bearing systems.

RFC-0041 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0006: Network Failure Model & Assumptions
RFC-0008: Network Knowledge & View Divergence Model
RFC-0036: Temporal Authority Model
RFC-0037: Attack Surface Theorem
RFC-0039: SL1 Node Role Model
RFC-0040: SL1 Delegation Transport Protocol
```

---

## 1. Constitutional Kernel

```text
Authority = f(Ledger[t], ProofEvaluator)
```

ProofEvaluator is not an authority source.

ProofEvaluator is a deterministic function over committed ledger state.

Any failure mode that creates pre-ledger authority makes the system invalid.

---

## 2. Failure Definition

An SL1 distributed failure is any condition that allows one or more nodes to treat non-committed, stale, inferred, or role-local state as authority.

Failure is not defined only as downtime.

Failure is defined as authority derivation corruption.

---

## 3. SplitBrainAuthority

`SplitBrainAuthority` occurs when two or more partitions accept incompatible authority states as current.

Invalid pattern:

```text
Partition A Ledger[t1] -> authorize A
Partition B Ledger[t2] -> authorize not-A
both treated as final authority
```

Required behavior:

```text
partitioned nodes may observe
partitioned nodes may reject
partitioned nodes must not mint independent authority
```

Resolution must occur through causal ledger reconciliation.

---

## 4. StaleLedgerRead

`StaleLedgerRead` occurs when a node evaluates proof against an older ledger state while treating the result as current.

Invalid pattern:

```text
ProofEvaluator(Ledger[t-old], Action) = true
  -> execute at t-current without re-validation
```

Required behavior:

```text
ledger height must be explicit
freshness policy must be applied
execution must bind to evaluated ledger height
```

Stale reads may support observation.

They must not silently support execution.

---

## 5. InvalidExecutionAcceptance

`InvalidExecutionAcceptance` occurs when an execution node accepts an action without ledger-height-bound proof evaluation.

Invalid sources include:

```text
session role
UI visibility
cached proof
coordinator route
runtime admin flag
transport signature alone
```

An execution node must reject any action whose proof cannot be evaluated over a committed ledger position.

---

## 6. ShadowAuthorityInjection

`ShadowAuthorityInjection` occurs when authority is introduced through an unmodeled channel.

Examples:

```text
direct database mutation
manual container command with authority effect
sidecar policy override
hidden environment variable grant
administrator console bypass
external token treated as local capability
```

Any channel that can change effective authority without ledger constitution is invalid.

---

## 7. Pre-Ledger Authority Rule

```text
Any failure mode that creates pre-Ledger authority => system invalid.
```

Pre-ledger authority includes:

```text
authority before commit
authority from role possession
authority from packet receipt
authority from proof object alone
authority from runtime locality
authority from inferred topology
```

---

## 8. Valid Degradation

During failure, a node may:

```text
stop execution
serve read-only observation
queue intents without authority claims
request fresh proof
request ledger sync
submit non-authoritative diagnostics
```

A node must not:

```text
issue emergency authority outside ledger
execute from stale validity silently
promote observation into permission
treat local administrator access as sovereign authority
```

---

## 9. Compromise Boundary

A system is compromised when authority derivation rules are violated.

This may occur even without data exfiltration.

This may occur even without infrastructure breach.

The constitutional security boundary is the integrity of authority derivation.

---

## 10. Minimal Form

```text
Distributed failure is authority derivation corruption.
Safe failure rejects execution.
Unsafe failure invents authority.
```
