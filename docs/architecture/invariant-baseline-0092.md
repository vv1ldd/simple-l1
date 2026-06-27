# Pre-Production Invariant Baseline (post ADR-0092)

Status: Baseline snapshot
Captured: 2026-06-27
Commit: 023da97
Runtime: node v24.4.1
Discovery: `cd node && for f in scripts/test-*.js; do node "$f"; done`
Result: **39 passed / 0 failed**

## Why this baseline exists

ADR-0085 through ADR-0092 close the hardening line. The capstone proof in
`node/scripts/test-cryptographic-assurance.js` fixes the most important
cryptographic boundary:

> Signature validity != Transition validity

The stack is now separated by responsibility:

```text
Crypto layer        -> "who signed?"
Registry + Validator -> "were they allowed?"
Accepted Realm Event -> "what became part of history?"
```

## Master invariant of the hardening line

```text
Everything can be copied.
Everything can be signed.
Everything can be transported.
Only accepted history creates Realm truth.
```

## Attack classes proven rejected (ADR-0092 capstone)

| Class | Attack | Rejection layer | Runtime reason code |
|-------|--------|-----------------|---------------------|
| 1 | Forged signature | Cryptographic | `DEVICE_SIGNATURE_INVALID` |
| 2 | Valid signature, revoked/unknown key | Key lifecycle | `DEVICE_SIGNER_NOT_ACTIVE` |
| 3 | Valid active key, forbidden scope | Authority policy | `AUTHORITY_TRANSITION_DENIED` |

`deviceRootEscalationProposal()` exercises class 3 specifically: the signature
verifies, then the kernel performs a semantic rejection rather than a
cryptographic one.

## ADR reason-code aliases (doc → runtime)

| ADR-0092 term | Runtime code |
|---------------|--------------|
| `EVENT_HASH_CHAIN_INVALID` | `REALM_EVENT_CHAIN_BROKEN` |
| `KEY_SCOPE_REVOKED` | `DEVICE_SIGNER_NOT_ACTIVE` |

## Hardening chain (ADR-0085 → ADR-0092)

```text
ADR-0085  Replay/storage optimization
   ↓
ADR-0086  Key lifecycle
   ↓
ADR-0087  Quorum recovery
   ↓
ADR-0088  Attestation
   ↓
ADR-0089  Evidence export
   ↓
ADR-0090  SDK surface
   ↓
ADR-0091  Adversarial verification
   ↓
ADR-0092  Cryptographic assurance
```

## Discovery snapshot (39 scripts)

```text
PASS  scripts/test-admin-operations-boundary.js
PASS  scripts/test-adversarial-verification.js
PASS  scripts/test-ceremony-par-overlay.js
PASS  scripts/test-cryptographic-assurance.js
PASS  scripts/test-device-event-submission-runtime.js
PASS  scripts/test-disaster-recovery-runbook.js
PASS  scripts/test-event-schema-evolution-runtime.js
PASS  scripts/test-evm-canonicalization.js
PASS  scripts/test-execution-kernel.js
PASS  scripts/test-federation-trust-runtime.js
PASS  scripts/test-fpl-v0.js
PASS  scripts/test-identity-mesh-conformance.js
PASS  scripts/test-identity-mesh-runtime.js
PASS  scripts/test-identity-proof-conformance.js
PASS  scripts/test-identity-proof-runtime.js
PASS  scripts/test-identity-realm-ledger-store.js
PASS  scripts/test-issuer-ceremony-delegation.js
PASS  scripts/test-marketplace-seller-launch.js
PASS  scripts/test-realm-api-adapter-runtime.js
PASS  scripts/test-realm-backup-restore-runtime.js
PASS  scripts/test-realm-command-execution-runtime.js
PASS  scripts/test-realm-command-runtime.js
PASS  scripts/test-realm-integrity-check-runtime.js
PASS  scripts/test-realm-lifecycle-runtime.js
PASS  scripts/test-realm-observability-runtime.js
PASS  scripts/test-realm-replication-transport-runtime.js
PASS  scripts/test-realm-snapshot-runtime.js
PASS  scripts/test-realm-validator-engine.js
PASS  scripts/test-reconciliation-v0.js
PASS  scripts/test-shadow-validation.js
PASS  scripts/test-sl1-wire-conformance.js
PASS  scripts/test-sl1e-authorize-registry.js
PASS  scripts/test-subject-authority-classifier.js
PASS  scripts/test-subject-authority-runtime.js
PASS  scripts/test-subject-authority-shadow-reconciler.js
PASS  scripts/test-subject-claim-history-runtime.js
PASS  scripts/test-subject-claim-issuance-policy.js
PASS  scripts/test-subject-email-claims.js
PASS  scripts/test-web-wallet-portability.js
----
passed=39 failed=0
```

## Next boundary (not yet defined)

After ADR-0092 the dominant risk is no longer a runtime bug but a change to the
language in which the Realm proves causality. The next logical ADR is protocol
governance, not per-layer defense:

> **ADR-0093 Realm Protocol Evolution Governance** — who may change event
> schemas, registry rules, cryptographic algorithms, SDK contracts, and
> compatibility guarantees.
