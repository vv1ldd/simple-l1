# Identity Proof Contract Pack

`identity-proof` defines the stable application-facing identity ABI for SL1
Connect.

This pack is governed by the normative SL1E review gates in
`../sl1e-core-laws.md`.

Applications trust `IdentityProofEnvelope`, not authentication mechanisms. Native
passkeys, browser WebAuthn, local dev runtimes, and future identity executors are
internal Identity Layer implementations behind this contract.

## Layers

- `schema/` contains structural JSON Schema validation.
- `invariants/` contains frozen protocol rules, domains, and failure taxonomy.
- `fixtures/` contains deterministic conformance scenarios.

## Version Boundary

`identity-proof-v1` is frozen by semantics, not just field shape. Changing the
meaning of a field requires a new version even if JSON Schema would still pass.

## Core Boundary

`authorization_code` is a transient rendezvous capability. It carries no identity
semantics. `IdentityProofEnvelope` is the first application-trustable identity
object.

Raw WebAuthn, credential, and internal authentication artifacts must never cross
into application space.
