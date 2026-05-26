# Simple L1 Protocol Versioning

**Status:** Frozen draft
**Date:** 2026-05-26
**Scope:** Versioning, conformance compatibility, and SDK binding rules

This document defines how Simple L1 Protocol semantics may change without destroying conformance.

`PROTOCOL.v1.md` defines protocol reality.

`conformance/` enforces protocol reality.

`test-vectors/` defines canonical allowed cases.

Code is only a permitted instance of that reality.

---

## 1. Versioning Rule

Simple L1 uses protocol versioning, not documentation versioning.

A protocol version changes when permitted system semantics change.

Formatting, wording, comments, code organization, and package layout do not change the protocol version unless they change conformance behavior or normative meaning.

---

## 2. Breaking Changes

The following changes require a new major protocol version:

* changing entity address semantics
* allowing `sl1_` key addresses to act as entity identity
* deriving `entity_l1_address` from cryptographic key material
* changing CRE input shape
* changing CRE output shape
* changing CRE policy precedence
* allowing roles, context, adapter metadata, or UI state into the CRE decision path
* allowing external events to mutate SL1 state directly
* allowing proofs to mutate SL1 state directly
* allowing adapters to issue final receipts
* changing settlement transition preconditions
* changing receipt validity semantics
* changing idempotency or replay rules
* removing a required conformance vector
* changing expected output for a required vector

Breaking changes MUST NOT be shipped as v1-compatible implementation changes.

---

## 3. Compatible Extensions

The following changes may be compatible if all v1 conformance vectors continue to pass:

* adding a new optional proof type
* adding a new external adapter family
* adding optional metadata that is explicitly non-decisional
* adding new rejection reason codes without changing existing ones
* adding new conformance vectors that do not alter existing expected behavior
* adding SDK helper functions that are exact projections of existing protocol rules
* improving internal performance without observable semantic change

Compatible extensions MUST NOT introduce implicit authority, implicit identity, or adapter-driven truth.

---

## 4. Conformance Compatibility

Conformance vectors are part of the protocol surface.

If a vector is required, then:

* every conforming implementation MUST pass it
* changing expected output is a semantic change
* deleting it is a semantic change
* weakening it is a semantic change

New vectors may be added in two ways:

* as compatibility vectors, when they clarify existing semantics
* as new-version vectors, when they define new semantics

When a vector fails, the implementation is non-conforming unless the protocol version is intentionally changed.

---

## 5. SDK Binding Rules

SDKs are constrained projections of the protocol.

SDKs MUST:

* expose protocol concepts without redefining them
* preserve entity/key separation
* expose CRE decisions without adding hidden decision inputs
* require explicit grants for authorization helpers
* preserve settlement transition preconditions
* keep adapters below protocol semantics
* pass the same conformance suite as runtime implementations

SDKs MUST NOT:

* introduce implicit defaults that change protocol meaning
* fallback from entity identity to key identity
* hide CRE deny/quorum/approval semantics behind boolean-only APIs
* add role shortcuts
* treat external chain events as state
* treat adapter output as truth
* issue receipts without protocol transition acceptance
* make non-decisional context decisional

An SDK API is valid only if it can be traced to `PROTOCOL.v1.md` and a conformance vector.

---

## 6. Implementation Binding Rules

Runtime implementations MUST treat protocol conformance as a release gate.

An implementation MAY:

* optimize internal execution
* cache derived data
* add observability
* support multiple adapters
* expose framework-specific integration points

An implementation MUST NOT:

* bypass conformance for internal services
* create hidden privileged paths
* mutate settlement state before receipt issuance
* use adapter-specific finality as SL1 finality
* change protocol outcomes for performance

---

## 7. Adapter Compatibility

Adapters are external-world mapping layers only.

An adapter update is compatible only if it:

* produces the same canonical evidence shape for the same observed external event
* does not add authority
* does not decide settlement truth
* does not mutate SL1 state
* does not issue final receipts
* does not bypass CRE

If an external network requires semantics not expressible in the current transition rules, the protocol must evolve before the adapter may expose that behavior.

---

## 8. Release Gate

A Simple L1 release is protocol-valid only if:

* `PROTOCOL.v1.md` remains the normative source of truth
* all required conformance vectors pass
* SDK APIs are traceable to the spec
* runtime behavior is traceable to the spec
* adapter behavior is limited to evidence/proof mapping
* every semantic change is classified as breaking, compatible, or rejected

If classification is unclear, the change is treated as breaking until proven otherwise.
