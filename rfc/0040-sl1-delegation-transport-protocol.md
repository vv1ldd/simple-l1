# RFC-0040: SL1 Delegation Transport Protocol

Status: Draft

This document defines the transport model for moving authority-bound intents, proofs, and execution results between role-composed SL1 nodes.

RFC-0040 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0003: Canonical Serialization & Replay Protection
RFC-0016: Capability & Delegation Model
RFC-0034: Authority Lattice Model
RFC-0036: Temporal Authority Model
RFC-0039: SL1 Node Role Model
```

---

## 1. Constitutional Kernel

```text
Authority = f(Ledger[t], ProofEvaluator)
```

ProofEvaluator is not an authority source.

ProofEvaluator is a deterministic function over committed ledger state.

No packet is authoritative before ledger binding.

No packet is authoritative before `LedgerCommit`.

---

## 2. Scope

The delegation transport protocol defines how nodes exchange:

```text
SignedIntentPacket
SignedProofEnvelope
SignedExecutionResultEnvelope
ReplayProtectionNonce
LedgerHeightBinding
```

Transport may move artifacts.

Transport must not create authority.

---

## 3. Packet Authority Rule

```text
No packet is authoritative until LedgerCommit.
```

A packet may be:

```text
well-formed
signed
fresh
locally verifiable
causally bound
```

and still not be authoritative until the corresponding ledger transition is committed.

---

## 4. SignedIntentPacket

A `SignedIntentPacket` represents a requested action.

Minimal fields:

```text
packet_type = SignedIntentPacket
intent_id
subject
action_scope
target_node
ledger_height_hint
nonce
issued_at
expires_at
signature
```

It must be canonically serialized.

It must bind the intended action scope.

It must not imply that the action is authorized.

---

## 5. SignedProofEnvelope

A `SignedProofEnvelope` carries evidence for proof evaluation.

Minimal fields:

```text
packet_type = SignedProofEnvelope
proof_id
intent_id
subject
capability_reference
ledger_height_binding
proof_material
nonce
signature
```

The envelope is evidence.

It is not authority.

It becomes usable only as input to deterministic proof evaluation over `Ledger[t]`.

---

## 6. SignedExecutionResultEnvelope

A `SignedExecutionResultEnvelope` records the outcome of execution.

Minimal fields:

```text
packet_type = SignedExecutionResultEnvelope
result_id
intent_id
execution_node
ledger_height_binding
execution_status
result_digest
result_artifacts
nonce
signature
```

The result envelope may be submitted to `Ledger.appendAPI`.

It must not mutate ledger storage directly.

---

## 7. Ledger Height Binding

Every proof-bearing packet must bind to a ledger height or causal ledger position.

Required invariant:

```text
No execution is valid without ledger-height-bound proof evaluation.
```

A stale ledger height may be rejected by policy.

A missing ledger height binding must be rejected.

---

## 8. Replay Protection

Every transport packet must carry replay protection.

Replay protection must bind:

```text
packet_type
intent_id or result_id
subject
target_node
ledger_height_binding
nonce
expiration
```

Replay validation must occur before execution and before ledger append.

---

## 9. Cross-Node Verification

Receiving nodes must verify:

```text
canonical serialization
signature validity
nonce freshness
ledger height binding
capability reference
role eligibility
```

Role eligibility is not authority.

Role eligibility only determines whether the node may process that packet type.

---

## 10. Forbidden Shortcuts

```text
signed_packet_as_authority
proof_envelope_as_permission
transport_delivery_as_commit
executor_receipt_as_ledger_truth
coordinator_route_as_authorization
cached_packet_as_current_validity
```

---

## 11. Minimal Form

```text
Packets transport evidence.
LedgerCommit constitutes authority.
Execution requires ledger-height-bound proof evaluation.
```
