# Realm Protocol v1 Compliance Matrix

Status: informative

This matrix records implementation maturity against Realm Protocol v1. It is not a substitute for the normative specification, schemas, profiles, or conformance vectors. A capability is marked pass only when an implementation has an executable proof in this repository.

Legend:

- `PASS` means executable proof exists and passed against Realm Protocol v1 artifacts.
- `PARTIAL` means the implementation proves a narrower Core-compatible subset.
- `PENDING` means no executable proof is present yet.
- `N/A` means the capability is outside the implementation scope.

## Compatibility Levels

Realm Protocol compatibility is tracked at three levels. Higher levels do not replace lower levels.

| Level | Name | Requirement |
| --- | --- | --- |
| Level 1 | Semantic | The same accepted history produces the same semantic anchors: `history_head`, `projection_hash`, `current_authority`, and `authority_subjects`. |
| Level 2 | Evidence | The same accepted history produces the same proof material: `integrity_report_hash`, lifecycle state, explanation anchors, attestation payload material, and evidence package hash. |
| Level 3 | Operational | The implementation independently executes the operational pipeline: verify, backup, restore, deployment gate, release governance, attestation, and evidence export. |

## Protocol Version Matrix

This axis answers whether an implementation understands a protocol version. Future protocol versions must add their own normative corpus before any implementation can claim pass.

| Implementation | Protocol v1 Core | Protocol v1 Evidence | Protocol v1 Operational | Protocol v2 |
| --- | --- | --- | --- | --- |
| Node | PASS | PASS | PASS | PENDING |
| Rust | PASS | PARTIAL | PENDING | PENDING |
| Go | PENDING | PENDING | PENDING | PENDING |
| WASM | PENDING | PENDING | PENDING | PENDING |
| Swift | PENDING | PENDING | PENDING | PENDING |

## Capability Matrix

| Capability | Node | Rust |
| --- | --- | --- |
| Core Profile | PASS | PASS |
| Canonical Replay | PASS | PASS |
| Semantic Anchors | PASS | PASS |
| Cross-Language Replay Equality | PASS | PASS |
| Cross-Language History Exchange | PASS | PASS |
| Portable Core Evidence Material | PASS | PASS |
| Integrity Report | PASS | PARTIAL |
| Attestation Payload | PASS | PARTIAL |
| Evidence Package Hash | PASS | PARTIAL |
| Evidence Export | PASS | PENDING |
| Extended Profile | PASS | PENDING |
| Operational Profile | PASS | PENDING |

## Current Proofs

| Proof | Command |
| --- | --- |
| Node Core conformance | `node node/scripts/realm-conformance.js --profile core --vectors docs/protocol/v1/vectors --interpreter builtin-dual` |
| Rust Core conformance | `node node/scripts/realm-conformance.js --profile core --vectors docs/protocol/v1/vectors --interpreter implementations/rust/realm-interpreter-v1/target/release/realm-interpreter` |
| Cross-language replay equality | `node node/scripts/test-cross-language-replay-equality.js` |
| Cross-language history exchange | `node node/scripts/test-cross-language-history-exchange.js` |
| Cross-language evidence interoperability | `node node/scripts/test-cross-language-evidence-interoperability.js` |
| Node certification report | `node node/scripts/realm-certify.js --implementation node --profile core --protocol 1.0` |
| Rust certification report | `node node/scripts/realm-certify.js --implementation rust --profile core --protocol 1.0` |

## Compliance Claims

### Node

Node may claim:

```text
Realm Protocol v1
Core Conformant
Implementation: Node
Conformance: PASS (Core)
anchor_schema: 1
protocol_version: 1.0
```

Node also has repository-local executable proofs for integrity, lifecycle, release governance, artifact provenance, evidence export, and operational boundaries.

### Rust

Rust may claim:

```text
Realm Protocol v1
Core Conformant
Implementation: Rust
Conformance: PASS (Core)
anchor_schema: 1
protocol_version: 1.0
```

Rust currently proves Core replay, semantic anchors, history exchange, and portable Core evidence material. It does not yet claim Extended or Operational profile conformance.
