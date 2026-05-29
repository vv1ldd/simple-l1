# RFC-0038: Cross-System Composition Theorem

Status: Draft

This document defines the boundary for composing multiple ledgers or authority spaces without creating implicit authority.

RFC-0038 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0013: Interoperability Principle
RFC-0017: External Proof Model
RFC-0023: Cross-System Settlement & Interoperability Execution
RFC-0024: Semantic Isolation & Domain Integrity
RFC-0034: Authority Lattice Model
RFC-0035: Delegation Algebra
RFC-0036: Temporal Authority Model
RFC-0037: Attack Surface Theorem
```

---

## 1. Theorem

```text
No external system may become authority by being connected.
```

Interoperability may provide evidence, settlement context, discovery, execution substrate, or external proof.

It must not bypass the local authority lattice.

---

## 2. Composition Boundary

Each authority space has its own:

```text
ledger
capability edges
proof evaluator
causal order
revocation semantics
projection surfaces
```

Cross-system composition must translate or attest authority.

It must not merge authority spaces by assumption.

---

## 3. External Authority Input

External authority input is epistemic until constituted locally.

Examples:

```text
external role
external token
external signature
external attestation
external policy decision
external ledger proof
```

These may feed local proof evaluation.

They must not become local authority without a local ledger transition.

---

## 4. Inter-Ledger Delegation

Valid inter-ledger delegation follows:

```text
ExternalProof
  -> local PolicyEvaluation
  -> local ProofEvaluator(grant_authority)
  -> local LedgerCommit
  -> local CapabilityEdge
```

Forbidden shortcut:

```text
ExternalProof -> local CapabilityEdge
```

An external edge may be mirrored locally only after local constitution.

---

## 5. Causal Graph Boundary

Ledgers may have incompatible causal orders.

The local system must not treat external order as local authority time.

Required rule:

```text
external_causal_state may be evidence
local LedgerState[t] defines local validity
```

Wall-clock alignment between systems is not authority alignment.

---

## 6. Conflict Resolution

Conflicts between authority spaces must be resolved as explicit local policy decisions.

They must not be resolved by:

```text
system priority by convention
latest timestamp wins
external admin override
UI-selected source
availability of a token
```

If a conflict changes local authority, the result must be committed to the local ledger.

---

## 7. Cross-System Revocation

External revocation is evidence until observed and constituted locally.

Local runtimes may define emergency rejection policies, but they must preserve the distinction:

```text
external revocation observed
local authority invalidated by policy
local ledger transition committed
```

External revocation must not silently mutate local authority state without a local causal record.

---

## 8. Interoperability Projection

Cross-system dashboards, badges, sync states, and notifications are epistemic projections.

They must not:

```text
create local authority
cache external authority as local proof
resolve conflicts silently
hide revocation uncertainty
collapse external state into local truth
```

---

## 9. Forbidden Patterns

```text
external_role_as_local_authority
external_token_as_capability_edge
foreign_ledger_time_as_local_time
cross_system_timestamp_ordering
silent_authority_import
revocation_without_local_causal_record
interoperability_dashboard_as_policy_source
multi_ledger_conflict_by_ui_selection
```

---

## 10. Minimal Form

```text
External systems may provide evidence.
Only local ledger constitution may create local authority.
```

Cross-system composition is valid only when interoperability preserves the authority boundary.
