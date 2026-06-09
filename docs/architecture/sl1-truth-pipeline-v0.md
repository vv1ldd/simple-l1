# SL1 Truth Pipeline v0

Status: Draft

SL1 Truth Pipeline v0 defines the protocol boundary that must exist before any
ownership projection is introduced.

This document does not define wallet behavior, custody, balances, or state
mutation. It defines the completed evidence-to-reconciliation path and the
readiness gate for a future ownership layer.

## Pipeline

```text
Layer A
Evidence
  -> Canonical Graph

Layer B
Canonical Graph
  -> Eligibility Verdict

Layer C
Finalized Graph + Intent
  -> Reconciliation Verdict
```

The pipeline answers three questions only:

- Layer A: what happened?
- Layer B: may this become protocol truth?
- Layer C: does this truth satisfy an intent?

The pipeline must not answer:

- who owns the asset?
- what is the balance?
- should protocol state mutate?

## Scope Test

Every proposed v0 change must pass this question:

```text
Can this be represented as:
Evidence
  -> Canonical Graph
  -> Eligibility Verdict
  -> Reconciliation Verdict
without introducing a new protocol truth class?
```

If the answer is yes, the change is v0 expansion.

If the answer is no, the change is protocol evolution and must not be introduced
as a Layer A, B, or C change.

Allowed expansion examples:

- new EVM event fixture
- new BTC evidence fixture
- new adapter
- new canonicalization rule
- new replay edge case
- new reorg observation case
- new reconciliation ambiguity case

Out-of-scope evolution examples:

- derive balance
- derive owner
- derive account position
- derive custody state
- apply protocol mutation
- update settlement state
- project holdings

## Assertion Alphabet

Truth Pipeline v0 freezes the classes of assertions the protocol may make.

Layer A may assert observation by producing a canonical graph.

Layer B may assert one of:

- `candidate`
- `finalized`
- `challenged`
- `invalidated`
- `rejected`

Layer C may assert one of:

- `MATCHED`
- `NOT_MATCHED`
- `AMBIGUOUS`
- `NOT_ELIGIBLE`

No Layer A, B, or C artifact may assert ownership, balances, custody, account
state, protocol state mutation, or settlement state.

## Layer Locks

Layer D may not exist unless Layers A, B, and C are locked.

Layer A is locked when:

- the canonicalization contract is frozen
- FrozenGraph fixtures are locked
- graph identity rules are locked

Layer B is locked when:

- the FPL verdict alphabet is frozen
- eligibility semantics are frozen

Layer C is locked when:

- the reconciliation verdict alphabet is frozen
- intent matching semantics are frozen

## Stability Rules

New fixtures may extend Layer B coverage, but they must not introduce new Layer B
verdict classes.

New fixtures may extend Layer C coverage, but they must not introduce new Layer C
verdict classes.

If a new fixture requires a new verdict class, the downstream ownership model is
not ready to exist as a stable protocol layer.

## Layer C Alphabet

Reconciliation v0 has exactly four verdict classes:

- `MATCHED`
- `NOT_MATCHED`
- `AMBIGUOUS`
- `NOT_ELIGIBLE`

The verdict classes are not ownership states. They are adjudication results over
finalized evidence and intent.

## Ownership Readiness Gate

A future ownership candidate may be derived only from a reconciliation result
that satisfies all of the following:

```text
MATCHED
AND FINALIZED
AND NOT_AMBIGUOUS
AND FACT_SELECTED
AND NOT_REORGED
```

`FACT_SELECTED` is mandatory. Composite transactions, multi-log transactions, or
any graph containing multiple possible evidence facts must not be consumed by an
ownership layer without an explicit selected reconciled fact.

## Selected Fact Boundary

Ownership projection may consume only selected finalized reconciled facts. It
must never consume raw receipts, raw logs, raw graphs, or non-finalized
eligibility candidates.

The source of truth for future ownership is therefore not:

- an EVM receipt
- an RPC response
- an indexer state
- a canonical graph by itself

The source of truth for future ownership is:

```text
selected reconciled fact
```

## Core Invariant

```text
No protocol state or ownership projection may be derived before evidence has
passed canonicalization, finality eligibility, unambiguous reconciliation, and
explicit fact selection.
```

This invariant keeps ownership as a projection over completed adjudication, not
as a side effect of observing an external execution system.
