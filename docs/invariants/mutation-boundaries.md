# Mutation Boundaries

SL1 federation must keep mutation paths explicit and narrow.

## Peer Registry

Only explicit peer admission may mutate the peer registry.

Current permitted operator paths:

```text
sovereign peer add <issuer>
sovereign network admit <request-id>
```

Network onboarding commands must not mutate peer registry:

```text
sovereign network request-subdomain
sovereign network allocate
sovereign network verify-domain
sovereign network pending
```

## Authority Projection

Only the local runtime authority pipeline may mutate authority projection.

Discovery artifacts, DNS artifacts, issuer reachability, and peer admission are not projection commits.

## Discovery Bridge

The bridge may append evidence.

It must not:

- Admit peers.
- Mark peers trusted.
- Mutate authority state.
- Create projection intents.

## DNS Provider

The DNS provider may mutate DNS records.

It must not:

- Mutate peer registry.
- Decide network membership.
- Mark a host trusted.

## Sacred Invariant

```text
operational convenience must not create hidden authority mutation
```
