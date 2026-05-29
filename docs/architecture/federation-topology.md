# Federation Topology

SL1 federation is layered. Each layer has one responsibility.

## Layers

```text
Namespace Layer
  DNS allocation evidence

Discovery Layer
  bridge-visible join requests and namespace artifacts

Verification Layer
  DNS, TLS, status endpoint, and issuer metadata checks

Federation Layer
  observed peer events and read-only evidence sync

Policy Layer
  admissibility evaluation and local policy context

Projection Layer
  shadow projection candidates and future projection intents

Authority Layer
  explicit local authority mutation only
```

## Bridge Role

`simplel1.online` is a discovery inbox.

It may store:

- Join requests.
- DNS allocation artifacts.
- Issuer reachability artifacts.

It must not:

- Mark peers trusted.
- Mutate peer registries.
- Decide federation membership.
- Commit authority projections.

## Host Role

Each sovereign host is locally authoritative over its own peer registry and authority graph.

Hosts may consume bridge evidence, but the bridge never acts on their behalf.

## Provider Role

DNS providers allocate and reconcile names.

Providers may prove operational reachability, but they do not grant trust.

## Operational Property

Bridge or DNS provider outages must not affect already admitted peers.
