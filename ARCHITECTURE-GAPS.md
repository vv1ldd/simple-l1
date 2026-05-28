# Simple L1 Architecture Gaps

Status: Working gap map

Purpose: identify which RFCs already have executable runtime support and which remain specification-only.

This is not a protocol RFC. It does not define new primitives, relationships, or semantics.

---

## 0. Phase Transition

Simple L1 has moved from ontology construction into runtime closure.

Phase 1:

```text
Ontology Construction
---------------------
What exists?
How does it relate?
What is forbidden?

Status: mostly complete
```

Phase 2:

```text
Runtime Closure
---------------
Can the runtime actually enforce it?

Status: next priority
```

The active goal is no longer to add RFC numbers.

The active goal is to turn specified layers into executable, testable runtime artifacts.

---

## 1. Current Executable Kernels

The repository currently has executable coverage for:

```text
Identity Kernel v1
CRE v1
Settlement transition boundary checks
Settlement intent lifecycle
EVM deposit proof adapter
Constitutional policy DSL / policy evaluator
Settlement proof and receipt generation
Validator attestation quorum prototype
SL1E Connect dev runtime
Authorization code exchange
IdentityProof introspection
```

Conformance currently covers:

```text
Identity Kernel v1
CRE v1
Settlement Transition Rules v1 boundary
```

Conformance does not yet cover the full RFC stack.

SL1E Connect currently has a manual runtime smoke path:

```text
Marketplace
  -> connect.simplelayer.one/authorize
  -> authorization code
  -> code exchange
  -> IdentityProof
```

This is runtime evidence, but it is not yet a full automated conformance vector.

---

## 2. Spec -> Runtime Closure KPI

Legend:

```text
✅ implemented / covered
🟡 partial
🔴 missing
```

Goal:

```text
turn red into yellow
turn yellow into green
```

Current closure matrix:

| RFC | Spec | Runtime | Conformance |
| --- | --- | --- | --- |
| RFC-0012 Ontology Core | ✅ | 🟡 | 🟡 |
| RFC-0014 Policy Layer | ✅ | 🟡 | 🔴 |
| RFC-0015 Trust & Attestation Lifecycle | ✅ | 🟡 | 🔴 |
| RFC-0016 Capability & Delegation | ✅ | 🟡 | 🔴 |
| RFC-0017 External Proof Model | ✅ | 🟡 | 🔴 |
| RFC-0018 SL1 Connect & Identity Proof | ✅ | 🟡 | 🟡 |
| RFC-0020 Execution Consistency & Temporal Safety | ✅ | 🟡 | 🔴 |
| RFC-0021 Workflow & Compensation | ✅ | 🔴 | 🔴 |
| RFC-0022 Economic State & Settlement Graph | ✅ | 🟡 | 🔴 |
| RFC-0023 Cross-System Settlement | ✅ | 🟡 | 🔴 |
| RFC-0024 Semantic Isolation & Domain Integrity | ✅ | 🔴 | 🔴 |
| RFC-0025 Runtime Architecture | ✅ | document | 🔴 |
| RFC-0026 Marketplace Reference Flow | ✅ | document | 🔴 |

This table should be updated whenever runtime or conformance coverage changes.

---

## 3. Runtime Closure Scorecard

The near-term roadmap is measured by a small closure scorecard.

### RFC-0018 Connect

```text
Spec         ✅
Runtime      🟡 -> near ✅
Conformance  🟡
```

Closure target:

```text
site
  -> Connect with SL1
  -> IdentityProof
  -> session
```

Runtime artifacts now present:

```text
/authorize
authorization code
code exchange
proof token store
proof introspection
audience-bound IdentityProof shape
launchd deployment behind Valet
external marketplace consumer
```

Still required before green:

```text
challenge storage
challenge expiry
single-use challenge enforcement
replay protection
verifyRegistrationResponse integration
verifyAuthenticationResponse integration
first-class AuthenticationProof object
signed IdentityProof token
proof signing key rotation
proof expiration enforcement
automated connect conformance vectors
```

### RFC-0016 Authority

```text
Spec         ✅
Runtime      🟡
Conformance  🔴
```

Closure target:

```text
Capability
  -> ControlGrant
  -> IntentApproval
  -> Authorization
```

### RFC-0014 Policy

```text
Spec         ✅
Runtime      🟡
Conformance  🔴
```

Closure target:

```text
PolicyEvaluation
  -> PolicyDecision
```

as first-class runtime artifacts, not only function results.

### RFC-0017 External Proofs

```text
Spec         ✅
Runtime      🟡
Conformance  🔴
```

Closure target:

```text
ExternalProof
VerificationPath
FinalityClaim
NormalizedFact
ReplayProtection
```

### RFC-0026 Marketplace Flow

```text
Spec         ✅
Runtime      🔴
Conformance  🔴
```

Closure target:

```text
Buyer
  -> Intent
  -> IntentApproval
  -> ExternalPayment
  -> ExternalProof
  -> Policy
  -> Authority
  -> Transaction
  -> Settlement
  -> Proof
```

Operational rule:

```text
No new conceptual entities are needed to improve this scorecard.
Only runtime artifacts and conformance vectors count.
```

---

## 4. RFC Runtime Coverage Matrix

| RFC | Spec Status | Runtime Status | Current Runtime | Main Gap |
| --- | --- | --- | --- | --- |
| RFC-0000 Constitutional Summary | Specified | Document only | None | Conformance checks for anti-collapse invariants |
| RFC-0011 Identity Kernel & CRE | Frozen v1 | Present | `node/identity-kernel.js`, `node/capability-resolution.js`, `test-vectors/identity-v1.json`, `test-vectors/cre-v1.json` | Production key lifecycle and revocation APIs |
| RFC-0012 Ontology Core | Specified | Partial | Address classes, accounts, grants, settlement records | First-class runtime objects for all ontology primitives |
| RFC-0013 Interoperability | Specified | Partial | EVM adapter, settlement registry paths | Generic external system model and domain registry |
| RFC-0014 Policy Layer | Specified | Partial | `node/settlement/policy.js`, `node/settlement/dsl.js` | First-class `PolicyEvaluation` and `PolicyDecision` artifacts |
| RFC-0015 Trust & Attestation Lifecycle | Specified | Partial | `node/settlement/attestations.js` validator quorum prototype | General attestation, credential, revocation, expiry lifecycle |
| RFC-0016 Capability & Delegation | Specified | Partial | CRE grants and `/api/capabilities/*` endpoints | Full `Capability`, `ControlGrant`, `IntentApproval`, `Authorization` runtime service |
| RFC-0017 External Proof Model | Specified | Partial | EVM verification adapter, `SettlementProofFactory` | Generic `ExternalProof`, `VerificationPath`, `FinalityClaim`, replay protection |
| RFC-0018 SL1 Connect & Identity Proof | Specified | Advanced partial / dev | `/authorize`, authorization code exchange, proof introspection, `/api/register/options`, `/accounts`, identity kernel, launchd deployment | Production WebAuthn verification, challenge storage, replay protection, signed `IdentityProof`, connect conformance vectors |
| RFC-0020 Execution Consistency & Temporal Safety | Specified | Partial | intent lifecycle, idempotency checks in settlement vectors | Unified execution predicate, revocation-time checks, concurrency semantics |
| RFC-0021 Workflow & Compensation | Specified | Missing | None | Workflow engine, step re-validation, compensation runtime |
| RFC-0022 Economic State & Settlement Graph | Specified | Partial | balances, settlement receipts, intent fulfillment | Economic graph runtime, obligations, settlement legs, netting, escrow state |
| RFC-0023 Cross-System Settlement | Specified | Partial | EVM deposit flow, registry verification | Finality model runtime, reconciliation records, bridge safety checks |
| RFC-0024 Semantic Isolation & Domain Integrity | Specified | Missing | None | Domain registry, boundary proofs, cross-domain validation gates |
| RFC-0025 Runtime Architecture | Specified | Document only | None | Component boundary tests and service-level write guards |
| RFC-0026 Marketplace Reference Flow | Specified | Document only | None in this repo | End-to-end marketplace trace conformance |

---

## 5. Detailed Gaps

### RFC-0012: Ontology Core

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
Entity address validation
Key address validation
Account records
Capability grants
Settlement intent records
```

Needed:

```text
first-class Entity records
first-class Controller records
OwnershipClaim runtime
IntentApproval runtime
Authorization runtime
Proof object registry
ontology conformance vectors
```

Risk:

```text
Runtime may drift back toward account-centric modeling if OwnershipClaim and Controller records remain implicit.
```

---

### RFC-0014: Policy Layer

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
ConstitutionalPolicyEngine
ConstitutionalDSLInterpreter
code-level policy rules
policy audit log
```

Needed:

```text
PolicyEvaluation object
PolicyDecision object
stable decision IDs
decision input hashes
policy conformance vectors
policy decision persistence
clear allow / deny / require_more_evidence / require_more_authorization outputs
```

Risk:

```text
Policy can be executable without becoming auditable as a protocol artifact.
```

---

### RFC-0015: Trust & Attestation Lifecycle

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
validator attestation quorum prototype
attestation signatures
quorum proof construction
```

Needed:

```text
general Attestation records
Credential records
TrustSignal records
revocation lifecycle
expiry lifecycle
issuer registry
credential verification interface
trust facts as policy inputs only
```

Risk:

```text
Validator quorum attestations may be mistaken for the full trust layer.
```

---

### RFC-0016: Capability & Delegation

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
CRE v1
capability grant records
grant matching
deny / quorum / approval / allow precedence
```

Needed:

```text
Capability object registry
ControlGrant object lifecycle
IntentApproval service
Authorization service
DelegationChain support
Revocation records
authority lineage verification
authorization conformance vectors
```

Risk:

```text
CRE decisions may be treated as authorization unless Authorization becomes a first-class runtime object.
```

---

### RFC-0017: External Proof Model

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
EVM adapter verification
SettlementProofFactory
proof fingerprints
deposit verification flow
```

Needed:

```text
ExternalProof object
ExternalReference object
ExternalEvent object
VerificationPath object
FinalityClaim object
proof replay protection
proof equivocation handling
multi-source proof adapters
```

Risk:

```text
SettlementProof and ExternalProof may collapse into one object if the boundary is not implemented explicitly.
```

---

### RFC-0018: SL1 Connect & Identity Proof

Status:

```text
Specified
```

Runtime:

```text
Partial / development only
```

Present:

```text
registration options endpoint
account creation endpoint
entity/key separation
simple key derivation
WebAuthn server dependency
/authorize endpoint
authorization code issue/exchange
proof token store
proof introspection endpoint
audience-bound IdentityProof response shape
external Marketplace consumer
launchd deployment behind Valet
```

Needed:

```text
challenge storage
challenge expiry
single-use challenge enforcement
verifyRegistrationResponse integration
verifyAuthenticationResponse integration
AuthenticationProof object
signed IdentityProof token
audience binding
proof signing key rotation
proof expiration enforcement
key revocation awareness
JS connect widget
connect conformance vectors
```

Risk:

```text
The dev runtime can issue IdentityProof-like responses before the full WebAuthn challenge lifecycle exists.
This must not be mistaken for production AuthenticationProof.
```

---

### RFC-0020: Execution Consistency & Temporal Safety

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
intent state machine
intent expiry checks
fulfilled replay guard
settlement idempotency conformance vector
```

Needed:

```text
formal can_execute predicate
execution-time authority revalidation
revocation dominance checks
policy window checks
resource availability checks
concurrency conflict model
ExecutionEnvelope runtime
```

Risk:

```text
Intent lifecycle can appear safe while authority freshness is still not fully revalidated.
```

---

### RFC-0021: Workflow & Compensation

Status:

```text
Specified
```

Runtime:

```text
Missing
```

Needed:

```text
Workflow records
WorkflowStep records
independent per-step validation
PartialExecutionState model
CompensationIntent support
WorkflowProof
workflow conformance vectors
```

Risk:

```text
Applications may implement workflow semantics outside the protocol and accidentally create macro-permissions.
```

---

### RFC-0022: Economic State & Settlement Graph

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
balances
deposit fulfillment
settlement receipts
provenance logs
```

Needed:

```text
EconomicIntent records
Obligation records
SettlementLeg records
NettingSet records
EscrowState runtime
SettlementOperation records
ReconciliationRecord linkage
partial settlement model
```

Risk:

```text
Balance mutation may exist without explicit economic graph lineage.
```

---

### RFC-0023: Cross-System Settlement

Status:

```text
Specified
```

Runtime:

```text
Partial
```

Present:

```text
external network catalog
EVM verification
deposit address derivation
settlement event bus
receipt verification
```

Needed:

```text
FinalityModel runtime
SettlementRecognition object
ReconciliationRecord object
bridge message safety checks
chargeback / challenge window modeling
cross-system replay protection
source and target domain validation
```

Risk:

```text
External receipt may become fulfillment trigger unless recognition and reconciliation are explicit.
```

---

### RFC-0024: Semantic Isolation & Domain Integrity

Status:

```text
Specified
```

Runtime:

```text
Missing
```

Needed:

```text
Domain registry
DomainFact records
DomainPolicy records
BoundaryProof records
source-domain / target-domain enforcement
cross-domain proof validation
domain-scoped authority checks
semantic leakage conformance vectors
```

Risk:

```text
Cross-system integrations may transfer meaning across domains without explicit re-validation.
```

---

## 6. Spec -> Runtime Closure Waves

### Wave 1: SL1 Connect v1

Target:

```text
RFC-0018
Specified -> Executable
```

Artifacts:

```text
AuthenticationProof
IdentityProof
challenge store
WebAuthn registration verification
WebAuthn authentication verification
proof issuance
audience-bound proof token
JS widget
connect conformance vectors
```

### Wave 2: Authority Runtime v1

Target:

```text
RFC-0016
Specified -> Executable
```

Artifacts:

```text
Capability registry
ControlGrant store
grant revocation
IntentApproval service
Authorization builder
lineage verification
authorization conformance vectors
```

Primary runtime question:

```text
Can an authenticated identity exercise authority with lineage?

IdentityProof
  -> Capability
  -> ControlGrant
  -> Authorization
```

### Wave 3: Policy Artifact Alignment

Target:

```text
RFC-0014
Partial runtime -> first-class runtime artifacts
```

This is not a new policy engine.

The repository already has:

```text
node/settlement/policy.js
node/settlement/dsl.js
```

Artifacts:

```text
PolicyEvaluation object
PolicyDecision object
decision IDs
input hashes
reason codes
decision persistence
policy conformance vectors
```

### Wave 4: External Proof Runtime v1

Target:

```text
RFC-0017
Partial adapter runtime -> generic proof runtime
```

Artifacts:

```text
ExternalProof
VerificationPath
FinalityClaim
normalization
replay protection
equivocation handling
adapter output registry
external proof conformance vectors
```

### Wave 5: Marketplace Reference Flow Conformance

Target:

```text
RFC-0026
Documented reference flow -> executable conformance trace
```

Trace:

```text
Buyer
  -> Intent
  -> IntentApproval
  -> ExternalPayment
  -> ExternalProof
  -> Policy
  -> Authority
  -> Transaction
  -> Settlement
  -> Proof
```

Artifacts:

```text
marketplace reference vector
purchase intent fixture
external payment proof fixture
policy decision fixture
authority lineage fixture
settlement proof fixture
end-to-end replay test
non-bypass negative cases
```

---

## 7. SL1 v0.1 Runtime Milestone

SL1 v0.1 should mean:

```text
RFC-0012 through RFC-0026 specified
RFC-0018 executable
RFC-0016 executable
RFC-0017 executable
Policy artifacts aligned with RFC-0014
Marketplace reference flow passing conformance
```

Minimum exit criteria:

```text
site can receive audience-bound IdentityProof
controller can create IntentApproval
authority service can build Authorization
policy engine persists PolicyDecision
external proof runtime normalizes PSP/EVM evidence
marketplace flow trace passes conformance
```

After this milestone, agent runtime work becomes grounded in real Policy, Authority, Proof, and Execution systems.

Lineage audit criterion:

```text
For every state mutation, the runtime can explain:

Settlement
  <- Transaction
  <- Authorization
  <- ControlGrant
  <- Capability
  <- PolicyDecision
  <- PolicyEvaluation
  <- Facts
```

If any state mutation cannot be explained by lineage, SL1 v0.1 is not closed.

---

## 8. Highest-Value Next Runtime Projects

### 1. SL1 Connect v1

Why:

```text
Most externally demonstrable value.
Turns identity kernel into usable website integration.
Already has a working dev authorization-code flow.
```

Deliverables:

```text
formal challenge store
single-use challenge enforcement
challenge expiry
replay protection
proof signing key rotation
proof expiration enforcement
connect conformance vectors
```

Already present:

```text
/authorize
authorization code
code exchange
proof introspection
IdentityProof response shape
external Marketplace consumer
launchd deployment
```

Remaining original deliverables:

```text
challenge store
registration verification
authentication verification
AuthenticationProof
IdentityProof
audience-bound proof token
JS widget
connect conformance vectors
```

### 2. Authority Runtime v1

Why:

```text
Prevents CRE decisions and signatures from being treated as authorization.
Connect can now prove identity; Authority Runtime must prove what that identity may do.
```

Deliverables:

```text
Capability registry
ControlGrant lifecycle
IntentApproval service
Authorization service
Revocation records
authority lineage verifier
authorization conformance vectors
```

### 3. Policy Engine v1 Alignment

Why:

```text
Policy logic exists, but RFC-0014 artifacts are not first-class.
```

Deliverables:

```text
PolicyEvaluation persistence
PolicyDecision persistence
decision input hash
reason codes
allow / deny / require_more_evidence / require_more_authorization outputs
policy conformance vectors
```

### 4. External Proof Runtime v1

Why:

```text
Needed before marketplace and cross-system settlement can be trusted.
```

Deliverables:

```text
ExternalProof registry
VerificationPath
FinalityClaim
proof replay protection
proof equivocation handling
adapter output normalization
external proof conformance vectors
```

---

## 9. Recommended Build Order

```text
1. SL1 Connect v1
2. Authority Runtime v1
3. Policy Engine v1 artifact alignment
4. External Proof Runtime v1
5. Marketplace Reference Flow conformance
6. Domain Boundary Enforcement
7. Workflow Engine
8. Economic Graph Runtime
```

Rationale:

```text
Identity proof gets external use.
Authority runtime prevents permission collapse.
Policy artifacts make decisions auditable.
External proofs make payment and settlement evidence safe.
Marketplace flow then becomes executable end-to-end.
```

---

## 10. Gap Review Rule

RFC freeze rule:

```text
Do not add new mechanism RFCs until the current red/yellow runtime gaps
have a closure plan or executable artifact.
```

Before adding a new mechanism RFC, ask:

```text
Does an existing RFC already define this layer?
Does the runtime implement it?
Does conformance test it?
```

If the answer is "specified but not executable", prioritize runtime alignment over new abstraction.

New RFC work should resume only when:

```text
the proposed behavior is not already specified
the runtime gap map shows no existing layer owns it
the new RFC is required to unblock implementation
```
