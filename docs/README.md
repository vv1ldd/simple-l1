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
- Identity issuance and client authentication model (ADR-0059) for issuer vs client Connect responsibilities.
- Policy decision and domain projection boundary (ADR-0060) for truth vs policy vs local authorization decisions.
- Authentication adapter boundary (ADR-0061) for replacing passkeys or future credential mechanisms without reissuing identity.
- Vault ownership boundary (ADR-0062) for entity-owned portable personal vault and encrypted storage representations.
- Identity realm and realm state boundary (ADR-0063) for durable realm state, event-log recovery, and replaceable issuer runtime.
- Identity key hierarchy boundary (ADR-0064) for authority lifecycle, recovery continuity, and root/device/session authority roles.
- Realm event vs domain event boundary (ADR-0065) for separating identity realm evolution from application domain evolution.
- Multi device synchronization boundary (ADR-0066) for event replication, authority verification, and local state reconstruction across devices.
- Federated realm trust boundary (ADR-0067) for explicit trust between authority histories across identity realms.
- Canonical state and replaceable representations (ADR-0068) for the shared platform pattern across realm, authority, event, replication, and federation boundaries.
- Key hierarchy implementation boundary (ADR-0069) for materializing authority lifecycle through events, validators, and projections without making keys identity.
- Recovery ceremony protocol (ADR-0070) for restoring authority continuity through validated realm events rather than key or backup restoration.
- Device event submission protocol (ADR-0071) for proposing realm mutations through validated event proposals rather than direct state writes.

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
