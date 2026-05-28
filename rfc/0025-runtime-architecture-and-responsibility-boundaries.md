# RFC-0025: Runtime Architecture & Responsibility Boundaries

Status: Draft

This document maps Simple Layer One RFC concepts to runtime components and responsibility boundaries.

RFC-0025 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0012: Ontology Core v0.1
RFC-0014: Policy Layer v0.2
RFC-0015: Trust & Attestation Lifecycle
RFC-0016: Capability & Delegation Model
RFC-0017: External Proof Model
RFC-0018: SL1 Connect & Identity Proof
RFC-0020: Execution Consistency & Temporal Safety
RFC-0021: Workflow & Compensation Semantics
RFC-0022: Economic State & Settlement Graph Kernel
RFC-0023: Cross-System Settlement & Interoperability Execution
RFC-0024: Semantic Isolation & Domain Integrity
```

RFC-0025 introduces no new protocol primitives.

It defines where existing primitives may be created, verified, consumed, and mutated in a reference runtime.

---

## 1. Core Principle

```text
Runtime components may implement protocol responsibilities.
They must not redefine protocol semantics.
```

Each component has a limited write boundary.

No component may create objects outside its responsibility boundary.

No component may skip the constitutional pipeline:

```text
Representation
  -> Policy
  -> Authority
  -> Re-validation
  -> Execution
  -> Settlement
```

---

## 2. Runtime Layers

### Identity Layer

Objects:

```text
Entity
Controller
AuthenticationProof
IdentityProof
```

Primary responsibility:

```text
who exists
which controller authenticated
which Entity is linked to a controller
```

Must not create:

```text
Capability
ControlGrant
Authorization
Transaction
SettlementOperation
```

### Trust Layer

Objects:

```text
Attestation
Credential
TrustSignal
ExternalProof
```

Primary responsibility:

```text
what is believed
what was verified
what evidence is available
```

Must not create authority.

### Policy Layer

Objects:

```text
Policy
PolicyEvaluation
PolicyDecision
PolicyConstraint
RiskSignal
```

Primary responsibility:

```text
what should be allowed
```

Must not mutate state.

Must not create authority directly.

### Authority Layer

Objects:

```text
Capability
ControlGrant
IntentApproval
Authorization
DelegationChain
Revocation
```

Primary responsibility:

```text
who may do what
which signed intent may be honored
```

Must not execute transactions.

### Execution Layer

Objects:

```text
Intent
Transaction
ExecutionEnvelope
Workflow
WorkflowStep
WorkflowProof
```

Primary responsibility:

```text
when an authorized action is valid at execution time
what actually happened
```

Must re-validate policy, authority, freshness, replay, and current state.

### Settlement Layer

Objects:

```text
SettlementOperation
SettlementRecognition
ReconciliationRecord
SettlementProof
BalanceMutation
AssetTransfer
EscrowStateTransition
FinalSettlement
```

Primary responsibility:

```text
what economic state changed
what settlement was recognized
what result can be verified
```

Only this layer may mutate economic state.

---

## 3. Reference Components

### Identity Kernel

May create:

```text
Entity
Controller
controller-to-entity binding records
```

May verify:

```text
entity address shape
controller key address shape
key registration status
key revocation status
```

Must not create authorization or application permissions.

### Connect Service

May create:

```text
AuthenticationProof
IdentityProof
```

May verify:

```text
WebAuthn registration response
WebAuthn authentication response
challenge freshness
audience binding
controller-to-entity binding
```

Must not create:

```text
Capability
ControlGrant
Authorization
Transaction
SettlementOperation
```

### Trust Service

May create:

```text
Attestation
Credential
TrustSignal
```

May verify:

```text
issuer identity
credential validity
revocation status
trust signal source
```

Must not create authority.

### External Proof Adapter

May create:

```text
ExternalProof
VerificationPath
FinalityClaim
```

May verify:

```text
external event authenticity
source system finality model
proof freshness
source domain identity
```

Must not mutate SL1 state.

### Policy Engine

May create:

```text
PolicyEvaluation
PolicyDecision
```

May consume:

```text
Facts
Attestations
Credentials
TrustSignals
ExternalProofs
Intent metadata
current state snapshots
```

Must not create:

```text
Capability
ControlGrant
Authorization
Transaction
SettlementOperation
```

### Authority Service

May create:

```text
Capability
ControlGrant
Authorization
DelegationChain
Revocation
```

May consume:

```text
PolicyDecision
IntentApproval
current grant state
revocation state
```

Must not execute transactions.

### Intent Approval Service

May create:

```text
IntentApproval
```

May verify:

```text
canonical Intent hash
WebAuthn signature
controller registration
challenge binding
replay protection
```

Must not infer authority from signature.

### Execution Engine

May create:

```text
Transaction
ExecutionEnvelope
WorkflowStep outcome
WorkflowProof
```

May consume:

```text
Intent
IntentApproval
Authorization
PolicyDecision
current state
idempotency records
```

Must re-validate at execution time.

Must not mutate economic state except through Settlement Engine.

### Workflow Engine

May create:

```text
Workflow
WorkflowStep
WorkflowProof
CompensationIntent
PartialExecutionState
```

Must not create authority.

Must not make workflow context influence execution validity.

### Settlement Engine

May create:

```text
SettlementOperation
SettlementRecognition
ReconciliationRecord
SettlementProof
```

May mutate:

```text
economic state
balances
escrow state
asset transfer state
final settlement records
```

Must consume valid execution results.

Must not accept external settlement signals without RFC-0023 recognition and RFC-0024 domain isolation.

---

## 4. Write Boundary Matrix

```text
Connect Service        -> AuthenticationProof, IdentityProof
Trust Service          -> Attestation, Credential, TrustSignal
External Proof Adapter -> ExternalProof, VerificationPath, FinalityClaim
Policy Engine          -> PolicyEvaluation, PolicyDecision
Authority Service      -> Capability, ControlGrant, Authorization, Revocation
Intent Approval Service-> IntentApproval
Execution Engine       -> Transaction, ExecutionEnvelope
Workflow Engine        -> Workflow, WorkflowStep, WorkflowProof
Settlement Engine      -> SettlementOperation, SettlementProof, economic state mutation
```

Any component writing outside this boundary must be treated as a protocol violation unless explicitly authorized by a later RFC.

---

## 5. Forbidden Runtime Collapses

The following implementation shortcuts are forbidden:

```text
Connect Service creates ControlGrant
IdentityProof creates application authority
Trust Service creates Capability
External Proof Adapter mutates account state
Policy Engine writes balances
Authority Service executes transactions
Workflow Engine grants permission
Execution Engine skips re-validation
Settlement Engine accepts bridge messages as state
Application writes protocol authority directly
```

These are runtime versions of constitutional collapse.

---

## 6. Deployment Boundaries

Components may be deployed together or separately.

Deployment topology does not change responsibility boundaries.

Valid deployment examples:

```text
single node runtime
modular service runtime
embedded marketplace runtime
federated settlement runtime
browser connect widget + SL1 backend
```

Invalid assumption:

```text
same process == same authority
```

A service may run in the same process as another service and still be forbidden from writing another layer's objects.

---

## 7. Application Boundary

Applications may consume SL1 proofs and request SL1 actions.

Applications must not define SL1 truth.

Applications may create:

```text
application sessions
application UI state
application-local roles
application-local preferences
```

Applications must not create:

```text
SL1 Entity
SL1 Authorization
SL1 SettlementOperation
SL1 SettlementProof
SL1 economic state mutation
```

If an application needs protocol authority, it must request it through the SL1 authority pipeline.

---

## 8. Review Gate

Every implementation, SDK, adapter, or service boundary must answer:

```text
Which component creates this object?
Is that component allowed to create this object?
Does this write skip policy, authority, re-validation, execution, or settlement?
```

If any answer crosses responsibility boundaries, redesign.

---

## 9. Non-Goals

This document does not define:

```text
network deployment topology
database schema
RPC API shape
service discovery
load balancing
consensus implementation
business workflow design
```

Those belong to implementation guides or later reference-flow RFCs.

RFC-0025 defines responsibility boundaries only.
