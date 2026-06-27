# ADR-0073: Event Schema Evolution

Status: Accepted

This ADR defines how canonical Realm Event formats may evolve without
rewriting historical logs, breaking hash chains, or creating a second path to
state.

ADR-0068 froze the rule that canonical state is defined by validated history,
not by storage representations. ADR-0069 through ADR-0072 implemented the
runtime kernel and its first consumers. ADR-0073 begins the hardening series by
protecting the most valuable asset in the system: existing identity histories.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss?
ADR-0071 answers: How does an active device submit authorized mutations?
ADR-0072 answers: How is external authority acceptance implemented as local policy?
ADR-0073 answers: How may event contracts evolve without rewriting history?
```

## Acceptance Criteria

ADR-0073 is accepted when the following hardening boundaries are frozen:

```text
event_format_may_evolve
event_meaning_must_remain_replayable
historical_event_bytes_remain_immutable
hash_chain_is_not_rewritten_by_migration
schema_migration_is_interpretation_not_mutation
old_history_replays_under_current_runtime
compatibility_adapters_are_explicit
projection_version_is_versioned_separately_from_payload_version
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Event format may evolve.
Event meaning must remain replayable.

Historical event bytes are immutable.
Migration is interpretation, not mutation.
```

Guardrail for the hardening series:

```text
Growth must not create a second path to state.
```

## Context

The runtime kernel now enforces:

```text
proposal / evidence
        ↓
validation + authority policy
        ↓
accepted Realm Event
        ↓
canonical history
        ↓
projection
```

That model is only durable if old accepted histories remain valid under new
code. Without explicit schema evolution rules, teams will be tempted to:

- rewrite old events in storage
- recompute historical hashes
- add migration shortcuts that bypass the validator
- treat "current schema" as the source of truth instead of stored history

ADR-0073 prevents that drift.

## Questions This ADR Answers

```text
How may event payload contracts evolve?
How does replay interpret older event versions?
What must never change in stored accepted events?
How do registry contracts stay compatible with old logs?
How do we test that old histories still rebuild the same projection?
```

This ADR does **not** select transport, snapshot storage, API design, or
specific migration tooling.

## Core Boundary

Wrong model:

```text
old event
        ↓
rewrite history
        ↓
new schema
```

Correct model:

```text
old event
        ↓
compatibility adapter
        ↓
current canonical contract
        ↓
same projection result
```

## Relationship to ADR-0068

ADR-0068 established:

```text
Canonical:
  Event History
  Authority Rules
  Validation Logic

Replaceable:
  CurrentAuthorityState
  Storage
  Snapshot
```

ADR-0073 extends that rule to event contract evolution:

```text
Canonical:
  accepted event bytes
  hash chain
  sequence order

Replaceable:
  current registry interpretation layer
  projection cache
  migration adapters
```

A valid projection does not prove a valid history. Schema evolution must
preserve that invariant.

## Registry Contract Shape

The Realm Event Registry remains the contract index, not the source of state.

Each canonical event contract should support explicit evolution metadata:

```json
{
  "canonicalName": "DEVICE_KEY_ISSUED",
  "version": 2,
  "payloadContract": {
    "device_id": "string",
    "public_key": "string",
    "metadata": "object"
  },
  "projectionVersion": 2,
  "migrationAdapter": "interpret_v1_payload"
}
```

Required contract fields for evolution:

```text
canonicalName
version
payloadContract
projectionVersion
validateTransition
apply
migrationAdapter (when version > 1 or legacy support exists)
```

Example evolution:

```text
DEVICE_KEY_ISSUED v1:
{
  device_id,
  public_key
}

DEVICE_KEY_ISSUED v2:
{
  device_id,
  public_key,
  metadata
}
```

Replay rule:

```text
v1 history
      +
current registry
      ↓
same CurrentAuthorityState
```

## Migration Adapter Boundary

Migration adapters are interpretation functions, not write-path mutations.

```text
stored event bytes
        ↓
migration adapter
        ↓
normalized canonical material
        ↓
current registry contract
        ↓
projection apply()
```

Adapters may:

- map legacy payload fields into current contract shape
- supply defaults for newly introduced optional fields
- interpret deprecated fields without erasing them from history

Adapters must not:

- rewrite stored events
- recompute historical `current_event_hash`
- bypass validator or authority policy
- append synthetic events to historical logs

## Hash Chain Invariant

Schema migration must not change historical hash material.

```text
canonical stored event
        |
        v
hash remains immutable
```

Hash material is derived from accepted event bytes at acceptance time. If event
meaning evolves, the evolution layer must interpret stored bytes without
mutating them.

```text
history bytes
        ↓
adapter
        ↓
current meaning
```

If a new field is introduced, it may affect future accepted events. It must not
retroactively alter the hash of already accepted events.

## Replay Compatibility Flow

```text
load old history
        ↓
verify hash chain
        ↓
apply compatibility adapters per event version
        ↓
registry validateTransition / apply
        ↓
rebuild projection
        ↓
equals expected state
```

Mandatory regression test:

```text
v1 accepted events
        |
        v
current registry
        |
        v
same CurrentAuthorityState
```

## Fixture Strategy

Historical replay fixtures are constitutional test assets, not legacy samples.

Recommended fixture layout:

```text
fixtures/
  realm-history-v1.jsonl
  realm-history-v2.jsonl
  expected-authority-state-v1.json
  expected-authority-state-v2.json
```

Each fixture set should verify:

```text
hash chain integrity
authority projection equivalence
federation trust provenance preservation
recovery continuity preservation
device/session lifecycle causality
```

Old identity histories are not "legacy data". They are constitutional history.

## Write Path vs Replay Path

Write path remains unchanged:

```text
Proposal
        ↓
Registry contract
        ↓
Validator
        ↓
Accepted Realm Event
        ↓
Hash chain append
        ↓
Projection
```

Replay path gains an explicit interpretation step:

```text
Event Log
        ↓
verify hash chain
        ↓
version adapter
        ↓
registry apply()
        ↓
projection
```

Validation is still not part of `applyEvent()` replay semantics. Compatibility
adapters are replay interpretation, not acceptance policy.

## Negative Boundaries

```text
Schema evolution must not rewrite stored event logs.
Schema evolution must not recompute historical hashes.
Schema evolution must not bypass validator or authority policy.
Schema evolution must not create a migration write path.
Projection version changes must not erase historical causality fields.
"Upgrade script" must not become a second source of truth.
```

## Relationship to Follow-Up Hardening ADRs

ADR-0073 is the first hardening ADR because it protects historical truth before
performance or transport optimizations are added.

```text
ADR-0073  Can old truth survive new code?
ADR-0074  Can large truth load faster without changing authority?
ADR-0075  Can truth move between realms safely?
ADR-0076  Can humans/apps interact without bypassing truth?
```

### ADR-0074: Snapshot Acceleration Boundary

Snapshot acceleration is valid only after replay compatibility is explicit.

```text
Event History
      |
      +----> full replay
      |
      +----> snapshot acceleration
```

Both paths must produce:

```text
same CurrentAuthorityState
```

Snapshot remains cache, never authority.

### ADR-0075: Realm Replication Transport

Transport may move evidence or accepted history. It may not decide acceptance.

```text
Transport moves evidence.
Kernel decides acceptance.
```

### ADR-0076: Command/API Surface Boundary

APIs may create commands or proposals. They may not mutate canonical state
directly.

```text
API does not perform state transitions.
API creates commands/proposals.
```

## Consequences

### Positive

- Old realm histories remain first-class constitutional assets
- Runtime upgrades do not require destructive migrations
- Registry evolution becomes explicit and testable
- Replay fixtures protect against semantic drift
- Teams can add fields and contracts without reopening truth boundaries

### Negative

- Every event evolution requires adapter design and fixture coverage
- Registry contracts become slightly more complex
- "Quick migration scripts" are architecturally discouraged
- Compatibility must be tested continuously, not assumed

## Non-Goals

- No snapshot format selection in this ADR
- No replication transport protocol in this ADR
- No HTTP/API design in this ADR
- No automatic in-place history rewriting
- No domain-event schema evolution in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be compatibility fixtures,
not new runtime capabilities:

```text
1. add historical replay fixtures for v1 accepted event logs
2. add registry migration adapter hooks
3. add replay equivalence tests against fixtures
4. only then evolve individual event contracts
```

Suggested first runtime targets:

- `realm-event-registry` migration adapter metadata
- replay-time adapter dispatch by `event.version`
- fixture-backed tests in `node/scripts/`
- explicit `projectionVersion` compatibility checks

## Summary

CRUD systems remember current values.

Realm systems remember valid causes.

ADR-0073 protects that distinction during growth:

```text
history → validation → state
```

not:

```text
state → storage rewrite
```

Event schema evolution must preserve replayable meaning, immutable historical
bytes, and the single constitutional write path through accepted Realm Events.
