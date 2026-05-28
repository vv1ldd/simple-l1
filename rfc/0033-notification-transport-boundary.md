# RFC-0033: Notification Transport Boundary

Status: Draft

This document defines `sl1.notification.v1`, the protocol transport boundary for non-authoritative discovery messages.

RFC-0033 depends on:

```text
RFC-0018: SL1 Connect & Identity Proof
RFC-0024: Semantic Isolation & Domain Integrity
RFC-0025: Runtime Architecture & Responsibility Boundaries
RFC-0030: Intent Evaluation & Deterministic Authorization Artifacts
```

---

## 1. Theorem

```text
A notification may disclose the existence of an authority artifact,
but may never grant, transfer, consume, or mutate authority.
```

This separates discovery transport from authority semantics.

---

## 2. Violation Class

### Authoritative Transport Collapse

A delivery channel or notification object is treated as authority.

Examples:

- email link possession creates membership;
- magic link possession creates a session;
- password reset delivery possession changes identity authority;
- inbox notification possession consumes an invitation artifact;
- read/dismiss status changes artifact validity or role scope.

Forbidden assumption:

```text
whoever possesses transport possesses authority
```

Required assumption:

```text
transport disclosure never implies authority transfer
```

---

## 3. NotificationEnvelope

`NotificationEnvelope` is a non-authoritative pointer.

```json
{
  "object_type": "NotificationEnvelope",
  "version": "sl1.notification.v1",
  "notification_type": "team.invitation",
  "recipient_hint": {
    "type": "entity",
    "value": "sl1e_..."
  },
  "artifact_ref": {
    "object_type": "TeamInvitationArtifact",
    "id": "tinv_...",
    "version": "team.invitation.v1",
    "hash": "..."
  },
  "issuer_entity_l1_address": "sl1e_...",
  "status": "pending",
  "authority_effect": "none",
  "non_authoritative": true,
  "consumes_artifact": false,
  "mutates_authority": false,
  "capabilities_granted": []
}
```

Allowed status transitions:

```text
pending -> read
pending -> dismissed
read -> dismissed
pending/read/dismissed -> expired
```

These transitions affect notification metadata only.

They must not affect:

- artifact validity;
- artifact scope;
- artifact expiry;
- policy decision;
- capability grants;
- team membership;
- identity authority.

---

## 4. Recipient Hints

Recipient hints route discovery.

Supported hint types:

```text
entity
alias
email_hash
external
```

Only `entity` is a principal address.

`alias`, `email_hash`, and `external` are discovery hints. They are not proof of identity.

---

## 5. Authority Flow Separation

Notification flow:

```text
AuthorityArtifact
  -> NotificationEnvelope
  -> DeliveryChannel
  -> recipient discovery
```

Authority consumption flow:

```text
IdentityProof
  + AuthorityArtifact
  + PolicyEvaluation
  -> ArtifactConsumption
  -> StateMutation
  -> LedgerFinality
```

The two flows must remain separate.

---

## 6. Team Invitation Application

For team invitations:

```text
team.member.invite
  -> TeamInvitationArtifact
  -> NotificationEnvelope(team.invitation)
  -> SL1 inbox / discovery fallback
```

Future join:

```text
SL1 IdentityProof
  + TeamInvitationArtifact
  -> team.member.join PolicyDecision
  -> artifact consumption
  -> membership mutation
```

Notification possession alone is insufficient.

Link possession alone is insufficient.

Email possession alone is insufficient.
