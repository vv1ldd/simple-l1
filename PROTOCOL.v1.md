# Simple L1 Protocol v1

**Status:** Frozen draft
**Date:** 2026-05-26
**Scope:** Formal protocol semantics

This document is the source of truth for Simple L1 Protocol v1.

Implementation code, SDK packages, node runtimes, application adapters, and external network adapters MUST conform to this document. If behavior conflicts with this document, the implementation is wrong.

The required development order is:

```text
SPEC -> SDK -> IMPLEMENTATION -> ADAPTERS
```

---

## 0. Protocol Overview

Simple L1 is a deterministic cross-domain coordination protocol.

Simple L1 is not:

* a wallet system
* an IAM system
* an authentication product
* a replacement blockchain
* an adapter-driven multi-chain abstraction

Simple L1 coordinates external value systems by accepting explicit protocol transitions over normalized external evidence.

The core causality pipeline is:

```text
External Chain Event
  -> Normalized Evidence
  -> Canonical Proof
  -> Intent Match
  -> CRE Decision
  -> Settlement Transition
  -> Receipt
  -> SL1 State Mutation
```

Identity is a stable reference system used by the pipeline. Identity does not derive from external events, adapter output, roles, or wallet state.

### 0.1 Layers

Simple L1 Protocol v1 has four frozen semantic layers:

1. Identity Kernel v1: who exists.
2. CRE v1: what is allowed.
3. Settlement Semantics v1: what can be interpreted as valid settlement evidence.
4. Settlement Transition Rules v1: when a valid settlement becomes a state mutation.

Each layer may depend on the meaning of previous layers. No layer may redefine previous layers.

### 0.2 Truth Model

Simple L1 has three independent truths:

* Identity truth: an entity exists.
* Authorization truth: an action is allowed.
* Settlement truth: a state transition happened.

None of these truths may be derived from another one.

---

## 1. Identity Kernel v1

Identity Kernel v1 defines entities and keys.

### 1.1 Entity Address

An entity address identifies a stable Simple L1 entity.

Canonical field:

```text
entity_l1_address
```

Canonical format:

```text
^sl1e_[a-f0-9]{39}$
```

An entity address:

* identifies who exists
* owns SL1 state
* may hold balances, grants, policies, receipts, and settlement projections
* survives key rotation
* is independent of any single passkey, public key, external address, or adapter output

### 1.2 Key Address

A key address identifies proof material for one registered key.

Canonical field:

```text
key_l1_address
```

Canonical format:

```text
^sl1_[a-f0-9]{40}$
```

A key address:

* proves control of one key
* may be derived from passkey public key material
* may be revoked, replaced, rotated, or scoped
* MUST NOT be used as stable entity identity

### 1.3 Rule 0

`entity_l1_address` MUST NOT be derived from cryptographic key material.

This rule is absolute. Any implementation path that creates an entity from a passkey public key hash violates the protocol.

### 1.4 Forbidden Identity Transitions

The following transitions are forbidden:

* `key_l1_address -> entity_l1_address`
* `public_key -> entity_l1_address`
* `external_chain_address -> entity_l1_address`
* `role -> entity_l1_address`
* `adapter_output -> entity_l1_address`
* implicit creation of entity identity during settlement

### 1.5 Identity Output

Protocol outputs that describe an actor MUST distinguish entity and key:

```json
{
  "entity_l1_address": "sl1e_...",
  "key_l1_address": "sl1_..."
}
```

No output may label a key address as `l1_address` when entity identity is required.

---

## 2. CRE v1

CRE means Capability Resolution Engine.

CRE v1 defines authorization as deterministic evaluation over explicit grants.

### 2.1 Input

CRE v1 input is:

```json
{
  "entity_l1_address": "sl1e_...",
  "proof_key_l1_address": "sl1_...",
  "capability": "string",
  "scope": "string",
  "context": {}
}
```

`context` is allowed as opaque metadata. `context` is non-decisional in CRE v1.

### 2.2 Grant

A grant is the only authority source for CRE v1.

Canonical grant fields:

```json
{
  "entity_l1_address": "sl1e_...",
  "key_l1_address": "sl1_...",
  "capability": "string",
  "scope": "string",
  "policy": "deny|require_quorum|require_approval|allow",
  "status": "active|revoked",
  "expires_at": "timestamp|null"
}
```

`key_l1_address` may be null. A null key means the grant is entity-scoped.

### 2.3 Decision

CRE v1 output is:

```json
{
  "decision": "allow|deny|quorum|approval",
  "matched_grants": [],
  "reason_codes": [],
  "confidence": 1
}
```

### 2.4 Policy Precedence

If multiple grants match, policy precedence is:

```text
deny > require_quorum > require_approval > allow
```

### 2.5 Matching Rules

A grant matches only if all of the following are true:

* grant entity equals input entity
* grant capability equals input capability exactly
* grant scope equals input scope exactly
* grant status is active
* grant is not expired
* if grant key is present, it equals input proof key

Wildcard expansion is not part of CRE v1.

### 2.6 Forbidden Authorization Inputs

The following MUST NOT affect CRE v1 decisions:

* roles
* user types
* UI state
* analytics
* external chain balances
* adapter output
* historical reputation
* implicit ownership
* context fields

Roles may describe key posture. Roles do not grant permission.

---

## 3. Settlement Semantics v1

Settlement Semantics v1 defines how the external world can become candidate evidence for Simple L1.

### 3.1 External Event

An external event is an observation from a system outside Simple L1.

Examples:

* EVM transaction receipt
* Bitcoin UTXO observation
* TON account event
* Solana account or transaction observation
* external oracle statement

External events are not Simple L1 state.

### 3.2 Evidence

Evidence is normalized data produced from an external event.

Evidence MUST include enough information to construct or verify a canonical proof.

Evidence MAY be produced by an adapter.

Evidence MUST NOT mutate SL1 state.

### 3.3 Proof

A proof is a canonical, portable object that claims external evidence satisfies a settlement intent.

A proof MUST be:

* deterministic to fingerprint
* self-describing
* tied to one intent or candidate intent
* independently verifiable according to its proof type

A proof is not a state change.

### 3.4 Intent

An intent is the semantic claim that an entity wants a specific settlement action.

Canonical settlement intent classes:

* cross-chain deposit
* cross-chain withdrawal

An intent MUST identify:

* entity
* action
* external network
* asset
* amount rule
* recipient or deposit target
* nonce or replay boundary
* expiry boundary

### 3.5 Adapter Boundary

Adapters are not trusted actors.

Adapters only:

* observe external systems
* normalize external evidence
* construct candidate proof objects
* validate external address formats
* expose network metadata

Adapters MUST NOT:

* create entity identity
* grant authorization
* decide settlement meaning
* mutate SL1 state
* bypass CRE
* issue final receipts

### 3.6 Settlement Truth

Settlement truth is internal protocol truth over external evidence.

External chain finality may be used as evidence. It is not itself SL1 finality.

---

## 4. Settlement Transition Rules v1

Settlement Transition Rules v1 define when a candidate settlement becomes a state mutation.

### 4.1 Transition Input

A settlement transition requires all of the following:

* existing `entity_l1_address`
* registered or valid intent
* canonical proof
* CRE decision for the required capability and scope
* deterministic transition rule
* idempotency key or replay boundary

If any input is missing, the transition MUST be rejected.

### 4.2 Required Order

The required order is:

```text
observe external event
normalize evidence
construct proof
match intent
evaluate CRE
apply transition rules
issue receipt
mutate state
```

Implementations MAY optimize execution internally, but observable behavior MUST be equivalent to this order.

### 4.3 CRE Position

CRE MUST be evaluated after intent matching and before state mutation.

CRE MUST NOT be skipped because a proof is valid.

Valid proof means "the external event happened or is admissible".

CRE allow means "this entity/key is authorized to perform this action in this scope".

Both are required.

### 4.4 Allowed Mutations

Settlement transitions may mutate only protocol-defined state for the matched entity and intent.

Allowed mutation classes:

* credit accepted deposit balance
* mark withdrawal intent as accepted, rejected, expired, or fulfilled
* record receipt
* append provenance
* update nonce or idempotency boundary
* update settlement lifecycle state

Any mutation outside the transition rule is forbidden.

### 4.5 Idempotency

The same external event MUST NOT produce multiple accepted state mutations for the same intent.

The same intent MUST NOT be fulfilled more than once.

The protocol MUST track enough identifiers to reject replay:

* intent id
* proof fingerprint
* external transaction hash or equivalent external event id
* entity
* network
* asset

### 4.6 Amount Semantics

Amount handling MUST be explicit.

For a deposit intent:

* exact amount intent accepts only exact amount
* minimum amount intent accepts amount greater than or equal to minimum
* overpayment handling MUST be specified by the intent
* underpayment MUST NOT fulfill an exact or minimum intent

No adapter may decide amount semantics.

### 4.7 Rejection Semantics

A rejected candidate settlement SHOULD produce a rejection receipt when the candidate is well-formed enough to identify the intent or entity.

Rejection reasons include:

* no matching intent
* expired intent
* invalid proof
* wrong recipient
* wrong network
* wrong asset
* insufficient amount
* duplicate proof
* CRE denied
* unsupported proof type

Rejection does not mutate balances.

### 4.8 Receipt Requirement

Receipt issuance is part of accepted settlement transition semantics.

An accepted settlement without a receipt is incomplete.

Receipts MUST be:

* immutable after issuance
* fingerprinted
* tied to intent and proof
* tied to entity
* verifiable without UI state
* stored in protocol state or a protocol-addressable receipt ledger

---

## 5. System Invariants

The following invariants apply globally.

### 5.1 Identity Invariants

* Entity identity is not derivable from keys.
* Keys prove control; keys do not define entities.
* External addresses do not define Simple L1 entities.

### 5.2 Authorization Invariants

* Authorization is explicit grants only.
* Roles are not permissions.
* Context is not decisional in CRE v1.
* Adapter output cannot grant permission.

### 5.3 Settlement Invariants

* External events do not mutate SL1 state directly.
* Proofs do not mutate SL1 state directly.
* State mutation is an internal protocol decision over external evidence.
* Adapters are normalization layers only.
* Receipts are protocol artifacts, not UI artifacts.

### 5.4 Layering Invariants

The following dependency direction is allowed:

```text
Settlement may use CRE.
CRE may use Identity.
Adapters may use protocol types.
```

The following dependency direction is forbidden:

```text
Identity may not depend on CRE.
CRE may not depend on Settlement.
Settlement semantics may not depend on adapter-specific meaning.
Adapters may not redefine protocol semantics.
```

---

## 6. Threat Model

### 6.1 Not Trusted

The following are not trusted sources of protocol truth:

* external chains
* external chain logs
* RPC providers
* indexers
* adapters
* UI
* analytics
* roles
* comments or labels
* marketplace metadata
* off-protocol databases

These sources may provide evidence. They do not decide protocol truth.

### 6.2 Trusted

The protocol trusts only:

* the Identity Kernel for entity/key separation
* explicit grants evaluated by CRE
* canonical proof verification rules
* deterministic settlement transition rules
* protocol receipts
* internal state machine replay

### 6.3 Attack Classes

Simple L1 Protocol v1 explicitly defends against:

* key-as-identity collapse
* role-based permission leakage
* adapter-driven settlement truth
* direct external-event state mutation
* replayed settlement proofs
* duplicate intent fulfillment
* wrong-recipient evidence
* wrong-asset evidence
* UI-driven authorization
* RPC-provider trust leakage

### 6.4 Non-Goals

Simple L1 Protocol v1 does not attempt to:

* replace external chain consensus
* hide external chain risk
* create a universal wallet abstraction
* infer user intent from balances or behavior
* grant authority from social or role metadata

---

## 7. Conformance

An implementation conforms to Simple L1 Protocol v1 only if:

* it preserves `sl1e_` entity and `sl1_` key separation
* it implements CRE v1 as deterministic explicit-grant evaluation
* it treats external events as evidence only
* it prevents adapters from mutating SL1 state
* it requires proof, intent, CRE decision, and transition rules before settlement mutation
* it issues receipts for accepted settlement transitions
* it rejects forbidden transitions instead of silently coercing them

SDKs MUST be thin interfaces over this document.

Runtime implementations MUST be realizations of this document.

Adapters MUST be mappings from external worlds into canonical evidence and proof objects.
