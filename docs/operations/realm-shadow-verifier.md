# Realm Shadow Verifier Operations

Status: Post-freeze operational maintenance

This document describes how to run Rust as an independent semantic observer beside the Node runtime. This is operational evidence, not a change to Protocol v1.0 meaning.

## Role Separation

```text
Node runtime     -> executes accepted history
Rust verifier    -> independently replays accepted history
Protocol corpus  -> defines semantic equivalence
Shadow verifier  -> measures semantic health
```

Rust is not a runtime owner. Rust answers:

```text
"If Node is removed from the equation, does the same Realm meaning remain?"
```

## Two Proof Types

| Check | Script | Question |
|-------|--------|----------|
| Protocol proof | `test-cross-language-replay-equality.js` | Can another implementation understand the same standard? |
| Runtime proof | `realm-shadow-verify.js` | Does the current running history still match that standard? |

The first proves protocol existence. The second proves meaning continuity over time.

## Phase 1: Manual Shadow Verification

Build the Rust Core interpreter if needed:

```bash
cd implementations/rust/realm-interpreter-v1
cargo build --release
```

Run shadow verification against an exported history:

```bash
cd node
npm run realm:shadow-verify -- --history ../docs/protocol/v1/vectors/canonical/authority-basic/history.jsonl
```

Expected healthy output:

```json
{
  "status": "OK",
  "semantic_health": "OK",
  "differences": []
}
```

On divergence:

```json
{
  "status": "DIVERGED",
  "semantic_health": "FAIL",
  "differences": [
    {
      "path": "current_authority",
      "node": "alice",
      "rust": "bob"
    }
  ]
}
```

Exit code:

- `0` -> semantic health OK
- non-zero -> divergence or replay failure

## Compared Fields

The shadow verifier compares:

- `history_head`
- `projection_hash`
- `current_authority`
- `last_sequence`
- `canonical_event_count`
- `authority_subjects`

These are the operational semantic anchors for Core-profile replay.

## Health Model

Do not conflate process health with semantic health.

```text
technical health:
  CPU / RAM / API / DB

semantic health:
  history valid
  replay equal
  anchors equal
```

A system can be technically healthy but semantically diverged:

```text
Node running      OK
API healthy       OK
Database healthy  OK
Realm meaning     FAIL
```

## Phase 2: CI And Release Gate

Keep normative corpus proof separate:

```bash
node node/scripts/test-cross-language-replay-equality.js
node node/scripts/test-realm-shadow-verify.js
```

Use shadow verification as operational evidence in certification and release workflows only. It must not change `package_fingerprint`.

Allowed effect:

```text
same package_fingerprint
new operational evidence artifact
new distribution_digest
```

Not allowed effect:

```text
new verifier tool
-> changed protocol meaning
```

## Phase 3: Production Shadow Mode

Recommended deployment pattern:

```text
Node accepts events
        ↓
Node writes canonical history
        ↓
scheduled export to history.jsonl
        ↓
realm-shadow-verify
        ↓
semantic health report
```

Suggested rollout policy:

1. Run shadow verification on every history export.
2. Treat `semantic_health: FAIL` as a rollout blocker.
3. Preserve the exported history before rollback or repair.
4. Alert on the first differing anchor path, plus `history_head` and `projection_hash`.

Suggested alert payload:

```json
{
  "alert": "semantic_divergence_detected",
  "history_head": "...",
  "projection_hash_node": "...",
  "projection_hash_rust": "...",
  "first_difference_path": "current_authority"
}
```

This is a semantic heartbeat:

```text
ordinary heartbeat: server responds
Realm heartbeat: server still interprets accepted history the same way
```

## Later Phases

After shadow verification is stable:

- use Rust Core for import/export validation
- use Rust Core for disaster recovery replay
- use Rust Core for audit and integrity checks
- compile Rust Core to WASM for browser/mobile/local verification

## Governance Boundary

This rollout adds operational evidence only.

```text
Accepted transitions preserve runtime truth.
Governed changes preserve protocol meaning.
Digested artifacts preserve publication identity.
```

Shadow verification preserves runtime truth observation. It does not create new protocol meaning.
