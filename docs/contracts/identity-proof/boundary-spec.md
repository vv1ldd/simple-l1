# Identity Proof Boundary Spec

## Role

`IdentityProofEnvelope v1` is the stable, application-facing identity ABI
produced by Identity Runtime after successful authorization-code exchange and
authentication.

It is runtime-produced. It is not a raw WebAuthn output and not a transformed
assertion.

## Axioms

```text
authorization_code is a transient rendezvous capability.
authorization_code carries no identity semantics.
IdentityProofEnvelope is the first trustable application identity artifact.
WebAuthn assertion is strictly internal identity runtime input.
WebAuthn assertion MUST NOT be observable outside Identity Layer.
Internal authentication state MUST NOT cross the exchange boundary.
Applications trust IdentityProofEnvelope, not authentication mechanisms.
Application trust is derived from proof semantics, not proof provenance.
```

## Verification

`verifyIdentityProofEnvelope()` must be a pure deterministic function.

Allowed context:

- expected `client_id`;
- expected `redirect_uri`;
- expected `intent`;
- current time;
- issuer trust material snapshot.

Forbidden dependencies:

- network calls;
- database lookups;
- runtime session state;
- WebAuthn artifacts;
- credential metadata.

## Boundary Integrity

The application layer MUST NOT receive:

- `credential_id`;
- `authenticator_data`;
- `client_data_json`;
- `webauthn_sign_count`;
- `attestation_object`;
- `transports`;
- raw assertion signatures;
- internal authentication traces.

Schema, runtime, and conformance fixtures must all preserve this boundary.
