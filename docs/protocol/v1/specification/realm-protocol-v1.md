# Realm Protocol v1

Status: Draft normative specification

Everything under `docs/protocol/v1/` is normative unless explicitly marked
informative.

Realm Protocol v1 defines the semantic contract for interpreting accepted Realm
event history. The Node runtime is one implementation of this protocol. It is
not the protocol itself.

```text
Specification
      ↓
Conformance vectors
      ↓
Implementations
```

## Core Principle

```text
Protocol conformance is defined over semantic anchors,
not implementation artifacts.
```

Two implementations are compatible when the same accepted history produces the
same protocol meaning. They do not need to share object layouts, indexes,
caches, registry internals, snapshot formats, or traversal strategies.

## Source of Truth

Realm truth is created only by accepted event history:

```text
Accepted Realm Event
        ↓
Hash-linked History
        ↓
Protocol Interpretation
        ↓
Semantic Projection
```

No runtime, release, artifact provenance, deployment state, snapshot, export,
attestation, SDK, or operational status may create Realm authority outside
accepted history.

## Normative Materials

Realm Protocol v1 is defined by:

```text
1. This specification
2. JSON schemas under docs/protocol/v1/schemas/
3. Conformance profiles under docs/protocol/v1/profiles/
4. Normative vectors under docs/protocol/v1/vectors/
5. Expected semantic anchors
6. Expected rejection results
```

Passing the Realm Protocol v1 Core Conformance Corpus is a necessary condition
for claiming **Realm Protocol v1 Core Conformant** status.

## Semantic Anchors

Anchor schema 1 is the normative semantic anchor contract for Core conformance.

```json
{
  "anchor_schema": 1,
  "history_head": "...",
  "projection_hash": "...",
  "current_authority": "...",
  "last_sequence": 2,
  "canonical_event_count": 2,
  "authority_subjects": []
}
```

Required fields:

- `anchor_schema`
- `history_head`
- `projection_hash`
- `current_authority`
- `last_sequence`
- `canonical_event_count`
- `authority_subjects`

The meaning of anchor schema 1 is frozen. Adding, removing, or changing required
anchor semantics requires a new `anchor_schema` version. Protocol versions and
anchor schema versions may evolve independently.

## Canonical Vectors

Canonical vectors define accepted histories and the semantic anchors that every
Core-conformant interpreter must derive.

Each canonical vector contains:

```text
history.jsonl
expected-anchors.json
protocol-version.json
```

Some vectors may also include `expected-state.json` for implementation
diagnostics. Compatibility is defined by semantic anchors, not by exact internal
state layout.

## Negative Vectors

Negative vectors define what must be rejected. Each negative vector contains one
of `history.jsonl`, `proposal.json`, or `signed-proposal.json`, plus
`expected-result.json`.

Rejection semantics are part of the protocol. A compatible implementation must
not only accept the same valid histories; it must reject the same invalid
histories, proposals, signatures, and authority transitions.

## Implementation Independence

An implementation may use any language, storage model, cache, replay strategy,
or internal representation if it satisfies the normative vectors.

Allowed differences:

- internal data structures
- collection ordering where anchors do not specify order
- cache and index design
- snapshot representation
- transport and SDK layout
- release and deployment tooling

Not allowed:

- different semantic anchors for the same accepted history
- silent fallback on unsupported event versions
- accepting a vector whose expected result is rejection
- rejecting a canonical vector
- mutating accepted history while interpreting it
- using release, provenance, deployment, SDK, or operational trust as authority

## Summary

Realm Protocol v1 compatibility means:

```text
same accepted history
        ↓
same semantic anchors
```

The canonical object is no longer one codebase. The canonical object is the
specification plus its normative conformance vectors.
