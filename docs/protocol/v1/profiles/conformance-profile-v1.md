# Realm Protocol v1 Conformance Profile

Status: Draft normative profile

Everything under `docs/protocol/v1/` is normative unless explicitly marked
informative.

This profile defines conformance levels for Realm Protocol v1. It separates
protocol compatibility from optional operational capabilities so independent
implementations can make precise claims.

## Compatibility Claim

An implementation may claim:

```text
Realm Protocol v1 Core Conformant
```

only if it passes the normative Core corpus:

```text
docs/protocol/v1/vectors/
```

Conformance is measured over semantic anchors and expected rejection results,
not implementation internals.

## Profile Levels

### Core

Core conformance is mandatory for claiming Realm Protocol v1 compatibility.

Core includes:

- canonical accepted history vectors
- expected semantic anchors using `anchor_schema: 1`
- hash-chain validation
- event-version rejection
- unknown-event rejection
- authority-scope rejection
- invalid-signature rejection, when signature verification is implemented

Core does not require snapshots, backup/restore, attestation exports,
deployment gates, release governance, artifact provenance, or performance
optimizations.

### Extended

Extended conformance covers derived but non-authoritative protocol surfaces:

- snapshot equivalence
- observability explanations
- integrity reports
- compliance evidence export
- attestation anchors
- SDK command surface behavior
- backup/restore evidence preservation

Extended features must not create authority. They are valid only when they
derive from accepted history and preserve Core semantic anchors.

### Operational

Operational conformance covers runtime lifecycle and production controls:

- deployment compatibility gates
- release governance
- artifact provenance
- rollback interpreter behavior
- lifecycle derivation
- multi-realm operations
- disaster recovery drills
- supply-chain evidence

Operational conformance may allow execution. It does not authorize history.

## Anchor Schema 1

Core conformance requires support for anchor schema 1.

Required fields:

```text
anchor_schema
history_head
projection_hash
current_authority
last_sequence
canonical_event_count
authority_subjects
```

Anchor schema 1 is frozen. Changing the meaning of any required field requires
a new anchor schema version.

Protocol version and anchor schema version are separate:

```text
Protocol v1 + Anchor Schema 1
Protocol v1 + Anchor Schema 2
Protocol v2 + Anchor Schema 2
```

## Corpus Layout

Normative vectors are organized by purpose:

```text
vectors/
  canonical/
  negative/
```

Optional implementation corpora should live outside the normative corpus or be
clearly marked non-normative:

```text
performance/
stress/
randomized/
fuzz/
large-history/
```

These corpora are useful for production assurance, but they do not define Realm
Protocol v1 compatibility.

## Runner Contract

A language-independent conformance runner can be as small as:

```text
read vector
        ↓
run interpreter
        ↓
derive semantic anchors or rejection result
        ↓
compare expected vector
        ↓
PASS / FAIL
```

The intended CLI shape is:

```bash
realm-conformance \
  --profile core \
  --vectors docs/protocol/v1/vectors \
  --interpreter ./realm-interpreter
```

The interpreter is an executable participant. The corpus and schemas define the
contract.

## Non-Conformance

An implementation is not Core Conformant if it:

- produces different anchors for a canonical vector
- accepts a negative vector
- rejects a canonical vector
- mutates accepted history while interpreting it
- treats unsupported versions as compatible by default
- uses release, provenance, deployment, SDK, or operational trust as authority

## Summary

Conformance levels separate independent concerns:

```text
Core         -> protocol meaning
Extended     -> derived evidence and explanations
Operational  -> runtime eligibility and production trust
```

Core conformance is the foundation. Everything else is useful only if Core
semantic anchors remain stable.
