# RFC-0048: Federated Identity Event Replication

Status: Draft

This document defines identity continuity in SL1 as federated causal replication of public authority transitions.

RFC-0048 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0003: Canonical Serialization & Replay Protection
RFC-0005: Ledger Persistence and Crash Recovery
RFC-0008: Network Knowledge and View Divergence Model
RFC-0015: Trust and Attestation Lifecycle
RFC-0018: SL1 Connect and Identity Proof
RFC-0039: SL1 Node Role Model
RFC-0041: SL1 Distributed Failure Model
RFC-0042: SL1 Proof Envelope Semantics
RFC-0043: SL1 Constitutional Security Model
```

---

## 1. Constitutional Kernel

```text
private authority material = device-local
public authority continuity = federated causal replication
```

SL1 identity is not an identity provider abstraction.

It is a causal authority graph runtime.

The purpose of replication is not login availability.

The purpose is preservation of authority continuity under infrastructure failure.

---

## 2. Core Object

The replicated object is an append-only authority event graph.

It is not a database replica.

It is not a blockchain.

It is not global consensus state.

It is a causally ordered set of public, signed, replay-constrained transitions from which authority state can be reconstructed.

Minimal form:

```text
AuthorityEvent {
  event_id
  event_type
  entity_address
  controller_address?
  previous_event_hash?
  causal_parents[]
  payload
  issued_at
  observed_at
  issuer_node
  signature
}
```

---

## 3. Event Classes

The following event classes are eligible for federated replication:

```text
ENTITY_CREATED
CONTROLLER_ADDED
CONTROLLER_REVOKED
PROOF_OBSERVED
BINDING_ATTESTED
RECOVERY_DELEGATED
```

Replicated event payloads may include:

```text
credential_id
credential_public_key
attestation_metadata
controller_address
revocation_state
proof_envelope_reference
binding_subject
binding_scope
recovery_delegate
```

Replicated event payloads must not include:

```text
private keys
authenticator secrets
session cookies
bearer tokens
unbounded admin credentials
```

---

## 4. WebAuthn Public Material

WebAuthn credential public material is not secret.

Replicating the following is constitutionally permitted:

```text
credential id
public key
attestation metadata
transports
rp binding
revocation state
```

The authenticator private key remains device-local.

Valid architecture:

```text
private key:
  user device only
  never replicated
  never exported

public credential state:
  replicated across sovereign nodes
  signed
  replay-constrained
  causally reconstructible
```

---

## 5. Replication Invariants

Every replicated identity event must preserve:

```text
append-only
hash-chained per entity
signed peer exchange
canonical serialization
replay rejection
fork detection
causal sync
domain isolation
```

Invalid replication behavior:

```text
last-write-wins identity state
mutable credential rows as authority
trust-by-transport
peer role as authority
implicit recovery from backup alone
```

---

## 6. Peer Sync Semantics

Peer sync is causal authority reconciliation.

It is not database replication.

A node receiving events from a peer must:

```text
verify peer signature
verify event canonical hash
verify entity hash-chain linkage
verify event admissibility
reject replayed event ids
detect divergent parent histories
store accepted event as epistemic evidence
reconstruct local authority projection deterministically
```

The local projection is derived state.

The event graph is the authority continuity substrate.

---

## 7. Event Admissibility

An event is admissible only if:

```text
event type is known
event hash matches canonical payload
issuer is known or explicitly trust-scoped
signature verifies
causal parents are known or marked missing
domain binding matches local policy
replay key has not been consumed
event does not violate entity lineage rules
```

Admissibility does not imply final authority.

It means the event may enter the local causal graph and participate in authority reconstruction.

---

## 8. Fork Detection

A fork exists when two admissible histories for the same entity cannot both be valid under entity lineage rules.

Examples:

```text
same previous_event_hash -> conflicting CONTROLLER_ADDED
controller revoked in one branch and used in another
same recovery delegation nonce consumed by different delegates
binding attested to incompatible subjects
```

RFC-0048 requires fork detection.

It does not define fork resolution.

Fork resolution is deferred to RFC-0050.

---

## 9. Attestation Quorum

Attestation quorum is optional in RFC-0048.

Quorum does not create global consensus.

It increases confidence in authority continuity.

Example:

```text
3/5 trusted peers observed CONTROLLER_ADDED
```

This strengthens:

```text
forgery resistance
recovery confidence
replay detection
stale peer detection
```

It must not be treated as token economics, mining, or speculative consensus.

---

## 10. Failure Property

The primary property of federated identity event replication is:

```text
loss of node != loss of authority continuity
```

If a node fails, a replacement node may:

```text
sync peer events
verify hash chains
reject replay and forks
reconstruct sl1_entities
reconstruct sl1_controllers
resume passkey verification
```

The user passkey continues to work because the private key remained on the device and the public credential state survived in the mesh.

---

## 11. Non-Goals

RFC-0048 does not define:

```text
token economics
mining
global consensus
settlement ordering
universal identity registry
automatic trust of all peers
fork resolution
constitutional recovery ceremonies
```

Recovery is defined by RFC-0049.

Fork resolution is defined by RFC-0050.

---

## 12. Minimal Form

```text
identity provider -> wrong abstraction
causal authority graph runtime -> correct abstraction

backup != authority continuity

authority continuity is:
  causal
  replicated
  attestable
  reconstructible
```
