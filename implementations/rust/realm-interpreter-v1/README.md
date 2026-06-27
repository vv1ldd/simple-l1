# Realm Protocol v1 — Rust Core Interpreter

Independent Core-profile interpreter for Realm Protocol v1. This crate proves that the normative conformance corpus under `docs/protocol/v1/vectors` is sufficient for a language-agnostic implementation.

## Scope

Core interpreter only:

- history parser
- hash-chain verification
- event interpretation (`ROOT_AUTHORITY_CREATED`, `DEVICE_KEY_ISSUED` v1)
- projection + semantic anchors
- minimal proposal rejection for normative negative vectors

Out of scope: transport, snapshots, observability, deployment, release governance.

## Build

```bash
cargo build --release
```

## Run conformance

```bash
./target/release/realm-interpreter \
  --profile core \
  --vectors ../../../docs/protocol/v1/vectors
```

Or via the stable harness:

```bash
node ../../../node/scripts/realm-conformance.js \
  --profile core \
  --vectors ../../../docs/protocol/v1/vectors \
  --interpreter ./target/release/realm-interpreter
```

## Replay and Exchange

Emit semantic anchors for a history:

```bash
./target/release/realm-interpreter \
  --replay ../../../docs/protocol/v1/vectors/canonical/authority-basic/history.jsonl
```

Emit portable Core evidence material for a history:

```bash
./target/release/realm-interpreter \
  --evidence ../../../docs/protocol/v1/vectors/canonical/authority-basic/history.jsonl
```

Export the Rust-generated canonical Core history used by the exchange proof:

```bash
./target/release/realm-interpreter --export-authority-basic
```

The Node-side exchange proof verifies both directions:

```bash
node ../../../node/scripts/test-cross-language-history-exchange.js
```

The evidence interoperability proof compares Node and Rust over `history_head`, `projection_hash`, `integrity_report_hash`, lifecycle state, attestation payload material, and evidence package hash:

```bash
node ../../../node/scripts/test-cross-language-evidence-interoperability.js
```
