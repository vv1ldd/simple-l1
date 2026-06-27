# ADR-0063: Identity Realm and Realm State Boundary

Status: Accepted

This ADR freezes the boundary between an Identity Realm, its durable Realm
State, replaceable representations of that state, and replaceable issuer
runtime roles.

ADR-0059 froze identity issuance ownership. ADR-0062 froze vault ownership.
ADR-0063 freezes where durable identity state lives and what survives issuer
runtime failure.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
ADR-0063 answers: What is an Identity Realm, what is Realm State, and what survives runtime failure?
```

## Acceptance Criteria

ADR-0063 is accepted when the following boundaries are frozen:

```text
identity_realm_is_authority_boundary
deployment_topology_is_implementation_detail
realm_state_is_durable
issuer_is_runtime_role
issuer_runtime_is_replaceable
single_writer_per_realm_initially
event_log_is_canonical
snapshot_is_derived
snapshot_must_be_reproducible
standby_must_verify
federation_is_separate_layer
replication_does_not_imply_federation
federation_does_not_replicate_identity_state
```

## Constitutional Kernel

```text
Identity Realm is the canonical authority boundary.
Deployment topology is an implementation detail.
Realm State is durable.
Issuer runtime is replaceable.
```

An Identity Realm is not a container, hostname, or Kubernetes cluster. It is
the canonical trust and authority boundary for durable identity state.

## Questions This ADR Answers

```text
What is an Identity Realm?
What is Realm State?
What survives issuer runtime, container, or node loss?
What is replication inside a realm versus federation between realms?
```

This ADR does **not** answer how federation trust is negotiated, how global
identity namespaces are unified, or how vault crypto is implemented.

## Platform Canonicality Pattern

ADR-0063 follows the shared platform pattern emerging across ADR-0059 through
ADR-0062:

```text
Canonical Owner
        │
owns
        ▼
Canonical State
        │
represented by
        ▼
Replaceable Representation
        │
served by
        ▼
Replaceable Runtime
```

Applied to Realm:

```text
Identity Realm
        │
owns
        ▼
Realm State
        │
canonically recoverable from
        ▼
Event Log
        │
materialized as
        ▼
Snapshot
        │
served by
        ▼
Issuer Runtime
```

Core invariant:

```text
snapshot == replay(event_log)
```

Realm State is **not** the Event Log itself. The Event Log is the canonical
recovery representation of Realm State. A Snapshot is valid only when it is
reproducible from the Event Log.

## Realm State Model

```text
Identity Realm
    │
    ├── Issuer Runtime
    ├── Claim Authorities
    ├── Policies
    ├── HA Cluster (optional)
    └── Storage Representations
```

Examples of current realms:

- `meanly.one` realm owns identity state behind `pass.meanly.one`
- `meanly.ru` realm owns identity state behind `pass.meanly.ru`

Each realm may be implemented as:

- one process
- primary + standby
- a cluster
- multiple datacenters

None of those deployment choices redefines the realm.

## Durable vs Runtime State

```text
Durable Realm State
    ├── Identity Event Log
    ├── Snapshots
    ├── Claims
    └── Authorities

Runtime Connect State
    ├── PAR Requests
    ├── PKCE
    ├── Challenges
    ├── Sessions
    └── In-flight Connect
```

If a primary issuer dies:

- acceptable: an in-flight login window fails and the user retries
- unacceptable: an identity disappears
- unacceptable: a valid Event Log cannot reproduce the latest accepted Realm State

## Negative Boundaries

```text
Realm replication does not imply Federation.
Federation does not replicate identity state.
```

These are different concepts:

- **HA replication** copies state inside one realm
- **Federation** defines trust between realms without merging canonical state

## Initial Implementation Topology

The first implementation uses one active writer per realm:

```text
Primary Issuer
    │
    ├── append Event Log
    ├── write Snapshot
    └── serve mutations

Standby Issuer
    │
    ├── verify Event Log / Snapshot
    ├── reject mutations
    └── promote on operator failover
```

This step explicitly avoids distributed consensus:

- no Raft
- no Paxos
- no etcd quorum
- no active-active write quorum

## Non-Goals

- No global `sl1e_*` namespace
- No multi-writer consensus
- No federation implementation
- No state replication across realms
- No vault storage implementation
- No change to ownership models from ADR-0059 through ADR-0062

## Relationship to Follow-Up ADRs

Follow-up ADRs may define:

- Federation trust policy between realms
- Automated failover promotion rules
- External durable log backends
- Runtime challenge replication for seamless in-flight Connect failover
