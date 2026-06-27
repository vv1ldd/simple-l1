# ADR-0087: Quorum Recovery Boundary

Status: Accepted

This ADR defines how multiple recovery authorities may jointly restore authority
continuity without making quorum signatures a magic override, a group-admin
escape hatch, or a source of authority outside accepted Realm Event history.

ADR-0086 established that key lifecycle records capability continuity and that
current keys are projection. ADR-0087 builds on that foundation: quorum recovery
evaluates active recovery capabilities under policy, then records successful
recovery as accepted Realm Events.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss without restoring key material?
ADR-0071 answers: How does an active device submit authorized mutations?
ADR-0072 answers: How is external authority acceptance implemented as local policy?
ADR-0073 answers: How may event contracts evolve without rewriting history?
ADR-0074 answers: How may replay be accelerated without replacing history?
ADR-0075 answers: How may verified histories move without becoming a copy?
ADR-0076 answers: How may actors request transitions without bypassing truth?
ADR-0077 answers: How may current truth be explained without becoming state?
ADR-0078 answers: How may a Realm prove its own internal consistency?
ADR-0079 answers: How should a Realm operate when integrity is verified, degraded, or failed?
ADR-0080 answers: What must be preserved to restore the same Realm after loss?
ADR-0081 answers: How may a Realm safely return to operation after disaster?
ADR-0082 answers: How may administrators operate a Realm without becoming authority?
ADR-0083 answers: How may runtime deployment change without changing truth?
ADR-0084 answers: How may many Realms be operated without merging authority domains?
ADR-0085 answers: How may history replay and storage scale without changing truth?
ADR-0086 answers: How may key lifecycle be operated without making keys identity?
ADR-0087 answers: How may quorum recovery restore continuity without creating authority?
```

## Acceptance Criteria

ADR-0087 is accepted when the following quorum recovery boundaries are frozen:

```text
quorum_restores_continuity
quorum_does_not_create_authority
quorum_evidence_is_not_authority_by_itself
recovery_policy_evaluates_history_derived_capabilities
recovery_transition_requires_accepted_realm_event
partial_signatures_remain_evidence_not_authority
revoked_key_cannot_satisfy_quorum
expired_key_cannot_satisfy_quorum
missing_participant_key_fails_closed
quorum_cannot_create_root_authority
quorum_approval_without_recovery_event_changes_nothing
same_quorum_evidence_replay_produces_same_projection
quorum_state_is_projection_not_recovery_store
recovery_quorum_metadata_is_not_authority_history
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Quorum restores continuity.
Quorum does not create authority.
```

Supporting kernel:

```text
Quorum evidence proves that policy may accept a recovery transition.
The accepted Realm Event is the transition.
```

Wrong:

```text
N signatures
        ↓
override reality
```

Correct:

```text
Recovery proposal
        ↓
Quorum evidence
        ↓
Recovery policy evaluation
        ↓
Accepted Realm Event
        ↓
Projection
```

Hardening series guardrails:

```text
ADR-0069  key != identity
ADR-0070  recovery != key restoration
ADR-0086  key lifecycle != identity lifecycle
ADR-0087  quorum != authority
```

## Context

ADR-0070 defined recovery as a governed authority transition:

```text
prove recovery authority
        ↓
validate recovery policy
        ↓
append Realm Events
        ↓
derive CurrentAuthorityState
```

ADR-0086 makes the inputs to quorum evaluation explicit:

```text
Key lifecycle
        ↓
Recovery authority continuity
        ↓
Quorum decision
```

Quorum recovery is needed when a single recovery authority is too fragile or too
powerful for production systems. But quorum must not become a group-admin bypass.

This ADR prevents:

- treating raw signatures as state transitions
- counting revoked or expired recovery keys
- creating root authority from quorum alone
- recording recovery state in a side table
- applying partial approvals as authority
- bypassing local validator policy during emergencies

## Questions This ADR Answers

```text
What is quorum evidence?
When does quorum evidence become a recovery transition?
How are participant capabilities evaluated?
What happens to partial signatures?
How does replay rebuild quorum state?
Why can quorum not create root authority?
How does quorum prepare attestation and compliance evidence?
```

This ADR does **not** select threshold signature schemes, MPC protocol,
guardian UX, cryptographic algorithms, participant discovery protocol, or social
recovery product design.

## Core Boundary

Quorum is policy evaluation over history-derived capabilities.

```text
multiple recovery authorities
        ↓
valid evidence
        ↓
threshold policy satisfied
        ↓
recovery event accepted
```

Not:

```text
3 keys
        ↓
magic admin override
```

The validator must evaluate:

```text
participant exists in history
participant authority scope is recovery-capable
participant key is active at approval time
participant key is not revoked
participant key is not expired
participant approval matches recovery proposal
threshold policy is satisfied
proposal sequence and previous head are valid
```

Only then may a recovery transition be accepted into history.

## Quorum Event Model

Minimum semantic events:

```text
RECOVERY_QUORUM_CREATED
RECOVERY_QUORUM_APPROVED
RECOVERY_EXECUTED
```

These events may be represented directly or mapped onto existing recovery event
contracts. The rule is invariant: quorum state is rebuilt from accepted events,
not from a mutable recovery store.

Example projection:

```json
{
  "recoveryQuorum": {
    "quorum_id": "quorum_123",
    "threshold": 2,
    "participants": [
      { "authority_ref": "recovery:a", "status": "approved" },
      { "authority_ref": "recovery:b", "status": "approved" },
      { "authority_ref": "recovery:c", "status": "pending" }
    ],
    "status": "executed",
    "createdEvent": "evt_100",
    "executedEvent": "evt_120"
  }
}
```

The projection explains the quorum. It does not create recovery authority.

## Quorum Evidence

Quorum evidence may include:

```text
quorum_id
recovery proposal hash
participant authority references
participant key references
participant signatures
approval timestamps
policy threshold
target authority transition
observed history head
```

Evidence must remain attributable:

```text
who approved
which key approved
which authority scope existed
which history head was observed
which proposal was approved
```

Evidence is not a Realm transition until an accepted Realm Event records it.

## Partial Signatures

Partial signatures are evidence.

```text
one of three approvals
        ↓
stored as pending evidence
        ↓
no authority change
```

Partial signatures may be:

```text
reported
explained
audited
retried
expired
discarded
```

They must not:

```text
activate new authority
revoke old authority
modify projection
mark recovery complete
```

## Participant Capability Evaluation

A participant satisfies quorum only if replayed history says the participant is
eligible at evaluation time.

Eligible:

```text
participant authority exists
participant key active
participant recovery scope present
participant not revoked
participant not expired
participant approval targets same proposal
```

Ineligible:

```text
participant only exists in key store
participant revoked in history
participant expired by accepted lifecycle event
participant missing key lifecycle record
participant approval targets different proposal
participant authority belongs to another Realm
```

Key possession is not enough. Recovery capability is history-derived.

## Recovery Execution

Quorum execution is the accepted recovery transition.

```text
threshold satisfied
        ↓
RECOVERY_EXECUTED accepted
        ↓
new authority capability projected
        ↓
old compromised / lost capability revoked as policy requires
```

The execution event must reference the quorum evidence or quorum event chain so
that the recovery remains explainable.

## No Root Creation by Quorum Alone

Quorum cannot create root authority out of nothing.

```text
quorum evidence
        ↓
ROOT_AUTHORITY_CREATED
        ↓
reject unless existing authority policy permits it
```

Quorum may restore or transition authority continuity under policy. It cannot
become a new origin of Realm identity.

## Quorum Store Boundary

Operational systems may keep a quorum workflow store:

```text
pending approvals
participant reminders
UI state
expiration timers
evidence upload status
```

But:

```text
quorum workflow store != authority history
pending approval row != recovery event
threshold counter != projection owner
```

If the workflow store is deleted, accepted recovery events remain replayable.
If no recovery event was accepted, deletion changes no authority state.

## Failure Modes

### Revoked Key Participates

```text
participant key revoked
        ↓
approval submitted
        ↓
reject
```

Expected result:

```text
QUORUM_PARTICIPANT_REVOKED
```

### Expired Key Participates

```text
participant key expired
        ↓
approval submitted
        ↓
reject
```

Expected result:

```text
QUORUM_PARTICIPANT_EXPIRED
```

### Missing Participant Key

```text
participant not found in key lifecycle projection
        ↓
fail closed
```

Expected result:

```text
QUORUM_PARTICIPANT_KEY_REQUIRED
```

### Partial Threshold

```text
threshold = 3
approvals = 2
        ↓
evidence stored / reported
        ↓
no authority transition
```

Expected result:

```text
QUORUM_THRESHOLD_NOT_MET
```

### Approval Without Recovery Event

```text
quorum approvals complete
        ↓
no RECOVERY_EXECUTED accepted
        ↓
projection unchanged
```

Expected result:

```text
RECOVERY_EVENT_REQUIRED
```

### Cross-Realm Participant

```text
participant from Realm A
        ↓
attempts quorum for Realm B
        ↓
reject unless Realm B policy explicitly recognizes that authority
```

Expected result:

```text
QUORUM_PARTICIPANT_NOT_LOCAL_AUTHORITY
```

## Mandatory Acceptance Tests

Future quorum recovery tests should prove:

### 1. Quorum Cannot Create Root Authority

```text
quorum evidence
        ↓
ROOT_AUTHORITY_CREATED
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 2. Revoked Key Cannot Satisfy Quorum

```text
participant key revoked
        ↓
approval submitted
        ↓
threshold not satisfied
```

### 3. Same Quorum Evidence Replay Gives Same State

```text
accepted quorum events
        ↓
replay
        ↓
same recoveryQuorum projection
```

### 4. Missing Participant Key Fails Closed

```text
approval from unknown participant
        ↓
reject
        ↓
no projection change
```

### 5. Approval Without Accepted Recovery Event Changes Nothing

```text
quorum approval evidence
        ↓
no RECOVERY_EXECUTED
        ↓
no authority transition
```

### 6. Partial Signatures Remain Evidence

```text
partial signatures
        ↓
audit / explanation only
        ↓
not authority
```

### 7. Quorum Store Deletion Does Not Erase Accepted Recovery

```text
delete workflow store
        ↓
replay history
        ↓
same executed recovery projection
```

## Relationship to Attestation

ADR-0087 prepares ADR-0088.

Quorum recovery creates explainable evidence:

```text
which authorities participated
which keys were active
which policy threshold was satisfied
which recovery event was accepted
which projection resulted
```

External attestation can later prove those facts without asking consumers to
trust a mutable recovery workflow store.

## Relationship to Follow-Up ADRs

Production hardening continues:

```text
ADR-0085 Replay & Storage Scaling
ADR-0086 Key Lifecycle Model
ADR-0087 Quorum Recovery
ADR-0088 Attestation Boundary
ADR-0089 Compliance Evidence Export
ADR-0090 SDK Contract
```

The common invariant remains:

```text
Scale improves access to truth.
Scale does not create new truth.
```

## Consequences

### Positive

- Quorum becomes policy evidence, not administrative override
- Revoked and expired capabilities cannot satisfy recovery
- Recovery remains replayable and explainable
- Partial approvals can be audited without changing state
- Attestation and compliance can cite accepted quorum events

### Negative

- Quorum recovery requires key lifecycle correctness
- Workflow systems cannot mark recovery complete by counter alone
- Threshold policy must be explicit and replayable
- Cross-Realm recovery participants require explicit local policy

## Non-Goals

- No threshold signature scheme selection in this ADR
- No MPC protocol selection in this ADR
- No guardian UX design in this ADR
- No recovery participant discovery protocol in this ADR
- No global recovery authority model in this ADR
- No new identity model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should add quorum evidence
validation and replay tests, not a mutable recovery authority table:

```text
1. define quorum evidence shape
2. define quorum projection from accepted recovery events
3. evaluate participants against key lifecycle projection
4. reject revoked, expired, missing, or cross-Realm participants
5. require RECOVERY_EXECUTED for authority transition
6. prove partial signatures do not change projection
7. prove replay produces the same quorum state
```

Suggested test target:

```text
node/scripts/test-quorum-recovery-boundary.js
```

## Summary

Quorum recovery asks:

```text
How can multiple recovery authorities restore continuity together?
```

Answer:

```text
Collect evidence.
Evaluate active capabilities.
Apply threshold policy.
Accept recovery event.
Replay projection.
Never treat signatures alone as authority.
```

Quorum restores continuity. Quorum does not create authority.
