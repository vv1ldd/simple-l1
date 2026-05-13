# SIMPLE-L1: The Engineering Core

Минимальный детерминированный runtime для исполнения подписанных намерений (intents) с hardware‑rooted идентичностью.

Без метафизики. Без лишних сущностей. Чистая криптографическая машина состояний.

---

## 1. Определение в одной строке

> **SIMPLE-L1** = deterministic intent execution ledger with passkey-bound identities and replayable state

То есть:
* Не «chain транзакций».
* А **машина исполнения намерений**.

---

## 2. Базовые принципы (жёсткие инварианты)

### 🔑 1. Identity is hardware-bound
* **Passkey (P-256)** = root identity.
* Приватный ключ никогда не покидает Secure Enclave устройства.
* Никаких seed‑фраз.
* **`identity = public key hash`**

### 🧬 2. Intent is the primitive
Вместо «transaction» используется явный примитив намерения:
```rust
Intent {
  domain: String,
  action: String,
  payload: Vec<u8>,
  nonce: u64,
  signer: Address
}
```
* Подписывается аппаратно через Passkey.
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
* Детерминированный адрес: `sl1 = BLAKE3(pubkey)[..20]` (с Bech32m-кодированием).

### Layer 2: Intent Layer
Каноническая Borsh-структура.
* Подпись: `signature = Sign(passkey_private, canonical_bytes)`

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
* [MANIFESTO.md](./MANIFESTO.md) — Неприкосновенные принципы.
* [WHITEPAPER.md](./WHITEPAPER.md) — Концептуальный обзор целей и проблем.

### ⚙️ Технические спецификации (RFC)
* [RFC-0001: Core Cryptography & Addressing Scheme](./rfc/0001-core-cryptography-and-addressing.md)
* [RFC-0002: Intent & WebAuthn Serialization Schema](./rfc/0002-intent-and-webauthn-schema.md)
* [RFC-0003: Canonical Serialization & Replay Protection](./rfc/0003-canonical-serialization-and-replay-protection.md)
* [RFC-0004: Block Structure & Deterministic Batch Execution](./rfc/0004-block-structure-and-deterministic-execution.md)
* [RFC-0005: Ledger Lineage Persistence & Crash Recovery](./rfc/0005-ledger-persistence-and-crash-recovery.md)
* [RFC-0006: Network Failure Model & Event-Ordering Assumptions](./rfc/0006-network-failure-model-and-assumptions.md)
* [RFC-0007: Ordered Set Agreement & Fork-Choice Model](./rfc/0007-ordered-set-agreement-and-fork-choice.md)
* [RFC-0008: Network Knowledge & View Divergence Model](./rfc/0008-network-knowledge-and-view-divergence-model.md)
* [RFC-0009: Propagation Control & Information Flow Constraints](./rfc/0009-propagation-control-and-information-flow.md)

---

## 7. Идеальная форма
> **A cryptographic state machine where human intent is the only input and hardware keys are the only authority.**
