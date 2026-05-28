# RFC-0012: Simple Layer One Ontology Core v0.1

Status: Draft

Simple Layer One is a network of digital subjects, their state, their relationships, and verifiable actions.

Coin is not the center.
Entity and verifiable relationships are the center.

This document defines the ontology core for Simple Layer One. It does not define consensus, serialization, or execution rules. It defines the domain primitives that later protocol layers use.

---

## 1. Protocol Objects

Protocol objects answer: what exists?

### Entity

An Entity is a legal, social, service, agent, or organizational subject.

Protocol prefix:

```text
sl1e_
```

Question answered:

```text
Who exists?
```

Examples:

```text
sl1e_alice
sl1e_meanly_ltd
sl1e_ai_agent
```

### Controller

A Controller is an authority that may approve actions. A controller does not own assets by default.

Protocol prefix:

```text
sl1c_
```

Question answered:

```text
Who may act?
```

Examples:

```text
passkey
multisig
session key
delegated agent
```

### Account

An Account is a state container. It may hold balances, escrow state, reward state, or application state.

Protocol prefix:

```text
sl1a_
```

Question answered:

```text
Where does state live?
```

Examples:

```text
treasury_account
settlement_account
escrow_account
rewards_account
```

### Asset

An Asset is a value object. Assets are optional for the ontology core.

Question answered:

```text
What has value?
```

Examples:

```text
SL1 Coin
tokens
NFTs
licenses
rights
```

### Attestation

An Attestation is a trusted claim about an entity, account, controller, asset, or application.

Protocol prefix:

```text
sl1t_
```

Question answered:

```text
What is trusted?
```

Examples:

```text
verified_merchant
legal_entity_verified
trusted_buyer
kyc_passed
merchant_since_2027
```

### Capability

A Capability describes permitted actions. It is a right, not the action itself.

Domain name:

```text
Capability
```

Protocol prefix:

```text
sl1r_
```

Question answered:

```text
What may be done?
```

Examples:

```text
purchase.hosting
treasury.transfer
seller.refund
issue.credential
```

### Intent

An Intent describes a requested change or action before approval and execution.

Protocol prefix:

```text
sl1i_
```

Question answered:

```text
What is requested?
```

Examples:

```text
purchase item
transfer asset
sign document
issue refund
grant controller
```

### Transaction

A Transaction is a state transition accepted by the network.

Protocol prefix:

```text
sl1x_
```

Question answered:

```text
What changed?
```

### Proof

A Proof is a verifiable result of authorization, execution, settlement, or attestation.

Protocol prefix:

```text
sl1p_
```

Question answered:

```text
What can be verified?
```

### Application

An Application is an external consumer of protocol state and proofs. Applications are not protocol primitives.

Question answered:

```text
Who consumes results?
```

Examples:

```text
marketplace
exchange
messenger
documents
agents
ticketing
```

---

## 2. Relationship Primitives

Relationship primitives answer: how existing things relate?

Relationships are first-class objects. They can have issuers, constraints, scopes, validity windows, revocation state, and source proofs.

### OwnershipClaim

An OwnershipClaim relates an Entity to an Account.

Question answered:

```text
Who owns what?
```

Shape:

```text
OwnershipClaim
  entity_id
  account_id
  role
  weight
  valid_from
  valid_until
  source_proof
```

This replaces the weaker pattern:

```text
Account.owner_id
```

Ownership is a relationship, not a field.

### ControlGrant

A ControlGrant binds a Controller to a Capability for an Entity, Account, or resource scope.

Question answered:

```text
Who may use which rights?
```

Shape:

```text
ControlGrant
  controller_id
  entity_id
  capability_id
  scope
  constraints
  valid_from
  valid_until
  revocation_policy
  source_proof
```

### IntentApproval

An IntentApproval records the cryptographic fact that a Controller approved a canonical Intent.

Question answered:

```text
Which controller signed which intent?
```

Shape:

```text
IntentApproval
  controller_id
  intent_id
  proof_key_id
  signature
  authenticator_data
  client_data_json
  approved_at
```

An IntentApproval proves controller approval.

It does not prove ownership, authority, validity, execution, or settlement.

### Authorization

An Authorization binds an IntentApproval to authority lineage.

Question answered:

```text
Was this approved intent authorized by valid authority?
```

Shape:

```text
Authorization
  intent_approval_id
  intent_id
  capability_id
  grant_id
  policy_decision_id
  authorized_at
  valid_until
```

Authorization is an authority object.

It is not the raw WebAuthn signature.

### Credential

A Credential transports proof of an Attestation.

Question answered:

```text
How is trust proven?
```

Shape:

```text
Credential
  issuer
  subject
  attestation_id
  proof
  issued_at
  expires_at
```

---

## 3. Core Questions

Each primary question has one primary object.

```text
Who exists?
  Entity

Who may act?
  Controller

Where does state live?
  Account

What has value?
  Asset

What is trusted?
  Attestation

What may be done?
  Capability

What is requested?
  Intent

What changed?
  Transaction

What can be verified?
  Proof

Who consumes results?
  Application
```

Relationship questions:

```text
Who owns what?
  OwnershipClaim

Who may use which rights?
  ControlGrant

Which controller signed which intent?
  IntentApproval

Was this approved intent authorized by valid authority?
  Authorization

How is trust proven?
  Credential
```

---

## 4. Axioms

The following axioms must remain true across implementations.

```text
Properties do not imply authority.
Authority does not imply ownership.
Ownership does not imply control.
Relationships are first-class objects.
Objects define state.
Relationships define meaning.
Wallet is not primitive.
```

Consequences:

```text
Attestation does not grant authority.
Capability does not prove trust.
Controller does not own assets.
Account does not equal identity.
Application does not control the network.
Proof does not create rights.
Credential does not mutate state.
Intent does not authorize itself.
Signature does not create authority.
```

---

## 5. Architectural Principles

The following principles guide protocol design but are not themselves object definitions.

```text
Subjects are fundamental.
Assets are optional.
State lives in objects.
Authority lives in relationships.
```

If the Asset layer is removed, Simple Layer One remains useful as an identity, trust, document, delegation, proof, and agent network.

If the Asset layer is added, Simple Layer One also becomes a settlement network.

Value transfer is an added capability, not the foundation of the ontology.

---

## 6. Wallet Is Not Primitive

Wallet is a client-side adapter over protocol primitives.

```text
Wallet =
  Controller Discovery
  + Account View
  + Asset View
  + Intent Creation UI
  + Authorization UX
```

This avoids the classical collapse:

```text
address = identity = wallet = account = authority = asset holder
```

In Simple Layer One:

```text
Entity != Controller
Controller != Account
Account != Asset
Attestation != Capability
Application != Network
```

---

## 7. Example: Organization With Delegated Agent

```text
Entity
  sl1e_meanly_ltd

Accounts
  sl1a_treasury
  sl1a_settlement

OwnershipClaims
  sl1e_meanly_ltd -> sl1a_treasury
    role: owner
    weight: 100

Controllers
  sl1c_passkey_ceo
  sl1c_passkey_cfo
  sl1c_multisig_board
  sl1c_ai_procurement

Capabilities
  sl1r_treasury_transfer
  sl1r_purchase_hosting

ControlGrants
  sl1c_passkey_cfo -> sl1r_treasury_transfer
    entity: sl1e_meanly_ltd
    scope: sl1a_treasury

  sl1c_ai_procurement -> sl1r_purchase_hosting
    entity: sl1e_meanly_ltd
    limit: 1000 SL1/month
    category: hosting
    expires_at: 2027-01-01

Attestations
  verified_merchant
  legal_entity_verified
```

The AI procurement controller can purchase hosting within its grant.
It does not own the treasury account.
It does not inherit the verified merchant attestation.
It does not become the entity.

---

## 8. Trust Does Not Grant Authority

Trust may inform policy. It does not directly grant rights.

Correct transition:

```text
Attestation
  verified_merchant

Policy evaluates trust

Capability
  seller.refund

ControlGrant
  controller -> seller.refund

IntentApproval
  controller signs refund intent

Authorization
  approval binds to capability and grant

Transaction
  state changes

Proof
  result is verifiable
```

Incorrect shortcut:

```text
verified_merchant => may_refund
```

That shortcut violates the ontology.

---

## 9. Evolution

```text
v0.1
  Ontology and invariants

v0.2
  Policy
  Risk
  Governance
  Constraints

v0.3
  Agents
  Workflows
  Automation
  Composition
```

Policy is intentionally outside v0.1. Ontology v0.1 defines what exists and how things relate. Policy defines how decisions are made.

---

## 10. Non-Goals

This document does not define:

```text
consensus
wire format
canonical serialization
signature algorithms
economic policy
native asset issuance
runtime execution semantics
```

This document also rejects the following ontology shortcuts:

```text
Identity is not a wallet.
Controller is not ownership.
Attestation is not authority.
Assets are not required.
Applications are not protocol primitives.
```
