# Minimal Execution Kernel Implementation Spec v0

Status: Draft

MEKIS v0 is the engineering blueprint for a future non-semantic execution
kernel. It does not introduce new semantics. It only defines the mechanical
runtime shape required to execute EKC-v0-compatible SDGA artifacts.

## Boundary

The kernel is only:

```text
input  -> Signed Decision Graph Artifact
output -> Execution Result Envelope
```

The kernel must not:

- interpret semantics
- evaluate policy
- evaluate guards
- validate correctness beyond artifact identity
- branch on meaning
- access SL1 Truth Spec
- access compiler logic

## Data Structures

### SDGA Input

```text
SDGA {
  artifact_hash: string
  signature: string
  provenance_chain: array
  nodes: Node[]
  edges: Edge[]
}
```

### Node

```text
Node {
  id: string
  op: OperationRef
  inputs: ResolvedInputs
  outputs: OutputSchema
  metadata: ExecutionMetadata
}
```

### Edge

```text
Edge {
  from: NodeID
  to: NodeID
  type: "dependency"
}
```

## Artifact Loading

Required loading steps:

```text
load(SDGA):
  verify_signature()
  verify_hash()
  verify_provenance()
```

Failure at any loading step must produce `REJECT_EXECUTION`.

Artifact loading is identity verification only. It must not evaluate semantic
validity.

## Topological Execution Loop

The core loop is:

```text
for node in topologically_sorted(SDGA.nodes):
  result = execute(node.op, node.inputs)
  store(result)
```

Constraints:

- no conditional branching
- no evaluation logic
- no dynamic resolution
- no graph mutation

## Operation Dispatch Table

The kernel dispatches operations through a fixed table:

```text
OperationTable = {
  op_name -> pure_function
}
```

Each operation must be:

- deterministic
- stateless, or explicitly state-passed
- side-effect controlled

Allowed operation implementations must not read policy, spec, compiler output,
or external authority state.

## Failure Semantics

Kernel failure classes:

- `INVALID_ARTIFACT`
- `SIGNATURE_MISMATCH`
- `HASH_MISMATCH`
- `PROVENANCE_MISMATCH`
- `TOPOLOGY_ERROR`
- `UNKNOWN_OPERATION`
- `EXECUTION_ERROR`

Failure is mechanical rejection only. Failure is not interpretation.

## Execution Result Envelope

The kernel must emit an execution result envelope:

```text
ExecutionResultEnvelope {
  artifact_hash
  execution_id
  node_results[]
  status: SUCCESS | FAILURE
  trace_metadata
}
```

The envelope must preserve:

- SDGA hash
- guard artifact hash
- node result order
- deterministic completion state

## Full Kernel Model

```text
function execute(SDGA):
  verify_artifact(SDGA)
  order = topological_sort(SDGA.nodes)
  for node in order:
    result = dispatch(node.op, node.inputs)
    record(node.id, result)
  return ExecutionResultEnvelope
```

## Explicit Non-Goals

The kernel does not contain:

- spec parser
- compiler
- guard evaluator
- policy engine
- admission engine
- bridge client
- UI projection logic
- network trust logic

## Kernel Identity

The kernel is a deterministic execution function over SDGA:

```text
Kernel = f(SDGA) -> ExecutionResultEnvelope
```

The kernel executes, but does not decide.
