# RFC-0042: SL1 Proof Envelope Semantics

Status: Draft

This document defines the semantics of proof envelopes used by SL1 authority evaluation.

RFC-0042 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0002: Intent & WebAuthn Schema
RFC-0003: Canonical Serialization & Replay Protection
RFC-0017: External Proof Model
RFC-0034: Authority Lattice Model
RFC-0040: SL1 Delegation Transport Protocol
```

---

## 1. Constitutional Kernel

```text
Authority = f(Ledger[t], ProofEvaluator)
```

ProofEvaluator is not an authority source.

ProofEvaluator is a deterministic function over committed ledger state.

A proof envelope is evidence.

A proof envelope is not authority.

---

## 2. Proof Principle

```text
ProofEvaluator:
  pure deterministic function
  over Ledger[t]
  returns boolean only
```

The evaluator does not create authority objects.

It returns whether a specific action is valid under committed ledger state.

---

## 3. Canonical Proof Envelope

Minimal structure:

```text
proof_envelope_id
proof_type
subject
intent_id
action_scope
capability_reference
ledger_height_binding
proof_material
nonce
issued_at
expires_at
signature
```

The envelope must be canonically serialized.

Any field that changes evaluation semantics must be included in the signed payload.

---

## 4. Ledger Binding

Every proof envelope must bind to a ledger height or causal ledger position.

Required invariant:

```text
No proof is authoritative before ledger binding.
```

Unbound proof material must be rejected for execution.

It may be stored or displayed only as epistemic evidence.

---

## 5. Composition Rules

Proof composition is allowed only when the composition itself is deterministic and ledger-bound.

Valid composition:

```text
ProofA + ProofB + Ledger[t] -> ProofEvaluator -> boolean
```

Invalid composition:

```text
ProofA + ProofB -> authority
```

Composed proofs must preserve:

```text
subject binding
scope binding
ledger height binding
nonce domain
expiration semantics
capability lineage
```

---

## 6. Partial Proofs

A partial proof may satisfy one predicate.

It must not be treated as full authorization.

Example:

```text
identity proof
  != capability proof
  != execution authorization
```

Partial proofs may feed evaluation.

They must not bypass evaluation.

---

## 7. Invalid Proof Collapse

If any required proof component is invalid, missing, stale, replayed, or out of scope, the composed proof collapses to false.

Required behavior:

```text
invalid_component -> ProofEvaluator returns false
```

There is no degraded proof state that grants reduced authority unless that reduced authority is explicitly constituted in ledger state and evaluated as a separate action scope.

---

## 8. Replay Resistance

Replay resistance must bind:

```text
proof_envelope_id
subject
intent_id
action_scope
ledger_height_binding
nonce
expiration
audience
```

Replay detection must occur before execution and before ledger append.

---

## 9. External Proofs

External proofs are epistemic until locally evaluated.

External proof material may be included in proof envelopes.

It must not become local authority without local ledger constitution.

---

## 10. Forbidden Patterns

```text
proof_object_as_permission
identity_proof_as_capability
signature_as_authority
partial_proof_as_authorization
stale_proof_as_current_validity
proof_without_ledger_binding
proof_composition_without_scope_binding
```

---

## 11. Minimal Form

```text
Proofs are evidence.
Evaluation is deterministic.
Authority emerges only from evaluation over Ledger[t].
```
