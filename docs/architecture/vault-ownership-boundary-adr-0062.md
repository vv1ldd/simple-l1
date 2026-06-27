# ADR-0062: Vault Ownership Boundary

Status: Accepted

This ADR freezes the boundary between entity-owned private state, encrypted
storage representations, and application-owned domain projections.

ADR-0059 froze identity ownership. ADR-0061 froze authentication adapter
replaceability. ADR-0062 freezes where private user state lives and who owns it.

```text
RFC-0018 answers: What is a verifiable identity proof?
ADR-0059 answers: Who issues identity, who consumes it, and what clients must never do?
ADR-0060 answers: Who evaluates policy, who decides, and what may change domain state?
ADR-0061 answers: How may authentication mechanisms evolve without reissuing identity?
ADR-0062 answers: Where does private user state live, and who owns it?
```

## Acceptance Criteria

ADR-0062 is accepted when the following boundaries are frozen:

```text
vault_belongs_to_entity
application_does_not_own_canonical_vault
server_stores_encrypted_blob_not_plaintext_secret
authentication_adapter_enables_vault_key_access
ownership != storage
storage_provider != vault_owner
entity_is_canonical_vault_authority
access_delegation != ownership_transfer
ownership_is_canonical
access_is_policy_governed
vault_storage != identity_authority
vault_contents != claims
vault_access_policy != application_decision_by_default
application_cache != canonical_vault
vault_reference_is_stable
vault_unlock_mechanism_is_replaceable
vault_is_not_identity_provider
vault_is_not_authorization_service
vault_is_not_claim_history
```

## Constitutional Kernel

```text
Entity owns the vault.
Storage providers store encrypted representations.
Ownership is canonical.
Access is policy-governed.
```

The canonical vault belongs to `sl1e_*`. Applications may read, cache, or
project vault data only through delegated access. They must not become the
owner of the canonical vault.

## Questions This ADR Answers

```text
Where does private user state live, and who owns it?
Who stores encrypted vault representations, and why does storage not imply ownership?
```

This ADR does **not** answer how vault crypto is implemented, which blob schema
is used, or how sync/recovery/sharing work. Those belong in follow-up ADRs.

## Core Ownership Model

```text
sl1e_...
    │
    │ owns
    ▼
Personal Vault
    │
    ├── notes
    ├── secrets
    ├── wallets
    ├── recovery material
    ├── documents
    ├── preferences
    └── ...
```

The first canonical vault scenario is a **portable personal vault** owned by
the entity, not by any single application.

Storefront, admin panel, API gateway, and future products are clients of that
vault. They may maintain local caches or projections, but they do not own the
canonical vault.

## Ownership Is Not Storage

```text
Entity owns the vault.
Storage providers store encrypted representations.
```

Storage custody does not create vault ownership.

A server, cloud provider, CDN, IPFS node, or self-hosted storage backend may
hold encrypted vault data without becoming the vault owner.

Replaceable storage backends include:

```text
S3
IPFS
local disk
managed cloud storage
self-hosted storage
future storage backend
```

Changing the backend must not change who owns the vault.

## Logical Vault vs Physical Representation

```text
Vault (logical object)
        │
        │ represented as
        ▼
Encrypted Blob(s)
        │
        │ stored by
        ▼
Storage Provider
```

The logical vault may later be represented as:

```text
single encrypted blob
blob tree
chunked storage
Merkle representation
future encrypted representation format
```

The representation format is replaceable. The vault ownership model is not.

## Vault Reference vs Storage Object

```text
Vault Reference
    stable logical identifier of the canonical vault

Storage Object
    physical encrypted representation stored by a backend
```

`Vault Reference` remains stable while storage objects and backends migrate.

Invalid inference:

```text
storage_object_location -> vault_owner          # INVALID
backend_migration -> new_vault_identity         # INVALID
application_cache -> canonical_vault            # INVALID
```

## Default Access Boundary

The default storage model is:

```text
Authentication Adapter
        │
        │ enables access to
        ▼
Vault Key
        │
        │ decrypts
        ▼
Encrypted Blob(s)
        │
        │ stored by
        ▼
Storage Provider
```

This is a responsibility boundary, not a final cryptographic construction.

Future designs may use:

```text
multiple key wrappers
hardware secure modules
threshold recovery
recovery contacts
several unlock paths
```

The invariant is only:

```text
server stores encrypted representations
entity-controlled unlock path gates access to plaintext
```

This aligns with ADR-0061: the unlock mechanism is replaceable, but the vault
reference and entity ownership remain stable.

## Vault Is Not Claims

Vault and claims are different layers.

```text
Vault   contains private user-controlled data.
Claims  are issuer-governed attestations.
```

Private vault data may later become evidence for a claim ceremony, but vault
storage must not become claim history.

Invalid collapse:

```text
vault_entry -> claim_event                 # INVALID
vault_storage -> issuer_attestation      # INVALID
private_note -> subject_authority          # INVALID
```

## Ownership vs Access Control

```text
The Entity is the canonical authority over the vault.
Access may be delegated without transferring ownership.
```

Future models may include:

```text
delegated access
shared access
recovery contacts
time-bounded permissions
application-scoped read/write grants
```

Delegation grants access. It does not transfer vault ownership.

## What Vault Must Not Become

```text
Vault is not an identity provider.
Vault is not an authorization service.
Vault is not claim history.
```

This does not prevent applications from using vault data as business input. It
only prevents vault storage from becoming identity, authority, or attestation.

## Layer Symmetry

ADR-0062 adds the private-state layer to the platform model:

```text
Authentication Adapter   proves control
Identity                 defines global subject
Vault                    stores entity-owned private state
Claims                   assert facts about subject
Policy                   defines app requirements
Decision                 allows or denies action
Domain Projection        mutates app-owned state
```

Two axes intersect in applications but must not collapse:

```text
User data axis:       Authentication -> Identity -> Vault -> Private Data
Trust/control axis:   Authority -> Claims -> Policy -> Decision -> Domain State
```

Responsibility symmetry:

```text
Identity      belongs to / is issued for Entity
Vault         belongs to Entity
Claims        belong to their issuers / claim history
Policies      belong to applications
Domain State  belongs to applications
```

## Relationship To Prior ADRs

ADR-0059 says applications never own identity; they project verified entities
into local domain state. ADR-0062 adds that applications also never own the
canonical vault.

ADR-0061 says authentication adapters are replaceable without reissuing
identity. ADR-0062 extends that idea to vault unlock: the unlock mechanism may
change without changing vault ownership or vault reference.

ADR-0060 says applications evaluate verified truth and local policy into
decisions. ADR-0062 says vault access may be policy-governed, but vault
ownership remains with the entity.

## Non-Goals

This ADR does not define:

```text
vault key derivation / wrapping
multi-device sync
recovery ceremony design
sharing / delegation protocol
server blob schema
local-first vs cloud-backed cache behavior
vault UX
```

Those belong in follow-up ADRs.

## Consequences

### Positive

- Private user state becomes portable across applications within an entity.
- Storage backends can evolve without rewriting identity, claims, or app policy.
- Vault unlock can evolve with ADR-0061 adapters without changing vault ownership.
- Applications can be rewritten or removed without destroying the canonical vault.

### Negative / Operational

- Every application must treat vault data as entity-owned input, not as its own account system.
- Delegated access, recovery, and sharing need explicit future policy ADRs.
- Encrypted blob storage requires careful key-management and migration design in later ADRs.

## References

- `rfc/0012-ontology-core-v0.1.md`
- `rfc/0018-sl1-connect-and-identity-proof.md`
- `docs/architecture/identity-issuance-client-authentication-adr-0059.md`
- `docs/architecture/policy-decision-domain-projection-boundary-adr-0060.md`
- `docs/architecture/authentication-adapter-boundary-adr-0061.md`
