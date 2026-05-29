# RFC-0049: Constitutional Recovery Model

Status: Draft

This document defines recovery in SL1 as restoration of causally valid authority continuity.

RFC-0049 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0003: Canonical Serialization & Replay Protection
RFC-0005: Ledger Persistence and Crash Recovery
RFC-0015: Trust and Attestation Lifecycle
RFC-0028: Controller Trust Model and Recovery Escalation
RFC-0034: Authority Lattice Model
RFC-0036: Temporal Authority Model
RFC-0041: SL1 Distributed Failure Model
RFC-0043: SL1 Constitutional Security Model
RFC-0048: Federated Identity Event Replication
```

---

## 1. Constitutional Kernel

```text
Authority continuity survives node failure
iff public authority transitions remain causally reconstructible.
```

Recovery is not account reset.

Recovery is not database rollback.

Recovery is not administrator override.

Recovery is a constitutionally bounded transition that restores valid authority derivation.

---

## 2. Recovery Scope

RFC-0049 covers:

```text
node loss
controller loss
controller compromise
controller rotation
quorum recovery
dead-node restoration
stale binding repair
```

Each case must preserve:

```text
authority lineage
revocation semantics
proof replay resistance
domain binding
temporal validity
auditability
```

---

## 3. Failure Classes

### Node Loss

The infrastructure node holding a local projection is unavailable or destroyed.

Valid recovery path:

```text
new node
  -> peer sync
  -> hash chain verification
  -> authority graph reconstruction
  -> local projection rebuild
```

### Controller Loss

A user loses access to a device-local controller.

Valid recovery requires a pre-existing recovery path or quorum-authorized replacement.

### Controller Compromise

A controller may be controlled by an adversary.

Valid recovery must revoke the compromised controller before accepting replacement authority.

### Stale Binding

A local application binding references an identity or controller no longer valid under the causal authority graph.

Valid recovery must repair the binding through an explicit attested transition.

---

## 4. Recovery Artifacts

Recovery may use the following artifacts:

```text
RECOVERY_DELEGATED
CONTROLLER_REVOKED
CONTROLLER_ADDED
BINDING_ATTESTED
PEER_ATTESTATION
RECOVERY_QUORUM_OBSERVED
```

Artifacts must be:

```text
signed
scoped
nonce-bound
time-bound
causally linked
replay-constrained
domain-bound
```

No recovery artifact may grant unbounded authority.

---

## 5. Recovery Delegation

Recovery delegation is an explicit authority transition.

Minimal payload:

```text
RECOVERY_DELEGATED {
  entity_address
  delegate_subject
  recovery_scope
  quorum_policy?
  expires_at
  nonce
  previous_event_hash
}
```

Delegation is not ambient trust.

Delegation is valid only for the bounded recovery scope.

---

## 6. Dead-Node Restoration

Dead-node restoration reconstructs public authority state from peers.

The restoring node must:

```text
discover trusted peers
fetch authority events
verify peer signatures
verify per-entity hash chains
detect missing parents
detect forks
rebuild local projections
mark unresolved histories as non-executable
```

If a required causal parent is missing, the projection may be stored but must not become executable authority.

---

## 7. Quorum Recovery

Quorum recovery is a future optional layer.

It allows a configured peer set to attest that a recovery transition was observed and is consistent with known causal history.

Example:

```text
3/5 trusted peers attest RECOVERY_DELEGATED
3/5 trusted peers attest CONTROLLER_ADDED
```

Quorum increases confidence.

It does not replace local proof evaluation.

It does not create global consensus.

---

## 8. Compromised Controller Handling

A compromised controller must be treated as dangerous until revoked in the causal graph.

Required sequence:

```text
detect compromise evidence
freeze high-risk execution scopes
commit CONTROLLER_REVOKED or recovery equivalent
reject proofs from revoked controller at or after revocation point
add replacement controller through valid recovery path
re-evaluate affected bindings and capabilities
```

Invalid behavior:

```text
add new controller while compromised controller remains active
trust latest login over revocation state
repair binding without recovery artifact
erase history to hide compromise
```

---

## 9. Stale Binding Repair

Application bindings are projections.

They are not authority.

If a Coolify, marketplace, or other application binding points to stale SL1 state, the repair must be attested.

Valid repair:

```text
BINDING_ATTESTED {
  subject_system
  subject_user_or_team
  entity_address
  controller_address
  binding_scope
  previous_binding?
  proof_reference
}
```

The repaired binding becomes usable only after local policy accepts the attestation under current authority graph state.

---

## 10. Recovery vs Backup

Backup restores data.

Recovery restores authority continuity.

Backup is insufficient when:

```text
controller state changed after backup
revocation happened on peer graph
binding became stale
controller was compromised
fork exists
```

Correct model:

```text
backup:
  operational state restoration

recovery:
  causal authority reconstruction
```

---

## 11. Safety Conditions

Recovered authority is valid only if:

```text
all required causal parents are known
no unresolved fork affects the authority scope
revocation checks pass
replay checks pass
recovery artifacts are current
domain and scope bindings match
local policy accepts the reconstructed graph
```

If any condition fails:

```text
authority projection may be visible
execution must remain blocked
```

---

## 12. Boundary With RFC-0050

RFC-0049 requires fork awareness.

It does not define all fork resolution rules.

RFC-0050 must define:

```text
when histories are mergeable
when histories are conflicting
how revocation conflicts are handled
how stale peers are weighted
how partial partitions rejoin
which recovery transitions dominate
```

Until RFC-0050 rules are available, unresolved forks must block affected authority scopes.

---

## 13. Minimal Form

```text
private authority = device-local
public authority continuity = federated causal replication

node failure:
  does not imply authority loss

valid recovery:
  reconstruct causal graph
  reject replay and forks
  restore bounded authority derivation
```
