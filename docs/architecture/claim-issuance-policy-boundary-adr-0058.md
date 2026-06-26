# ADR-0058: Claim Issuance Policy Boundary

Status: Accepted

This ADR defines the admission boundary for claim event candidates before they may enter `claim_history`.

ADR-0057 froze versionable claim lifecycle. ADR-0058 freezes the separate question of issuer eligibility: whether a candidate claim event satisfies policy for its claim type and provenance class.

```text
RFC-0052 answers: What is a subject?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0053 answers: Who may interpret causality into state?
ADR-0054 answers: How may runtime mutations enter the authority model?
ADR-0055 answers: What may divergence measurement do?
ADR-0056 answers: What may email mean, and what must it never mean?
ADR-0057 answers: How may claims change without changing subject authority?
ADR-0058 answers: Which claim candidates may be admitted to claim history?
```

## Acceptance Criteria

ADR-0058 is accepted when the following boundaries are frozen:

```text
claim_policy != authority_history
claim_policy != claim_history
issuer_eligibility != subject_authority
claim_admission != identity_creation
admission is not attestation
attestation is not truth
disclosure is not endorsement
```

## Constitutional Kernel

```text
claim_event_candidate != claim_event
claim_event_candidate != authority_event
claim_policy_decision != authority_decision
admitted != true
admitted != endorsed
rejected != subject_revoked
pending_evidence != denied_identity
unknown != default_admit
```

Admission means only that a candidate is policy-eligible to be recorded as a claim event by a later ceremony. It does not mean the claim is true, authoritative, endorsed, disclosed, or usable for subject continuity.

## Scope

This ADR governs:

```text
claim event candidates
issuer classes
claim-type admission policy
admission decision alphabet
non-authoritative policy evaluator boundary
```

This ADR does NOT govern:

```text
claim event writing
claim ceremony UX
claim truth evaluation
subject authority
controller binding
application disclosure
```

## Pipeline

```text
claim_event_candidate
  -> claim issuance policy evaluator
  -> admitted | rejected | pending_evidence | unknown
  -> claim ceremony may append claim event later
  -> claim_history
  -> active_claim_projection
  -> disclosure policy
```

The policy evaluator is inert. It returns a decision only. It must not append to `claim_history`, mutate `authority_history`, emit claim events, emit authority events, perform disclosure, or create runtime sessions.

## Decision Alphabet

### admitted

The candidate is structurally valid and policy-eligible for its `claim_type` and issuer class.

`admitted` is not:

```text
truth
attestation
endorsement
authority
disclosure
```

### rejected

The candidate is structurally invalid or policy-ineligible.

`rejected` is local to claim admission policy. It must not be interpreted as a subject rejection, Layer B FPL verdict, Layer C reconciliation status, or authority decision.

### pending_evidence

The candidate names a policy path that requires evidence not present in the candidate. Missing evidence must not fall through to `admitted`.

### unknown

No applicable policy rule is available. Unknown must not default to admission.

## Issuer Classes

Internal policy terms intentionally avoid implying truth:

```text
self_asserted
delegated_assertion
provider_assertion
organization_assertion
public_institution_assertion
```

Applications may assign different trust weight to the same admitted claim later. That is outside this boundary.

## Example Policy Matrix

```text
controls_email      -> self_asserted | provider_assertion
controls_phone      -> self_asserted | provider_assertion
verified_domain     -> provider_assertion
organization_role   -> organization_assertion
verified_document   -> public_institution_assertion
payment_endpoint    -> self_asserted | provider_assertion
```

The matrix defines eligibility only. It does not define claim truth.

## Forbidden Effects

A claim policy decision must not produce:

```text
authority_event
claim_event
claim_history append
authority_history mutation
subject state change
identity creation
controller binding
session grant
disclosure
endorsement
```

## Executable Reference

```text
docs/contracts/subject-authority/fixtures/claim-issuance-policy-v1.json
node/subject-claim-issuance-policy.js
node/scripts/test-subject-claim-issuance-policy.js
```

ADR-0058 is a semantic boundary document. Runtime implementation follows as a separate executable artifact.
