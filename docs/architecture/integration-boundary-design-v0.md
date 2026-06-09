# Integration Boundary Design v0

Status: Draft

IBD v0 defines the wiring boundary between an existing SL1 runtime and the
isolated Kernel v0 execution target.

It does not define new semantics. It defines coupling topology.

## Current State

```text
Architecture: complete
Execution model: complete
Kernel v0: implemented in isolated mode
Integration: not started
```

## SDGA Source

The runtime obtains SDGA from a pre-existing artifact source:

- compiled artifact store
- signed release bundle chain
- deterministic fetch layer

The kernel never constructs SDGA.

## Pre-Kernel Validation Ownership

Validation happens before kernel invocation:

- SGARP signature verification
- SDGA signature verification
- hash validation
- provenance chain validation
- structural SDGA validation

The kernel receives only already-validated SDGA.

## Invocation Model

Call model:

```text
validated_SDGA -> kernel.execute()
```

Pipeline form:

```text
ingest -> validate -> invoke kernel -> emit result
```

The invocation layer must not ask the kernel to regenerate guards, fetch specs,
or re-validate trust semantics.

## Result Routing

Execution results are routed outside the kernel.

Possible output targets:

- runtime aggregator
- logging sink
- test harness
- shadow-mode comparator

The kernel does not decide routing.

## Isolation Preservation

Kernel isolation is preserved by forbidding:

- direct database access
- system state access
- runtime service dependencies
- spec access
- compiler access
- bridge access
- UI access

The kernel remains a pure function executor over validated SDGA.

## Runtime-Facing Failure Model

Only these failure classes cross the integration boundary:

- `INVALID_ARTIFACT`
- `VERIFICATION_FAILED`
- `EXECUTION_FAILED`

Kernel failures are not automatically system failures. The integration layer
decides whether a kernel envelope is logged, compared, ignored, or promoted.

## Shadow Mode First

Initial integration must be shadow-only:

```text
production_runtime -> production path
                   -> kernel shadow execution
                   -> shadow result envelope
                   -> comparator/logging
```

Shadow mode guarantees:

- no side effects
- no authority shift
- no production mutation
- no user-visible behavior change

## Future Wiring Flow

```text
SDGA store
  -> SGARP validation layer
  -> dispatch layer
  -> kernel.execute()
  -> result envelope
  -> router (shadow or live)
```

## Core Invariant

The kernel is not part of the system state.

The kernel is a called execution function.
