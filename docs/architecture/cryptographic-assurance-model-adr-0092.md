# ADR-0092: Cryptographic Assurance Model

Status: Accepted

This ADR defines what cryptographic hashing and signing prove in a Realm system
without making cryptography a source of authority, identity, or accepted
transitions.

ADR-0091 established adversarial verification: every non-kernel layer may lie, but
only accepted history may cause truth. ADR-0092 defines cryptographic meaning:
what is hashed, what is signed, what survives key rotation, and what survives
algorithm migration.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss without restoring key material?
ADR-0071 answers: How does an active device submit authorized mutations?
ADR-0072 answers: How is external authority acceptance implemented as local policy?
ADR-0073 answers: How may event contracts evolve without rewriting history?
ADR-0074 answers: How may replay be accelerated without replacing history?
ADR-0075 answers: How may verified histories move without becoming a copy?
ADR-0076 answers: How may actors request transitions without bypassing truth?
ADR-0077 answers: How may current truth be explained without becoming state?
ADR-0078 answers: How may a Realm prove its own internal consistency?
ADR-0079 answers: How should a Realm operate when integrity is verified, degraded, or failed?
ADR-0080 answers: What must be preserved to restore the same Realm after loss?
ADR-0081 answers: How may a Realm safely return to operation after disaster?
ADR-0082 answers: How may administrators operate a Realm without becoming authority?
ADR-0083 answers: How may runtime deployment change without changing truth?
ADR-0084 answers: How may many Realms be operated without merging authority domains?
ADR-0085 answers: How may history replay and storage scale without changing truth?
ADR-0086 answers: How may key lifecycle be operated without making keys identity?
ADR-0087 answers: How may quorum recovery restore continuity without creating authority?
ADR-0088 answers: How may Realm state be externally verified without creating authority?
ADR-0089 answers: How may compliance evidence be exported without exporting authority?
ADR-0090 answers: How may developers use Realm safely without bypassing the kernel?
ADR-0091 answers: How does the Realm preserve causality when every non-kernel layer may lie?
ADR-0092 answers: What exactly is cryptographic proof of continuity?
```

## Acceptance Criteria

ADR-0092 is accepted when the following cryptographic assurance boundaries are
frozen:

```text
cryptography_protects_evidence_continuity
cryptography_does_not_create_authority
valid_signature_does_not_imply_valid_authority_transition
event_hash_covers_semantic_bytes
event_hash_does_not_depend_on_projection
event_hash_does_not_depend_on_snapshot
event_hash_does_not_depend_on_explanation
signature_covers_canonical_proposal_material_not_current_state
tampered_event_payload_changes_hash
broken_previous_hash_breaks_chain
invalid_signature_rejected
valid_signature_with_invalid_scope_rejected
key_rotation_preserves_old_events
revoked_key_cannot_create_new_events
algorithm_migration_preserves_replay_equivalence
attestation_references_exact_cryptographic_anchors
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Cryptography protects evidence continuity.
Cryptography does not create authority.
```

Supporting kernel:

```text
Keys do not create history.
History gives keys meaning.
```

Wrong:

```text
valid signature
        ↓
valid authority transition
```

Correct:

```text
signature proves:
"this key authorized this statement"

history proves:
"this transition was accepted at this point"

authority model proves:
"this key was allowed to make this transition"
```

Hardening series guardrails:

```text
ADR-0086  key lifecycle != identity lifecycle
ADR-0088  attestation != authority
ADR-0091  threat model != authority
ADR-0092  cryptography != authority
```

## Context

The assurance stack is now:

```text
0085 Storage scaling
0086 Key lifecycle
0087 Quorum recovery
0088 Attestation
0089 Evidence export
0090 SDK
0091 Threat model
0092 Cryptographic assurance
```

The architecture already defines causal truth:

```text
proposal / evidence
        ↓
registry + validator
        ↓
accepted Realm Event
        ↓
hash-linked history
        ↓
projection
```

ADR-0092 defines what cryptography contributes at each step without replacing
the authority model.

## Questions This ADR Answers

```text
What exactly is hashed?
What exactly is signed?
What does a valid signature prove?
What does a valid event hash prove?
What survives key rotation?
What survives algorithm migration?
What cryptographic anchors must attestation reference?
What must never be signed or rehashed?
```

This ADR does **not** select a cryptographic library, HSM vendor, signature
algorithm suite, certificate authority, or hardware enclave design.

## Core Boundary

Cryptography protects evidence. Authority is decided by accepted history under
policy.

```text
proposal
        ↓
signature verification
        ↓
authority policy
        ↓
accept event
        ↓
hash chain
        ↓
projection
```

Not:

```text
sign(current_state)
        ↓
assume truth
```

## Four Cryptographic Objects

### 1. Event Cryptographic Identity

Each accepted Realm Event has a cryptographic identity derived from semantic
event bytes and chain linkage.

Canonical hash material:

```text
Realm Event Hash =
hash(
  event_type
  event_version
  sequence
  timestamp
  payload
  previous_event_hash
  authority_reference
  signer
)
```

The exact canonical encoding is fixed by the registry and must remain stable for
a given event version. Implementations may expose this as `realmEventHashMaterial`
and `canonicalEncode()`.

Invariants:

```text
hash covers semantic bytes
hash does not depend on projection
hash does not depend on snapshot
hash does not depend on explanation
hash does not depend on attestation
hash does not depend on export metadata
```

If projection logic changes but accepted event bytes do not, event hashes must
not change.

```text
Projection changes.
Event meaning does not.
```

Chain rule:

```text
event[n].previous_event_hash == event[n-1].current_event_hash
```

Broken linkage invalidates the chain regardless of signature validity elsewhere.

### 2. Signature Boundary

Signatures prove that a specific key authorized a specific canonical statement at
submission time.

Correct signing target:

```text
sign(
  canonical_event_intent
)
```

Wrong signing target:

```text
sign(
  current_state
)
```

Because state is derived.

Signature verification proves:

```text
this key produced this statement
```

It does not prove:

```text
this transition was accepted
this key had authority scope
this statement became canonical history
```

Those are separate checks:

```text
signature verification
        ↓
authority policy evaluation
        ↓
registry contract validation
        ↓
accept event
        ↓
append to hash chain
```

Device and recovery submissions follow the same rule: sign proposal material,
not projection.

### 3. Key Rotation Continuity

Key rotation changes future signing capability. It must not rewrite historical
cryptographic evidence.

Correct:

```text
Old key
        ↓
signed historical events remain valid

New key
        ↓
signs future accepted events
```

Wrong:

```text
new key
        ↓
rewrite old signatures
```

Rotation model:

```text
KEY_ROTATED event accepted
        ↓
projection updates active key
        ↓
history preserves old signer and old signatures
```

Historical verification must use the key context valid at acceptance time.
Current active key metadata is not sufficient to verify old events and must not
replace stored event bytes or historical signer attribution.

### 4. Algorithm Migration

Algorithm migration is the most dangerous production change because it tempts
systems to rewrite evidence.

Wrong:

```text
new algorithm
        ↓
rewrite entire history
```

Correct:

```text
historical event.signature_algorithm = v1
future event.signature_algorithm = v2
        ↓
replay verifies according to event metadata
        ↓
same projection
```

Rules:

```text
algorithm metadata is per-event or per-version evidence
verification selects algorithm by metadata
migration does not rehash accepted events
migration does not resign accepted events
unsupported algorithm blocks new verification, not history erasure
```

If an old algorithm becomes unavailable, the events remain canonical. Recovery
requires compatible verification tooling or archival proof, not history rewrite.

## Cryptographic Proof Layers

| Layer | Cryptography proves | Cryptography does not prove |
|-------|---------------------|-----------------------------|
| Event hash | semantic integrity and chain linkage | authority scope |
| Signature | key authorized statement | transition accepted |
| History head | current canonical chain tip | external trust |
| Projection hash | derived state from history | authority grant |
| Attestation envelope | observed anchors at verification time | Realm validity by assertion |
| Evidence export hash | package integrity | importable authority |

Authority emerges only after all layers align under policy.

## Attestation Cryptographic Anchors

Attestation and compliance export must reference exact cryptographic anchors:

```text
history_head
projection_hash
integrity_report_hash
event_hash_chain_root_or_head
registry_version
runtime_version
projection_version
signature_algorithm_metadata
key_lifecycle_projection_hash
attestation_material_hash
```

External consumers verify anchors. They do not trust a bare state claim.

If attestation material omits cryptographic anchors, it is explanatory evidence
only, not a continuity proof.

## Failure Modes

### Tampered Event Payload

```text
payload modified
        ↓
event hash mismatch
```

Expected result:

```text
REALM_EVENT_HASH_MISMATCH
```

### Broken Previous Hash

```text
previous_event_hash wrong
        ↓
chain broken
```

Expected result:

```text
REALM_EVENT_CHAIN_BROKEN
```

### Invalid Signature

```text
signature does not match proposal material
        ↓
reject before acceptance
```

Expected result:

```text
DEVICE_SIGNATURE_INVALID
```

### Valid Signature, Invalid Scope

```text
valid signature
        +
wrong authority scope
        ↓
reject
```

Expected result:

```text
AUTHORITY_TRANSITION_DENIED
```

### Rotation Rewrites History

```text
KEY_ROTATED
        ↓
old event signatures rewritten
        ↓
forbidden
```

Expected result:

```text
KEY_ROTATION_HISTORY_REWRITE_FORBIDDEN
```

### Revoked Key Signs New Event

```text
KEY_REVOKED
        ↓
new signed proposal
        ↓
reject
```

Expected result:

```text
AUTHORITY_TRANSITION_DENIED
```

### Algorithm Migration Rewrites History

```text
new algorithm deployed
        ↓
rehash or resign old events
        ↓
forbidden
```

Expected result:

```text
CRYPTO_HISTORY_REWRITE_FORBIDDEN
```

### Attestation Missing Anchors

```text
attestation without history_head / projection_hash
        ↓
reject as continuity proof
```

Expected result:

```text
ATTESTATION_CRYPTO_ANCHOR_REQUIRED
```

## Mandatory Acceptance Tests

Future cryptographic assurance tests should prove:

### 1. Tampered Payload Changes Hash

```text
modify event.payload
        ↓
verifyRealmEventHistory()
        ↓
REALM_EVENT_HASH_MISMATCH
```

### 2. Broken Previous Hash Breaks Chain

```text
modify previous_event_hash
        ↓
REALM_EVENT_CHAIN_BROKEN
```

### 3. Invalid Signature Rejected

```text
valid proposal
invalid signature
        ↓
DEVICE_SIGNATURE_INVALID
```

### 4. Valid Signature + Invalid Scope Rejected

```text
valid device signature
unauthorized event type / signer
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 5. Key Rotation Preserves Old Events

```text
old signed events accepted
KEY_ROTATED accepted
        ↓
old event bytes unchanged
old signatures still verifiable in historical context
```

### 6. Revoked Key Cannot Create New Events

```text
KEY_REVOKED
        ↓
new signed proposal
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 7. Algorithm Migration Keeps Replay Equivalent

```text
history with mixed algorithm metadata
        ↓
replay under compatible verifier
        ↓
same projection_hash
same history_head
```

### 8. Attestation References Exact Cryptographic Anchors

```text
attest()
        ↓
includes history_head, projection_hash, integrity_report_hash
        ↓
mutation of any anchor detectable
```

## Relationship to Prior ADRs

```text
ADR-0073  event meaning must remain replayable
ADR-0086  key lifecycle records capability continuity
ADR-0087  quorum evidence is not authority by itself
ADR-0088  attestation proves observation
ADR-0089  export packages evidence
ADR-0091  adversarial layers may lie
ADR-0092  cryptography binds evidence, not authority
```

The assurance model conclusion:

```text
Keys do not create history.
History gives keys meaning.
```

A key is a participant in a verifiable causal chain. It is not the owner of the
chain.

## Consequences

### Positive

- Cryptographic meaning is explicit and testable
- Signature, hash, and authority checks remain separable
- Key rotation and algorithm migration have safe boundaries
- Attestation and export can bind exact continuity anchors
- Threat tests can map directly to crypto failure codes

### Negative

- Historical verification must preserve algorithm metadata
- Key rotation cannot be implemented as silent resigning
- Attestation generation requires more metadata discipline
- Unsupported legacy algorithms require tooling, not rewrite shortcuts

## Non-Goals

- No signature algorithm selection in this ADR
- No HSM or enclave design in this ADR
- No certificate authority model in this ADR
- No post-quantum migration plan in this ADR
- No key backup format in this ADR
- No new authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should harden cryptographic tests and
metadata, not add new write paths:

```text
1. document canonical hash material and signature material
2. ensure timestamp and authority_reference participation is explicit
3. test payload tamper and chain break detection
4. test valid signature + invalid scope rejection
5. test rotation without historical signature rewrite
6. test algorithm metadata replay equivalence
7. bind attestation and export to cryptographic anchors
```

Suggested test target:

```text
node/scripts/test-cryptographic-assurance.js
```

## Summary

Cryptographic assurance asks:

```text
What exactly proves continuity of authority and evidence?
```

Answer:

```text
Hash semantic event bytes.
Sign canonical proposals.
Verify signatures before policy.
Accept only through validator.
Preserve old evidence through rotation.
Migrate algorithms without rewriting history.
Bind attestation to exact anchors.
Never let cryptography create authority.
```

Cryptography protects evidence continuity. Cryptography does not create
authority.
