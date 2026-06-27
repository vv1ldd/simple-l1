# ADR-0075: Realm Replication Transport

Status: Accepted

This ADR defines how verified Realm histories and evidence may move between
Realm instances without creating a second path to state through state import,
transport shortcuts, or remote projection trust.

ADR-0066 froze multi-device continuity as event replication, not state sync.
ADR-0067 froze federation as trust between authority histories. ADR-0074 froze
snapshots as replaceable acceleration artifacts. ADR-0075 extends the
hardening series to transport and replication boundaries.

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
```

## Acceptance Criteria

ADR-0075 is accepted when the following hardening boundaries are frozen:

```text
transport_carries_evidence_not_authority
received_is_not_accepted
transported_events_must_preserve_hash_chain_continuity
transport_cannot_bypass_local_validation
remote_signature_validity_does_not_imply_local_acceptance
snapshot_over_transport_remains_cache_only
replay_after_transport_equals_direct_local_replay
remote_current_authority_state_cannot_become_local_truth
federation_evidence_remains_distinct_from_local_acceptance
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Transport carries evidence.
Realm validates authority.
Only accepted Realm Events become local truth.
```

Hardening series guardrails:

```text
ADR-0068  representation ≠ authority
ADR-0073  migration ≠ mutation
ADR-0074  snapshot ≠ history
ADR-0075  transport ≠ acceptance
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

That model must remain intact when histories move between Realm instances,
devices, or federation peers.

Without explicit transport rules, teams will be tempted to:

- replicate `CurrentAuthorityState` directly
- treat received events as accepted events
- trust remote snapshots without local verification
- use transport success as authority success
- import remote state to "catch up" faster
- merge remote and local histories without local policy

ADR-0075 prevents that drift.

## Questions This ADR Answers

```text
What may transport carry between Realm instances?
What must never be transported as authority?
How does a receiving Realm distinguish received from accepted?
How do transported event batches preserve hash continuity?
How do snapshots and federation evidence fit into transport?
How does transport relate to ADR-0066 and ADR-0072?
```

This ADR does **not** select wire protocol, gossip algorithm, queue system,
WebSocket framing, or API design.

## Core Boundary

Wrong model:

```text
Remote Realm
        ↓
send CurrentAuthorityState
        ↓
local truth updated
```

Correct model:

```text
Remote Realm
        ↓
send verified history / evidence
        ↓
local hash + policy validation
        ↓
accepted Realm Events
        ↓
local projection rebuilt
```

## Relationship to ADR-0066, ADR-0067, and ADR-0074

ADR-0066 established:

```text
Replicas consume authorized events.
State is never synced as authority.
```

ADR-0067 established:

```text
Federation trusts verified authority histories,
not remote assertions.
```

ADR-0074 established:

```text
Snapshot accelerates replay.
Snapshot never replaces history.
```

ADR-0075 unifies them at the transport layer:

```text
ADR-0066  replicas consume authorized events
ADR-0067  trust external authority histories
ADR-0074  snapshot is cache
ADR-0075  history/evidence movement
```

## Received ≠ Accepted

The most important transport distinction:

```text
Received ≠ Accepted
```

Flow:

```text
Remote transport
        ↓
Received Event / Evidence
        ↓
Hash continuity check
        ↓
Local validator
        ↓
Accepted Realm Event
        ↓
Local Event History
        ↓
Projection
```

Delivery alone changes nothing.

A valid remote signature may prove:

```text
who signed
```

It does not prove:

```text
who may mutate this local Realm
```

Local authority policy decides acceptance.

## Allowed Transport Objects

### Event Batches

```json
{
  "events": [],
  "previous_event_hash": "abc...",
  "head_hash": "def..."
}
```

Semantics:

```text
here is a hash-linked segment of history
```

Not:

```text
here is current truth
```

### Event Head Announcements

```text
I have history until hash X
```

Use:

```text
discovery / catch-up coordination
```

Not:

```text
trust establishment
```

Announcement locates history. It does not establish authority.

### Missing History Requests

```text
give me events after hash X
```

Use:

```text
gap fill for verified history replication
```

### Optional Snapshots

```text
snapshot + verification metadata
```

Allowed only under ADR-0074 rules:

```text
snapshot travels
authority does not
```

A transported snapshot must still be verified locally against event history
before acceleration.

### Federation Evidence Bundles

Under ADR-0072, a remote Realm may provide:

```text
remote event log
remote authority projection evidence
policy-relevant metadata
```

But local acceptance still requires:

```text
evaluate policy
        ↓
create local trust proposal
        ↓
acceptRealmEvent()
```

## Forbidden Transport Paths

The following are forbidden:

```text
Remote CurrentAuthorityState
        ↓
local CurrentAuthorityState
```

```text
remote snapshot
        ↓
trusted without verification
        ↓
local authority
```

```text
received event batch
        ↓
append without validation
        ↓
local truth
```

```text
transport success
        ↓
implicit trust
```

These create a second path:

```text
state import
      |
      X
      |
event history
```

The constitutional model remains:

```text
history first
projection second
```

## Transport Flow

### Local Replica Catch-Up

```text
announce head hash
        ↓
request missing events
        ↓
receive event batch
        ↓
verify chain continuity
        ↓
validate each proposal/event
        ↓
accept into local history
        ↓
replay / snapshot acceleration
        ↓
CurrentAuthorityState
```

### Federation Evidence Intake

```text
receive remote evidence bundle
        ↓
verify remote history
        ↓
evaluate local federation policy
        ↓
create local federation trust proposal
        ↓
acceptRealmEvent()
        ↓
local federation projection updated
```

Transport delivers evidence. Local Realm decides.

## Mandatory Acceptance Tests

### 1. Chain Preservation

```text
received batch
+
local previous head
=
continuous history
```

Otherwise:

```text
TRANSPORT_HISTORY_GAP
```

### 2. Validation Cannot Be Bypassed

Even if:

```text
remote event signature is valid
```

local acceptance still requires:

```text
registry policy
authority transition validation
sequence validation
hash continuity
```

Valid signature proves signer identity, not local mutation rights.

### 3. Snapshot Remains Cache

```text
receive remote snapshot
        ↓
verify against local or transported history
        ↓
delete snapshot
        ↓
same local truth from event history
```

Snapshot over transport changes performance only, not meaning.

### 4. Replay Equivalence

Mandatory equivalence:

```text
transported events
        ↓
local acceptance
        ↓
replay
=
direct local replay
```

Requirement:

```text
CurrentAuthorityState equality
```

### 5. Federation Compatibility

ADR-0072 remains in force:

```text
remote evidence
        ↓
local policy evaluation
        ↓
local accepted trust event
        ↓
local projection
```

Remote Realm evidence never becomes local truth without local acceptance.

### 6. Authority Injection Rejection

Critical negative test:

```text
transported snapshot/projection says:
  device X active

local accepted history says:
  device X never issued
        ↓
reject
```

Transport cannot create authority absent from locally accepted history.

## Negative Boundaries

```text
Transport must not import remote CurrentAuthorityState as local truth.
Transport must not treat received events as accepted events.
Transport must not bypass local validator or authority policy.
Transport must not establish trust by discovery or reachability alone.
Transport must not merge remote and local histories without local acceptance.
Transport must not rewrite historical event bytes.
Transport must not use snapshot as authority channel.
Transport success must not imply local acceptance.
```

## Relationship to ADR-0076

ADR-0075 defines how truth may move.

ADR-0076 will define how humans and applications invoke transitions without
bypassing truth:

```text
API does not perform state transitions.
API creates commands/proposals.
```

Transport is infrastructure. API is invocation surface. Neither may become a
second mutation path.

## Consequences

### Positive

- Replication can scale without state-import shortcuts
- Multi-device sync remains constitutional under ADR-0066
- Federation evidence transport aligns with ADR-0072
- Snapshots can accelerate catch-up without becoming authority
- Remote and local Realm instances remain independently verifiable

### Negative

- Transport requires explicit gap detection and chain verification
- Catch-up logic must remain separate from acceptance logic
- Operators cannot "sync state" to fix identity drift
- More tests are required for replay equivalence across transport paths

## Non-Goals

- No wire protocol selection in this ADR
- No gossip/WebSocket/queue design in this ADR
- No API/UI design in this ADR
- No cross-realm history merge in this ADR
- No transport-level trust policy in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be transport evidence
verification helpers and equivalence tests, not new authority mechanisms:

```text
1. define transport batch / head / gap-request shapes
2. add chain continuity verification for received batches
3. route received events through existing acceptRealmEvent pipeline
4. reject remote projection/state import paths
5. add replay equivalence tests for transported accepted history
```

Suggested runtime targets:

- `realm-replication-transport.js`
- `verifyTransportBatchContinuity()`
- `ingestTransportedEvents()` as evidence ingress only
- tests for `TRANSPORT_HISTORY_GAP`, authority injection rejection, replay equivalence

## Summary

CRUD replication asks:

```text
how do we copy current state?
```

Realm replication asks:

```text
how does truth move without becoming a copy?
```

Answer:

```text
Move history.
Verify locally.
Derive state again.
```

ADR-0075 does not add a new source of truth. It protects the existing one while
verified histories move between Realm instances.
