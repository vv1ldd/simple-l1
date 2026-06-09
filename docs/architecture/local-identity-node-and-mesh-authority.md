# Local Identity Node and Mesh Authority

## Status

Core protocol specification.

This document is authority protocol evolution. It is intentionally separate from
Truth Pipeline v0 Layer A/B/C artifacts and does not expand execution,
reconciliation, or ownership semantics in those layers.

## Core Law

```text
Distributed identity state is allowed.
Distributed unilateral permission is forbidden.
```

Devices MAY share identity state observations. Devices MUST NOT issue unilateral
authorization grants. Authority MAY be centralized or quorum-based depending on
explicit policy. Applications MUST consume only validated authority grants.

## Identity Model

Simple L1 identity separates stable subjects from controller keys:

- `entity_l1_address`: stable subject identity.
- `key_l1_address`: controller key identity.
- controller binding: evidence that a controller key is bound to a subject.
- state proof: evidence that a state view was observed at a specific epoch.
- authority grant: permission for one intent under policy.

Bindings and observations are identity state. They are not permissions.

## Separation Of Concerns

```text
State      = observed state
Authority  = policy decision
Decision   = application execution
```

Local nodes compute, cache, and exchange state. Authority layers decide whether a
specific intent is allowed. Applications execute only after consuming a validated
authority grant.

## Local Identity Node

A local identity node is an execution runtime and mesh cache. It is not an
authority source.

It MAY:

- execute WebAuthn or other local credential ceremonies;
- construct SL1E proof material;
- cache controller bindings;
- cache identity state observations;
- cache revocation observations;
- estimate freshness;
- prepare authority requests;
- attach relevant observations to authority requests;
- route `simplel1://authorize` requests.

It MUST NOT:

- issue authorization grants by itself;
- decide final access for an application intent;
- convert cached state into permission;
- override provider revocation;
- treat local freshness as canonical authority;
- become the source of truth for global policy.

## IdentityStateEnvelope

Devices exchange signed observations, not capability tokens.

```json
{
  "schema_version": "simple-l1.identity_state_envelope.v1",
  "entity_l1_address": "sl1e_...",
  "device_key_l1_address": "sl1_...",
  "sequence": 42,
  "previous_state_hash": "sha256:...",
  "state_hash": "sha256:...",
  "issued_at": "2026-06-06T16:00:00Z",
  "expires_at": "2026-06-06T16:10:00Z",
  "observed_epoch": 7,
  "controller_bindings": [],
  "revocation_observations": [],
  "provider_state_proof": null,
  "signature": {
    "algorithm": "p256-sha256-der",
    "signed_by_key_l1_address": "sl1_...",
    "value": "base64url..."
  }
}
```

An envelope means:

```text
device key sl1_X observed identity state for entity sl1e_Y at epoch N
```

It does not mean:

```text
an application action is allowed
```

## Sync Layer

The envelope format is transport neutral. It may move through:

- LAN gossip;
- QR handoff;
- provider relay mailbox;
- encrypted cloud sync;
- manual export/import;
- push-notification wake-up;
- device-to-device local transport.

Transport does not change semantics. Sync moves observations, not authority.

## Merge Rules

Local merge rules are conservative:

- valid signature is required before import;
- known or provider-verifiable controller binding is required before trust;
- monotonic sequence wins for the same device key;
- provider state proof overrides local cache;
- revocation overrides stale allow observations;
- expired observations become hints only;
- conflict creates uncertainty, not permission escalation;
- unknown issuer metadata must be quarantined until verified.

The local node may keep multiple conflicting observations. It must not resolve a
conflict by granting authority. Canonical resolution belongs to the authority
layer.

## Authority Modes

### Provider Authority

Default mode.

```text
Application intent
  -> local node prepares request
  -> SL1 Provider validates state, freshness, revocation, and policy
  -> provider issues authorization_code or normalized proof
  -> application consumes grant
```

Use for high-risk, global, irreversible, administrative, recovery, grant,
payment, and cross-entity actions.

### Local Quorum Authority

Restricted degraded mode.

```text
Application intent
  -> local node broadcasts exact intent hash
  -> N trusted devices sign the same intent
  -> local quorum policy validates signatures and freshness
  -> local_authority_grant is created
  -> later provider reconciliation audits the grant
```

This mode is allowed only when policy explicitly permits it. A single device
must never mint a quorum grant.

### Deferred Reconciliation

Audit mode for low-risk or reversible actions.

The local node may allow a constrained action under explicit policy, record all
evidence, and reconcile with the provider later. Reconciliation failure must be
observable and reversible where possible.

## Risk Policy

| Intent class | Authority mode |
| --- | --- |
| Local-only, reversible, low value | Local quorum or deferred reconciliation MAY be allowed |
| Vault display or local unlock | Provider authority SHOULD be default; local quorum MAY be policy-bound |
| Marketplace login | Provider authority REQUIRED unless explicit local quorum login policy exists |
| Offer signing | Provider authority REQUIRED |
| Ops admin | Strict provider authority REQUIRED |
| Grant creation or revocation | Strict provider authority REQUIRED |
| Recovery or key rotation | Strict provider authority REQUIRED |
| Payouts, settlement, irreversible finance | Strict provider authority REQUIRED |

## Forbidden Behavior

Implementations MUST NOT:

- let one device issue an authorization grant;
- treat mesh cache as a permission database;
- treat controller binding existence as action approval;
- treat stale state as fresh authority;
- bypass provider revocation with local cache;
- allow applications to consume raw state observations as grants;
- use credential type as application authorization logic;
- let offline mode broaden authority.

## Guardrails

Protocol and client implementations should enforce:

- no application access path consumes `IdentityStateEnvelope` as permission;
- no local authorization issuance path exists outside explicit quorum policy;
- no state-cache-to-access conversion;
- no credential-derived permission logic in application layer;
- no single-device local grant for high-risk intents;
- tests for provider-only intent classes;
- tests for local quorum requiring the exact same intent hash;
- tests that revocation beats stale local observations.

## Machine-Checkable Conformance

This specification is backed by executable artifacts:

- `docs/contracts/identity-mesh/schema/` defines structural JSON Schema
  validation.
- `docs/contracts/identity-mesh/invariants/ruleset-v1.json` defines the frozen
  `identity-mesh-v1` invariant taxonomy.
- `docs/contracts/identity-mesh/fixtures/conformance-v1.json` defines scenario
  fixtures for merge and authority-boundary behavior.
- `node/scripts/test-identity-mesh-conformance.js` validates schema conformance
  and semantic safety cases as a registered contract extension pack.
- `npm run identity-mesh:check` runs the focused conformance suite from
  `node/`; CI uses the single `npm run contracts:validate` entrypoint.

The conformance layer must prove:

- an `IdentityStateEnvelope` is an observation, not a grant;
- merge rules are deterministic;
- revocation beats stale local observations;
- provider state dominates local cache;
- local quorum requires the exact same intent hash;
- provider-only intent classes reject local quorum.

Failures are categorized as:

- `SCHEMA_ERROR`;
- `INVARIANT_VIOLATION`;
- `QUORUM_MISMATCH`;
- `AUTHORITY_LEAK_DETECTED`;
- `RULESET_VERSION_ERROR`.

## Summary

```text
Local Nodes:
  state + execution + mesh

SL1 Provider:
  authority + revocation + policy

Optional Quorum:
  constrained authority under explicit policy

Applications:
  consume authority only
```

State observations can be distributed. Authority must be constrained. Decisions
must be explicit.
