# SL1 Protocol v0 RC Freeze

## Status

This document freezes the SL1 Protocol v0 release-candidate surface.

SL1 v0 is defined by conformance, not by implementation intent. A runtime is SL1-v0 compatible only when it produces the expected canonical bytes, hashes, verifier verdicts, and failure codes for the frozen golden vectors.

## Scope

SL1 Protocol v0 defines the following normative surfaces:

- Identity state machine
- Capability algebra
- Epoch authority model
- Wire format
- Canonical JSON serialization
- Verifier kernel
- Protocol bundle model
- Federated trust system

This RC freeze covers canonical bytes, hashes, wire object shape, verifier failure codes, and conformance behavior only. It does not define ownership, settlement, balances, custody, reconciliation truth, Layer A/B/C fixture semantics, or protocol state mutation outside the SL1 wire boundary.

No new protocol behavior is permitted inside v0 RC. Any new behavior, verifier rule, wire object, compatibility rule, or canonicalization semantic must be proposed as a new major protocol version.

## Precedence

The v0 precedence order is:

```text
golden vectors > normative specs > reference implementation > runtime ports
```

Golden vectors are specification, not tests. If a runtime disagrees with the vectors, the runtime is non-conformant.

## Implementation Tracks

### v0 Implementation Track

Allowed work:

- Reference verifier implementation
- Canonicalization implementation
- Golden vector expansion without new semantics
- Swift, Kotlin, Go, Rust, or JS ports
- Product integration of the frozen verifier behavior

Constraints:

- Must not introduce new behavior
- Must match vectors exactly
- Must preserve failure taxonomy
- Must preserve canonical byte output

### v1 Proposal Track

Allowed work:

- New capability semantics
- New wire formats
- New verifier rules
- New compatibility model
- New canonicalization behavior

Constraints:

- Must not alter v0 conformance
- Must declare a new major protocol version
- Must include new vectors and compatibility policy

## Meanly One Constraint

Meanly One is a SL1 v0 execution host, not an application-specific authorization system.

Meanly One must not add custom login authority, bypass the verifier kernel, convert sessions into identity authority, or accept proof behavior that is not represented in the frozen vectors.

## Core Invariants

- Protocol correctness is proven through vectors.
- Unknown behavior is rejected.
- Unknown major versions are rejected.
- Session state cannot escalate authority.
- State declares protocol bundle identity but does not define verifier semantics.
- Trust is local policy over immutable protocol bundles and signed state.

## First Frozen Vector Set

The initial v0 RC admission pack starts with:

- `canonicalization-basic-v1`
- `intent-valid-v1`
- `proof-valid-v1`
- `proof-replay-reject-v1`
- `proof-revoked-device-reject-v1`
- `state-stale-reject-v1`

This set is intentionally small. It establishes the conformance boundary before expanding the protocol surface.

## Closing Rule

SL1 v0 is not evolved. It is replicated.
