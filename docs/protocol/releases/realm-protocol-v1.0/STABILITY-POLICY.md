# Realm Protocol v1 Stability Policy

Status: normative policy

This policy defines what Realm Protocol v1.x promises to implementations and operators. It does not add new protocol semantics. It freezes the compatibility guarantees already defined by the Realm Protocol v1 specification, schemas, profiles, vectors, manifest, and compliance matrix.

## Scope

This policy applies to Realm Protocol v1.x releases.

For v1.x, the following are stable:

- semantic anchor meaning for `anchor_schema: 1`
- canonical accepted history interpretation
- canonical history hash material and hash-chain verification
- Core rejection semantics for normative negative vectors
- Core conformance corpus layout
- protocol manifest structure
- compatibility level names: `semantic`, `evidence`, `operational`

## Stable Semantic Anchors

For Protocol v1.x, the meaning of the required `anchor_schema: 1` fields is stable:

```text
anchor_schema
history_head
projection_hash
current_authority
last_sequence
canonical_event_count
authority_subjects
```

An implementation that derives different required semantic anchors from the same accepted history is not v1 Core conformant.

Adding optional diagnostic fields is allowed only if existing required fields keep the same meaning. Changing, removing, or reinterpreting a required anchor field requires a new anchor schema version.

## Stable Rejection Semantics

For Protocol v1.x, normative negative vectors remain stable. Implementations must continue to reject invalid histories, proposals, signatures, and authority transitions represented in the v1 corpus.

New negative vectors may be added in a v1.x release only when they clarify existing v1 semantics. A vector that requires reinterpretation of previously valid accepted history requires Protocol v2.

## Stable History Encoding

For Protocol v1.x, canonical history hash material is stable. In particular, Realm event hashes are derived from:

```text
type
version
sequence
signer
authority_reference
payload
previous_event_hash
```

Timestamps, runtime metadata, deployment state, artifact provenance, snapshots, attestations, and evidence exports do not create or alter accepted history meaning.

Any change that makes existing accepted v1 history replay to different required semantic anchors requires Protocol v2.

## Compatible v1.x Changes

The following changes are compatible with Protocol v1.x when they preserve Core semantic anchors and rejection results:

- adding non-normative examples
- adding optional diagnostics
- adding implementation-specific tests outside the normative corpus
- adding performance, stress, fuzz, or large-history corpora marked non-normative
- clarifying specification text without changing required behavior
- adding new implementations to the compliance matrix
- adding new conformance proof commands
- adding operational guidance that does not affect accepted history meaning

## Changes Requiring v2

The following changes require Protocol v2:

- changing required semantic anchor meaning
- changing canonical history hash material
- accepting a history or proposal that v1 requires rejecting
- rejecting an accepted canonical v1 vector
- silently treating unsupported event versions as compatible
- allowing runtime trust, deployment state, provenance, snapshot state, or operational status to create Realm authority
- requiring existing v1 accepted histories to replay to different required anchors

## Version Governance

Protocol version and anchor schema version are separate:

```text
Protocol v1.x + Anchor Schema 1
Protocol v1.x + Anchor Schema 2
Protocol v2.x + Anchor Schema 2
```

A new anchor schema version may appear within v1.x only when v1 Core conformance over `anchor_schema: 1` remains valid. If the old anchors cannot remain valid for existing accepted history, the change is Protocol v2.

## Release Immutability

Published release packages under `docs/protocol/releases/` are immutable. After publication, a release package directory must not be edited in place.

Any content change requires a new release package and a new package fingerprint:

```text
v1.0    -> initial stable standard candidate
v1.0.1  -> editorial, metadata, or tooling correction with no semantic change
v1.1    -> backward-compatible addition under this stability policy
v2.0    -> semantic evolution requiring new protocol governance
```

The release identity is the pair of release name and package fingerprint. The directory name alone is not sufficient to identify a published standard.

## Compatibility Claims

An implementation may claim Realm Protocol v1 compatibility only for the levels it proves:

```text
Semantic      -> same meaning from same accepted history
Evidence      -> same proof material from same accepted history
Operational   -> full operational lifecycle support
```

Compatibility claims must cite the protocol version, profile, anchor schema, implementation, and proof result.
