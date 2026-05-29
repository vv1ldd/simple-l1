# Namespace Onboarding

Namespace onboarding coordinates DNS and issuer reachability without granting peer trust.

## Flow

```text
join_request
  -> dns_allocated
    -> issuer_reachable | issuer_unreachable
      -> optional local peer admission
```

## Join Request

A join request is a canonical declaration that a node wants visibility in a network namespace.

It may begin before DNS exists:

```text
status = pending_dns
issuer_url = null
requested_fqdn = alice.simplel1.online
```

This supports network-controlled namespace onboarding without making DNS allocation a trust decision.

## Namespace Artifacts

Namespace artifacts are append-only evidence linked to a join request.

Current artifact types:

- `dns_allocated`
- `issuer_reachable`
- `issuer_unreachable`

Artifacts are immutable. Re-observing the same semantic evidence should return `duplicate_observed`, not create timestamp noise.

## Issuer Binding

`issuer_reachable` evidence must bind issuer metadata back to the join request.

```text
issuer_metadata.node_id == join_request.node_id
```

If this check fails, the evidence must not be emitted as `issuer_reachable`.

## Provider Abstraction

DNS providers are implementation backends.

The minimum provider contract is:

- `resolve_zone`
- `upsert_a_record`
- `verify_propagation`

Cloudflare is the first backend. A future `sovereign_dns` backend must preserve the same semantics.

## Bridge-Side Allocation

The bridge may act as the namespace operator for its own zone.

For `simplel1.online`, the bridge-side allocation endpoint is:

```text
POST /api/sl1/network/join-requests/:requestId/allocate-dns
```

It requires an explicit operator capability:

```text
Authorization: Bearer <SL1_NAMESPACE_OPERATOR_TOKEN>
```

Runtime secrets are read from environment only:

```text
SL1_NAMESPACE_OPERATOR_TOKEN
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ZONE_NAME=simplel1.online
CLOUDFLARE_ZONE_ID optional
```

The endpoint may create or update the DNS `A` record and then append a normal `dns_allocated` namespace artifact.

It must not:

- Admit peers automatically.
- Register peers.
- Mutate authority projection.
- Persist Cloudflare API tokens.
- Treat DNS allocation as trust.

## Non-Goals

Namespace onboarding does not:

- Admit peers automatically.
- Mutate authority projection.
- Make DNS ownership a trust signal.
- Make any DNS provider a federation authority.
