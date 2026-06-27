# Realm Protocol v1 Conformance Profile

Status: Draft normative profile

This profile defines the conformance levels for Realm Protocol v1. It separates
protocol compatibility from optional operational capabilities so independent
implementations can make precise claims.

## Compatibility Claim

An implementation may claim:

```text
Realm Protocol v1 Core Conformant
```

only if it passes the normative Core corpus:

```text
node/fixtures/realm-conformance/v1/
```

Conformance is measured over semantic anchors and expected rejection results,
not implementation internals.

## Profile Levels

### Core

Core conformance is mandatory for claiming Realm Protocol v1 compatibility.

Core proves:

```text
accepted history
        ↓
same semantic anchors
```

Core includes:

- canonical accepted history vectors
- expected semantic anchors using `anchor_schema: 1`
- hash-chain validation
- event-version rejection
- unknown-event rejection
- authority-scope rejection
- invalid-signature rejection, when signature verification is implemented

Core does not require:

- snapshots
- backup/restore
- attestation exports
- deployment gates
- release governance
- artifact provenance
- performance optimizations

A minimal interpreter in Rust, Go, Swift, WASM, or another language can be Core
Conformant without implementing the full operational stack.

### Extended

Extended conformance covers derived but non-authoritative protocol surfaces.

Extended may include:

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

Operational conformance covers runtime lifecycle and production controls.

Operational may include:

- deployment compatibility gates
- release governance
- artifact provenance
- rollback interpreter behavior
- lifecycle derivation
- multi-realm operations
- disaster recovery drills
- supply-chain evidence

Operational conformance may allow execution. It does not authorize history.

```text
Runtime trust
        ↓
execution eligibility

Runtime trust
        ↓
not authority
```

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

This allows anchor evolution without silently changing old conformance vectors.

## Corpus Layout

Normative vectors are organized by purpose:

```text
realm-conformance/
  v1/
    canonical/
      authority-basic/
        history.jsonl
        expected-anchors.json
        protocol-version.json
    negative/
      hash-chain-broken/
        history.jsonl
        expected-result.json
      unsupported-version/
        history.jsonl
        expected-result.json
      unknown-event/
        proposal.json
        expected-result.json
      authority-scope-violation/
        proposal.json
        expected-result.json
      invalid-signature/
        signed-proposal.json
        expected-result.json
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

## Negative Result Schema

Negative vectors use `expected-result.json`:

```json
{
  "result_schema": 1,
  "accepted": false,
  "reason": "REALM_EVENT_CHAIN_BROKEN",
  "runtime_reason_aliases": []
}
```

`reason` is the normative rejection class. `runtime_reason_aliases` may map the
normative class to implementation-specific diagnostics while preserving the
same protocol meaning.

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

The runner must not require the Node runtime. The Node tests are the first
implementation of the runner, not the definition of the protocol.

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
