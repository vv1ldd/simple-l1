# ADR-0072: Federation Trust Policy Model

Status: Accepted

This ADR defines how an Identity Realm implements recognition of external
authority without importing foreign state, merging histories, or trusting
endpoints by discovery alone.

ADR-0067 froze federation as trust between authority histories. ADR-0072
materializes that recognition into explicit trust policy, federation lifecycle
events, and validation flow for external assertions.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss?
ADR-0071 answers: How does an active device submit authorized mutations?
ADR-0072 answers: How is external authority acceptance implemented as local policy?
```

## Acceptance Criteria

ADR-0072 is accepted when the following implementation boundaries are frozen:

```text
federation_trust_is_policy_over_external_authority_histories
remote_realm_not_trusted_because_reachable
remote_realm_trusted_when_authority_chain_satisfies_local_policy
discovery_does_not_imply_trust
federation_never_imports_remote_state_as_local_authority
trust_requires_explicit_policy
remote_claims_remain_attributable_to_remote_realm
federated_claim_is_not_local_fact
federation_does_not_merge_histories
trust_is_scoped_not_universal
revoked_federation_trust_stops_new_assertion_acceptance
federation_decisions_are_represented_as_realm_events
```

## Constitutional Kernel

```text
Federation trust is a policy over external authority histories.

A remote Realm is not trusted because it is reachable.
It is trusted because its authority chain satisfies local policy.
```

## Context

ADR-0067 established:

```text
Federation is trust between authority histories,
not trust between databases.
```

A local Realm must not:

- import foreign Realm State as local truth
- treat an external claim as a local fact by default
- trust a remote realm because of endpoint discovery or key possession alone

ADR-0072 implements that architectural boundary.

## Questions This ADR Answers

```text
How does a local Realm establish trust with a remote Realm?
What may be accepted from a trusted remote Realm?
How are remote claims represented without becoming local authority?
How is federation trust revoked?
What validation must occur before accepting an external assertion?
```

This ADR does **not** select federation transport, handshake wire format,
discovery protocol, or application projection rules for specific claim types.

## Core Transition

```text
ADR-0067  How do we recognize another truth?
ADR-0072  How do we implement that recognition policy?
```

## Decision

Federation trust is defined through explicit policy.

Wrong model:

```text
Remote Realm discovered
        |
        v
Trusted
```

Correct model:

```text
Remote Realm discovered
        |
        v
Trust relationship established
        |
        v
Authority history verified
        |
        v
Allowed claims / actions determined
```

Discovery locates a realm. Policy establishes trust.

## Trust Model

```text
Local Realm
        |
        | trust policy
        |
        v
Remote Realm
        |
        +-- Realm Identity
        +-- Authority History
        +-- Event History
```

The local Realm evaluates remote authority history under policy. It does not
merge remote history into local canonical truth.

## Federation Events

Trust lifecycle is Realm-level evolution:

```text
FEDERATION_TRUST_ESTABLISHED
FEDERATION_TRUST_UPDATED
FEDERATION_TRUST_REVOKED
```

As with other authority changes:

```text
event
        |
        v
validation
        |
        v
Current Federation Trust State
```

`Current Federation Trust State` is a projection. The Realm Event Log remains
canonical.

Example projection shape:

```json
{
  "remoteRealms": [
    {
      "realmId": "meanly.ru",
      "status": "active",
      "trustedRootAuthority": "root_ref",
      "allowedClaimScopes": ["email.verified", "merchant.verified"],
      "establishedAt": "2026-06-27T00:00:00.000Z",
      "revokedAt": null
    }
  ]
}
```

## Invariants

### 1. Discovery ≠ Trust

```text
Discovery finds a Realm.
Policy establishes trust.
```

Endpoint reachability, DNS resolution, or public key presence must not imply
federation trust.

### 2. Remote Claims Are Not Local Facts

Example:

```text
Remote Realm asserts:
    SUBJECT_X VERIFIED

Local Realm records:
    Remote Realm asserts SUBJECT_X_VERIFIED
```

These are different states.

The local Realm may accept the assertion for policy evaluation or domain
projection. It must not silently rewrite local Realm State as if the claim were
locally issued truth.

### 3. Federation Does Not Merge Histories

Forbidden:

```text
Realm A Event Log
        +
Realm B Event Log
        =
One identity history
```

Correct:

```text
Realm A history
trusts
Realm B history
```

Each realm retains its own canonical Event Log.

### 4. Trust Is Scoped

Not:

```text
Trust Realm B forever
```

But:

```text
Realm B may issue:
    claims X
    under policy Y
    for scope Z
```

Trust policy must define:

- which remote realm
- which authority roots or histories are recognized
- which claim types or actions may be accepted
- under what conditions acceptance applies
- when trust expires or is revoked

## Validation Flow

```text
remote event / assertion
        |
        v
verify remote Realm identity
        |
        v
verify remote authority chain
        |
        v
evaluate local trust policy
        |
        v
accept / reject external assertion
```

Accepted external assertions may inform:

- policy evaluation (ADR-0060)
- local authorization decisions
- application domain projections

They must not append to local Realm Event Log as if locally authorized unless
the event class is explicitly a federation governance event such as
`FEDERATION_TRUST_ESTABLISHED`.

## Relationship to ADR-0065

ADR-0065 separated Realm Events from Domain Events.

ADR-0072 adds the cross-realm rule:

```text
Remote domain activity must not mutate local identity realm state.
Remote identity assertions must not become local facts by default.
```

`REMOTE_ORDER_CREATED` must not enter the local realm log.
`SUBJECT_X_VERIFIED` from Realm B must not become local authority history.

## Relationship to ADR-0071

ADR-0071 defined local device proposal and realm acceptance.

ADR-0072 defines external assertion evaluation:

```text
ADR-0071  Can this device act inside my Realm?
ADR-0072  Can this other Realm be trusted?
```

Both preserve:

```text
events / assertions are evaluated
state is derived
acceptance is explicit
```

## Relationship to Previous Implementation ADRs

```text
ADR-0069  who can act?
ADR-0070  how continuity is restored?
ADR-0071  how active authority performs actions?
ADR-0072  how external authority is accepted?
```

The implementation layer is now closed at the boundary level:

```text
ADR-0069  authority instruments
ADR-0070  continuity recovery
ADR-0071  authorized local actions
ADR-0072  external authority trust
```

## Negative Boundaries

```text
Federation must not import remote snapshot as local truth.
Federation must not merge event logs across realms.
Discovery must not auto-establish trust.
Public key alone must not establish trust.
Remote claim acceptance must not bypass local policy evaluation.
Revoked trust must not continue accepting new assertions.
Federation handshake success must not imply permanent trust.
```

## Consequences

### Positive

- Realms remain independent while cooperating
- External assertions are attributable and auditable
- Trust can be scoped, updated, and revoked
- meanly.one and meanly.ru can federate without one database
- Implementation can proceed with validators, APIs, and ceremony UX

### Negative

- Federation requires explicit policy objects and lifecycle events
- Cross-realm workflows need assertion envelopes, not state sync
- Applications must project external truth deliberately
- No shortcut through shared storage or merged logs

## Non-Goals

- No federation handshake wire protocol in this ADR
- No discovery protocol selection in this ADR
- No application-specific claim projection rules in this ADR
- No global `sl1e_*` namespace in this ADR
- No cross-realm recovery ceremony in this ADR

## Roadmap Completion

```text
ARCHITECTURE
ADR-0063  Truth location
ADR-0064  Mutation authority
ADR-0065  Event ownership
ADR-0066  Replication model
ADR-0067  External trust
ADR-0068  Canonical vs representation

IMPLEMENTATION
ADR-0069  authority instruments
ADR-0070  continuity recovery
ADR-0071  authorized local actions
ADR-0072  external authority trust
```

After ADR-0072, the implementation boundary series is complete. Next work may
move to concrete plans:

- authority event validators
- `CurrentAuthorityState` / federation trust projections
- storage schema for realm event log and snapshots
- recovery and device submission APIs
- federation handshake and ceremony UX

without reopening constitutional questions of ownership, truth, or trust.

## Relationship to Follow-Up Work

Follow-up implementation may define:

- `FederationTrustPolicy` schema and evaluation engine
- external assertion envelope and verification
- operator workflows for trust establishment and revocation
- application projection contracts for recognized external claims
- federation handshake protocol as replaceable transport/runtime
