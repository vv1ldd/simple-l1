# ADR-0076: Command API Surface Boundary

Status: Accepted

This ADR defines how humans, applications, devices, and services may request
Realm transitions without creating a direct API write path to canonical state.

ADR-0075 froze the transport boundary: verified history and evidence may move,
but transport never decides acceptance. ADR-0076 freezes the invocation
boundary: APIs and command handlers may express intent, but only accepted Realm
Events may change local truth.

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
```

## Acceptance Criteria

ADR-0076 is accepted when the following hardening boundaries are frozen:

```text
commands_express_intent
realm_events_express_accepted_transitions
apis_never_mutate_canonical_state_directly
api_cannot_append_to_event_log
api_cannot_call_projection_mutation_directly
every_command_has_validation_path
failed_command_leaves_no_canonical_mutation
same_command_history_replay_produces_same_state
authentication_identifies_caller_authority_history_decides_capability
authorization_is_evaluated_from_realm_history_not_api_session_memory
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Commands express intent.
Realm Events express accepted transitions.
APIs never mutate canonical state directly.
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0073  migration ≠ mutation
ADR-0074  snapshot ≠ history
ADR-0075  transport ≠ acceptance
ADR-0076  command ≠ mutation
```

## Context

The lower layers now enforce a single constitutional path:

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

ADR-0075 completed the lower boundary for movement of truth:

```text
ADR-0075
How does verified history move?
        ↓
ADR-0076
How do actors request transitions?
        ↓
Implementation
transport + API + commands
```

Without an explicit API and command boundary, later transport or HTTP runtime
work will be tempted to add convenient methods that directly update storage,
projection caches, or event logs. Those methods would become hidden write paths.

ADR-0076 prevents that drift.

## Questions This ADR Answers

```text
What may an API endpoint do?
What may a command handler do?
How does a command become a Realm Event proposal?
Where is authorization evaluated?
What must never be updated directly from request handlers?
How do recovery, device submission, and federation APIs fit the same boundary?
```

This ADR does **not** select HTTP routes, RPC framework, queue system,
authentication provider, or public SDK shape.

## Core Boundary

Wrong model:

```text
HTTP request
        ↓
database update
        ↓
current authority state changed
```

Correct model:

```text
API Request
        ↓
Command Handler
        ↓
Proposal / Evidence
        ↓
acceptRealmEvent()
        ↓
Accepted Realm Event
        ↓
History
        ↓
Projection
```

API request handling is an invocation surface. It is not a mutation authority.

## Authentication ≠ Authority

The API layer may authenticate:

```text
user
device
session
service credential
```

Authentication proves:

```text
who is calling
```

It does not prove:

```text
which Realm transition is allowed
```

Mandatory invariant:

```text
Authentication identifies the caller.
Authority history decides the capability.
```

An API session may carry caller identity, transport context, request metadata,
or anti-abuse state. It must not become the source of authority for Realm
mutation decisions.

Authorization must be evaluated from:

```text
accepted Realm history
current projection derived from that history
registry policy
transition validator
```

Not from:

```text
API session memory
cached user role claims
transport authentication alone
HTTP route membership
```

## Command Layer

Commands express intent. They do not change canonical state.

Examples:

```text
CreateDeviceKeyCommand
ExecuteRecoveryCommand
RecognizeRealmCommand
SubmitRealmEventCommand
```

Command flow:

```text
command
        ↓
normalize request intent
        ↓
collect evidence
        ↓
build proposal
        ↓
acceptRealmEvent()
```

Commands may:

- parse and normalize API input
- authenticate the caller
- gather request evidence
- choose a proposal type
- call existing runtime entry points that converge on `acceptRealmEvent()`
- return acceptance or rejection results

Commands must not:

- append directly to `event_log`
- mutate `CurrentAuthorityState`
- call projection `apply()` helpers directly as authority
- write accepted-event shaped objects without validation
- treat response payloads as canonical state
- bypass registry policy or transition validation

## Existing Runtime Consumers

The existing runtime layers already match the command boundary when exposed
through API surfaces:

```text
Recovery API
        ↓
executeRecoveryCeremony()
        ↓
acceptRealmEvent()
```

```text
Device API
        ↓
submitDeviceEvent()
        ↓
acceptRealmEvent()
```

```text
Federation API
        ↓
recognizeRemoteRealm()
        ↓
acceptRealmEvent()
```

ADR-0076 requires future API handlers to preserve this convergence.

## API Response Boundary

API responses are representations. They are not authority state.

Forbidden model:

```text
API response object
        ↓
becomes authority state
```

Correct model:

```text
accepted history
        ↓
projection
        ↓
response representation
```

Responses may expose:

```text
accepted event id
current projected state
validation errors
command rejection reason
snapshot metadata
transport discovery status
```

Responses must not become:

```text
canonical history
authority source
projection import artifact
trusted recovery material
federation trust proof by themselves
```

## Command Outcome Semantics

A command can produce:

```text
accepted Realm Event
rejected proposal
missing evidence request
authentication failure
transport or dependency failure before proposal
```

Only one outcome mutates canonical truth:

```text
accepted Realm Event
        ↓
append to hash-chained history
        ↓
derive projection
```

All failed command outcomes must leave canonical state unchanged.

## Mandatory Acceptance Tests

### 1. API Cannot Append to Event Log

```text
API handler
        ↓
direct event_log.push()
        ↓
forbidden
```

Any accepted event must come through the validator pipeline.

### 2. API Cannot Mutate Projection Directly

```text
API handler
        ↓
CurrentAuthorityState update
        ↓
forbidden
```

Projection changes must be derived from accepted history.

### 3. Every Command Has a Validation Path

```text
command
        ↓
proposal / evidence
        ↓
registry policy + validator
        ↓
accepted or rejected
```

No command may be implemented as a storage patch.

### 4. Failed Command Leaves No Canonical Mutation

```text
invalid command
        ↓
rejection
        ↓
event log unchanged
        ↓
projection unchanged
```

Partial API failures must not partially commit authority state.

### 5. Command History Replay Equivalence

Mandatory equivalence:

```text
accepted events produced by commands
        ↓
replay from history
=
state observed after command execution
```

Requirement:

```text
CurrentAuthorityState equality
```

### 6. Authorization Comes From Realm History

Negative test:

```text
API session says:
  caller is admin

Realm history says:
  caller has no active authority
        ↓
reject
```

Positive authority must be derivable from accepted Realm history.

### 7. Response Import Rejection

Critical negative test:

```text
previous API response says:
  device X active

local accepted history says:
  device X revoked
        ↓
response cannot restore authority
```

Response objects are replaceable representations only.

## Relationship to ADR-0075

ADR-0075 says transport is another evidence carrier:

```text
transport
        ↓
received evidence
        ↓
local validation
```

ADR-0076 says API is another intent carrier:

```text
API
        ↓
command
        ↓
proposal / evidence
        ↓
local validation
```

Together:

```text
Transport does not accept.
API does not mutate.
Realm validates.
History records.
Projection derives.
```

This makes transport runtime safe to implement after the command boundary is
frozen: transport supplies evidence, API supplies commands, and neither becomes
a second path to state.

## Full External Boundary

```text
Input
  |
  v
Command
  |
  v
Proposal / Evidence
  |
  v
Realm Validator
  |
  v
Accepted Event
  |
  v
History
  |
  v
Projection
```

## Negative Boundaries

```text
API must not append to event logs directly.
API must not mutate CurrentAuthorityState directly.
API must not call projection mutation as authority.
API must not treat authentication as Realm authority.
API must not treat response objects as authority state.
Command handlers must not write accepted-event shaped objects directly.
Command handlers must not bypass registry validation.
Failed commands must not partially commit canonical state.
Transport and API helpers must not create parallel write paths.
```

## Consequences

### Positive

- HTTP, RPC, CLI, and SDK surfaces can share one authority model
- Recovery, device submission, and federation APIs converge on existing runtime
- Authentication can evolve without changing Realm authority semantics
- Transport runtime can be implemented as evidence ingress, not a write API
- Replay equivalence remains testable at the external boundary

### Negative

- API handlers must be thin and cannot perform convenience state patches
- Command tests must assert no mutation on failure
- Authorization requires Realm-history evaluation, not only session checks
- More boilerplate is required to express request intent as command/proposal

## Non-Goals

- No HTTP route design in this ADR
- No SDK method naming in this ADR
- No authentication provider selection in this ADR
- No transport runtime implementation in this ADR
- No UI workflow design in this ADR
- No command queue or retry semantics in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should define command wrappers
around existing runtime entry points, then add transport ingestion under
ADR-0075:

```text
1. define command object shapes for recovery, device, federation, and transport intake
2. route command handlers into existing runtime consumers
3. assert handlers cannot append event logs directly
4. assert failed commands leave event log and projection unchanged
5. assert replay of command-produced events equals observed state
6. implement ADR-0075 transport ingestion as evidence-to-command/proposal flow
```

Suggested runtime targets:

- `realm-command-runtime.js`
- `handleCreateDeviceKeyCommand()`
- `handleExecuteRecoveryCommand()`
- `handleRecognizeRealmCommand()`
- `handleSubmitRealmEventCommand()`
- tests for API boundary rejection and command replay equivalence

## Summary

CRUD APIs often ask:

```text
how does this request update state?
```

Realm APIs must ask:

```text
how does this actor express intent for validation?
```

Answer:

```text
Create commands.
Build proposals.
Validate locally.
Record only accepted events.
Derive state again.
```

ADR-0076 completes the external boundary: transport moves evidence, APIs create
commands, and only accepted Realm Events mutate canonical truth.
