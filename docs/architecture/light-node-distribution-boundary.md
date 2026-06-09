# Light Node Distribution Boundary

Status: Draft

This document records why `simplel1` light-node packaging is deferred until the
SL1 truth model is stable and machine-checkable.

## Boundary

`apt install simplel1` is a distribution wrapper. It must not define protocol
truth, peer admission, mesh membership, or UI visibility semantics.

The distribution layer may install:

- a runtime binary or service
- systemd unit files
- default configuration
- state directories
- operator commands

It must not decide:

- whether a peer is admitted
- whether discovery evidence is trusted
- whether bridge visibility is membership
- whether TLS issuance gates converge

## Required Precondition

The following chain must be in place before packaging:

```text
ontology -> truth spec -> invariants -> tests -> runtime guards -> distribution
```

The source of truth is `SL1 Truth Spec v1`, not package behavior.

## Deferred Phases

### Phase 2: Light Node Runtime Spec

Define a panel-less, consensus-capable node runtime after the truth model is
accepted. The runtime may declare roles such as Gateway, Ledger, Validator,
Authority, and Observer, but those roles do not imply peer admission.

### Phase 3: Apt Repository

Build a signed apt repository only after Phase 2 has a stable runtime contract.
At that point, `sudo apt install simplel1` becomes an installation mechanism for
an already-defined node, not a source of semantics.

## Non-Negotiable Rule

Distribution must never crystallize an unstable truth model.
