# SL1E Core Laws

## Status

Normative.

These laws define protocol-level invariants for SL1E.

Any protocol change MUST preserve these laws or explicitly introduce a new
protocol version.

## Core Laws

- Identity is stable.
- Controllers are replaceable.
- Possession is not authority.
- Binding is not approval.
- Proof is intent-bound.
- Session is application-local.
- Observation is not authority.
- Relay is not provider.
- Controller loss is not identity loss.

## Negative Invariants

- Controller != Identity.
- ControllerBinding != AuthorityGrant.
- DevicePossession != IntentApproval.
- IdentityStateEnvelope != IdentityProofEnvelope.
- IdentityProofEnvelope != ApplicationSession.
- RelayMailboxPayload != ProviderDecision.
- IdentityManagementSession != IdentityProofEnvelope.

## Review Gate

Before accepting a protocol change, evaluate:

- Does this endpoint turn possession into authority?
- Does this relay turn observation into decision?
- Does this controller become identity?
- Does this proof become session?

If the answer is yes, the change is a protocol-semantics change and MUST be
versioned.

## Conformance Relationship

Contract packs, schemas, fixtures, and runtime conformance suites MUST enforce
these laws through executable negative invariants.

Documentation alone is insufficient.

```text
SL1E Core Laws
  -> Negative Invariants
  -> Contract Packs
  -> Conformance Fixtures
  -> CI Validation
```
