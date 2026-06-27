# ADR-0060: Policy Decision And Domain Projection Boundary

Status: Accepted

This ADR freezes the boundary between verified identity/claim truth, application policy evaluation, authorization decisions, and domain-state mutation.

ADR-0059 froze the identity ownership model: applications never own identity; they verify proofs and project global entities into local domain state.

ADR-0060 freezes the next question:

```text
Who decides whether an action is allowed?
```

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0053 answers: Who may interpret causality into state?
ADR-0056 answers: What may email mean, and what must it never mean?
ADR-0057 answers: How may claims change without changing subject authority?
ADR-0058 answers: Which claim candidates may be admitted to claim history?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
```

## Acceptance Criteria

ADR-0060 is accepted when the following boundaries are frozen:

```text
truth != policy
policy != decision
decision != domain_mutation
issuer != authorization_server_for_application_actions
claim_issuer != application_policy_engine
verified_claim != permission
valid_identity_proof != allowed_action
domain_projection != identity_authority
local_policy_decision_is_local_to_application_domain
```

## Constitutional Kernel

```text
verified_truth + application_policy + local_context -> decision
decision + command -> domain_state_transition
```

Truth is what has been cryptographically or semantically verified. Policy is the
application-specific rule set. Decision is the result of evaluating truth and
context against policy. Domain state changes only after a decision authorizes a
command.

```text
truth is input
policy is evaluator
decision is result
domain state is projection/output
```

No layer may silently collapse into another.

## Decision Chain

```text
Issuer
    │
    │ issues entity proof
    ▼
sl1e_...
    │
    │ accumulates eligible claims
    ▼
Verified Claims
    │
    │ evaluated by
    ▼
Application Policy
    │
    │ produces
    ▼
Decision
    │
    │ authorizes
    ▼
Domain State Transition
```

Example:

```text
Issuer says:
    "this authenticated subject is sl1e_123"

Claim issuer says:
    "sl1e_123 has claim X"

Application policy says:
    "this operation requires claim X and local role Admin"

Application decision says:
    "allow" or "deny"
```

The application makes the decision even when it fully trusts the issuer and
claim issuers.

## Layer Responsibilities

```text
Identity     Who is the subject?                 sl1e_*
Authority    Who may speak about the subject?     authority / issuance policy
Claims       What is asserted about the subject?  claim history / active claims
Policy       What is required for this action?    application rule set
Decision     Is this action allowed now?          allow | deny | abstain | error
Domain State What changed after the decision?     application-owned projection
```

## Truth vs Policy vs Decision

### Truth

Truth is verified input to policy evaluation.

Truth includes:

```text
valid IdentityProof
verified entity_l1_address
verified active claims
validated claim issuer eligibility
validated signatures/proof envelopes
```

Truth does not grant permission by itself.

Invalid inference:

```text
valid_identity_proof -> allowed_action      # INVALID
verified_claim_X -> permission_X           # INVALID
```

### Policy

Policy defines what a particular application requires for a particular action.

Policy may inspect:

```text
entity_l1_address
verified claims
local roles
tenant/team membership
resource ownership
request context
time/risk/session constraints
```

Policy must not:

```text
issue identity
write claim history
modify authority history
reinterpret the global subject
convert local roles into identity authority
```

### Decision

A decision is the local result of policy evaluation.

Decision alphabet:

```text
allow
deny
abstain
error
```

`allow` authorizes only the requested action in the local domain and context.

`deny` does not revoke identity, delete claims, or change global authority.

`abstain` means the policy engine lacks an applicable rule and must not default
to allow.

`error` means the decision pipeline could not complete safely and must fail
closed.

## Domain Projection Boundary

Applications own domain state, not identity.

Domain projections include:

```text
storefront_user
cart
order
subscription
admin_user
team_role
api_subject
access_token
billing_customer
invoice
infrastructure_resource
```

All domain projections are downstream of verified identity and local decisions.

Rule:

```text
domain_state_may_reference_sl1e_*
domain_state_must_not_define_sl1e_*
```

Deleting or migrating domain state must not delete, rewrite, or reissue the
global identity.

## What Issuers Must Not Become

Issuers must not become central authorization services for application actions.

An issuer may say:

```text
this subject is sl1e_123
this proof is valid
this claim exists / was issued / is active
```

An issuer must not decide:

```text
sl1e_123 may deploy this app
sl1e_123 may refund this order
sl1e_123 may read this invoice
sl1e_123 may rotate this API token
```

Those are application decisions.

## Scaling Properties

This boundary allows the platform to evolve without cross-layer rewrites:

```text
policy_changes_do_not_reissue_identity
new_issuer_does_not_replace_application_policy
new_claim_type_does_not_rewrite_authentication
domain_refactor_does_not_mutate_global_subjects
federation_expands_trusted_truth_sources_not_local_decision_ownership
```

## Relationship To Prior ADRs

ADR-0053 says the authority evaluator interprets authority history into
canonical subject state. ADR-0060 does not replace that evaluator; it consumes
verified outputs.

ADR-0058 says claim admission policy is not truth and does not write claim
history. ADR-0060 says even verified claims are not permissions until an
application policy evaluates them.

ADR-0059 says applications do not own identity. ADR-0060 adds that applications
do own their local authorization decisions and domain projections.

## References

- `rfc/0018-sl1-connect-and-identity-proof.md`
- `docs/architecture/authority-event-evaluation-boundary-adr-0053.md`
- `docs/architecture/claim-issuance-policy-boundary-adr-0058.md`
- `docs/architecture/identity-issuance-client-authentication-adr-0059.md`
