# Execution Kernel Contract v0

Status: Draft

The Execution Kernel Contract defines the permitted behavior of a future
non-semantic SL1 runtime kernel.

The kernel is not a system of decisions. The kernel is a system of execution
only.

## Input Contract

The kernel must accept only a Signed Decision Graph Artifact:

```text
input = SDGA
```

The kernel must reject all other input types.

## Identity Verification

The kernel must verify:

- artifact signature
- artifact hash
- provenance chain
- SGARP linkage through `guard_artifact_hash`

The kernel must not evaluate semantic validity. Identity verification is not
policy evaluation.

## Execution Rule

The kernel must execute nodes in deterministic topological order.

```text
for node in topological_order(SDGA):
  execute(node)
```

Each node is a pre-resolved operation:

```text
node.execute(input) -> output
```

No node execution may evaluate conditions, consult policy, read the truth spec,
or modify the graph.

## Output Contract

The kernel must emit an execution result envelope containing:

- SDGA hash
- guard artifact hash
- execution status
- deterministic completion state
- optional node execution traces

## Forbidden Capabilities

The kernel must never:

- read SL1 Truth Spec
- compile rules
- evaluate guards
- evaluate policy
- branch on semantic conditions
- infer meaning
- modify graph structure
- admit peers
- mutate authority outside a pre-resolved operation

## Collapse Rule

If SDGA identity is invalid, the kernel must reject execution.

If SDGA identity is valid, the kernel must not question graph content. The graph
is pre-runtime truth.

## Architecture Boundary

Truth lives upstream:

```text
Truth Spec -> Compiler -> SGARP -> SDGA
```

Execution lives in the kernel:

```text
SDGA -> deterministic execution result
```

The kernel executes, but does not decide.
