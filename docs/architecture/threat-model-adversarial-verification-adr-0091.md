# ADR-0091: Threat Model and Adversarial Verification

Status: Accepted

This ADR defines the adversarial verification model for Realm systems after the
architectural closure of ADR-0068 through ADR-0090. It does not add a new source
of authority. It defines how the existing causal kernel must behave when every
external, derived, operational, or convenience layer is assumed hostile.

ADR-0090 closed the SDK boundary: convenience must collapse into the same
command and evidence flows as every other caller. ADR-0091 begins proof-driven
production maturation by asking what happens when each layer lies.

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
```

## Acceptance Criteria

ADR-0091 is accepted when the following adversarial verification boundaries are
frozen:

```text
threat_model_tests_causality_not_convenience
adversarial_layers_may_lie_but_must_not_create_truth
projection_tampering_detected_by_replay
snapshot_tampering_detected_by_history_head_mismatch
transport_compromise_cannot_bypass_acceptance
sdk_compromise_cannot_bypass_kernel
admin_compromise_cannot_create_authority
fleet_compromise_cannot_create_global_authority
attestation_compromise_cannot_make_invalid_realm_valid
export_compromise_cannot_import_state
stolen_device_key_limited_by_history_derived_scope
revoked_key_cannot_authorize_future_commands
quorum_compromise_requires_policy_valid_evidence
deployment_compromise_cannot_rewrite_history
optimization_corruption_falls_back_to_canonical_verification
threat_tests_must_preserve_no_second_path_to_state
```

## Constitutional Kernel

```text
Threat modeling protects causal continuity.
It does not add a new authority mechanism.
```

Supporting kernel:

```text
Every layer may lie.
Only accepted history may cause truth.
```

Wrong:

```text
security tool
        ↓
declares state trusted
        ↓
Realm becomes valid
```

Correct:

```text
adversarial input / artifact / caller
        ↓
kernel validation or verification
        ↓
accepted event or rejected evidence
        ↓
causality preserved
```

Hardening series guardrails:

```text
ADR-0078  verification != repair
ADR-0085  optimization != meaning
ADR-0088  attestation != authority
ADR-0089  export != authority
ADR-0090  SDK != bypass
ADR-0091  threat model != authority
```

## Context

Architectural closure established:

```text
SDK / API / Admin / Device / Federation / Transport
                    ↓
             Commands + Evidence
                    ↓
              Idempotency
                    ↓
              Dispatcher
                    ↓
          Registry + Validator
                    ↓
        Accepted Realm Event
                    ↓
          Hash-linked History
                    ↓
              Projection
                    ↓
      Explanation / Verification
                    ↓
       Lifecycle / Operations
                    ↓
       Attestation / Evidence Export
```

And the negative boundaries:

```text
Projection       != Authority
Snapshot         != History
Transport        != Acceptance
API              != Mutation
Command          != State Change
Verification     != Repair
Lifecycle        != Permission Grant
Recovery         != Ownership Transfer
Admin            != Root
Fleet            != Global Authority
Attestation      != Validity Source
Export           != State Import
SDK              != Bypass Layer
```

ADR-0091 turns those boundaries into adversarial obligations.

## Questions This ADR Answers

```text
What if projection is modified?
What if snapshot is modified?
What if transport is controlled?
What if SDK is malicious?
What if admin or fleet tooling is compromised?
What if a key is stolen, revoked, or replayed?
What if attestation or export artifacts are tampered with?
What if optimization indexes or archives lie?
What must always remain rebuildable from history?
```

This ADR does **not** select a security scanner, formal method, fuzzing
framework, incident response vendor, cryptographic suite, or penetration test
provider.

## Core Threat Model

Assume the attacker may control:

```text
projection cache
snapshot artifact
transport channel
API request body
SDK client
admin console
fleet dashboard
backup metadata
attestation envelope
compliance export
index / segment metadata
deployment metadata
operator workflow state
```

The attacker must not be able to cause authority unless they can produce an
accepted Realm Event through registry and validator policy.

```text
malicious artifact
        ↓
verification / validation
        ↓
rejected or ignored
```

Not:

```text
malicious artifact
        ↓
imported as truth
```

## Measure, Attack, Optimize, Operationalize

Production maturation follows four tracks:

```text
1. Measure
2. Attack
3. Optimize
4. Operationalize
```

### Measure

The system must prove:

```text
same history
        ↓
same result
        ↓
predictable cost
```

Benchmark targets:

```text
replay 10k / 100k / 1M events
snapshot restore vs full replay
index-assisted replay equivalence
federation evidence verification cost
command throughput with idempotency
```

Invariant:

```text
Optimization may reduce time.
It may not change meaning.
```

### Attack

Attack every derived and external layer:

```text
projection
snapshot
transport
device key
SDK
admin
fleet
attestation
export
deployment
storage index
```

Success criteria are rejection, detection, or bounded damage. Never silent
authority creation.

### Optimize

Production optimizations must pass one filter:

```text
Can this be deleted and rebuilt from history?
```

If not, it is a candidate authority source and must be redesigned.

Examples:

```text
Merkle / event segment storage
archival tiers
streaming replay
parallel verification
remote attestation cache
hardware-backed key providers
```

### Operationalize

Operational maturity must prove continuity under failure:

```text
multi-region placement
disaster drills
rotation ceremonies
quorum exercises
upgrade rehearsals
compliance exports
```

Not:

```text
backup succeeded
```

But:

```text
Can we prove continuity after total loss?
```

## Attack Scenarios

### Projection Tampering

```text
Attacker modifies projection
        ↓
detected by replay
```

Expected result:

```text
PROJECTION_REPLAY_MISMATCH
```

Projection is replaceable representation. Replay decides.

### Snapshot Tampering

```text
Attacker modifies snapshot
        ↓
detected by history head mismatch
```

Expected result:

```text
SNAPSHOT_HISTORY_MISMATCH
```

Snapshot is acceleration. History remains authority.

### Transport Compromise

```text
Attacker controls transport
        ↓
cannot bypass acceptance
```

Expected result:

```text
TRANSPORT_EVENT_HASH_MISMATCH
AUTHORITY_TRANSITION_DENIED
```

Transport can deliver evidence. It cannot accept events.

### Device Key Theft

```text
Attacker steals device key
        ↓
scope limits damage
        ↓
revocation blocks future commands
```

Expected result:

```text
capability limited to history-derived scope
```

Key possession is not unlimited authority.

### SDK Compromise

```text
Attacker controls SDK
        ↓
cannot bypass kernel
```

Expected result:

```text
SDK_FORCE_ACCEPT_FORBIDDEN
AUTHORITY_TRANSITION_DENIED
```

SDK convenience is not SDK privilege.

### Admin Compromise

```text
Attacker controls admin console
        ↓
cannot become root
```

Expected result:

```text
AUTHORITY_TRANSITION_DENIED
ADMIN_EVENT_APPEND_FORBIDDEN
ADMIN_PROJECTION_MUTATION_FORBIDDEN
```

Admin can request. History decides.

### Fleet Compromise

```text
Attacker controls fleet layer
        ↓
cannot create global authority
```

Expected result:

```text
GLOBAL_AUTHORITY_FORBIDDEN
REALM_ISOLATION_VIOLATION
```

Fleet coordinates Realms. It does not merge authority domains.

### Attestation Tampering

```text
Attacker modifies attestation
        ↓
material hash / signature mismatch
```

Expected result:

```text
ATTESTATION_HASH_MISMATCH
```

Attestation proves observation. It does not make state valid.

### Export Import Attack

```text
Attacker imports compliance export
        ↓
attempts projection mutation
```

Expected result:

```text
EXPORT_IMPORT_MUTATION_FORBIDDEN
```

Export packages evidence. It does not export authority.

### Deployment Compromise

```text
Attacker deploys runtime that cannot interpret history
        ↓
boot verification blocks command intake
```

Expected result:

```text
RUNTIME_HISTORY_COMPATIBILITY_FAILED
```

Deployment changes runtime. It does not change history.

### Optimization Corruption

```text
Attacker corrupts index / segment metadata
        ↓
canonical verification detects or bypasses optimization
```

Expected result:

```text
INDEX_CORRUPTED_REBUILD_REQUIRED
HISTORY_SEGMENT_HASH_MISMATCH
```

Optimization may reduce time. It may not change meaning.

## Formal Proof Obligations

Every implementation must be able to test:

```text
same accepted history => same projection
same accepted history => same explanation anchors
same accepted history => same verification result
same accepted history => same lifecycle derivation
same accepted history => same evidence export anchors
```

And:

```text
no projection import creates authority
no snapshot import creates authority
no transport delivery creates authority
no admin command creates authority outside validator
no SDK method creates authority outside validator
no fleet operation creates global authority
no attestation validates an invalid Realm
no export imports state
```

## Mandatory Acceptance Tests

Future adversarial verification tests should prove:

### 1. Projection Tampering Detected

```text
modify CurrentAuthorityState
        ↓
verify integrity
        ↓
PROJECTION_REPLAY_MISMATCH
```

### 2. Snapshot Tampering Detected

```text
modify snapshot head / projection hash
        ↓
verify snapshot
        ↓
reject
```

### 3. Transport Cannot Bypass Acceptance

```text
malicious transport event
        ↓
receive batch
        ↓
validator rejection
        ↓
no history mutation
```

### 4. Stolen Device Key Is Scope-Limited

```text
device key signs unauthorized authority transition
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 5. SDK Cannot Force Accept

```text
SDK tries forceAccept
        ↓
method absent / forbidden
```

### 6. Admin Cannot Become Root

```text
admin command creates root
        ↓
AUTHORITY_TRANSITION_DENIED
```

### 7. Fleet Cannot Merge Authority

```text
root authority A used for Realm B
        ↓
reject
```

### 8. Attestation Cannot Validate Invalid Realm

```text
invalid integrity report
        ↓
attest valid state
        ↓
ATTESTATION_INTEGRITY_REQUIRED
```

### 9. Export Cannot Import State

```text
compliance package
        ↓
import as CurrentAuthorityState
        ↓
EXPORT_IMPORT_MUTATION_FORBIDDEN
```

### 10. Optimization Disagreement Loses to Full Replay

```text
optimized replay projection != full replay projection
        ↓
optimized path rejected
```

## Relationship to Production Work

ADR-0091 starts the production maturation phase:

```text
performance benchmarks
cryptographic key implementation details
hardware-backed key storage
multi-region operations
SDK language bindings
threat modeling
formal verification of invariants
protocol / version governance
```

Those efforts may improve durability, speed, ergonomics, and assurance. They
must not add new truth sources.

## Consequences

### Positive

- The architecture becomes testable under adversarial assumptions
- Derived artifacts can be attacked without becoming authority
- Production optimization receives a clear safety filter
- Security reviews can focus on causal continuity, not just data secrecy
- Threat tests can reuse ADR reason codes as expected outcomes

### Negative

- Some attacks cause fail-closed operational interruption
- Test coverage must include hostile artifacts, not only happy paths
- Optimizations must provide equivalence proof
- SDK/admin/fleet tooling must be tested as hostile callers

## Non-Goals

- No security tooling selection in this ADR
- No cryptographic algorithm selection in this ADR
- No penetration test provider selection in this ADR
- No incident response playbook in this ADR
- No formal verification language selection in this ADR
- No new authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be adversarial tests and
benchmarks, not new architecture:

```text
1. add projection tamper tests
2. add snapshot tamper tests
3. add malicious transport tests
4. add stolen key scope tests
5. add SDK/admin/fleet bypass tests
6. add attestation/export tamper tests
7. add optimized replay vs full replay equivalence benchmarks
```

Suggested test target:

```text
node/scripts/test-adversarial-verification.js
```

Suggested benchmark target:

```text
node/scripts/benchmark-realm-replay.js
```

## Summary

Threat modeling asks:

```text
What happens if every layer lies?
```

Answer:

```text
Reject forged transitions.
Detect corrupted representations.
Ignore or rebuild derived artifacts.
Fail closed on missing canonical evidence.
Preserve one causal path to truth.
```

Realm is not a database with permissions. Realm is a verifiable history machine
from which permissions emerge.
