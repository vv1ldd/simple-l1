# ADR-0057: Claim History And Disclosure Boundary

Status: Accepted

This ADR defines the lifecycle boundary for versionable subject claims.

ADR-0056 froze email as a non-authoritative claim and notification hint. ADR-0057 generalizes that model: claims are append-only, versionable assertions about a subject, but they are not subject authority.

```text
RFC-0052 answers: What is a subject?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0053 answers: Who may interpret causality into state?
ADR-0054 answers: How may runtime mutations enter the authority model?
ADR-0055 answers: What may divergence measurement do?
ADR-0056 answers: What may email mean, and what must it never mean?
ADR-0057 answers: How may claims change without changing subject authority?
```

## Acceptance Criteria

ADR-0057 is accepted when the following boundaries are frozen:

```text
claim_history is separate from authority_history
claim issuance is not authority change
claim revocation is not subject revocation
claim supersession preserves subject continuity
disclosure reflects active claim projection, not historical claims
account records are projections, not canonical claim sources
```

## Constitutional Kernel

```text
claim_event != authority_event
claim_history != authority_history
active_claim_projection != subject_state
claim_revocation != subject_revocation
claim_supersession != authority_transfer
```

Claims describe mutable assertions about a subject. They do not define who the subject is, who controls the subject, or how subject continuity is recognized.

## Scope

This ADR governs:

```text
versionable claims
claim issuance
claim supersession
claim revocation
active claim projection
scope-gated disclosure from active claims
```

This ADR does NOT govern:

```text
subject authority continuity
controller binding
recovery policy
relationship governance
application profile editing
automatic runtime correction
```

## Claim Lifecycle

The minimum lifecycle is append-only:

```text
CLAIM_ISSUED
  -> ACTIVE
  -> CLAIM_SUPERSEDED
  -> SUPERSEDED

CLAIM_ISSUED
  -> ACTIVE
  -> CLAIM_REVOKED
  -> REVOKED
```

Claim lifecycle transitions never mutate prior records. They append new claim events and derive a projection.

## Claim Event Classes

### CLAIM_ISSUED

Creates a candidate active claim for a subject:

```json
{
  "event_type": "CLAIM_ISSUED",
  "subject": "sl1e_subject",
  "claim_type": "controls_email",
  "value_hash": "sha256:..."
}
```

`CLAIM_ISSUED` does not grant authority, authentication, recovery, membership, or runtime permissions.

### CLAIM_SUPERSEDED

Replaces a prior claim with a newer claim of the same subject and claim type:

```json
{
  "event_type": "CLAIM_SUPERSEDED",
  "subject": "sl1e_subject",
  "claim_type": "controls_email",
  "supersedes": "claim_event_001",
  "value_hash": "sha256:..."
}
```

Supersession preserves subject continuity. It changes the active claim projection only.

### CLAIM_REVOKED

Retires a prior claim:

```json
{
  "event_type": "CLAIM_REVOKED",
  "subject": "sl1e_subject",
  "claim_type": "controls_email",
  "revokes": "claim_event_002"
}
```

Revocation removes a claim from the active claim projection. It does not revoke the subject, controller, session, or authority graph.

## Runtime Shape

```text
claim_history
  -> claim evaluator
  -> active_claim_projection
  -> disclosure policy
  -> IdentityProofEnvelope.claims
  -> application contact projection
```

The evaluator is deterministic and stateless over claim history. It does not read application user records as canonical claim truth.

## Disclosure Boundary

Disclosure is a policy decision over active claims:

```text
active_claim_projection
  -> claim_type = controls_email
  -> scope contains email
  -> disclose email/email_hash
```

Rules:

```text
historical claims are not disclosed as current facts
revoked claims are not disclosed
superseded claims are not disclosed
scope is required for raw disclosure
value_hash may be disclosed as a privacy-preserving contact hint
```

Raw contact values are not authority facts. Canonical claim semantics are keyed by `value_hash`; any raw disclosure value is a local disclosure secret or application-facing reveal, not subject authority.

## General Claim Types

The same lifecycle applies to future claims:

```text
controls_email
controls_phone
controls_matrix
controls_signal
controls_nostr
verified_domain
verified_document
organization_role
payment_endpoint
```

Adding a new claim type must not create a new authority primitive. New claim types inherit the same lifecycle unless a later ADR freezes a stricter boundary.

## Relation To Account Records

Runtime account records may cache active claims as projections. They must not become canonical claim truth.

Invalid:

```text
account.email = canonical claim source
account profile edit -> active subject claim without claim event
email lookup -> subject identity
```

Valid:

```text
claim_history -> active_claim_projection -> account/contact projection
```

## Executable Reference

```text
docs/contracts/subject-authority/fixtures/claim-history-v1.json
node/subject-claim-history-runtime.js
node/scripts/test-subject-claim-history-runtime.js
```

ADR-0057 is a semantic boundary document. Runtime implementation follows as a separate executable artifact.
