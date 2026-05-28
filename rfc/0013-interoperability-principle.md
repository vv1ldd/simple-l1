# RFC-0013: Interoperability Principle

Status: Draft

Simple Layer One is not an island.

Simple Layer One is a network of digital subjects, not a closed universe. Subjects, assets, attestations, credentials, transactions, and proofs may originate from Simple Layer One or from external systems. The protocol provides a common ontology for describing, relating, and verifying them.

This document defines an architectural principle. It does not modify the ontology core defined in RFC-0012.

---

## 1. Principle

Simple Layer One does not assume exclusive ownership of identity, assets, trust, or settlement.

The network may:

```text
reference external objects
verify external proofs
consume external settlement events
produce proofs for external applications
relate external identities, accounts, assets, and attestations
```

The purpose of Simple Layer One is not to replace every network. The purpose is to provide a common semantic and verification layer across networks.

---

## 2. Consequence

Traditional L1 assumption:

```text
Identity belongs to the chain.
Assets belong to the chain.
Trust belongs to the chain.
Settlement belongs to the chain.
```

Simple Layer One assumption:

```text
Identity may originate elsewhere.
Assets may originate elsewhere.
Trust may originate elsewhere.
Settlement may originate elsewhere.

SL1 provides a common ontology for reasoning about them.
```

---

## 3. External Entities

An Entity does not have to originate inside Simple Layer One.

Examples:

```text
WebAuthn passkey identity
Ethereum account
Solana account
Nostr identity
government credential subject
corporate registry record
enterprise identity
```

SL1 may reference external subjects and relate them to SL1 entities through credentials, attestations, ownership claims, and proofs.

---

## 4. External Assets

An Asset does not have to be native to Simple Layer One.

Examples:

```text
native SL1 asset
Bitcoin
Ethereum ERC-20
USDC
NFT on another chain
bank settlement receipt
marketplace voucher
software license
```

SL1 may represent external assets as referenced assets, wrapped assets, attested assets, or settlement evidence. The representation must not imply custody unless a custody relationship is explicitly established.

---

## 5. External Trust

An Attestation may originate from external issuers.

Examples:

```text
government authority
corporate registry
marketplace
enterprise CA
external network
KYC provider
merchant verification provider
```

External trust does not automatically grant SL1 authority. It may be evaluated by policy and may inform capability issuance or control grants.

---

## 6. External Proofs

A Proof may verify events that happened outside Simple Layer One.

Examples:

```text
Bitcoin transaction
Ethereum transaction
Solana transaction
bank payment settlement
document signature
credential issuance
marketplace fulfillment
```

Applications may consume SL1 proofs about external events when those proofs contain enough verification material for the application's risk model.

---

## 7. Marketplace Example

A marketplace can use external settlement while relying on SL1 identity and proof semantics.

```text
Buyer pays through external PSP
PSP confirms captured payment
Marketplace records payment receipt
SL1 links receipt to Entity
Marketplace fulfills order
SL1 may issue proof or reward event
```

In this model:

```text
SL1E identifies who acted.
External PSP confirms money settlement.
Marketplace determines what was purchased.
SL1 proof links the event to the subject.
```

The marketplace does not need to become a payment account provider or asset custodian merely because it consumes SL1 identity.

---

## 8. Non-Goals

This document does not define:

```text
bridge protocol
wrapped asset mechanics
oracle trust model
external chain light client
bank settlement API
cross-chain finality rules
```

Those belong to later RFCs.

---

## 9. Summary

Simple Layer One should be able to coordinate with many networks and systems.

It should not require all identity, trust, assets, or settlement to be native.

The network's differentiator is the common ontology of subjects, state, relationships, and verifiable actions.
