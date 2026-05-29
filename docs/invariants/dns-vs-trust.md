# DNS vs Trust

DNS automation improves reachability. It does not create trust.

## Core Rules

```text
dns_allocation != peer_admission
domain_ownership != peer_trust
cloudflare_api != federation_authority
dns_provider != federation_authority
```

## What DNS Can Prove

DNS evidence may prove:

- A name was allocated.
- A record points to an IP address.
- A name resolves.
- A host is reachable through TLS.

DNS evidence may not prove:

- The host should be trusted.
- The host should be admitted.
- The host controls valid SL1 authority.
- The host should receive projected authority state.

## Provider Neutrality

Cloudflare is an implementation backend.

A future sovereign DNS provider must preserve the same boundary:

```text
namespace provider = operational coordination
namespace provider != authority source
```

## Namespace Uniqueness

Within one network namespace:

```text
requested_fqdn must resolve to one active namespace allocation
```

If multiple requests compete for the same FQDN, the bridge should expose conflict evidence rather than choosing trust.
