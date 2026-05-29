# Admission Invariants

Peer admission is an explicit local act.

## Core Rule

```text
join_request != peer_admission
```

A join request says:

```text
this node wants to be observed
```

It does not say:

```text
this node is trusted
```

## Admission Inputs

Admission may consider:

- Join request payload.
- Namespace artifacts.
- DNS allocation evidence.
- Issuer reachability evidence.
- Operator policy.
- Future signed approvals or objections.

These inputs are evidence only.

## Admission Output

Admission may mutate the local peer registry only through the explicit peer admission boundary.

In current operator tooling, that boundary is:

```text
sovereign network admit <request-id>
```

## Replay Safety

Replaying a join request or namespace artifact must not admit a peer.

Re-running admission for the same peer must be idempotent and must not duplicate peer state.
