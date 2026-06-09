# Web to Native Identity Portability

Meanly One Web Wallet is the first client for creating the persistent Simple L1 identity. Native is a later client/controller, not a second account.

## Hard Contract

```text
Create Identity = Add First Controller

Identity Address must never change.
Controllers may change.
Clients may change.
Devices may change.
```

## Rollout Flow

```text
Web Wallet
  -> creates sl1e_*
  -> records browser passkey as controller #1
  -> stores/exports IdentityCapsule

Native App
  -> generates native device key
  -> requests controller link for the existing sl1e_*
  -> Web Wallet passkey approves controller binding
  -> ledger records native key as controller #2
```

Native does not import private web data. It receives authority through an approved controller binding.

## Guardrail

`/api/sl1e/native/bootstrap` must not silently create a new root identity during the web-first rollout. If the referenced `sl1e_*` is not already known to the ledger/capsule projection, the runtime rejects native bootstrap with:

```text
native_root_identity_bootstrap_disabled
```

The only acceptable production path is:

```text
existing sl1e_* + new native sl1_* controller -> same identity
```

Explicit native root bootstrap is reserved for development/recovery and requires `SL1_ALLOW_NATIVE_ROOT_BOOTSTRAP=1`.
