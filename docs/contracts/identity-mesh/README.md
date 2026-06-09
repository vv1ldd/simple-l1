# Identity Mesh Contract Pack

`identity-mesh` is a contract extension pack under the main contracts pipeline.
It is not a sibling contract system and must be executed through
`npm run contracts:validate` in CI.

This pack is governed by the normative SL1E review gates in
`../sl1e-core-laws.md`.

## Layers

- `schema/` contains structural JSON Schema validation.
- `invariants/` contains frozen protocol rules and failure taxonomy.
- `fixtures/` contains scenario fixtures evaluated against the invariant rules.

## Version Boundary

`identity-mesh-v1` is frozen. Changes that alter semantics require a new ruleset
version and fixtures instead of mutating v1 behavior in place.

## Core Boundary

State observations are not authority grants. Mesh sync must not become grant
propagation.

`identity-mesh-v1` is deny-only for authority creation. Positive authority grant
fixtures require a separate grant artifact specification and protocol-evolution
review.
