# ADR-0061: Authentication Adapter Boundary

Status: Accepted

This ADR freezes the boundary between a human's authentication mechanism and the
global `sl1e_*` entity issued by an SL1 issuer.

ADR-0059 froze the identity ownership model: applications never own identity.
ADR-0061 freezes the credential mechanism boundary: the SL1 entity must not be
defined by today's authentication technology.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
```

## Acceptance Criteria

ADR-0061 is accepted when the following boundaries are frozen:

```text
authentication_adapter != identity
credential_mechanism != sl1e_subject
passkey_is_current_adapter_not_platform_ontology
bio_interface_is_adapter_not_identity_authority
adapter_rotation_must_not_reissue_sl1e_*
adapter_recovery_must_not_mutate_domain_projection
issuer_confirms_control_over_identity_not_application_permission
authentication_is_not_identity
authentication_adapter_is_replaceable
authentication_rotation_preserves_subject_identity
```

## Constitutional Kernel

```text
Human
    │
    │ proves control through
    ▼
Authentication Adapter
    │
    │ authenticates to
    ▼
Issuer
    │
    │ confirms control of
    ▼
sl1e_*
```

The durable subject is `sl1e_*`. The authentication adapter is only the current
mechanism by which a human proves control to the issuer.

The adapter may change; the subject must remain stable.

## Authentication Proves Control, Not Identity

The central invariant of this layer:

```text
Authentication proves control.
It does not define identity.
```

Expanded binding chain:

```text
Authentication Adapter
        │
        │ proves control of
        ▼
Authentication Credential
        │
        │ recognized by
        ▼
Issuer
        │
        │ binds to
        ▼
sl1e_...
```

Therefore:

```text
authentication does not create identity
authentication is not identity
authentication only lets the issuer confirm control of an existing binding
```

This is exactly why adapter rotation is possible without changing `sl1e_*`:
rotating how control is proven does not touch what the subject is.

## Motivation

Today's production implementation uses passkeys / WebAuthn ceremonies.

Future implementations may use:

```text
Passkey Adapter
Device Secure Enclave Adapter
Biometric Adapter
Hardware Token Adapter
Government eID Adapter
Future Credential Adapter
```

The platform must not be built around passkeys as ontology. It is built around
the invariant that a human can prove control over a durable identity to an
issuer, and that the issuer can then issue proofs about the same `sl1e_*`.

## Adapter Contract

An authentication adapter exposes a control-proof interface to the issuer.

```text
authenticate()
prove_control()
recover()
rotate()
```

### authenticate()

Starts the ceremony or protocol by which the human presents the adapter.

Examples:

```text
WebAuthn assertion
secure enclave challenge
hardware token challenge
biometric liveness ceremony
government eID presentation
```

### prove_control()

Produces verifier input that lets the issuer decide whether the human controls a
credential bound to the subject.

The output is mechanism-specific, but the issuer-level result is stable:

```text
control_confirmed(entity_l1_address)
```

### recover()

Runs an issuer-governed recovery path when the prior adapter can no longer be
used.

Recovery must not imply:

```text
new_identity
claim_truth
application_permission
domain_state_mutation
```

### rotate()

Adds, removes, or replaces an adapter/controller binding for the same `sl1e_*`.

Rotation changes how control is proven. It does not change who the subject is.

## Biometric Caution

The term "Bio ID" is too broad to use as an architectural primitive.

Biometrics differ materially:

```text
fingerprint
face
iris
voice
multi-factor biometric ceremony
local-only biometric unlock
remote biometric template matching
```

These choices have different security, privacy, revocability, and compromise
properties.

Therefore SL1 must not depend on "biometrics" as a category. A biometric system,
if added, is one authentication adapter with a precise threat model and storage
boundary.

Preferred boundary:

```text
bio_signal != identity
biometric_template != sl1e_*
local_device_biometric_unlock != remote_biometric_attestation
adapter_output_must_be_evaluated_by_issuer_policy
```

## Adapter Independence From Clients

Client applications must not care which adapter authenticated the human unless
they explicitly ask for assurance metadata.

For normal Connect flows, the client receives:

```text
entity_l1_address
IdentityProof
issuer
assurance/context metadata (optional)
```

The client must not infer identity semantics from the adapter type.

Invalid inference:

```text
passkey_user != bio_user
hardware_token_user != passkey_user
adapter_type -> local_account_namespace     # INVALID
```

Valid inference:

```text
valid_proof_for_sl1e_* -> same_global_subject
```

## Adapter Rotation Properties

Adapter rotation must preserve:

```text
same_sl1e_subject
same_claim_history_subject
same_application_projections
same_domain_references
```

Adapter rotation may update:

```text
controller bindings
credential metadata
assurance level
recovery state
audit trail
```

Adapter rotation must not require:

```text
new storefront account
new admin user
new billing customer
new api subject
```

## Consequences

### Positive

- Passkeys remain an implementation choice, not the identity ontology.
- Future credential mechanisms can be added without changing `sl1e_*`.
- Applications stay stable across authentication technology changes.
- Claims, policy decisions, and domain projections remain layered above the same subject.

### Negative / Operational

- Every adapter needs a precise threat model, recovery story, and issuer policy.
- Assurance levels may differ by adapter and must be represented explicitly.
- Biometric adapters require stronger privacy and revocation analysis than passkeys.

## Relationship To Prior ADRs

ADR-0059 says applications project a global entity into local domain state.
ADR-0061 says the mechanism that proves human control over that entity is
replaceable.

ADR-0060 says applications decide actions using verified truth and local policy.
ADR-0061 says adapter type may be one input to policy only when explicitly
modeled as assurance/context metadata; it must not redefine identity.

ADR-0061 completes the bottom of the layered platform model:

```text
1. Authentication Adapter   how a subject proves control        (ADR-0061)
2. Identity                 who the subject is                  (ADR-0059)
3. Authority                who may make assertions             (ADR-0052/0053)
4. Claims                   which assertions exist              (ADR-0057/0058)
5. Policy                   which assertions are required       (ADR-0060)
6. Decision                 allow or deny                       (ADR-0060)
7. Domain Projection        how the decision changes state      (ADR-0059/0060)
```

Each layer owns one responsibility and does not absorb the others.

## References

- `rfc/0018-sl1-connect-and-identity-proof.md`
- `docs/architecture/identity-issuance-client-authentication-adr-0059.md`
- `docs/architecture/policy-decision-domain-projection-boundary-adr-0060.md`
