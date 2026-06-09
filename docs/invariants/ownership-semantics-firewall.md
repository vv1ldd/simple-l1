# Ownership Semantics Firewall

SL1 Truth Pipeline v0 must not imply ownership before an explicit ownership
projection layer exists.

## Layer Boundaries

Layer A may describe observations only.

Layer B may describe eligibility only.

Layer C may describe reconciliation outcomes only.

Layer D is not implemented and not authorized.

## Forbidden Semantics

No Layer A, B, or C artifact may:

- assign ownership
- assign balances
- assign custody
- assign account state
- assign protocol state mutations

No verdict class may imply ownership.

No reason code may imply ownership.

No graph node may imply ownership.

## Review Checklist

Every new Layer A, B, or C field, verdict, status, reason code, graph node, or
fixture must be reviewed against these questions:

- Does this pass the SL1 Truth Pipeline v0 Scope Test?
- Does this describe ownership?
- Does this imply a balance or balance delta?
- Does this imply custody or account control?
- Does this imply protocol state mutation?
- Does this turn an observation into truth without Layer B?
- Does this turn reconciliation into ownership without Layer D?

If any answer is yes, the artifact must not be added to Layer A, B, or C.

## Selected Fact Rule

Ownership projection may consume only selected finalized reconciled facts.

It must never consume:

- raw receipts
- raw logs
- raw graphs
- finalized graphs by themselves
- matched intents by themselves

## Core Rule

```text
reconciliation != ownership
```

Until Layer D exists as a separate protocol layer, SL1 may observe, canonicalize,
evaluate eligibility, and reconcile intent. It must not claim who owns what.
