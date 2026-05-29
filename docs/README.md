# SL1 Semantic Contracts

This directory is the cross-repository semantic synchronization layer.

It defines shared meaning for:

- Bridge discovery evidence.
- Namespace onboarding.
- Admission boundaries.
- DNS provider boundaries.
- Observe-only federation.

## Structure

- `architecture/` describes responsibility boundaries and topology.
- `contracts/` contains machine-readable schemas for protocol artifacts.
- `examples/` contains canonical payload examples.
- `invariants/` records rules that implementations must preserve.

## Rule

If `simple-l1`, `sovereign-host`, or the Sovereign Coolify runtime use the same term, they must use the same semantics.

Implementation details may differ. Contract meaning must not drift.
