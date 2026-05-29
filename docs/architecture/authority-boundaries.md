# Authority Boundaries

SL1 federation separates observation, evidence, policy, and authority mutation.

## Boundary Stack

```text
transport
  -> observation
    -> evidence
      -> evaluation
        -> policy
          -> projection candidate
            -> sovereign intent
              -> authority mutation
```

Each layer may read previous layers. No layer may silently collapse into a later layer.

## Discovery Is Not Authority

Join requests and namespace artifacts are evidence.

They may answer:

- Which node wants to be visible?
- Which namespace was requested?
- Was DNS allocated?
- Is the issuer reachable?
- Does issuer metadata bind to the declared node id?

They do not answer:

- Should this peer be trusted?
- Should this host enter the local peer registry?
- Should authority state be projected?

## Peer Admission

Peer admission is a local sovereign act.

Only an explicit local admission command may mutate peer registry state. Operator tooling may prepare evidence, but it must not auto-admit.

## Projection

Projection remains separate from admission.

Admitting a peer permits local observation and sync. It does not mean remote authority events are committed into the local authority graph.

## Hard Invariants

```text
join_request != peer_admission
dns_allocation != peer_admission
issuer_reachable != local_trust
bridge_request_visibility != peer_trust
cloudflare_api != federation_authority
dns_provider != federation_authority
```
