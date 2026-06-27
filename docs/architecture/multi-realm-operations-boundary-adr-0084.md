# ADR-0084: Multi-Realm Operations Boundary

Status: Accepted

This ADR defines how many Realms may be discovered, monitored, scheduled,
backed up, deployed, and coordinated without merging their authority domains or
creating a fleet-wide source of truth.

ADR-0083 established that deployment changes runtime, not history. ADR-0084
completes the operational arc by defining the boundary for operating many
independent Realms: a fleet is an operational view, while each Realm remains its
own authority boundary.

```text
ADR-0063 answers: Where does realm truth live?
ADR-0064 answers: Who may change realm truth?
ADR-0065 answers: Which events belong to realm truth?
ADR-0066 answers: How does realm truth propagate to devices?
ADR-0067 answers: How do realms recognize external authority?
ADR-0068 answers: What is canonical versus replaceable?
ADR-0069 answers: How is authority lifecycle implemented without making keys identity?
ADR-0070 answers: How is authority continuity restored after loss?
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
```

## Acceptance Criteria

ADR-0084 is accepted when the following multi-Realm boundaries are frozen:

```text
multi_realm_operations_coordinate_realms
multi_realm_operations_do_not_merge_authority_domains
fleet_is_operational_view
realm_remains_authority_boundary
fleet_cannot_create_global_authority_state
fleet_cannot_merge_event_histories
fleet_cannot_import_authority_between_realms
fleet_cannot_create_global_root_authority
fleet_cannot_mutate_remote_projections
fleet_cannot_bypass_local_validators
realm_isolation_preserves_independent_projection
fleet_membership_does_not_imply_federation_trust
federation_remains_explicit_local_policy_event
fleet_lifecycle_view_is_not_global_realm_state
fleet_commands_route_to_realm_local_commands
growth_must_not_create_a_second_path_to_state
```

## Constitutional Kernel

```text
Multi-Realm operations coordinate Realms.
They do not merge authority domains.
```

Supporting kernel:

```text
A fleet is an operational view.
A Realm remains the authority boundary.
```

Wrong:

```text
Fleet Manager
        ↓
Global Authority State
```

Correct:

```text
Realm A
  history A
  authority A
  projection A

Realm B
  history B
  authority B
  projection B

Fleet Operations
        ↓
coordination only
```

Hardening series guardrails:

```text
ADR-0072  federation does not merge histories
ADR-0077  dashboard / explanation != state
ADR-0082  admin operation != authority
ADR-0083  deployment != history
ADR-0084  fleet != authority
```

## Context

The operational arc is now:

```text
0078 Verification
       ↓
0079 Lifecycle
       ↓
0080 Backup
       ↓
0081 Disaster Recovery
       ↓
0082 Admin
       ↓
0083 Deployment
       ↓
0084 Multi-Realm
```

Each previous layer preserved the same invariant:

```text
Operations can request transitions.
Only Realm history can prove transitions happened.
```

ADR-0084 extends that invariant to scale:

```text
Scale increases coordination.
Scale does not create new authority.
```

Without this boundary, fleet tooling will be tempted to introduce:

- a global authority database
- cross-Realm projection mutation
- fleet membership as implicit trust
- centralized root authority for convenience
- history merge jobs
- multi-tenant storage shortcuts that blur Realm identity

ADR-0084 prevents that drift.

## Questions This ADR Answers

```text
What is a fleet allowed to coordinate?
What remains Realm-local?
How are lifecycle states aggregated without becoming global state?
How are deployments and backups scheduled across Realms?
How does federation remain explicit instead of membership-derived?
What must never be shared or merged across Realms?
```

This ADR does **not** select fleet orchestration tooling, discovery protocol,
tenant model, dashboard design, billing model, or global policy engine.

## Core Boundary

Multi-Realm operation is coordination over independent causal histories.

```text
Fleet Command
        ↓
Realm Target Selection
        ↓
Realm-local Command
        ↓
Realm Kernel
        ↓
Realm History
```

Multi-Realm does not mean:

```text
multi-tenant database with shared authority state
```

It means:

```text
many independent causal histories
with operational coordination
```

## Fleet Layer Capabilities

The fleet layer may:

```text
discover realms
collect integrity reports
monitor lifecycle states
schedule deployment procedures
coordinate backup procedures
coordinate disaster recovery procedures
request federation operations
route admin commands to selected realms
compare operational metadata across realms
display read-only fleet dashboards
```

The fleet layer must not:

```text
merge event histories
import authority from one realm to another
create global root authority
mutate remote projections
bypass local validators
rewrite local history
declare federation trust by fleet membership
convert fleet dashboard state into Realm state
```

## Realm Isolation

Each Realm owns its own:

```text
event history
authority policy
validator decisions
projection
integrity report
lifecycle state
backup artifacts
deployment compatibility gate
```

An event accepted in Realm A must not mutate Realm B.

```text
Realm A accepted event
        ↓
Realm A projection changes

Realm B projection
        ↓
unchanged
```

Cross-Realm effects require explicit local acceptance in the target Realm.

## No Authority Merge

Root authority in one Realm is not root authority in another Realm.

```text
root authority A
        ↓
fleet operation
        ↓
cannot become root authority B
```

If Realm B recognizes Realm A, that recognition must be represented as Realm B
history under Realm B policy.

```text
Realm A trust evidence
        ↓
Realm B federation policy
        ↓
FEDERATION_TRUST_ESTABLISHED in Realm B
```

Fleet membership is not trust.

## Fleet Read-Only View

Fleet dashboards may aggregate:

```text
realm_id
history_head
projection_hash
integrity status
lifecycle state
runtime version
backup status
deployment status
federation references
```

But:

```text
fleet dashboard != global Realm state
fleet report != authority history
fleet index != projection owner
```

Fleet views are operational representations. They can be missing, stale, or
rebuilt without changing any Realm identity.

## Independent Lifecycle

Lifecycle remains Realm-local:

```text
Realm A = VERIFIED
Realm B = SUSPENDED
        ↓
fleet view = mixed operational status
        ↓
not a global Realm lifecycle state
```

Fleet status may summarize health, but it must not override a Realm's local
lifecycle derivation.

```text
fleet says healthy
        ↓
not sufficient
        ↓
Realm-local lifecycle still decides command acceptance
```

## Federation Remains Explicit

ADR-0072 established:

```text
Federation is trust between authority histories,
not trust between databases.
```

ADR-0084 adds:

```text
Fleet membership is discovery.
Fleet membership is not federation trust.
```

Correct:

```text
Realm A discovered in fleet
        ↓
Realm B requests federation operation
        ↓
Realm B validator evaluates policy
        ↓
FEDERATION_TRUST_ESTABLISHED accepted or rejected in Realm B
```

Wrong:

```text
Realm A and Realm B are in same fleet
        ↓
trust each other automatically
```

## Fleet Commands

Fleet commands must decompose into Realm-local commands:

```text
Fleet Command
        ↓
target selection
        ↓
per-Realm Admin Command
        ↓
executeCommand()
        ↓
Realm-local validator
```

Examples:

```text
SCHEDULE_BACKUP_FOR_ALL
        ↓
CREATE_BACKUP per Realm

DEPLOY_RUNTIME_TO_GROUP
        ↓
ADR-0083 deployment gate per Realm

VERIFY_FLEET_INTEGRITY
        ↓
RUN_INTEGRITY_CHECK per Realm

REQUEST_FEDERATION
        ↓
RECOGNIZE_REALM command in target Realm
```

Fleet command success is a coordination result. It is not a Realm Event unless a
Realm-local kernel accepts a Realm Event.

## Failure Modes

### Cross-Realm Projection Mutation

```text
event accepted in Realm A
        ↓
projection B changes
        ↓
forbidden
```

Expected result:

```text
REALM_ISOLATION_VIOLATION
```

### Global Authority Creation

```text
fleet manager
        ↓
create global root
        ↓
forbidden
```

Expected result:

```text
GLOBAL_AUTHORITY_FORBIDDEN
```

### Fleet Membership as Trust

```text
realm discovered by fleet
        ↓
trusted by every Realm
        ↓
forbidden
```

Expected result:

```text
FEDERATION_TRUST_REQUIRED
```

### Merged Histories

```text
history A + history B
        ↓
global history
        ↓
forbidden
```

Expected result:

```text
REALM_HISTORY_MERGE_FORBIDDEN
```

### Fleet Dashboard Loss

```text
fleet dashboard unavailable
        ↓
operational visibility degraded
        ↓
Realm identities unchanged
```

## Mandatory Acceptance Tests

Future multi-Realm tests should prove:

### 1. Realm Isolation

```text
event in Realm A
        ↓
no projection change in Realm B
```

### 2. No Authority Merge

```text
root authority A
        ↓
fleet operation
        ↓
cannot become root authority B
```

### 3. Fleet Read-Only View

```text
fleet dashboard
        ↓
representation only
        ↓
no Realm mutation
```

### 4. Independent Lifecycle

```text
Realm A = VERIFIED
Realm B = SUSPENDED
        ↓
fleet state != global realm state
```

### 5. Federation Remains Explicit

```text
Realm A trusts Realm B
        ↓
only through FEDERATION_TRUST_ESTABLISHED
        ↓
not through fleet membership
```

### 6. Fleet Command Routes Locally

```text
fleet operation
        ↓
per-Realm command
        ↓
per-Realm kernel
        ↓
per-Realm history
```

### 7. Failed Target Does Not Mutate Other Targets

```text
Realm A target succeeds
Realm B target fails validation
        ↓
Realm A history reflects only A acceptance
Realm B history unchanged
Realm C history unchanged
```

## Relationship to the Operating Model

After ADR-0084, the series has moved from identity kernel to Realm operating
model:

```text
Identity kernel:
  history, authority policy, accepted Realm Events, projection

Operational model:
  verification, lifecycle, backup, disaster recovery, admin, deployment, fleet
```

The operating model remains constitutional because every operational layer
preserves the same rule:

```text
coordination / request / explanation / deployment / recovery
        ↓
not authority

accepted Realm Event history
        ↓
authority
```

## Consequences

### Positive

- Fleet operations can scale without centralizing authority
- Realm isolation remains testable
- Fleet dashboards can be broad without becoming state
- Federation trust remains explicit and attributable
- Deployment, backup, and DR can be coordinated safely across many Realms

### Negative

- Fleet tooling cannot rely on global projection shortcuts
- Cross-Realm workflows require explicit per-Realm acceptance
- Operators must tolerate mixed lifecycle states
- Fleet membership cannot be used as universal trust

## Non-Goals

- No fleet orchestration platform selection in this ADR
- No tenant billing model in this ADR
- No global policy engine design in this ADR
- No dashboard UI design in this ADR
- No shared database schema design in this ADR
- No new global authority model in this ADR

## Implementation Follow-Up

The first implementation step after this ADR should be a read-mostly fleet
adapter and focused isolation tests, not a shared authority store:

```text
1. define fleet Realm registry as operational metadata
2. collect per-Realm integrity and lifecycle reports
3. route fleet commands into Realm-local admin commands
4. prove event acceptance in one Realm does not mutate another
5. prove fleet membership does not establish federation trust
6. prove mixed lifecycle states remain per-Realm
```

Suggested test target:

```text
node/scripts/test-multi-realm-operations-boundary.js
```

## Summary

Multi-Realm operations ask:

```text
How do we operate many Realms together?
```

Answer:

```text
Discover them.
Observe them.
Schedule work for them.
Route commands to them.
Let each Realm decide locally.
Never merge their authority.
```

Scale increases coordination. Scale does not create new authority.
