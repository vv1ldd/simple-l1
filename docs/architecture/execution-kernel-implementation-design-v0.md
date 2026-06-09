# Execution Kernel Implementation Design v0

Status: Draft

EKID v0 defines the code-level behavior of a future non-semantic execution
kernel. It materializes MEKIS v0 without adding new semantics.

The kernel executes SDGA mechanically. The kernel must not decide meaning,
infer intent, evaluate correctness, or interpret semantics.

## Memory Model

Execution memory is strictly ephemeral.

Kernel memory must be:

- per-execution scoped
- graph-bound
- non-persistent by default

State types:

- `input_state`: SDGA input.
- `execution_state`: runtime ephemeral state.
- `result_state`: output-only state.

The kernel must not persist state beyond execution and must not reuse memory
across SDGA runs.

## Execution State Machine

State flow:

```text
INIT
  -> VERIFY_ARTIFACT
  -> LOAD_GRAPH
  -> EXECUTE
  -> EMIT_RESULT
  -> TERMINATE
```

State transitions are deterministic. There are no dynamic branches between
states and no semantic decision points.

## Topological Scheduler

Nodes must execute in:

```text
topological_order(SDGA.graph)
```

The scheduler must not:

- reorder based on runtime conditions
- infer execution priority
- mutate graph structure

Cycle detection is a hard failure:

```text
cycle_detected -> TOPOLOGY_ERROR
```

## Operation Dispatch Table

Dispatch table:

```text
op_id -> deterministic_function
```

Execution rule:

```text
execute(node):
  fn = dispatch_table[node.op]
  return fn(node.inputs)
```

Functions must be:

- pure
- deterministic
- side-effect controlled

Unknown operations fail mechanically with `UNKNOWN_OPERATION`.

## IO Boundaries

Allowed IO:

- SDGA input ingestion
- execution result emission

Forbidden IO:

- network calls, unless explicitly modeled as a pre-resolved node operation
- SL1 Truth Spec access
- compiler access
- external authority state queries
- UI projection reads or writes

## Failure Propagation

Failure classes:

- `INVALID_ARTIFACT`
- `VERIFICATION_ERROR`
- `SIGNATURE_MISMATCH`
- `HASH_MISMATCH`
- `PROVENANCE_MISMATCH`
- `TOPOLOGY_ERROR`
- `UNKNOWN_OPERATION`
- `NODE_EXECUTION_ERROR`

Propagation rule:

- failure is immediate
- failure is non-recoverable within the execution
- failure is terminal for the current SDGA run
- failure must be represented in the execution result envelope

Failure is mechanical rejection only. Failure is not interpretation.

## Result Envelope Emission

The kernel emits an `ExecutionResultEnvelope` with:

- SDGA hash
- guard artifact hash
- execution id
- ordered node results
- final status
- deterministic trace metadata

The envelope must be deterministic and reproducible for the same SDGA and
operation table.

## Artifact Identity Verification

Before graph loading, the kernel must verify:

- signature validity
- hash integrity
- provenance chain correctness
- SGARP linkage through `guard_artifact_hash`

If verification fails, execution must not start.

## Full Execution Model

```text
function run(SDGA):
  verify_artifact(SDGA)
  state = INIT -> VERIFY_ARTIFACT -> LOAD_GRAPH -> EXECUTE
  for node in topological_order(SDGA):
    dispatch(node)
  return ExecutionResultEnvelope
```

## Core Invariant

```text
Kernel = f(SDGA, OperationTable) -> ExecutionResultEnvelope
```

The kernel executes, but does not decide.
