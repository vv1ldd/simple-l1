# ADR-0088: Attestation Boundary

Status: Accepted

This ADR defines how a Realm may produce externally verifiable attestations of
history, projection, integrity, runtime, and policy evidence without making
attestation artifacts a source of authority or a mechanism that validates the
Realm by assertion.

ADR-0087 made recovery quorum evidence replayable and explainable. ADR-0088
extends the same principle outward: external consumers may verify what the Realm
observed and derived, but external attestation does not create Realm truth.

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
ADR-0088 answers: How may Realm state be externally verified without creating authority?
```

## Acceptance Criteria

ADR-0088 is accepted when the following attestation boundaries are frozen:

```text
attestation_proves_observation
attestation_does_not_create_authority
attestation_does_not_make_invalid_realm_valid
attestation_requires_valid_integrity_report
attestation_references_history_head
attestation_references_projection_hash
attestation_references_integrity_report_id
attestation_references_runtime_version
attestation_references_registry_version
attestation_mutation_is_detectable
old_attestation_does_not_authorize_new_state
same_verified_material_produces_same_attestation_material
deleting_attestation_does_not_affect_realm_validity
attestation_store_is_not_authority_history
external_consumer_verifies_evidence_not_state_claim
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Attestation proves observation.
Attestation does not create authority.
```

Supporting kernel:

```text
Attestation says: this state was derived from this verified history
under this runtime contract.
```

Wrong:

```text
External Attestation
        ↓
Realm becomes valid
```

Correct:

```text
Realm State
        ↓
Integrity Verification
        ↓
Attestation Evidence
        ↓
External Consumer
```

Hardening series guardrails:

```text
ADR-0077  explanation != state
ADR-0078  verification != repair
ADR-0083  deployment != history
ADR-0087  quorum != authority
ADR-0088  attestation != authority
```

## Context

The hardening chain now has replayable internal continuity:

```text
History
  ↓
Keys
  ↓
Quorum Recovery
  ↓
Attestation
  ↓
Compliance Evidence
  ↓
SDK
```

External systems need a way to verify claims such as:

```text
I have this history.
I derived this state.
I satisfied this policy.
I ran under this runtime and registry contract.
```

They must not be asked to accept:

```text
trust me, my current state is X
```

ADR-0088 defines attestation as an evidence layer over verified causality, not
as a delegation of authority to external signers or attestation stores.

## Questions This ADR Answers

```text
What does an attestation prove?
What must an attestation reference?
When may an attestation be generated?
How does an external consumer verify attested material?
What happens when attestation artifacts are mutated, stale, or deleted?
How is attestation different from federation trust or compliance export?
```

This ADR does **not** select attestation signature format, certificate
authority, transparency log, hardware enclave, remote attestation provider, or
wire protocol.

## Core Boundary

Attestation packages verified observation.

```text
history_head
projection_hash
integrity_report_id
runtime_version
registry_version
        ↓
attestation material
        ↓
attestation signature
        ↓
external verification
```

It does not produce a Realm transition.

```text
attestation verified
        ↓
consumer confidence in observed evidence
        ↓
no Realm Event unless separately accepted by local policy
```

If the Realm is invalid, attestation must fail or attest the invalidity. It must
not turn invalidity into trust.

## Attestation Event Model

Minimum semantic events or records:

```text
ATTESTATION_CREATED
ATTESTATION_SIGNED
ATTESTATION_VERIFIED
```

These may be represented as operational records rather than canonical Realm
Events when they only explain observed state. If an attestation is used as
evidence for a Realm transition, that transition still requires the normal
command, registry, validator, and accepted-event path.

The boundary is:

```text
attestation record
        ↓
evidence / explanation

accepted Realm Event
        ↓
authority transition
```

## Required Attestation Material

An attestation must reference at minimum:

```text
realm_id
history_head
projection_hash
integrity_report_id
integrity_report_hash
runtime_version
registry_version
projection_version
verified_at
attestation_subject
attestation_scope
```

When relevant, it may also reference:

```text
lifecycle_state
key_lifecycle_projection_hash
quorum_evidence_hash
backup_artifact_hash
deployment_id
federation_policy_version
```

External consumers verify evidence by checking references, not by trusting a
bare state claim.

## Generation Gate

Attestation generation requires a valid integrity report for the attested scope.

```text
verifyRealmIntegrity()
        ↓
realm_valid == true
        ↓
attestation material created
```

If `realm_valid` is false:

```text
attestation rejected
        or
invalidity attested explicitly as diagnostic evidence
```

An invalid Realm must not receive a valid-state attestation.

## External Consumer Model

An external consumer should conclude:

```text
This Realm state was derived from this verified history
under this runtime and registry contract.
```

Not:

```text
The external attestor granted authority to the Realm.
```

Consumer verification should check:

```text
attestation signature
attestation material hash
history_head availability
projection_hash match
integrity report hash
runtime / registry compatibility metadata
freshness or validity window
scope of attestation
```

## Freshness and Staleness

Attestations are point-in-time observations.

```text
attestation at history_head H1
        ↓
new accepted event H2
        ↓
old attestation remains historical evidence
        ↓
old attestation does not authorize H2 state
```

Old attestations may be useful for audit, compliance, or comparison. They are
not current authority.

## Mutation Detection

Attestation material must be tamper-evident.

```text
mutate projection_hash
        ↓
signature / material hash mismatch
        ↓
attestation rejected
```

Mutation detection protects external consumers. It does not repair Realm state.

## Attestation Store Boundary

Operational systems may store attestations:

```text
attestation archive
transparency log reference
consumer receipt
signature envelope
verification cache
```

But:

```text
attestation store != authority history
attestation archive != event log
consumer receipt != Realm state
```

Deleting attestation artifacts may reduce external verifiability. It must not
change Realm validity.

## Relationship to Federation

Federation trust remains explicit local policy.

```text
remote attestation verified
        ↓
evidence for policy
        ↓
FEDERATION_TRUST_ESTABLISHED accepted or rejected locally
```

Not:

```text
remote attestation verified
        ↓
remote Realm automatically trusted
```

Attestation can support federation decisions. It cannot replace them.

## Relationship to Quorum Recovery

Quorum recovery can produce attestable evidence:

```text
which recovery authorities participated
which keys were active
which threshold was satisfied
which RECOVERY_EXECUTED event was accepted
which history head resulted
```

Attestation exposes that causality externally. It does not make recovery
successful unless the recovery event is already accepted.

## Failure Modes

### Invalid Realm Attestation

```text
realm_valid == false
        ↓
valid-state attestation requested
        ↓
reject
```

Expected result:

```text
ATTESTATION_INTEGRITY_REQUIRED
```

### Attestation Mutation

```text
attestation material modified
        ↓
verification fails
```

Expected result:

```text
ATTESTATION_HASH_MISMATCH
```

### Stale Attestation Used as Current State

```text
attestation references old history_head
        ↓
consumer treats as current
        ↓
reject or mark stale
```

Expected result:

```text
ATTESTATION_HISTORY_HEAD_STALE
```

### Missing Integrity Report

```text
attestation references unknown integrity_report_id
        ↓
verification cannot prove derivation
```

Expected result:

```text
ATTESTATION_INTEGRITY_REPORT_REQUIRED
```

### Attestation Store Deletion

```text
attestation records deleted
        ↓
external proof unavailable
        ↓
Realm validity unchanged
```

Expected result:

```text
ATTESTATION_ARTIFACT_MISSING
```

## Mandatory Acceptance Tests

Future attestation tests should prove:

### 1. Invalid Realm Cannot Produce Valid-State Attestation

```text
invalid integrity report
        ↓
generate attestation
        ↓
reject
```

### 2. Attestation Mutation Is Detectable

```text
valid attestation
        ↓
mutate history_head / projection_hash
        ↓
verification fails
```

### 3. Old Attestation Does Not Authorize New State

```text
attestation at H1
        ↓
new event produces H2
        ↓
H1 attestation not valid for H2
```

### 4. Same History Produces Same Attestation Material

```text
same history_head
same projection_hash
same integrity report
same runtime / registry versions
        ↓
same attestation material hash
```

### 5. Deleting Attestation Does Not Affect Realm Validity

```text
delete attestation artifact
        ↓
verify Realm integrity
        ↓
same result
```

### 6. Attestation References Required Runtime Contract

```text
attestation missing runtime_version or registry_version
        ↓
reject
```

### 7. Federation Requires Local Acceptance

```text
remote attestation verified
        ↓
no local federation event
        ↓
no trust established
```

## Relationship to Compliance Evidence

ADR-0088 prepares ADR-0089.

Compliance export will need:

```text
history proof
projection explanation
verification report
lifecycle evidence
attestation envelope
```

Attestation gives the export a tamper-evident claim about what was verified and
under which runtime contract. Compliance export will package that evidence for a
specific audience and retention requirement.

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

- External consumers can verify causality without receiving authority
- Invalid Realm state cannot be made valid by attestation
- Attestations are scoped, tamper-evident, and history-head specific
- Federation and compliance gain reusable evidence
- Attestation deletion does not affect canonical Realm validity

### Negative

- Attestation generation requires integrity verification
- Consumers must handle staleness and scope
- Runtime and registry metadata become part of external proof material
- Attestation stores need durability for audit value, even though they are not authoritative

## Non-Goals

- No attestation signature format selection in this ADR
- No certificate authority or trust anchor selection in this ADR
- No hardware enclave or remote attestation provider selection in this ADR
- No transparency log design in this ADR
- No compliance report format in this ADR
- No federation trust policy replacement in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should add attestation material
construction and verification tests, not a new authority path:

```text
1. define attestation material schema
2. require history_head, projection_hash, integrity_report_id, runtime_version, registry_version
3. reject valid-state attestations for invalid integrity reports
4. hash and sign attestation material
5. verify mutation detection
6. enforce history_head freshness by scope
7. prove attestation deletion does not affect Realm integrity
```

Suggested test target:

```text
node/scripts/test-attestation-boundary.js
```

## Summary

Attestation asks:

```text
How can the external world verify why Realm state exists?
```

Answer:

```text
Verify integrity.
Bind history head.
Bind projection hash.
Bind runtime and registry contract.
Sign the observation.
Let consumers verify evidence.
Never let attestation create authority.
```

Attestation proves observation. Attestation does not create authority.
