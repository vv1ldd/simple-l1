# RFC-0020: Execution Consistency & Temporal Safety

Status: Draft

This document defines execution consistency under time, concurrency, replay, and revocation.

RFC-0020 depends on:

```text
RFC-0012: Ontology Core v0.1
RFC-0014: Policy Layer v0.2
RFC-0016: Capability & Delegation Model
RFC-0017: External Proof Model
```

RFC-0020 answers:

```text
When is action allowed to become reality?
```

---

## 1. Core Principle

```text
Execution time is authoritative.
All validity is re-evaluated at execution time.
```

All execution is re-validated reality, not replayed permission.

Approval does not survive time automatically.

Authority does not survive revocation.

Evidence does not survive policy windows.

Intent does not survive state change.

---

## 2. Temporal Safety Invariants

### Authority Validity Is Time-Relative

Authority must be valid at execution time `t`, not merely at creation time.

Required checks:

```text
ControlGrant is active at t
Capability matches intent at t
Authorization is valid at t
Delegation lineage is valid at t
```

### Policy Is Time-Relative

Policy must be evaluated against current context and state.

Past policy decisions may be historical facts.

They are not executable permission unless still valid at execution time.

### Evidence Is Time-Relative

ExternalProof, Credential, Attestation, and TrustSignal inputs must satisfy the policy window at execution time.

Fresh enough for policy is not the same as historically true.

### Intent Is State-Relative

An Intent must be:

```text
unexpired
unreplayed
bound to the same resource
valid against current state
```

---

## 3. Formal Validity Predicate

Execution validity may be expressed as:

```text
can_execute(intent, authorization, context, state, t) =
  intent.valid_at(t)
  AND authorization.valid_at(t)
  AND grant.active_at(t)
  AND capability.matches(intent)
  AND policy.allows(context, state, t)
  AND not replayed(intent.idempotency_key)
  AND resource.available(state, intent.resource)
```

This predicate is illustrative, not a required implementation API.

The required semantics are:

```text
current validity
ordering
idempotency
```

---

## 4. Revocation Dominance

Revocation affects future execution validity.

```text
Authorization proves approval happened.
It does not guarantee future execution.
```

Therefore:

```text
Authorization != irrevocable right
Authorization != transaction
Authorization must be checked against current grant state
```

Revocation overrides stale authorization for future execution.

Revocation does not rewrite completed transactions.

---

## 5. Replay and Idempotency

Every executable intent must have replay protection.

Replay checks must bind:

```text
intent identity
idempotency key
resource scope
authorization lineage
external proof lineage where applicable
```

Duplicate external proofs must not produce duplicate execution.

Duplicate intents must not mutate state twice unless explicitly modeled as separate intents.

---

## 6. Ordering and Concurrency

Concurrent execution must preserve deterministic validity.

Implementations must prevent:

```text
double spend of one intent
parallel use of exhausted authority
conflicting policy decisions over the same resource
race between revocation and execution
race between external proof arrival and execution
agent use of stale grant cache
```

When ordering affects validity, the accepted order must be part of the execution record.

---

## 7. Failure Modes

RFC-0020 exists to prevent or surface:

```text
stale authorization accepted
revoked grant still usable
policy window mismatch
external proof arrives after authority expiry
duplicate external proof after first execution
conflicting external proofs
intent replay after revocation
agent continues old grant cache
application fulfills from old proof
partial execution hidden as success
```

Failure must not silently become success.

Failure records may be proven, but failure proofs do not authorize future retries by themselves.

---

## 8. State of Record vs Approval History

RFC-0020 introduces a hard separation:

```text
Authorization = historical fact
Execution = current validity check
```

State of record is not the same as history of approval.

Approval records may explain why an action was attempted.

They do not prove the action is still valid.

---

## 9. Agent and Cache Safety

Agents may cache facts.

Agents must not cache authority as executable permission without revalidation at execution time.

Valid agent behavior:

```text
cache fact
re-evaluate policy
re-check authority lineage
execute only if valid at t
```

Invalid agent behavior:

```text
cache allow decision
execute later without revalidation
```

---

## 10. Examples

### Revocation Before Execution

```text
Intent created
Authorization granted
ControlGrant revoked
Execution requested
```

Result:

```text
deny execution
```

The authorization remains historical.

The grant is not active at execution time.

### Delayed External Proof

```text
ExternalProof arrives after policy window
Execution requested
```

Result:

```text
policy may reject stale evidence
```

Historical truth does not imply current usability.

---

## 11. Review Gate

Every proposal that executes intents must answer:

```text
Is validity re-evaluated at execution time using current state, current authority, current policy, and idempotent lineage?
```

If no, the proposal violates RFC-0020.

---

## 12. Non-Goals

This document does not define:

```text
workflow composition
compensation semantics
economic settlement graphs
consensus ordering protocol
policy language
proof adapter implementation
```

Those belong to other RFCs.
