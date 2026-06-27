# ADR-0077: Observability Boundary

Status: Accepted

This ADR defines how Realm runtimes explain current authority state, command
outcomes, rejection decisions, and projection derivation without making
observability artifacts a source of truth.

ADR-0076 closed the external write boundary: APIs, devices, federation, and
transport all converge on commands, idempotency, the dispatcher, and
`acceptRealmEvent()`. ADR-0077 freezes the epistemic boundary: explanations may
describe why truth is what it is, but explanations never create truth.

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
ADR-0074 answers: How may replay be accelerated without replacing history?
ADR-0075 answers: How may verified histories move without becoming a copy?
ADR-0076 answers: How may actors request transitions without bypassing truth?
ADR-0077 answers: How may current truth be explained without becoming state?
```

## Acceptance Criteria

ADR-0077 is accepted when the following hardening boundaries are frozen:

```text
observability_explains_truth
observability_never_creates_truth
explanation_is_derived_representation
every_explanation_has_derivation_source
explanation_generated_from_history_projection_or_execution_records_only
removing_explanation_artifacts_does_not_change_state
explanation_cannot_be_imported_as_state
same_event_history_produces_same_explanation
rejection_explanation_preserves_validator_reason_codes
command_lineage_references_execution_records_not_canonical_history
corrupted_observability_data_is_ignored_or_rebuilt
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Observability explains truth.
Observability never creates truth.
```

Supporting kernel:

```text
A projection may be explained by its causally relevant history.
An explanation artifact is a derived representation.
Removing or corrupting it must not affect canonical state.
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0073  migration ≠ mutation
ADR-0074  snapshot ≠ history
ADR-0075  transport ≠ acceptance
ADR-0076  command ≠ mutation
ADR-0077  explanation ≠ state
```

## Context

The runtime now has one write path:

```text
evidence / intent
        ↓
Command Boundary
        ↓
Idempotency Layer
        ↓
Dispatcher
        ↓
Registry + Validator
        ↓
Accepted Realm Event
        ↓
Hash-linked Event History
        ↓
Derived Projection
```

Operational systems now need answers to questions such as:

```text
Why is this device active?
Why was this command rejected?
Which events caused this projection field?
Which transport delivery produced this local event?
Which command execution created this accepted event?
What was the authority chain at the time of acceptance?
```

Without an explicit observability boundary, teams will be tempted to:

- treat traces or audit views as source-of-truth records
- repair identity state by editing explanation artifacts
- infer authority from cached dashboards
- trust command execution records as canonical history
- import support-tool JSON as projection state
- overwrite rejection reason codes with friendlier but lossy messages

ADR-0077 prevents that drift.

## Questions This ADR Answers

```text
What may observability artifacts contain?
How does a projection explain its causal history?
What must every explanation cite as derivation source?
How do command lineage and rejection reasons relate to canonical history?
What happens when observability data is missing or corrupted?
Why must explanation artifacts remain replaceable?
```

This ADR does **not** select log storage, metrics backend, tracing vendor,
dashboard UI, alerting rules, or support workflow design.

## Core Boundary

Wrong model:

```text
explanation artifact
        ↓
trust
        ↓
state correction
```

Correct model:

```text
Event History
        ↓
Projection
        ↓
Explanation / Trace / Metrics
```

Observability answers:

```text
why does derived state look like this?
```

It must not answer:

```text
what should canonical state become?
```

## Relationship to ADR-0068 and ADR-0074

ADR-0068 established:

```text
Representation is not authority.
```

ADR-0074 established:

```text
Snapshot is not history.
```

ADR-0077 adds:

```text
Explanation is not state.
```

Canonical:

```text
Event History
Authority Rules
Validation Logic
```

Derived:

```text
Projection
CurrentAuthorityState
Explanation
Metrics
Trace Views
Dashboards
Support Exports
```

Derived artifacts may be useful, cached, indexed, displayed, exported, or
deleted. They must not become authority.

## Observability Runtime Shape

```text
Event History
      |
      v
Projection
      |
      +--> Authority Explanation
      |
      +--> Event Trace
      |
      +--> Command Lineage
      |
      +--> Rejection Explanation
      |
      +--> Metrics / Views
```

Each branch is derived. None is canonical.

## Derivation Source Requirement

Every explanation must have a derivation source.

Example:

```json
{
  "subject": "identity-x",
  "current_authority": "device-a",
  "derived_from": [
    {
      "event_id": "evt-001",
      "type": "ROOT_AUTHORITY_CREATED"
    },
    {
      "event_id": "evt-009",
      "type": "DEVICE_KEY_ISSUED"
    },
    {
      "event_id": "evt-015",
      "type": "RECOVERY_EXECUTED"
    }
  ],
  "projection_hash": "abc...",
  "history_head": "def..."
}
```

An explanation may cite:

```text
accepted event ids
event types
event sequence numbers
current_event_hash values
history head
projection hash
validator reason codes
command_id
transport delivery id
snapshot verification metadata
```

An explanation must not invent causality absent from:

```text
accepted history
derived projection
command execution records
validation result
transport evidence metadata
```

## Authority Explanation

Authority explanations answer:

```text
Why may this actor perform this transition?
Why is this authority currently active or revoked?
Which events caused this capability?
```

Example causal answer:

```text
ROOT_AUTHORITY_CREATED
        ↓
RECOVERY_AUTHORITY_ISSUED
        ↓
RECOVERY_EXECUTED
        ↓
DEVICE_KEY_ISSUED
        ↓
old DEVICE_KEY_REVOKED
        ↓
current device authority active
```

Not:

```text
devices[id].status = active
        ↓
therefore authority exists
```

A status field is an observation. Causality comes from history.

## Event Trace

Event traces are ordered views over accepted Realm Events.

They may include:

```text
event_id
sequence
type
signer
authority_reference
previous_event_hash
current_event_hash
accepted_at
projection field effects
```

They must not:

```text
rewrite historical event bytes
recompute canonical hashes
fill missing events
insert synthetic events into Realm history
hide causally relevant events from explanation
```

## Command Lineage

Command lineage explains ingress:

```text
API request / device submission / federation evidence / transport delivery
        ↓
command_id
        ↓
execution result
        ↓
accepted_event_ids
```

Command execution records are operational artifacts.

They may explain:

```text
which command produced this accepted event
whether an execution was idempotent replay
which delivery/request/session supplied evidence
```

They must not become:

```text
canonical event history
authority source
projection source
replay input
```

If command execution records are lost, canonical state remains replayable from
Realm Event History. The system loses some lineage context, not identity truth.

## Rejection Explanation

Rejected proposals and commands should preserve validator reason codes.

Example:

```json
{
  "ok": false,
  "reason_codes": [
    "AUTHORITY_TRANSITION_DENIED"
  ],
  "explanation": {
    "summary": "Signer is not authorized by current Realm history.",
    "derived_from": {
      "validator": "validateRealmEventProposal",
      "history_head": "def..."
    }
  }
}
```

Human-readable messages may be added, but they must not erase or replace the
machine reason codes produced by the validator.

## Projection Hash

Explanations may include a projection hash to bind a view to the derived state
it explains.

Recommended semantics:

```text
projection_hash = hash(canonical encoded derived projection)
history_head = latest accepted Realm Event hash
```

The hash helps detect stale or mismatched explanations. It does not make the
explanation authoritative.

## Mandatory Acceptance Tests

### 1. Explanation Is Generated From History / Projection Only

```text
event history
        ↓
projection
        ↓
explanation
```

No explanation may require imported state absent from canonical history or
operational execution records.

### 2. Removing Explanation Artifacts Does Not Change State

```text
delete explanation cache
        ↓
rebuild explanation from history/projection
        ↓
same CurrentAuthorityState
```

Deleting observability data may reduce support context. It must not alter
identity meaning.

### 3. Explanation Cannot Be Imported As State

Critical negative test:

```text
explanation says:
  device X active

event history says:
  device X revoked
        ↓
ignore explanation for state
```

### 4. Same Event History Produces Same Explanation

Mandatory equivalence:

```text
same accepted event log
        ↓
same projection
        ↓
same deterministic explanation
```

Requirement:

```text
event trace equality
history_head equality
projection_hash equality
derived_from equality
```

### 5. Rejection Explanation Preserves Validator Reason Codes

```text
validator result:
  AUTHORITY_TRANSITION_DENIED
        ↓
explanation:
  includes AUTHORITY_TRANSITION_DENIED
```

Human summaries may enrich reason codes. They must not replace them.

### 6. Command Lineage References Execution Records, Not Canonical History

```text
command_id
        ↓
execution_result
        ↓
accepted_event_ids
```

Lineage may point to accepted events. It must not define accepted events.

### 7. Corrupted Observability Data Is Ignored Or Rebuilt

```text
corrupted trace cache
        ↓
discard/rebuild from history
        ↓
state unchanged
```

Corrupted observability data must not partially commit projection state.

## Negative Boundaries

```text
Explanation must not become CurrentAuthorityState.
Explanation must not append to Event History.
Explanation must not rewrite historical event bytes.
Explanation must not recompute canonical event hashes.
Explanation must not grant authority.
Explanation must not replace validator reason codes.
Explanation must not hide causally relevant accepted events.
Metrics must not become policy input unless represented as accepted Realm Events.
Dashboards must not become repair tools for canonical state.
Support exports must not be imported as authority.
Command lineage must not become canonical history.
```

## Relationship to Operational Tooling

ADR-0077 enables:

```text
dashboards
audit UI
support workflows
debug traces
operator explanations
compliance exports
metrics and alerts
```

These tools are consumers of explanation models.

They may help operators understand:

```text
why state exists
why a command failed
which event caused a capability
which command or delivery introduced an event
```

They must not become mutation surfaces.

## Consequences

### Positive

- Current authority state becomes explainable by causality, not lookup alone
- Support tooling can answer why questions without touching canonical state
- Rejection reasons remain machine-testable and human-readable
- Command lineage preserves ingress context without replacing history
- Observability caches can be deleted or rebuilt safely

### Negative

- Explanation generation must stay deterministic
- Trace caches need invalidation or derivation metadata
- Support tools must resist repair-by-edit workflows
- Operators may need both canonical event views and friendly explanations

## Non-Goals

- No logging backend selection in this ADR
- No tracing vendor or metrics platform selection in this ADR
- No dashboard design in this ADR
- No alerting policy in this ADR
- No support workflow implementation in this ADR
- No new mutation path for repair tools in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should derive explanations from
existing history, projection, validator results, and command execution records:

```text
1. add deterministic projection hashing helper
2. add event trace builder over accepted Realm history
3. add current authority explanation helper
4. add subject authority explanation helper
5. add command execution lineage explanation helper
6. add rejection explanation helper preserving reason_codes
7. add negative tests for explanation import/corruption
```

Suggested runtime targets:

- `realm-observability.js`
- `explainCurrentAuthorityState()`
- `explainAuthorityForSubject()`
- `explainCommandExecution()`
- `explainRejection()`
- `buildEventTrace()`
- `calculateProjectionHash()`

## Summary

CRUD systems often explain current state by reading current rows.

Realm systems explain current state by citing valid causes:

```text
history
  ↓
projection
  ↓
explanation
```

ADR-0077 completes the epistemic boundary:

```text
Where is truth?              Event History.
Who changes truth?           Authority from history.
What belongs to truth?       Realm Events.
How does truth move?         Evidence transport.
How is truth invoked?        Commands.
How is truth explained?      Derived observability.
```

Observability explains truth. Observability never creates truth.
