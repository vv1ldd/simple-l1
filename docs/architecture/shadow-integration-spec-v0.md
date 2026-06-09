# Shadow Integration Spec v0

Status: Draft

Shadow Integration Spec v0 defines the first safe wiring mode for Kernel v0.

Shadow mode runs the kernel alongside the production path without side effects
or authority transfer.

## Model

```text
production_runtime -> production path
                   -> kernel shadow execution
                   -> shadow envelope
                   -> comparator
```

The production path remains authoritative. The kernel result is observational.

## Inputs

Shadow execution receives:

- validated SDGA
- production result envelope or comparable runtime observation
- correlation id

The kernel must not read production state directly.

## Comparator

The comparator compares:

- execution status
- node result ordering
- guard artifact hash
- SDGA hash
- deterministic completion state

The comparator must not infer semantic meaning from differences. It only emits
structured divergence records.

## Divergence Record

```text
DivergenceRecord {
  correlation_id
  sdga_hash
  guard_artifact_hash
  field
  expected
  observed
  severity
}
```

Severity levels:

- `info`
- `warn`
- `blocker`

## Acceptance Thresholds

Initial thresholds:

- `info`: accepted
- `warn`: logged and reviewed
- `blocker`: prevents live cutover

No shadow divergence may mutate production state.

## Envelope Diff Model

Diffs are field-level only:

- missing field
- unexpected field
- value mismatch
- order mismatch

Diffs must be deterministic and reproducible for the same inputs.

## Promotion Rule

Shadow mode may be considered for live cutover only when:

- SDGA validation succeeds consistently
- kernel execution is deterministic
- no blocker divergences exist
- warning divergences are explicitly reviewed

Promotion is an integration decision, not a kernel decision.

## Core Invariant

Shadow execution observes. It does not decide, admit, mutate, or project
authority.
