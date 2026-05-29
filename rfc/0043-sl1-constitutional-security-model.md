# RFC-0043: SL1 Constitutional Security Model

Status: Draft

This document defines compromise and security in SL1 as authority graph integrity, not merely infrastructure breach.

RFC-0043 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0034: Authority Lattice Model
RFC-0037: Attack Surface Theorem
RFC-0039: SL1 Node Role Model
RFC-0041: SL1 Distributed Failure Model
RFC-0042: SL1 Proof Envelope Semantics
```

---

## 1. Constitutional Kernel

```text
Authority = f(Ledger[t], ProofEvaluator)
```

ProofEvaluator is not an authority source.

ProofEvaluator is a deterministic function over committed ledger state.

The security boundary is the integrity of authority derivation.

---

## 2. Compromise Definition

An SL1 system is compromised when authority derivation rules are violated.

Compromise is not limited to:

```text
host intrusion
secret leakage
database access
container escape
network interception
```

Those events may be serious.

They are constitutional compromise only when they corrupt authority derivation, execution validity, or ledger truth.

---

## 3. Authority Graph Corruption

Authority graph corruption occurs when effective authority differs from the authority derivable from committed ledger state.

Invalid condition:

```text
effective_authority != ProofEvaluator(Ledger[t], Action)
```

Examples:

```text
capability edge added without ledger commit
revoked authority accepted as current
runtime role treated as permission
direct ledger storage mutation
proof envelope accepted without ledger binding
```

---

## 4. Breach vs Constitutional Compromise

A breach is operational access outside intended boundaries.

A constitutional compromise is a violation of authority derivation rules.

Examples:

```text
read-only log disclosure
  may be breach
  not necessarily authority compromise

manual database write to capability edge
  breach
  authority graph corruption
  constitutional compromise

execution from stale proof
  authority derivation violation
  constitutional compromise
```

---

## 5. Security Invariants

```text
No node is authoritative by role alone.
No proof is authoritative before ledger binding.
No packet is authoritative before LedgerCommit.
No execution is valid without ledger-height-bound proof evaluation.
```

Any implementation path that violates these invariants is insecure, even if it is authenticated, encrypted, or administrator-only.

---

## 6. Attack Classes

### Authority Injection

Uncommitted state becomes effective authority.

### Proof Substitution

Proof material is reused across subject, scope, domain, nonce, or ledger height.

### Role Escalation

A node role is treated as authority possession.

### Ledger Bypass

Execution or authority state changes without `Ledger.appendAPI`.

### Projection Capture

UI, notification, tag, dashboard, or registry state influences proof evaluation.

### Stale Validity

Past proof evaluation is accepted as current authority.

---

## 7. Recovery Requirement

Recovery must restore authority derivation integrity.

Valid recovery requires:

```text
identify corrupted authority derivation path
stop execution from corrupted path
restore or reconcile ledger causal state
invalidate affected proofs and nonces
re-evaluate affected capabilities
commit recovery transition to ledger
```

Operational rollback is insufficient if authority graph corruption remains.

---

## 8. Audit Requirement

Every constitutional compromise investigation must answer:

```text
Which authority derivation rule was violated?
Which ledger state was treated as authoritative?
Which proof evaluation was skipped, stale, or corrupted?
Which executions depended on invalid authority?
Which recovery transition restored causal truth?
```

---

## 9. Forbidden Security Claims

The following claims are invalid as sufficient security arguments:

```text
admin-only path
signed request
private network
trusted service
known node
valid session
encrypted transport
human approval
```

Each may be useful evidence.

None is authority.

---

## 10. Minimal Form

```text
Security = preservation of authority derivation rules.
Compromise = authority graph corruption.
Recovery = causal restoration of ledger-valid authority.
```
