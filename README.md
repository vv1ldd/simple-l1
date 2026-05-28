# SIMPLE-L1: The Engineering Core

Минимальный детерминированный runtime для исполнения подписанных намерений (intents) с hardware‑rooted идентичностью.

Без метафизики. Без лишних сущностей. Чистая криптографическая машина состояний.

---

## 1. Определение в одной строке

> **SIMPLE-L1** = deterministic intent execution ledger with passkey-backed entity identities and replayable state

То есть:
* Не «chain транзакций».
* А **машина исполнения намерений**.

---

## 2. Базовые принципы (жёсткие инварианты)

### 🔑 1. Identity is passkey-backed, not passkey-derived
* **Entity address (`sl1e_`)** = stable account identity.
* **Passkey key address (`sl1_`)** = proof of control for one registered key.
* Приватный ключ никогда не покидает Secure Enclave устройства.
* Никаких seed‑фраз.
* **`identity != public key hash`**. Key material authenticates an entity; it never becomes the entity.

### 🧬 2. Intent is the primitive
Вместо «transaction» используется явный примитив намерения:
```rust
Intent {
  domain: String,
  action: String,
  payload: Vec<u8>,
  nonce: u64,
  entity: EntityAddress,
  controller: KeyAddress,
  capability: String,
  scope: String
}
```
* Подтверждается аппаратно через passkey Controller как `IntentApproval`.
* Подпись доказывает approval, но не ownership, authority или execution.
* Сериализуется детерминированно (канонический Borsh).

### 🛡 3. Deterministic execution
Любой узел гарантированно получает идентичный результат:
`state' = f(state, intent)`
* Без скрытого состояния.
* Без внешнего времени (time oracle) как источника истины.
* Без случайности.

### 📜 4. Ledger = append-only intent log
Не «блокчейн как набор разрозненных блоков», а:
* Линейный журнал (journal/ledger).
* Группировка в блоки — исключительно для оптимизации дискового ввода-вывода и хэширования.

### ♻️ 5. Full replayability
Любой узел в любой момент времени может воспроизвести состояние с нуля:
`state = replay(genesis, all_intents)`

---

## 3. Архитектура SIMPLE-L1 (Четыре слоя)

### Layer 1: Identity Layer
* **WebAuthn / Passkey**
* Кривая NIST P-256.
* `sl1e_` entity address — стабильная личность/account.
* `sl1_` key address — passkey-derived proof material.
* Authorization не выводится из roles или key type; оно вычисляется CRE v1 по explicit grants.

### Layer 2: Intent Layer
Каноническая Borsh-структура.
* `IntentApproval = WebAuthn signature over canonical Intent`.
* `Authorization = IntentApproval + Capability/ControlGrant lineage`.

### Layer 3: Execution Layer
Детерминированный рантайм переходов: `apply(state, intent) -> new_state`
* Чистые функции (pure functions).
* Запрет на external calls во время исполнения.

### Layer 4: Consensus Layer
* **Радикальный SIMPLE-L1 стиль:** `Deterministic ordered broadcast + replay agreement`.
* Порядок намерений фиксируется консенсусом, а согласие достигается над упорядочиванием, а не над стейтом.

---

## 4. Отличия от Solana / Ethereum

| Feature | Ethereum | Solana | SIMPLE-L1 |
| :--- | :--- | :--- | :--- |
| **Primitive** | transaction | transaction | **intent** |
| **Identity** | account key | ed25519 key | **passkey (P-256)** |
| **Execution** | VM state | runtime | **deterministic intent function** |
| **UX auth** | external wallet | external wallet | **native WebAuthn** |
| **Recovery** | seed phrase | keypair | **replayable ledger** |

---

## 5. Ядро философии
> **Intent must be cryptographically unambiguous before execution.**

Это означает отсутствие «interpretation layer» и любой двусмысленности. Рантайм не гадает, что имел в виду пользователь — он исполняет математически чистое намерение.

---

## 6. Документация репозитория

### 🧭 Ценности и Манифест
* [PROTOCOL.v1.md](./PROTOCOL.v1.md) — Формальная спецификация Simple L1 Protocol v1 и источник истины для реализации.
* [PROTOCOL-VERSIONING.md](./PROTOCOL-VERSIONING.md) — Правила изменения протокола, conformance compatibility и SDK binding.
* [MANIFESTO.md](./MANIFESTO.md) — Неприкосновенные принципы.
* [WHITEPAPER.md](./WHITEPAPER.md) — Концептуальный обзор целей и проблем.

### ⚙️ Технические спецификации (RFC)
* [RFC-0000: Constitutional Summary](./rfc/0000-constitutional-summary.md)
* [RFC-0001: Core Cryptography & Addressing Scheme](./rfc/0001-core-cryptography-and-addressing.md)
* [RFC-0002: Intent & WebAuthn Serialization Schema](./rfc/0002-intent-and-webauthn-schema.md)
* [RFC-0003: Canonical Serialization & Replay Protection](./rfc/0003-canonical-serialization-and-replay-protection.md)
* [RFC-0004: Block Structure & Deterministic Batch Execution](./rfc/0004-block-structure-and-deterministic-execution.md)
* [RFC-0005: Ledger Lineage Persistence & Crash Recovery](./rfc/0005-ledger-persistence-and-crash-recovery.md)
* [RFC-0006: Network Failure Model & Event-Ordering Assumptions](./rfc/0006-network-failure-model-and-assumptions.md)
* [RFC-0007: Ordered Set Agreement & Fork-Choice Model](./rfc/0007-ordered-set-agreement-and-fork-choice.md)
* [RFC-0008: Network Knowledge & View Divergence Model](./rfc/0008-network-knowledge-and-view-divergence-model.md)
* [RFC-0009: Propagation Control & Information Flow Constraints](./rfc/0009-propagation-control-and-information-flow.md)
* [RFC-0010: Adversarial Topology & Network Geometry Invariance](./rfc/0010-adversarial-topology-and-geometry.md)
* [RFC-0011: Identity Kernel & Capability Resolution](./rfc/0011-identity-kernel-and-capability-resolution.md)
* [RFC-0012: Ontology Core v0.1](./rfc/0012-ontology-core-v0.1.md)
* [RFC-0013: Interoperability Principle](./rfc/0013-interoperability-principle.md)
* [RFC-0014: Policy Layer v0.2](./rfc/0014-policy-layer-v0.2.md)
* [RFC-0015: Trust & Attestation Lifecycle](./rfc/0015-trust-and-attestation-lifecycle.md)
* [RFC-0016: Capability & Delegation Model](./rfc/0016-capability-and-delegation-model.md)
* [RFC-0017: External Proof Model](./rfc/0017-external-proof-model.md)
* [RFC-0018: SL1 Connect & Identity Proof](./rfc/0018-sl1-connect-and-identity-proof.md)
* [RFC-0020: Execution Consistency & Temporal Safety](./rfc/0020-execution-consistency-and-temporal-safety.md)
* [RFC-0021: Workflow & Compensation Semantics](./rfc/0021-workflow-and-compensation-semantics.md)
* [RFC-0022: Economic State & Settlement Graph Kernel](./rfc/0022-economic-state-and-settlement-graph-kernel.md)
* [RFC-0023: Cross-System Settlement & Interoperability Execution](./rfc/0023-cross-system-settlement-and-interoperability-execution.md)
* [RFC-0024: Semantic Isolation & Domain Integrity](./rfc/0024-semantic-isolation-and-domain-integrity.md)
* [RFC-0025: Runtime Architecture & Responsibility Boundaries](./rfc/0025-runtime-architecture-and-responsibility-boundaries.md)
* [RFC-0026: Marketplace Reference Flow](./rfc/0026-marketplace-reference-flow.md)

---

## 7. Идеальная форма
> **A cryptographic state machine where human intent is the only input, entity identity is stable, and hardware keys are proofs rather than accounts.**
