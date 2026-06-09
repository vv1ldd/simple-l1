# SL1 Truth Spec v1

Status: Draft

This specification defines the canonical truth contract between the SL1
runtime, discovery bridge, local admission boundary, postflight observers, and
UI projections.

The purpose of this document is not to describe implementation files. It
defines state, ownership, transitions, invariants, and forbidden write paths.

## Core Separation

SL1 mesh truth is separated into four lifecycle stages and one postflight
observation class:

| Entity | Meaning | Authority Status |
| --- | --- | --- |
| `join_request` | Observed network discovery signal | Not trusted |
| `verified_candidate` | `join_request` plus validation evidence | Not admitted |
| `admitted_peer` | Local host authority decision | Membership truth |
| `visible_mesh_node` | UI/query projection derived from membership/read models | Not authoritative |
| `tls_state` | Derived postflight observation | Not a converge or admission input |

These entities are related but never interchangeable.

## Authority Boundary Table

| Domain | Owner | Allowed Authority |
| --- | --- | --- |
| Network discovery | Bridge | Store and replay evidence |
| Runtime validation | Runtime validation layer | Produce non-authoritative candidate evidence |
| Peer admission | Host | Exclusive write authority for `admitted_peer` |
| Visibility | UI projection layer | Render labeled read models |
| TLS status | Postflight observer | Report derived lifecycle state |
| State execution | Runtime converge owner | Execute deterministic converge mutations |

## Transition Rules

Allowed transitions:

- `join_request -> verified_candidate`
- `verified_candidate -> admitted_peer`
- `verified_candidate -> rejected`
- `admitted_peer -> visible_mesh_node`
- postflight observation may derive `tls_state`

Forbidden transitions:

- `join_request -> admitted_peer`
- `bridge -> admitted_peer`
- `ui -> admitted_peer`
- `runtime_validation -> admitted_peer`
- `tls_state -> converge`
- `tls_state -> admitted_peer`

## Invariants

- `ADMITTED_PEER_HOST_AUTHORITY`: `admitted_peer` must originate from host
  authority only.
- `BRIDGE_NO_ADMISSION`: bridge-originated data must never create or mutate
  `admitted_peer`.
- `UI_NO_PEER_MUTATION`: UI projections must not write peer state or drive
  admission decisions.
- `RUNTIME_NO_ADMISSION_OVERRIDE`: runtime validation may create candidate
  evidence but must not override host admission.
- `POSTFLIGHT_NO_CONVERGE_MUTATION`: postflight observers must not mutate
  converge state.
- `TLS_NO_CONVERGE_GATE`: TLS state must not fail converge execution or peer
  admission.
- `DISCOVERY_NOT_MEMBERSHIP`: `join_request` and discovery artifacts are not
  mesh membership.
- `VISIBLE_NODE_IS_PROJECTION`: `visible_mesh_node` must be derived from
  `admitted_peer` or explicitly labeled discovery/candidate read models.

## TLS State Semantics

`tls_state` is derived observability only:

- `trusted`
- `pending_acme`
- `fallback_self_signed`
- `unreachable`

TLS state must not affect:

- converge execution
- peer admission
- runtime state transitions

## Converge Independence

Converge must not depend on:

- DNS propagation
- TLS issuance
- HTTP endpoint availability

These are postflight observations. They can produce diagnostics and retry
guidance, but they must not retroactively turn a deterministic converge mutation
into a failed mutation.

## Spec Compiler Constraint

The SL1 Spec Compiler is a deterministic, stateless, side-effect-free
transformation layer.

It must not introduce new semantics. It only transforms declared spec facts into:

- lintable invariants
- positive transition fixtures
- negative transition fixtures
- runtime guard stubs

The spec is the source of truth. Enforcement artifacts are derived.
