# RFC-0052: Subject Authority And Identity Continuity

Status: Accepted

This RFC defines the constitutional model of a subject within SL1.

A subject is not an account, profile, credential, wallet, key, or provider record.

A subject is a persistent authority continuity graph whose current state is derived from validated authority history.

```text
Authentication proves present access.
Identity proves continuity of subject.
Authority proves control over state transitions.
```

RFC-0052 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0003: Canonical Serialization & Replay Protection
RFC-0011: Identity Kernel & Capability Resolution
RFC-0015: Trust and Attestation Lifecycle
RFC-0016: Capability and Delegation Model
RFC-0034: Authority Lattice Model
RFC-0036: Temporal Authority Model
RFC-0043: SL1 Constitutional Security Model
RFC-0048: Federated Identity Event Replication
RFC-0049: Constitutional Recovery Model
RFC-0050: Authority Fork Resolution Model
RFC-0051: Proof of Sovereign Continuity
```

---

## 1. Constitutional Kernel

```text
subject != account
subject != profile
subject != key
subject != wallet
subject != provider record

identity_state != database_record
identity_state = derived_from_authority_history

authority_event != transaction
authority is scoped

key_rotation != identity_change
recovery != subject_creation
provider_continuity != subject_continuity
```

A subject is not created by registration.

A subject is recognized by continuity of authority.

The subject is the persistent continuity source from which identity state is derived.

The subject does not own identity as an external object.

The subject controls authority over its identity graph.

---

## 2. Acceptance Criteria

RFC-0052 is accepted when the following semantic boundaries are frozen:

```text
Subject semantics frozen.
Authority event model frozen.
Authority domains frozen.
Subject continuity semantics frozen.
Authentication / identity / authority split frozen.
Provider boundary frozen.
Recovery boundary frozen.
```

No implementation choice may redefine what a subject is.

Code may change storage, indexes, caches, replication, or projections.

Code must not collapse subject identity back into:

```text
user row -> identity
account record -> subject
provider account -> subject continuity
```

---

## 3. Non-Goals

RFC-0052 does not define:

```text
authentication
provider accounts
wallet accounts
financial transactions
global identity registry
biometric personhood proof
social reputation
automatic trust
```

RFC-0052 does not create identity.

RFC-0052 defines how continuity of authority is recognized.

Registration with a provider creates a provider relationship.

It does not create the subject.

---

## 4. Subject Model

A subject is represented as an authority continuity graph:

```text
Subject
 |
 +-- Authority Root
 |
 +-- Authority Domains
 |    |
 |    +-- identity
 |    +-- device
 |    +-- finance
 |    +-- organization
 |    +-- application
 |
 +-- Claims
 |
 +-- Relationships
 |
 +-- Agents
 |
 +-- Delegations
 |
 +-- Recovery Paths
```

Each edge in the graph must be justified by validated authority history.

The graph is not a profile row.

The graph is not a provider-owned object.

The graph is the evaluated state of subject authority.

---

## 5. Authority Root

The authority root is the constitutional source from which subject continuity begins.

It is not a single private key.

It is not a wallet seed phrase.

It is not a provider account.

Valid control mechanisms may include:

```text
passkeys
hardware enclaves
controller sets
guardians
quorum recovery paths
time-bound controller delegation
```

These mechanisms may prove, restore, or participate in control.

They are not the subject.

```text
self-sovereign != single_key
self-sovereign = human-controlled authority graph
```

---

## 6. Authority Domains

Authority is never global by default.

An authority domain scopes the meaning of control.

Examples:

```text
identity authority
device authority
finance authority
organization authority
application authority
```

Each domain may define different valid event classes, recovery rules, delegation rules, and revocation semantics.

Authority in one domain does not imply authority in another domain.

```text
device.transfer != finance.spend
recovery.identity != ownership.transfer
email_control != identity_authority
```

This prevents the account-centric collapse where one provider account becomes the control center for email, devices, payments, applications, and recovery.

---

## 7. Authority Event Model

An authority event is the smallest valid transition of subject authority state.

It is not a database mutation.

It is not a financial transaction.

It is an authority transition.

Minimal form:

```json
{
  "event_id": "evt:123",
  "type": "authority_event",
  "subject": "sl1:id:alice",
  "domain": "device",
  "action": "bind",
  "target": "sl1:device:pixel-7a",
  "proof": {
    "type": "signed_intent",
    "controller": "sl1:id:alice"
  },
  "timestamp": "2026-06-26T00:00:00Z"
}
```

Authority event flow:

```text
subject emits authority_event
  -> event validated
  -> authority graph evolves
  -> identity state derived
```

Invalid model:

```text
user.update(device_owner=true)
```

Valid model:

```text
evaluate(authority_history) -> current authority graph
```

---

## 8. Evaluation Model

Identity state is not stored.

Identity state is evaluated.

```text
derive_subject_state(
  genesis_authority,
  authority_events,
  claims,
  relationships,
  delegations,
  revocations
) -> derived_identity_state
```

Current state is the result of evaluating authority history under domain rules.

Example event history:

```text
t1: genesis(subject=alice)
t2: bind_device(pixel-7a)
t3: delegate(app-x, capability=y)
t4: transfer_device(pixel-7a -> bob)
```

The system must not ask:

```text
SELECT owner FROM devices
```

It must derive:

```text
replay(authority_events)
  -> validate proofs
  -> apply scoped domain rules
  -> compute current authority graph
```

Result example:

```json
{
  "subject": "sl1:id:alice",
  "effective_authority": {
    "device": [],
    "finance": [
      "payment_capability_x"
    ]
  }
}
```

After `transfer_device(pixel-7a -> bob)`, Alice no longer has effective device authority over `pixel-7a` unless a later valid event restores it.

Canonical subject state MUST be reproducible from authority history.

If subject state cannot be reconstructed by replay and evaluation, then a hidden source of truth has been introduced.

---

## 9. Claims

A claim is an assertion about a subject.

A claim is not authority.

Examples:

```text
email_control
phone_control
kyc_attested
employment_attested
device_manufactured
account_observed
```

Provider claim example:

```json
{
  "type": "claim",
  "issuer": "google",
  "subject": "sl1:id:alice",
  "claim": "controls_email",
  "value_hash": "sha256:..."
}
```

This means:

```text
Google attests that subject controls email X.
```

It does not mean:

```text
Google owns the subject.
Google created the subject.
Google controls subject continuity.
```

---

## 10. Relationships

A relationship is a typed edge between a subject and another counterparty.

Relationships are distinct from attributes.

An email address may be modeled as an attribute or claim.

Device ownership is a relationship derived from authority events.

Example:

```json
{
  "type": "relationship",
  "subject": "sl1:id:alice",
  "counterparty": "sl1:device:pixel-7a",
  "relation": "owner",
  "derived_from": "evt:123"
}
```

The relationship is valid only if the authority history supports it.

---

## 11. Agents

An agent is an entity that may act on behalf of a subject within a scoped authority domain.

Examples:

```text
device
application
service worker
automation
organization seat
```

An agent is not the subject.

Agent possession is not root authority.

Agent compromise must not imply global subject compromise unless the authority graph explicitly grants that scope.

---

## 12. Delegations

A delegation grants scoped capability to an agent or counterparty.

Delegation is not ownership.

Delegation must be:

```text
explicit
scoped
time-bound or revocable
domain-bound
replay-constrained
```

Example:

```json
{
  "type": "authority_event",
  "domain": "finance",
  "action": "delegate",
  "subject": "sl1:id:alice",
  "target": "sl1:agent:app-x",
  "capability": "approve_payment",
  "expiry": "2027-01-01T00:00:00Z"
}
```

This changes the authority graph for a bounded capability.

It does not transfer identity.

---

## 13. Recovery Boundary

Recovery restores authority continuity.

Recovery does not create a new subject.

Recovery does not transfer ownership.

Recovery does not replace authority history.

Recovery must preserve:

```text
authority lineage
revocation semantics
domain scope
proof replay resistance
temporal validity
auditability
```

Recovery paths help a subject regain control.

They must not become the source of the subject.

---

## 14. Provider Boundary

Providers are external participants.

Providers may:

```text
issue claims
host agents
provide services
attest observations
relay events
offer recovery assistance
```

Providers may not:

```text
create subjects
own subject continuity
become authority root
collapse scoped authority domains
turn account recovery into identity ownership
```

Valid provider statement:

```text
This subject controls email X.
```

Invalid provider statement:

```text
This subject is Google account X.
```

A provider may observe, attest, host, or serve a subject.

A provider cannot become the source of the subject.

---

## 15. Device Binding And Transfer

Device ownership is derived from authority history.

It is not a provider-owned flag.

Binding flow:

```text
Pixel Hardware Agent
  -> hardware attestation
  -> Device Agent Record
  -> authority_event: bind_device
  -> Subject Identity
```

Transfer flow:

```text
Alice signs transfer_intent(device=pixel-7a, to=Bob)
Bob signs acceptance
valid authority_event chain
  -> device.owner = Bob
```

A manufacturer may attest:

```text
device manufactured
device model
hardware identity
secure enclave capability
```

The manufacturer may not decide permanent human ownership.

---

## 16. Key Rotation

Key rotation is not identity change.

A subject may rotate:

```text
passkeys
controller keys
hardware authenticators
recovery guardians
device-local credentials
```

The subject remains the same subject if authority continuity is validly preserved.

```text
old_key -> valid_rotation_event -> new_key
```

does not imply:

```text
old_subject -> new_subject
```

---

## 17. Core Invariants

```text
subject != account
subject != profile
subject != key
subject != wallet
subject != provider_record

subject != identity_record
identity_state != database_record
identity_state = derived_from_authority_history

authority_event != transaction
authority_event = scoped_authority_transition
authority is scoped

claim != authority
relationship != attribute
agent != subject
delegation != ownership

recovery != creation
recovery_path != ownership_transfer
key_rotation != identity_change

provider_account != subject
provider_continuity != subject_continuity
provider_claim != authority_root

device_ownership != financial_authority
email_control != identity_authority
authentication != identity_continuity
canonical_subject_state = replay(authority_history)
```

---

## 18. Relation To Existing RFCs

RFC-0011 separates entity identity, key proof material, and capability grants.

RFC-0052 defines the subject-level constitutional semantics above that separation.

RFC-0048 defines federated replication of public authority transitions.

RFC-0052 defines what those transitions mean for subject continuity.

RFC-0049 defines recovery as restoration of causally valid authority continuity.

RFC-0052 defines why recovery must not create a new subject.

RFC-0051 defines operational continuity as evidence, not authority.

RFC-0052 defines subject authority continuity as the identity substrate to which evidence may refer.

---

## 19. Final Axiom

```text
A subject exists through continuity of authority,
not through registration with a provider.

A provider may observe, attest, host, or serve a subject,
but cannot become the source of the subject.

The subject is the only persistent entity.
Everything else is a changing relationship around it.
```
