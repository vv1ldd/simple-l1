# ADR-0056: Email Claim And Notification Boundary

Status: Accepted

This ADR defines how email may appear in SL1E and subject-authority semantics without becoming identity authority, authentication, or recovery.

```text
RFC-0052 answers: What is a subject?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0053 answers: Who may interpret causality into state?
ADR-0054 answers: How may runtime mutations enter the authority model?
ADR-0055 answers: What may divergence measurement do?
ADR-0056 answers: What may email mean, and what must it never mean?
```

RFC-0052 models email as a claim or attribute, not as identity authority.

RFC-0033 forbids transport possession from implying authority.

ADR-0056 freezes the application-facing boundary for email in SL1E Connect proofs and notifications.

## Acceptance Criteria

ADR-0056 is accepted when the following email boundaries are frozen:

```text
Email claim boundary frozen.
Email notification hint boundary frozen.
Email is not identity authority.
Email is not authentication.
Email is not recovery authority.
Scope-gated disclosure frozen for IdentityProof envelopes.
```

## Constitutional Kernel

```text
email_control != identity_authority
email_delivery != authentication
email_claim != recovery_path
email_hash != subject
```

Email may attest a contact property of a subject. Email must never define who the subject is or who may control the subject graph.

```text
Observation does not imply correction.
Measurement does not imply authority.
Email disclosure does not imply authority.
```

## Scope

This ADR governs:

```text
email as non-authoritative claim
email_hash as privacy-preserving matching hint
email as notification recipient hint
scope-gated IdentityProof disclosure
forbidden email-as-authority patterns
```

This ADR does NOT govern:

```text
SMTP transport implementation
email verification ceremony design
recovery policy (future governance layer)
automatic drift correction from email mismatch
```

## Two Email Roles

Email appears in exactly two roles, and they must not collapse:

### Email Claim

Evidence that a subject controls an email address.

```text
claim: controls_email
value: disclosed only with consent and scope
canonical storage: value_hash preferred in authority history
```

An email claim is not:

```text
identity authority
controller binding
recovery path
membership proof
login credential
```

### Email Notification Hint

A routing hint for notifications or application contact.

```text
recipient_hint.type = email_hash
authority_effect = none
```

A notification hint is not proof of identity and must not grant access. This aligns with RFC-0033 Notification Transport Boundary.

## IdentityProof Disclosure Boundary

Relying applications receive email only through consented, scope-gated disclosure in `IdentityProofEnvelope.claims`:

```json
{
  "claims": {
    "alias": "alice",
    "display_alias": "Alice",
    "email": "alice@example.com",
    "email_hash": "sha256:..."
  }
}
```

Rules:

```text
subject key remains entity_l1_address, never email
email disclosure requires scope containing "email"
without email scope, claims.email and claims.email_hash MUST be null
raw email in envelope is application disclosure, not canonical subject truth
raw email MUST NOT enter authority_history as subject-defining fact
```

Sovereign Coolify (`meanly.ops`) and Meanly (`meanly.one`, `meanly.ru`) may request `openid sl1e email` scope. They must still authenticate and map users by `subject.entity_l1_address`.

## Forbidden Patterns

### Magic-Link Login

Invalid:

```text
email link possession -> session
email link possession -> membership
email link possession -> identity authority
```

### Email As Recovery Authority

Invalid:

```text
password reset email -> controller rotation
email verified -> subject continuity restored without authority event
```

Recovery is a future policy/governance boundary, not an email transport feature.

### Email As Subject Key

Invalid:

```text
primary user key = email
account lookup by email without IdentityProof
email_hash treated as subject address
```

### Raw Email In Canonical Authority History

Invalid:

```text
authority_event stores raw email as subject-defining truth
genesis event embeds email as identity root
```

Canonical authority history may reference `value_hash` for claims. Raw email belongs in application disclosure or external evidence, not replayable subject ontology.

## Relation To Subject Authority Stack

```text
Slice 1 kernel     -> canonical subject state from authority_history
Slice 2a classifier -> admissibility of runtime events
Slice 2b reconciler -> divergence measurement only
Email helper        -> non-authoritative claim projection only
```

Email helpers and IdentityProof email disclosure do not:

```text
mutate authority_history
enforce runtime behavior
elevate email to authority domain
feed back into classifier or reconciler
```

## Runtime Invariants

```text
email_is_claim_not_authority = true
email_disclosure_is_scope_gated = true
email_notification_is_non_authoritative = true
email_hash_is_matching_hint_not_subject = true
identity_proof_subject_is_entity_l1_address = true
transport_possession_does_not_imply_authority = true
```

## Pipeline

```text
Passkey ceremony
  -> IdentityProof (controller authenticated for subject)
  -> optional scope-gated email disclosure in envelope
  -> app maps session by entity_l1_address
  -> app may use email for contact/notifications only

Notification routing (separate path)
  -> recipient_hint.email_hash
  -> authority_effect: none
  -> no access grant
```

## Executable Reference

This boundary is realized by pure helpers and scope-gated envelope claims. Documents reference executable modules, not the other way around.

```text
docs/contracts/subject-authority/fixtures/email-claim-v1.json
node/subject-email-claims.js
node/identity-proof-runtime.js (scope-gated claims extension)
node/notification-runtime.js (existing email_hash recipient hint)
node/scripts/test-subject-email-claims.js
```

## Non-Goals For This Boundary

```text
SMTP sending
email verification UX
recovery workflows
server.js enforcement changes
authority_history mutation from email
```

ADR-0056 is a semantic boundary document. Email claim helpers and envelope extension follow in a separate implementation artifact.
