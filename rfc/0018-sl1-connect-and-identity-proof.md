# RFC-0018: SL1 Connect & Identity Proof

Status: Draft

This document defines how external applications receive verifiable identity facts from Simple Layer One.

RFC-0018 depends on:

```text
RFC-0011: Identity Kernel & Capability Resolution
RFC-0012: Ontology Core v0.1
RFC-0013: Interoperability Principle
RFC-0016: Capability & Delegation Model
RFC-0017: External Proof Model
```

RFC-0018 is not a login system.

It is a proof issuance model for external applications.

---

## 1. Core Principle

```text
SL1 Connect issues verifiable identity facts.
It does not create authority.
```

External applications do not receive a user object.

They receive a proof:

```text
This controller authenticated.
This controller is linked to this Entity.
This proof is valid for this audience until this time.
```

Identity is not authority.

Authentication is not authorization.

---

## 2. Valid Pipeline

Valid flow:

```text
Controller
  -> AuthenticationProof
  -> IdentityProof
  -> External Application Session
```

If the external application wants an action, it must continue through the normal authority pipeline:

```text
Site Action
  -> Intent
  -> IntentApproval
  -> Authorization
  -> Execution
```

Forbidden shortcut:

```text
IdentityProof -> Capability
IdentityProof -> ControlGrant
IdentityProof -> Authorization
IdentityProof -> Execution
```

---

## 3. Proof Objects

### AuthenticationProof

An AuthenticationProof proves that a Controller authenticated for a specific challenge.

It answers:

```text
Did this controller authenticate?
```

Shape:

```text
AuthenticationProof
  proof_id
  controller_l1_address
  challenge
  audience
  authenticator_data
  client_data_json
  signature
  issued_at
  expires_at
```

AuthenticationProof proves controller authentication.

It does not prove:

```text
ownership
authority
permissions
grant validity
execution validity
```

### IdentityProof

An IdentityProof binds an authenticated Controller to an Entity for a specific audience and validity window.

It answers:

```text
Which Entity is this authenticated controller linked to?
```

Shape:

```json
{
  "proof_type": "identity",
  "entity_l1_address": "sl1e_...",
  "controller_l1_address": "sl1_...",
  "audience": "marketplace.example",
  "issued_at": "2026-05-27T00:00:00.000Z",
  "expires_at": "2026-05-27T00:10:00.000Z",
  "proof_id": "idp_...",
  "signature": "..."
}
```

IdentityProof proves controller-to-entity binding.

It does not prove:

```text
authority
grants
capabilities
application permissions
execution rights
```

---

## 4. Proof Semantics

The proof ladder is:

```text
Signature
  proves cryptographic control

AuthenticationProof
  proves controller authenticated for challenge

IdentityProof
  proves authenticated controller is linked to Entity

Authorization
  proves authority lineage for a concrete IntentApproval
```

These objects must not collapse.

---

## 5. Audience Binding

Every IdentityProof must be audience-bound.

Required fields:

```text
audience
issued_at
expires_at
challenge
proof_id
```

An IdentityProof for one application must not be accepted by another application.

Examples:

```text
audience: marketplace.example
audience: app.meanly.io
audience: partner-console.example
```

Audience binding prevents identity proof replay across sites.

---

## 6. Challenge Lifecycle

SL1 Connect challenge flow:

```text
Application requests challenge
SL1 creates challenge bound to audience and expiry
Controller signs challenge through WebAuthn
SL1 verifies authentication response
SL1 resolves controller -> Entity binding
SL1 issues IdentityProof
Application verifies IdentityProof
Application creates local session if desired
```

Challenge records must include:

```text
challenge
audience
created_at
expires_at
used_at
controller_hint optional
entity_hint optional
```

A challenge must be single-use.

A challenge must expire.

A challenge must be audience-bound.

---

## 7. External Application Contract

An external application may use IdentityProof to answer:

```text
Who authenticated?
Which SL1 Entity is linked?
Is this proof intended for my audience?
Is the proof currently valid?
```

It must not use IdentityProof to answer:

```text
What may this Entity do?
May this controller execute this action?
May this account transfer assets?
Is this user an admin?
```

Those questions require policy, capability, control grants, and authorization.

---

## 8. Site Action Boundary

Login and action authorization are separate.

Correct flow:

```text
IdentityProof
  -> site session

Site Action
  -> Intent
  -> IntentApproval
  -> Authorization
  -> Execution
```

Incorrect flow:

```text
IdentityProof
  -> site action allowed
```

The site may create a local session from IdentityProof.

The site must not infer SL1 authority from that session.

---

## 9. Anti-Patterns

The following patterns violate RFC-0018:

```text
AuthenticationProof -> Capability
AuthenticationProof -> Authorization
IdentityProof -> ControlGrant
IdentityProof -> application admin
Passkey -> Permission
WebAuthn credential -> Authority
Signature -> Authorization
```

Valid path:

```text
Signature
  -> AuthenticationProof
  -> IdentityProof

Intent
  -> IntentApproval
  -> Authorization
  -> Execution
```

---

## 10. Implementation Requirements

A conforming SL1 Connect implementation should provide:

```text
registration challenge storage
registration verification
authentication challenge storage
authentication verification
controller-to-entity resolution
signed IdentityProof token
audience binding
expiry enforcement
single-use challenge enforcement
key revocation awareness
```

Production implementations must verify WebAuthn registration and authentication responses.

Accepting raw public keys from clients is development-only behavior.

---

## 11. Review Gate

Every proposal that introduces identity proofs, sessions, connect widgets, application login, or website integration must answer:

```text
Does this proposal treat authentication or identity proof as authority?
```

If yes, redesign.

Cryptographic Fact Test:

```text
Does this proposal treat a cryptographic proof as authority?
```

If yes, redesign.

---

## 12. Non-Goals

This document does not define:

```text
application session storage
application roles
asset transfer authorization
agent authorization model
governance login policy
social recovery
```

Those belong to applications or later RFCs.

RFC-0018 defines only verifiable identity proof issuance for external applications.
