# ADR-0067: Federated Realm Trust Boundary

Status: Accepted

This ADR freezes the boundary for how one Identity Realm recognizes another
Identity Realm without merging canonical state or delegating local identity
existence.

ADR-0063 through ADR-0066 established truth, authority, event class, and
device replication inside one realm. ADR-0067 establishes how realms relate
across trust boundaries.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
ADR-0063 answers: What is an Identity Realm, what is Realm State, and what survives runtime failure?
ADR-0064 answers: How does identity preserve authority continuity across device loss, rotation, and recovery?
ADR-0065 answers: Which events belong to Identity Realm evolution versus Application Domain evolution?
ADR-0066 answers: How do multiple devices stay continuous with the same identity without syncing opaque state?
ADR-0067 answers: How does one realm recognize another realm's authority without merging identity truth?
```

## Acceptance Criteria

ADR-0067 is accepted when the following boundaries are frozen:

```text
federation_is_trust_between_authority_histories_not_databases
realm_identity_is_local_authority
trust_is_explicit_not_discovered
external_claim_is_assertion_not_local_fact
federated_claim_is_not_local_authority
federation_events_may_be_realm_events
remote_domain_events_must_not_mutate_local_realm
federation_does_not_merge_realm_state
federation_does_not_delegate_identity_existence
realm_verifies_authority_chain_not_database_or_endpoint
```

## Constitutional Kernel

```text
Federation is trust between authority histories,
not trust between databases.
```

A realm does not trust another realm's database, snapshot, or endpoint. A realm
verifies another realm's authority chain and accepts only authorized realm
assertions.

## Questions This ADR Answers

```text
How does one Identity Realm trust another?
What may cross a federation boundary?
What must remain local to each realm?
How are external claims represented without becoming local authority?
```

This ADR does **not** answer which transport carries federation messages, which
cryptographic suite signs trust artifacts, or how marketplace applications
project federated claims into domain state. Those are implementation concerns.

## Core Problem

```text
How do multiple Identity Realms cooperate without becoming one database?
```

This is not:

```text
How do we sync identity between meanly.one and meanly.ru?
```

This is:

```text
How does Realm A recognize Realm B's authority history
without merging canonical Realm State?
```

## Decision

Federation is a trust relationship between authority histories.

```text
Realm A verifies Realm B authority chain
and accepts only authorized realm assertions.
```

Not:

```text
Realm A trusts Realm B database
```

Not:

```text
Realm A trusts Realm B public key alone
```

Trust is earned through explicit federation policy applied to verifiable
authority history, not through endpoint discovery or database replication.

## Federation Model

```text
Realm A                          Realm B
Identity                         Identity
Authority Chain                  Authority Chain
Event History                    Event History
        │                                │
        └──────── federation trust ──────┘
```

Each realm retains:

- local identity existence
- local authority chain
- local Event Log
- local Realm State projection

Federation adds recognition, not merger.

## Continuation of the ADR Series

```text
ADR-0063  state is projection
ADR-0064  authority decides valid mutation
ADR-0065  only realm events mutate realm
ADR-0066  replicas consume authorized realm events
ADR-0067  realms recognize each other's authority
```

Architectural arc:

```text
Single Realm
        │
        ▼
Authority lifecycle
        │
        ▼
Event boundaries
        │
        ▼
Device replicas
        │
        ▼
Realm-to-Realm trust
```

After ADR-0067, the boundaries are defined for implementation:

- where truth lives
- who may change it
- which events count as truth
- how truth propagates inside a realm
- how external realms become trusted

## Invariant 1: Realm Identity Is Local Authority

```text
A realm does not delegate its identity existence to another realm.
```

Federation does not turn two realms into one database or one global namespace.

`meanly.one` and `meanly.ru` may trust each other. They do not become one
realm. Each `sl1e_*` issued inside a realm remains governed by that realm's
authority history unless a separate federation policy explicitly recognizes
cross-realm continuity.

## Invariant 2: Trust Is Explicit

Wrong model:

```text
I discovered your endpoint,
therefore I trust you
```

Correct model:

```text
I have a trust relationship
with your authority root / history
```

Trust must be established, recorded, and revocable. Discovery may locate a
realm. Discovery must not imply trust.

Examples of federation-local Realm Events:

```text
FEDERATION_TRUST_ESTABLISHED
FEDERATION_TRUST_REVOKED
FEDERATION_POLICY_UPDATED
```

## Invariant 3: External Claims Are Not Local Authority

```text
Federated claim ≠ local fact
```

Example:

```text
Realm A asserts:
    SUBJECT_X VERIFIED
```

Realm B must not automatically treat this as local Realm State.

Realm B may accept:

```text
Realm A asserts X according to A's authority model
```

The receiving realm evaluates the assertion under federation policy. It does
not import foreign authority as local truth by default.

This preserves ADR-0060 separation:

```text
Truth arrives as assertion.
Policy evaluates assertion.
Decision authorizes local action.
Domain projection may index the result.
```

## Invariant 4: Federation Events Are Not Domain Mutation

Federation governance may produce Realm Events inside each realm:

```text
FEDERATION_TRUST_ESTABLISHED
FEDERATION_TRUST_REVOKED
```

Remote business activity must not mutate local Identity Realm state:

```text
REMOTE_ORDER_CREATED      → must not append to local realm log
REMOTE_PAYMENT_SETTLED    → must not append to local realm log
```

This follows ADR-0065:

```text
Realm Event ≠ Business Event
Neither event class may mutate the other's state boundary.
```

Federation recognizes authority histories. It does not replicate marketplace
domain events into identity substrate.

## Trust Evaluation Flow

```text
receive external realm assertion
        │
        ▼
identify source realm
        │
        ▼
is federation trust active?
        │
        ▼
verify source authority chain
        │
        ▼
verify assertion signature / sequence
        │
        ▼
evaluate under federation policy
        │
        ▼
accept as recognized assertion
        or
reject
```

Accepted assertions may inform policy and local projections. They must not
silently rewrite local Realm State as if they were locally authorized Realm
Events.

## Relationship to ADR-0063 Replication

ADR-0063 HA replication copies authorized Realm Events inside one realm.

ADR-0067 federation recognizes authorized assertions across realms.

```text
Replication inside realm  ≠  Federation between realms
```

Replication preserves one authority history.

Federation recognizes another authority history without merging it.

## Relationship to ADR-0066 Multi-Device Sync

```text
ADR-0066  How do I trust my other device?
ADR-0067  How do I trust another realm?
```

Multi-device sync shares one realm history across replicas.

Federation relates distinct realm histories under explicit trust policy.

## Negative Boundaries

```text
Federation does not merge realm databases.
Federation does not replicate domain events into identity logs.
Federation does not make foreign claims local facts by default.
Endpoint discovery does not imply trust.
Public key possession alone does not imply trust.
Global sl1e namespace is not created by federation alone.
```

## Consequences

### Positive

- Realms remain administratively and operationally independent
- Cross-realm cooperation becomes policy-governed, not accidental
- Identity substrate stays constitutional, not commercial
- meanly.one and meanly.ru can federate without becoming one database
- External assertions can be verified without state import

### Negative

- Federation requires explicit trust artifacts and policy
- Cross-realm workflows need assertion evaluation, not log merging
- Applications must project federated truth into domain indexes deliberately
- No shortcut through shared database or shared event log

## Non-Goals

- No global identity namespace in this step
- No cross-realm state merge in this step
- No federation transport protocol in this step
- No automatic trust-on-discovery in this step
- No marketplace domain-event bridging in this step

## Roadmap Completion

```text
ADR-0063  Where does truth live?
ADR-0064  Who can change truth?
ADR-0065  What belongs to this truth?
ADR-0066  How does this truth propagate?
ADR-0067  How do we recognize another truth?
```

With ADR-0067, the sovereign identity substrate boundary set is complete at the
architectural level. Follow-up work may implement mechanisms without reopening
the foundational questions of ownership, authority, event class, replication,
or trust.

## Relationship to Follow-Up Work

Follow-up implementations may define:

- Federation trust policy objects and ceremony
- Cross-realm assertion envelopes and verification
- Application projection rules for recognized external claims
- Operator workflows for trust establishment and revocation
- Meta-document: Canonical State and Replaceable Representations
