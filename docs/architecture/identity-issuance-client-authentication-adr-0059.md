# ADR-0059: Identity Issuance And Client Authentication Model

Status: Accepted

This ADR freezes the fundamental responsibility boundary between SL1 issuers, SL1 entities, and client services that consume identity through Connect.

RFC-0018 defines verifiable identity proof issuance. ADR-0059 defines how every client service must participate in that model without becoming an identity authority.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0056 answers: What may email mean, and what must it never mean?
ADR-0057 answers: How may claims change without changing subject authority?
ADR-0058 answers: Which claim candidates may be admitted to claim history?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
```

## Acceptance Criteria

ADR-0059 is accepted when the following boundaries are frozen:

```text
issuer_is_only_identity_authority
entity_is_global_subject_not_site_account
client_verifies_proof_only
client_does_not_issue_entity
connect_flow_is_canonical_for_all_services
par_stores_issuer_owned_request_only
ceremony_interactive_params_are_live_overlay_only
ledger_issuer_authority != end_user_identity
```

## Architectural Roles

```text
Issuer (SL1)
    │
    │ issues & attests
    ▼
SL1 Entity (sl1e_...)
    │
    │ presented with proof
    ▼
Client Service
    │
    │ creates local session / account mapping
    ▼
Application
```

### Issuer

The issuer is the only source of truth for identity.

Only the issuer:

- registers passkeys against an `sl1e_*` subject;
- runs the Connect ceremony;
- issues and signs identity proofs;
- maintains the issuer ledger for subjects it has observed.

Examples in production:

- `pass.meanly.ru` for the RU contour
- `pass.meanly.one` for the ONE contour

### Entity

An entity is a global subject identified by `sl1e_*`.

An entity:

- exists independently of any client service;
- is not owned by a website, panel, or application;
- may be presented to many clients through proofs issued by the same issuer contour.

### Client Service

A client service trusts an issuer, verifies proofs, and maps verified entities to local application state.

Examples:

- `meanly.ru`
- `meanly.one`
- Sovereign Coolify panels (`lena.meanly.ru`, `lena.meanly.one`)
- future internal APIs and products

### Application

The application layer implements business logic and access control on top of the client’s local session. It must not redefine identity authority.

## What A Client Must Never Do

A conforming client service:

- does **not** create identity;
- does **not** issue `sl1e_*` entities;
- does **not** sign identity claims;
- does **not** become an identity authority;
- does **not** store passwords as the source of identity;
- does **not** treat local user rows as cryptographic identity.

A conforming client service only says:

```text
I trust this issuer.
If the proof is valid, the authenticated subject is this sl1e_*.
```

## Canonical Connect Contract

Every new client service uses the same sequence:

```text
Client
    │
    │ PAR push
    ▼
Issuer
    │
    │ short authorize URL (/r/sl1rq_...)
    ▼
Connect
    │
    │ user authenticates (passkey / account switch)
    ▼
Issuer
    │
    │ callback + IdentityProof
    ▼
Client
    │
    │ verify proof
    ▼
Local session
```

### Issuer-owned request (frozen at PAR push time)

The pushed authorization request stores only issuer-owned parameters:

```text
client_id
redirect_uri
state
nonce
scope
mode
flow
intent metadata
```

### Ceremony-interactive overlay (live, never frozen in PAR)

The following parameters belong to the live ceremony and must be applied as an overlay on top of the resolved PAR:

```text
identity_hint
login_hint
entity_l1_address
browser_identity_hint
remembered_identity_hint
identity_capsule
sl1e_switch
alias
display_alias
alias_locale
ui_locale
alias_reservation_owner
```

Rule:

```text
resolved_par_query + live_ceremony_overlay => effective_authorize_query
```

The live overlay wins for ceremony-interactive parameters. The stored PAR remains authoritative for issuer-owned request fields.

This is the canonical Connect behavior validated in production for marketplace storefronts and Sovereign Coolify panels.

### Client onboarding checklist

To attach a new service to SL1 Connect:

1. Register the client in the issuer client registry:
   - `client_id`
   - `client_secret`
   - allowed `redirect_uris`
2. Push authorization parameters to `/api/sl1e/authorize/requests` (PAR).
3. Redirect the user to the returned short URL (`/r/sl1rq_...`).
4. Handle the callback, verify the proof, and bind the verified `entity_l1_address` to local session state.

Fail closed:

- if PAR push fails, do not fall back to legacy long `/authorize?...` URLs;
- if proof verification fails, do not create or refresh a session.

## Local User Model

After successful proof verification, the client needs only a minimal local mapping:

```text
entity_l1_address
local_user_id
created_at
last_login_at
```

Optional non-authoritative metadata may be copied from the proof envelope (for example display alias or contact claim hints), but it must never be treated as identity authority.

There are:

- no passwords as identity source;
- no client-issued entities;
- no separate cryptographic “accounts” invented by the application.

## Ledger Issuer Authority vs End-User Identity

These roles must never be mixed.

### End-user identity

```text
passkey
    ↓
Issuer
    ↓
sl1e_xxx
```

This is the identity a person uses to authenticate.

### Ledger issuer authority

```text
@devledgerissuer / @devledgerissuerru
        │
        ▼
trusted operational authority for issuer-side claims and panel control
```

This is not a normal consumer identity.

It is a delegated operational authority used for issuer-side control surfaces such as Sovereign Coolify panels. It may be entitled to issue or endorse certain ledger-scoped claims, but it is not “the user” in the Connect sense.

Rule:

```text
user_authenticates_as_sl1e_*
issuer_signs_claims
client_verifies_signatures_and_proofs
ledger_issuer_authority != consumer_identity
```

## Relationship To Claims

ADR-0056 through ADR-0058 govern claim meaning, history, and admission.

ADR-0059 does not redefine claims. It freezes the layer beneath them:

```text
identity issuance and proof verification happen first
claims may describe properties of an already-constituted subject
claims do not create the subject
```

## Consequences

### Positive

- One Connect protocol for all Meanly surfaces and internal services.
- Identity remains portable across clients within the same issuer contour.
- Account switching in Connect is authoritative and cannot be overridden by stale PAR state.
- Future ADRs for federation, claims, and authority policy can reference ADR-0059 instead of re-explaining issuer vs client responsibilities.

### Negative / Operational

- Each contour maintains its own issuer ledger; device passkeys for one RP ID do not automatically imply registration on another issuer host.
- Client operators must keep client registry entries, redirect URIs, and PAR secrets aligned per contour.
- Operational ledger-issuer accounts must be provisioned deliberately; they are not interchangeable with personal user identities.

## References

- `rfc/0018-sl1-connect-and-identity-proof.md`
- `docs/architecture/email-claim-notification-boundary-adr-0056.md`
- `docs/architecture/claim-history-disclosure-boundary-adr-0057.md`
- `docs/architecture/claim-issuance-policy-boundary-adr-0058.md`
- `node/sl1e-ceremony-params.js`
- `node/sl1e-authorize-requests.js`
