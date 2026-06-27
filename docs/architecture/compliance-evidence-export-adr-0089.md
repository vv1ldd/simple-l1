# ADR-0089: Compliance Evidence Export

Status: Accepted

This ADR defines how a Realm may package history proof, projection explanation,
verification reports, lifecycle evidence, and attestation envelopes for
compliance or audit consumers without exporting authority or creating a state
import path.

ADR-0088 established that attestation proves observation and does not create
authority. ADR-0089 packages that verified observation with the surrounding
evidence an auditor needs to understand why a Realm state existed at export
time.

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
ADR-0089 answers: How may compliance evidence be exported without exporting authority?
```

## Acceptance Criteria

ADR-0089 is accepted when the following compliance export boundaries are frozen:

```text
compliance_export_packages_evidence
compliance_export_does_not_export_authority
compliance_export_is_derived_artifact
export_must_reference_canonical_history
included_in_export_does_not_make_source_of_truth
exported_projection_is_not_restore_source
export_cannot_create_trust_without_verification
exported_explanation_preserves_reason_codes
attestation_envelope_remains_evidence
missing_operational_artifacts_reduce_explainability_not_identity_continuity
corrupted_export_fails_verification
same_history_produces_same_evidence_package_hash
deleted_export_does_not_affect_realm_validity
imported_export_cannot_mutate_local_realm
projection_only_export_rejected_as_canonical_proof
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Compliance export packages evidence.
Compliance export does not export authority.
```

Supporting kernel:

```text
Included in export != source of truth.
```

Wrong:

```text
Export Package
        ↓
External System
        ↓
Authority Imported
```

Correct:

```text
Realm Evidence
        ↓
Evidence Package
        ↓
External Auditor / Consumer
```

Hardening series guardrails:

```text
ADR-0077  explanation != state
ADR-0078  verification != repair
ADR-0080  backup != authority
ADR-0088  attestation != authority
ADR-0089  export != authority
```

## Context

Traditional compliance export often asks:

```text
Here is the current database state.
```

Realm compliance export asks:

```text
Here is the proof of why this state exists.
```

The evidence chain is:

```text
Accepted History
        ↓
Verification
        ↓
Explanation
        ↓
Attestation
        ↓
Compliance Evidence Export
        ↓
External Consumer
```

Export is a representation layer over existing proof surfaces:

```text
History
  ↓
Projection
  ↓
Explanation
  ↓
Verification
  ↓
Attestation
```

It must not become a backup, restore source, federation trust shortcut, or
external authority container.

## Questions This ADR Answers

```text
What belongs in a compliance evidence package?
What must an export reference to remain verifiable?
How does an auditor distinguish projection from authority?
What happens when export metadata changes?
Can an export be imported into another Realm?
How do missing optional artifacts affect export confidence?
How is export different from backup or attestation?
```

This ADR does **not** select report formats, regulatory frameworks, retention
periods, data redaction rules, privacy policy, evidence portal design, or legal
review workflow.

## Core Boundary

Compliance export is derived evidence.

```text
canonical history
        ↓
projection / explanation / verification / attestation
        ↓
evidence package
```

It explains:

```text
At export time, this projection was derived from this history head
under this runtime and registry contract.
```

It does not say:

```text
This exported projection may be imported as authority.
```

## Minimal Evidence Bundle

Minimum bundle shape:

```json
{
  "realm_id": "realm_123",
  "history_head": "hash...",
  "projection_hash": "hash...",
  "integrity_report": {},
  "attestation": {},
  "lifecycle_state": {},
  "event_trace": [],
  "runtime_version": "1",
  "registry_version": "1",
  "export_metadata": {}
}
```

The bundle may include:

```text
projection explanation
validator reason codes
command lineage
key lifecycle projection
quorum recovery evidence
federation references
backup artifact references
deployment metadata
attestation material hash
redaction manifest
```

Every included artifact must either be derived from canonical history or clearly
marked as operational evidence.

## Canonical References

An export must reference canonical proof anchors:

```text
realm_id
history_head
projection_hash
integrity_report_hash
attestation_material_hash
runtime_version
registry_version
projection_version
export_scope
exported_at
```

These anchors let consumers verify the export against the Realm's causal
history. They do not create that history.

## Projection Export Boundary

An export may include `CurrentAuthorityState` or another projection for
readability.

But:

```text
exported CurrentAuthorityState
        !=
authority snapshot to restore
```

Projection is included to explain:

```text
which current capability state was derived from history_head
```

It must not be accepted as:

```text
canonical state
backup source
federation trust source
admin mutation payload
```

## Explanation and Reason Codes

Exported explanations must preserve:

```text
event causality
validator reason codes
command result status
accepted_event_ids
rejection reasons
lifecycle derivation source
integrity warnings and failures
```

Compliance consumers need not only what happened, but why it was accepted or
rejected.

If reason codes are missing, explainability is degraded. Authority continuity is
not changed.

## Attestation Envelope

An export may include an attestation envelope from ADR-0088.

The envelope remains evidence:

```text
attestation verified
        ↓
consumer confidence in exported proof
        ↓
no Realm mutation
```

If attestation and export anchors disagree, the export must be rejected.

```text
export.history_head != attestation.history_head
        ↓
ATTESTATION_EXPORT_MISMATCH
```

## Export Metadata Boundary

Export metadata may describe:

```text
export_id
exported_at
exported_by
purpose
scope
redaction_policy
format_version
retention_class
consumer
```

But:

```text
export metadata != authority history
export purpose != Realm policy
export consumer != Realm participant
```

Changing export metadata must be detectable if the package is sealed, but it
must not change Realm state.

## Import Boundary

A compliance export must not be importable as canonical Realm state.

```text
import evidence package
        ↓
read / verify / inspect only
        ↓
no event append
no projection mutation
no lifecycle override
```

If a local Realm wants to trust evidence from an export, it must pass through
the appropriate local policy path, such as federation recognition or admin
command execution. Export import is never a direct authority path.

## Missing Optional Artifacts

Optional artifacts may be absent:

```text
command execution records
observability cache
deployment metadata
backup references
attestation archive
redaction annotations
```

Result:

```text
reduced explainability
operational warning
Realm identity unchanged
canonical continuity unchanged
```

If canonical history or required verification anchors are absent, the package is
not a canonical proof.

## Failure Modes

### Projection-Only Export

```text
CurrentAuthorityState only
        ↓
canonical proof requested
        ↓
reject
```

Expected result:

```text
CANONICAL_HISTORY_REQUIRED
```

### Attestation Mismatch

```text
export history_head H1
attestation history_head H2
        ↓
reject
```

Expected result:

```text
ATTESTATION_EXPORT_MISMATCH
```

### Export Mutation

```text
sealed export
        ↓
metadata or evidence changed
        ↓
package hash mismatch
```

Expected result:

```text
EXPORT_HASH_MISMATCH
```

### Missing Canonical History Reference

```text
export lacks history_head
        ↓
cannot verify derivation
```

Expected result:

```text
EXPORT_HISTORY_HEAD_REQUIRED
```

### Imported Export Attempts Mutation

```text
external package
        ↓
import into local Realm
        ↓
attempt projection update
```

Expected result:

```text
EXPORT_IMPORT_MUTATION_FORBIDDEN
```

### Deleted Export

```text
evidence package deleted
        ↓
audit unavailable
        ↓
Realm validity unchanged
```

Expected result:

```text
EXPORT_ARTIFACT_MISSING
```

## Mandatory Acceptance Tests

Future compliance export tests should prove:

### 1. Same History Produces Same Evidence Package Hash

```text
same history_head
same projection_hash
same integrity report
same attestation material
        ↓
same evidence package hash
```

### 2. Changed Export Metadata Is Detectable

```text
sealed package
        ↓
mutate export_metadata
        ↓
verification fails
```

### 3. Deleted Export Does Not Affect Realm Validity

```text
delete export artifact
        ↓
verify Realm
        ↓
same integrity result
```

### 4. Imported Export Cannot Mutate Local Realm

```text
import export package
        ↓
no event append
no projection mutation
```

### 5. Projection-Only Export Rejected as Canonical Proof

```text
CurrentAuthorityState only
        ↓
canonical proof requested
        ↓
CANONICAL_HISTORY_REQUIRED
```

### 6. Attestation Mismatch Rejected

```text
export anchors
        ↓
attestation anchors disagree
        ↓
reject
```

### 7. Audit Package Rebuild From History Produces Equivalent Evidence

```text
delete generated package
        ↓
rebuild from history + verification + explanation + attestation
        ↓
equivalent evidence anchors
```

## Relationship to SDK Contract

ADR-0089 prepares ADR-0090.

SDKs should expose evidence-oriented APIs:

```text
explain()
verify()
attest()
exportEvidence()
```

They must not expose:

```text
writeState()
setAuthority()
importProjectionAsTruth()
```

Compliance export proves that developer ergonomics can be built around
evidence, not hidden mutation.

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

- Compliance output becomes causal proof, not a state dump
- Auditors can trace state to accepted events and reason codes
- Export packages can include attestations without becoming authority
- Projection-only artifacts are clearly non-canonical
- Deleted exports do not affect Realm validity

### Negative

- Export generation requires verification and explanation machinery
- Consumers must validate anchors and attestation envelopes
- Redaction must be designed without breaking proof references
- Missing optional artifacts may reduce audit confidence

## Non-Goals

- No regulatory framework selection in this ADR
- No legal retention policy in this ADR
- No report format selection in this ADR
- No redaction policy design in this ADR
- No evidence portal design in this ADR
- No external system import protocol in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should add evidence package
construction and verification tests, not importable state exports:

```text
1. define evidence package schema
2. require history_head, projection_hash, integrity report, lifecycle state, and runtime metadata
3. include attestation envelope when available
4. seal package with deterministic material hash
5. reject projection-only canonical proof
6. reject attestation anchor mismatch
7. prove imported exports cannot mutate local Realm
```

Suggested test target:

```text
node/scripts/test-compliance-evidence-export.js
```

## Summary

Compliance export asks:

```text
What evidence explains this state to an external consumer?
```

Answer:

```text
Package history proof.
Package projection explanation.
Package verification report.
Package lifecycle evidence.
Package attestation envelope.
Never package authority.
```

Compliance export packages evidence. Compliance export does not export
authority.
