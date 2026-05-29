# Observe-Only Mode

Observe-only mode lets nodes learn about remote evidence without mutating local authority.

## Core Rule

```text
observed_evidence != local_authority
```

## What Observation May Do

Observation may:

- Fetch remote events.
- Store remote evidence.
- Verify structure and hashes.
- Verify signatures when available.
- Produce admissibility reports.
- Produce shadow projection candidates.

## What Observation Must Not Do

Observation must not:

- Mutate local authority graph.
- Revoke local controllers.
- Add peer trust.
- Commit projection state.
- Execute remote intents.

## Operator Surface

Operator commands may render observed evidence and diagnostics.

They must not turn observation into mutation unless the command is explicitly an admission or authority action.

## Repair Plane

Runtime repair may reconcile availability, migrations, policy sync, domains, and endpoint checks.

It must preserve:

```text
authority_projection_changed = false
```
