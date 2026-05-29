# Repository Responsibilities

This document defines the semantic boundaries between the current SL1 repositories.

## simple-l1

`simple-l1` is the semantic source of truth for protocol contracts and evidence meaning.

It owns:

- Identity and authority terminology.
- Bridge and discovery evidence semantics.
- Join request and namespace artifact contracts.
- Invariants that must be preserved by operator tooling and runtime integrations.
- RFCs and protocol-level examples.

It must not own:

- Host installation lifecycle.
- Cloudflare credentials or provider-specific operational state.
- Coolify runtime peer registry mutations.
- Local deployment-specific runtime data.

## sovereign-host

`sovereign-host` is the operator control plane.

It owns:

- Installer and upgrade flows.
- Operator CLI commands.
- Runtime repair and reconciliation.
- DNS provider adapters.
- Network onboarding orchestration.

It consumes `simple-l1` contracts. It must not redefine the meaning of join requests, namespace artifacts, authority projection, or peer admission.

## Coolify Sovereign Runtime

The Sovereign Coolify runtime owns deployed authority behavior.

It owns:

- Peer registration persistence.
- Observed peer event synchronization.
- Admissibility evaluation.
- Policy context and shadow projection.
- Explicit intent and authority mutation paths.

It must not treat discovery artifacts, DNS allocation, or issuer reachability as peer trust.

## Rule

Same term means same semantics across repos.

If a repo needs a new meaning, add or revise a contract in `simple-l1` first.
