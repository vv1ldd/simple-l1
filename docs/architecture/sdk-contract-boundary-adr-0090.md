# ADR-0090: SDK Contract Boundary

Status: Accepted

This ADR defines the developer-facing SDK contract for Realm systems without
exposing direct authority mutation, projection replacement, history append, or
policy bypass APIs.

ADR-0089 completed the evidence export layer: a Realm can package proof of why
state exists for external consumers. ADR-0090 is the final translation layer over
the proven kernel. It makes the Realm easier to use without making the Realm
easier to bypass.

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
```

## Acceptance Criteria

ADR-0090 is accepted when the following SDK boundaries are frozen:

```text
sdk_exposes_intent_and_evidence_flows
sdk_does_not_expose_authority_mutation
sdk_convenience_is_not_sdk_privilege
sdk_command_creates_events_only_through_kernel
sdk_cannot_append_history_directly
sdk_cannot_mutate_projection_directly
sdk_cannot_replace_projection
sdk_cannot_import_state_as_truth
sdk_cannot_force_accept_events
sdk_preserves_command_idempotency
sdk_read_apis_return_representations
sdk_explanation_outputs_reference_history
sdk_verification_failure_blocks_attestation
sdk_exported_evidence_equals_native_evidence_export
sdk_methods_cannot_bypass_registry_policy
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
SDK exposes intent and evidence flows.
SDK does not expose authority mutation.
```

Supporting kernel:

```text
SDK convenience != SDK privilege.
```

Wrong:

```text
Developer
    ↓
SDK
    ↓
State mutation
```

Correct:

```text
Developer
    ↓
SDK
    ↓
Command / Query / Evidence API
    ↓
Realm Kernel
    ↓
Accepted Event History
```

Hardening series guardrails:

```text
ADR-0076  command != mutation
ADR-0077  explanation != state
ADR-0078  verification != repair
ADR-0088  attestation != authority
ADR-0089  export != authority
ADR-0090  SDK != bypass
```

## Context

After ADR-0089, the Realm has a complete proof cycle:

```text
History
  ↓
Verification
  ↓
Explanation
  ↓
Attestation
  ↓
Evidence Export
```

Developers should not need to know every kernel detail to use the system
correctly. But the SDK must not hide the model by introducing privileged
shortcuts.

The developer-facing vertical is:

```text
Developer / Operator / Device / Federation
                ↓
              SDK/API
                ↓
          Command + Evidence
                ↓
            Kernel Boundary
                ↓
        Accepted Realm Events
                ↓
          Hash-linked History
                ↓
             Projection
                ↓
 Explanation / Verify / Attest / Export
```

## Questions This ADR Answers

```text
What should the SDK expose?
What must the SDK never expose?
How does SDK sugar map to commands?
How do SDK read APIs avoid becoming authority?
How do verification, attestation, and export appear to developers?
How is idempotency preserved through SDK convenience APIs?
How do SDK tests prove no registry bypass exists?
```

This ADR does **not** select programming languages, package names, transport
protocol, authentication UX, generated client style, or documentation format.

## Core Boundary

The minimal SDK surface is:

```text
createCommand()
submit(command)
observe(query)
explain(target)
verify()
attest()
exportEvidence()
```

The SDK must intentionally omit:

```text
writeState()
setAuthority()
replaceProjection()
importState()
forceAccept()
appendHistory()
overrideValidator()
```

The absence of those methods is part of the contract.

## SDK Convenience Boundary

Convenience APIs may exist only as command builders or evidence queries.

Allowed sugar:

```text
realm.devices.rotate(deviceId, newKey)
        ↓
createCommand(DEVICE_ROTATION_REQUEST)
        ↓
submit(command)
        ↓
kernel decides
```

Forbidden sugar:

```text
realm.devices.rotate(deviceId, newKey)
        ↓
mutate projection
```

Developer ergonomics may reduce boilerplate. They must not reduce validation.

## Command API

Command construction:

```text
createCommand(intent)
        ↓
command_id
        ↓
executeCommand()
```

The SDK must preserve:

```text
stable command_id
actor identity
evidence payload
requested action
idempotency semantics
validator reason codes
accepted_event_ids
```

If the same command ID is retried with the same intent, the SDK must surface the
idempotent result. If the same command ID is reused with a different intent, the
SDK must surface the mismatch.

## Observation API

Observation APIs return representations.

```text
observe()
        ↓
projection representation
        ↓
never authority
```

Observations may include:

```text
current projection
lifecycle state
history head
projection hash
operational warnings
fleet or admin views
```

They must not expose mutable references to canonical stores.

## Explanation API

Explanation APIs return causal traces.

```text
explain(target)
        ↓
causal trace
        ↓
history references
```

Explanation output must preserve:

```text
event ids
event sequence
history head
signer / authority reference
accepted_event_ids
validator reason codes
derivation source
```

An explanation cannot be submitted as state.

## Verification API

Verification APIs return integrity reports.

```text
verify()
        ↓
integrity report
```

The SDK must surface:

```text
realm_valid
canonical checks
derived artifact checks
operational warnings
failure reason codes
history_head
projection_hash
```

Verification failure must not repair the Realm. It must also block valid-state
attestation.

## Attestation API

Attestation APIs produce proof envelopes only after verification succeeds for
the attested scope.

```text
attest()
        ↓
proof envelope
```

The SDK must bind:

```text
history_head
projection_hash
integrity_report_id
runtime_version
registry_version
attestation_scope
```

If verification fails, the SDK must reject valid-state attestation generation.

## Compliance API

Compliance APIs package evidence.

```text
exportEvidence()
        ↓
evidence package
```

The SDK result must match the native evidence export semantics:

```text
history proof
projection explanation
verification report
lifecycle evidence
attestation envelope
export metadata
```

SDK export must not be importable as authority.

## Error and Reason Code Contract

The SDK must not hide kernel rejections behind generic exceptions.

It must preserve:

```text
AUTHORITY_TRANSITION_DENIED
SEQUENCE_MISMATCH
COMMAND_ID_INTENT_MISMATCH
CANONICAL_HISTORY_REQUIRED
ATTESTATION_INTEGRITY_REQUIRED
EXPORT_IMPORT_MUTATION_FORBIDDEN
```

Developer experience improves when rejections are explainable, not when they are
silently converted into alternate mutation paths.

## Forbidden Root API

The SDK must not become a root API.

Forbidden capabilities:

```text
direct event_log.push()
direct CurrentAuthorityState mutation
validator bypass
registry bypass
history hash override
projection replacement
lifecycle state override
attestation despite failed verification
evidence export as restore source
```

If internal test helpers need privileged access, they must be clearly scoped as
test-only and unavailable in production SDK surfaces.

## Failure Modes

### Direct History Append Attempt

```text
sdk.appendHistory(event)
        ↓
method absent / forbidden
```

Expected result:

```text
SDK_HISTORY_APPEND_FORBIDDEN
```

### Projection Mutation Attempt

```text
sdk.replaceProjection(state)
        ↓
method absent / forbidden
```

Expected result:

```text
SDK_PROJECTION_MUTATION_FORBIDDEN
```

### Registry Policy Bypass Attempt

```text
sdk.forceAccept(proposal)
        ↓
method absent / forbidden
```

Expected result:

```text
SDK_FORCE_ACCEPT_FORBIDDEN
```

### Attestation After Verification Failure

```text
verify().realm_valid == false
        ↓
attest()
        ↓
reject
```

Expected result:

```text
ATTESTATION_INTEGRITY_REQUIRED
```

### Imported Export Mutation Attempt

```text
sdk.importState(exportPackage)
        ↓
method absent / forbidden
```

Expected result:

```text
SDK_STATE_IMPORT_FORBIDDEN
```

## Mandatory Acceptance Tests

Future SDK contract tests should prove:

### 1. SDK Command Creates Accepted Event Only Through Kernel

```text
SDK command
        ↓
executeCommand()
        ↓
validator + registry
        ↓
accepted event or rejection
```

### 2. SDK Cannot Append History Directly

```text
SDK surface
        ↓
no direct event_log append method
```

### 3. SDK Cannot Mutate Projection

```text
SDK surface
        ↓
no CurrentAuthorityState mutation method
```

### 4. Same Command Idempotency Preserved

```text
same command_id
        ↓
same result
        ↓
no duplicate event
```

### 5. SDK Read APIs Return Representations

```text
observe()
        ↓
representation only
        ↓
no authority mutation
```

### 6. Explanation Output References History

```text
explain(target)
        ↓
event ids / history_head / reason codes
```

### 7. Verification Failure Blocks Attestation

```text
invalid Realm
        ↓
attest()
        ↓
ATTESTATION_INTEGRITY_REQUIRED
```

### 8. SDK Export Equals Native Evidence Export

```text
exportEvidence()
        ↓
same evidence anchors as native export
```

### 9. No SDK Method Can Bypass Registry Policy

```text
unauthorized transition via SDK
        ↓
AUTHORITY_TRANSITION_DENIED
```

## Relationship to Ecosystem Layer

After ADR-0090, future work is ecosystem design rather than kernel hardening:

```text
language bindings
client libraries
UI tooling
governance tooling
developer documentation
test harnesses
integration adapters
```

All ecosystem work must preserve the SDK boundary:

```text
make safe paths easier
do not expose unsafe paths
```

## Relationship to the Full Series

The final vertical is:

```text
External Intent / Evidence
        ↓
Command Boundary
        ↓
Idempotency
        ↓
Dispatcher
        ↓
Registry + Validator
        ↓
Hash-linked Event History
        ↓
Projection
        ↓
Explanation
        ↓
Verification
        ↓
Lifecycle
        ↓
Operations
        ↓
Backup / Restore
        ↓
Deployment
        ↓
Multi-Realm Coordination
        ↓
Evidence / Attestation / Export
        ↓
SDK Surface
```

The final invariant:

```text
The SDK may make the Realm easier to use.
It must never make the Realm easier to bypass.
```

## Consequences

### Positive

- Developers get ergonomic access to safe flows
- SDK sugar remains command construction, not mutation
- Read APIs remain representation-only
- Evidence APIs expose the proof model directly
- Kernel reason codes remain visible to applications

### Negative

- SDK cannot offer convenient direct state writes
- Some simple-looking operations must be asynchronous command flows
- Developer documentation must explain intent versus acceptance
- Test helpers must be kept out of production SDK surfaces

## Non-Goals

- No language binding selection in this ADR
- No package naming in this ADR
- No transport protocol selection in this ADR
- No authentication UX design in this ADR
- No generated client format in this ADR
- No admin UI design in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should define an SDK facade and
contract tests, not new kernel capabilities:

```text
1. define createCommand / submit facade
2. define observe / explain / verify facades
3. define attest / exportEvidence facades
4. ensure all mutating helpers call executeCommand()
5. omit direct mutation methods
6. preserve reason codes and accepted_event_ids
7. prove SDK evidence export equals native export anchors
```

Suggested test target:

```text
node/scripts/test-sdk-contract-boundary.js
```

## Summary

SDK design asks:

```text
How can developers use the Realm without learning every internal detail?
```

Answer:

```text
Expose commands.
Expose observation.
Expose explanation.
Expose verification.
Expose attestation.
Expose evidence export.
Do not expose mutation.
```

SDK exposes intent and evidence flows. SDK does not expose authority mutation.
