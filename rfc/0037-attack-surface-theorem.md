# RFC-0037: Attack Surface Theorem

Status: Draft

This document defines invalid authority states caused by leakage between epistemic projection and causal authority space.

RFC-0037 depends on:

```text
RFC-0000: Constitutional Summary
RFC-0009: Propagation Control & Information Flow
RFC-0024: Semantic Isolation & Domain Integrity
RFC-0033: Notification Transport Boundary
RFC-0034: Authority Lattice Model
RFC-0035: Delegation Algebra
RFC-0036: Temporal Authority Model
```

---

## 1. Theorem

```text
Any epistemic projection attempting to influence authority
creates an attack surface.
```

Epistemic projections include:

```text
UI
Authority Surface Registry
tags
notifications
logs
views
search indexes
error messages
runtime status
```

They may disclose, organize, or explain state.

They must not construct, imply, cache, or reconstruct authority.

---

## 2. Projection Leakage

Projection leakage occurs when an observation channel changes proof evaluation or execution eligibility.

Forbidden forms:

```text
rendered_button_implies_authority
hidden_button_implies_no_authority
visible_resource_implies_control
read_notification_implies_artifact_consumption
tag_implies_policy_predicate
log_presence_implies_permission
```

Observation must never imply ability to act.

---

## 3. Semantic Authority Reconstruction

Semantic authority reconstruction occurs when authority is inferred from meaning-bearing artifacts instead of ledger-constituted capability edges.

Examples:

```text
notification says "admin invitation" -> user treated as invited admin
tag says "production" -> runtime grants deploy control
UI group says "owner" -> policy treats subject as owner
error message reveals hidden capability -> caller derives valid action path
ASR grouping says "enabled" -> execution treats surface as authorized
```

Required boundary:

```text
semantics may explain authority
semantics must not become authority
```

---

## 4. Cross-Surface Inference Collapse

Cross-surface inference collapse occurs when separate epistemic surfaces combine into effective authority.

Example pattern:

```text
Notification reveals artifact id
Tag reveals environment scope
UI reveals hidden route
Error message reveals required action name
Combined inference reconstructs executable authority
```

This is constitutionally invalid unless the resulting action still passes the single authority gate defined in RFC-0034.

---

## 5. Shadow Surface Leakage

Shadow-evaluated surfaces are not UI-visible.

They must not be discoverable through:

```text
UI enumeration
tags
notifications
error messages
route probing
search indexes
```

Shadow authority may be addressed only by:

```text
explicit capability reference
ledger-authorized query
```

If a hidden surface can be discovered by inference alone, it has leaked from authority space into epistemic projection.

---

## 6. Notification Boundary

Notifications are epistemic transport.

They must not:

```text
grant authority
transfer authority
consume artifacts
trigger execution
change policy state
change revocation state
change expiry state
```

Notification-triggered execution is an attack surface unless it resolves intent and passes the single authority gate.

---

## 7. Tag Boundary

Tags are annotations by default.

A tag may become policy-relevant only through explicit promotion to authority scope.

Promotion requires:

```text
ledger transition
capability edge
policy proof
execution-time evaluation
```

Unpromoted tags must never be policy predicates.

---

## 8. ASR Boundary

The Authority Surface Registry is a derived view.

It must not:

```text
store independent authority state
cache proof results
pre-filter capability edges for execution
hide authority as revocation
render authority as grant
```

ASR misprojection must not change the truth value of proof evaluation.

---

## 9. Attack Classes

```text
projection_leakage
semantic_authority_reconstruction
cross_surface_inference_collapse
shadow_surface_discovery
notification_authority_collapse
tag_policy_smuggling
ASR_authority_substitution
runtime_memory_authority_replay
error_message_capability_oracle
```

---

## 10. Compliance Rule

```text
If an action becomes possible because a projection was observed,
the system contains an implicit authority channel.
```

Only the ledger, capability edge, and proof evaluator may make action possible.

---

## 11. Minimal Form

```text
projection -> inference -> authority reconstruction = constitutional violation
```
