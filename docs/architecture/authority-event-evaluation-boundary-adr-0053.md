# ADR-0053: Authority Event Evaluation Boundary

Status: Accepted

This ADR defines the evaluator that interprets authority history into canonical subject state.

```text
RFC-0052 answers: What is a subject?
ADR-0052 answers: How is subject authority represented in runtime?
ADR-0053 answers: Who may interpret causality into state, and under what constraints?
```

RFC-0052 froze subject ontology.

ADR-0052 froze the canonical/derived runtime boundary.

ADR-0053 freezes the boundary of the truth interpreter.

## Constitutional Kernel

```text
canonical_subject_state = replay(authority_history)
```

The evaluator is the only component permitted to turn raw causality into interpreted truth.

```text
authority_history       # raw causality
  -> evaluator          # interpretation
canonical_subject_state # interpreted truth
```

Without this boundary a hidden leak is possible:

```text
application -> writes projection -> becomes de facto authority   # INVALID
```

The evaluator makes this formally impossible: projections are outputs, never inputs.

## Evaluator Contract

The evaluator:

```text
consumes authority history
validates event ordering
validates event causal links
applies authority_domain rules
produces canonical_subject_state
```

The evaluator MUST NOT:

```text
create authority events
modify authority history
delete authority history
infer ownership from projections
accept application or profile writes as authority
collapse authority_domain rules
introduce identity shortcuts
```

## Determinism

```text
Evaluator is deterministic over authority history.
same authority_history -> same canonical_subject_state
```

Determinism prevents:

```text
divergent identity state across runtimes
floating interpretation of a subject
non-reproducible authority decisions
```

Two correct runtimes evaluating the same authority history MUST derive identical canonical subject state.

## Statelessness With Respect To Subject Identity

```text
Evaluator MUST be stateless with respect to subject identity.
```

The evaluator must not carry:

```text
hidden memory of a subject
cached authority meaning
implicit identity shortcuts
out-of-history inference
```

The only permitted derivation is:

```text
state = f(full_authority_history)
```

Caches are permitted only as derived acceleration that is fully reconstructible from history, never as authority memory.

## Semantic Class Validation

A `type` field is not routing metadata. It is a semantic-class assertion.

```text
"type": "authority_event"
```

means:

```text
this object claims authority to change the authority graph
```

Validation MUST therefore check more than shape:

```text
shape valid
+ event class valid
+ authority_domain valid
+ proof valid
+ causal order valid
+ replay constraints valid
```

An object that is structurally valid but fails semantic-class validation MUST be rejected, not silently routed.

## Pipeline

```text
Authority Writer
  -> authority_events.log        # canonical causality
  -> Authority Evaluator         # deterministic, stateless over identity
  -> canonical_subject_state
  -> Projection Builders
  -> Applications
```

The arrows are one-directional. No downstream stage may write upstream.

## Relation To Existing Layers

```text
RFC-0052: ontology
ADR-0052: runtime boundary (canonical vs derived)
ADR-0053: evaluation boundary (who interprets causality)
```

ADR-0053 is not a new identity primitive.

It constrains the interpreter that sits between canonical causality and derived state.

## Append-Only Causality Invariant

```text
The system never edits identity.
The system only appends causality and re-evaluates subject state.
```

This is the final defense against regression into a `user table + flags` model.

## Runtime Invariants

```text
canonical_subject_state = replay(authority_history)
evaluator_output = derived
evaluator_input != projection
evaluator != authority_writer
evaluator_is_deterministic = true
evaluator_is_stateless_over_subject = true
type_field = semantic_class_assertion
identity_edit != allowed
identity_change = append(authority_event) + reevaluate
```

## Sequencing

This ADR precedes authority event schema definition.

```text
RFC-0052
  -> ADR-0052 (runtime boundary)
  -> ADR-0053 (evaluation boundary)
  -> authority-event.schema.json
  -> claim / relationship / delegation schemas
  -> projection schema
  -> validation model
  -> implementation
  -> migration
```

After this boundary, `authority-event.schema.json` describes the evaluator input, and schemas fix the form of an already-accepted causal physics rather than defining the system.

## Executable Reference

This evaluation boundary is realized by a pure, runtime-independent kernel (Slice 1).
The documents below reference the executable kernel, not the other way around.

```text
docs/contracts/subject-authority/schema/authority-event.schema.json   (input contract)
docs/contracts/subject-authority/invariants/ruleset-v1.json           (frozen invariants)
docs/contracts/subject-authority/fixtures/conformance-v1.json         (oracle fixtures)
node/subject-authority-runtime.js                                     (deterministic evaluator + read-only legacy bridge)
node/scripts/test-subject-authority-runtime.js                        (causality oracle)
```

The kernel has no runtime, HTTP, or storage dependencies. It enforces
`canonical_subject_state = replay(authority_history)` and is independently
reproducible outside the live runtime.
