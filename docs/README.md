# SL1 Semantic Contracts

This directory is the cross-repository semantic synchronization layer.

It defines shared meaning for:

- Bridge discovery evidence.
- Namespace onboarding.
- Admission boundaries.
- DNS provider boundaries.
- Observe-only federation.
- Mesh truth ownership and projection boundaries.
- Local identity node and mesh authority boundaries.
- Signed execution graph and non-semantic kernel boundaries.
- Minimal execution kernel implementation design.
- Integration and shadow-mode wiring boundaries.
- Shadow execution validation records.
- Truth pipeline readiness gates before ownership projection.
- Ownership semantics firewall for Layer A/B/C artifacts.
- Subject authority runtime boundary (ADR-0052) for RFC-0052 subject continuity.
- Authority event evaluation boundary (ADR-0053) for the deterministic truth interpreter.
- Semantic write-path classification boundary (ADR-0054) for Slice 2 shadow-mode integration.
- Observation not correction boundary (ADR-0055) for Slice 2b divergence measurement.
- Email claim and notification boundary (ADR-0056) for non-authoritative email semantics in SL1E.
- Claim history and disclosure boundary (ADR-0057) for versionable claim lifecycle.
- Claim issuance policy boundary (ADR-0058) for non-authoritative claim admission.

## Structure

- `architecture/` describes responsibility boundaries and topology.
- `contracts/` contains machine-readable schemas for protocol artifacts.
- `contracts/sl1e-core-laws.md` defines normative SL1E review gates and negative invariants.
- `contracts/identity-mesh/` contains the local identity node contract extension pack.
- `examples/` contains canonical payload examples.
- `invariants/` records rules that implementations must preserve.
- `specs/` contains contract-shaped source specs consumed by validation and compiler tooling.

## Rule

If `simple-l1`, `sovereign-host`, or the Sovereign Coolify runtime use the same term, they must use the same semantics.

Implementation details may differ. Contract meaning must not drift.
