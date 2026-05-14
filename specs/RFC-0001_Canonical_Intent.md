# RFC-0001: Canonical Intent Format

## Status: PROPOSED

## 1. Abstract
This RFC defines the standard serialization and validation format for user execution intentions (Intents) in the Simple-L1 network. An Intent is a signed declaration of an authority's desire to perform a state transition.

## 2. Intent Structure
Every intent must follow this JSON structure:

```json
{
  "type": "string",       // e.g., "TRANSFER", "POLICY_CHANGE", "DELEGATE"
  "authority": "string",  // sl1 address of the signer
  "nonce": "number",      // strictly monotonic counter per authority
  "timestamp": "string",  // ISO-8601
  "payload": { ... },     // type-specific data
  "signature": "string"   // WebAuthn/ECC signature of the canonical hash
}
```

## 3. Canonical Hashing
To ensure deterministic validation across nodes:
1. Fields must be sorted alphabetically.
2. The object must be stringified without whitespace.
3. The SHA-256 hash of the resulting string is the `intent_hash`.

## 4. Replay Protection
- Nodes MUST maintain the current `nonce` for each authority.
- An intent is valid ONLY if `intent.nonce == current_nonce + 1`.
- Once applied, `current_nonce` is incremented.

## 5. Intent Types
- **TRANSFER**: Move assets between handles.
- **DELEGATE**: Grant temporary capability to a projection.
- **REVOKE**: Terminate a delegated capability.
