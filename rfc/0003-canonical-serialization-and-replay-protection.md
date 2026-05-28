# RFC-0003: Canonical Serialization & Replay Protection

**Статус:** Черновик (Draft)  
**Автор:** Команда Simple-L1  
**Дата:** 13 мая 2026 г.  

---

## 1. Аннотация (Abstract)

Этот RFC формализует **Phase 1: Intent Formalization** архитектуры Simple-L1. Мы утверждаем перенос фокуса с сырых текстовых подписей на **детерминированное бинарное кодирование намерения (Canonical Intent)**. Документ определяет строгий бинарный формат Intent на базе спецификации **Borsh**, вводит систему сквозных `nonce` для replay protection, механизм **Domain Separation** для защиты от атак межсетевого воспроизведения (replay), и структуру хэшируемого `IntentApprovalEnvelope`, готового к проверке authority lineage.

---

## 2. Мотивация (Motivation)

Подпись над неструктурированными строками (например, `"TRANSFER 100"`) страдает от критических уязвимостей:
1.  **Неоднозначность (Ambiguity):** Разные парсеры могут по-разному интерпретировать пробелы, кодировки или локали, порождая несовпадающие хэши `challenge`.
2.  **Replay Атаки:** Однажды опубликованная транзакция может быть повторно отправлена в сеть злоумышленником, повторно списывая средства.
3.  **Cross-Domain Атаки:** Подпись из тестовой сети (Testnet) может быть валидной в основной сети (Mainnet), если они используют одну кривую и ключи.

Для превращения Simple-L1 в **Universal Cryptographic Coordination Fabric** требуется детерминированная, бинарно строгая и изолированная схема сериализации.

---

## 3. Каноническое кодирование: Спецификация Borsh

В качестве стандарта детерминированной сериализации Simple-L1 утверждает **Borsh** (Binary Object Representation Serializer for Hashing).

### Почему Borsh?
*   **100% Детерминизм:** Для любого объекта данных существует ровно одно валидное байтовое представление. Нет опциональных полей, нет неопределенности порядка ключей.
*   **Отсутствие метаданных:** Сериализуются только чистые значения без имен полей, что экономит память нод.
*   **Строгая типизация:** Идеально транслируется в структуры Rust/C++ и типы TypeScript.

---

## 4. Структура Намерения (Canonical Intent Schema)

Каждое намерение, подписываемое пользователем, обязано иметь следующую Borsh-структуру:

| Поле | Borsh Тип | Описание |
| :--- | :--- | :--- |
| `domain_prefix` | `[u8; 32]` | Фиксированная строка домена (см. Раздел 5). |
| `chain_id` | `[u8; 32]` | Уникальный хэш идентификатора конкретной сети L1. |
| `entity_l1_address` | `string` | Стабильный субъект (`sl1e_`), от имени которого создаётся Intent. |
| `proof_key_l1_address` | `string` | Controller/passkey (`sl1_`), который подписывает Intent. |
| `intent_nonce` | `u64` | Сквозной счетчик Intent для replay protection. |
| `expires_at` | `u64` | Абсолютный Timestamp (или номер блока), после которого Intent сгорает. |
| `fee_limit` | `u128` | Максимально допустимая комиссия в базовых единицах. |
| `action_enum` | `u8` | Идентификатор действия: `0 = Transfer`, `1 = Call`, `2 = Admin`. |
| `action_data` | `Vec<u8>` | Сериализованные аргументы конкретного действия. |

---

## 5. Domain Separation & Изоляция Доменов

Для предотвращения использования подписи в чужих сетях или других протоколах, первым элементом бинарного потока ВСЕГДА идет преамбула разделения доменов.

### 5.1 Domain Prefix
Строка длиной 32 байта, дополненная нулями:
`"SIMPLE_L1::INTENT::V1"`

### 5.2 Chain ID
Результирующий байтовый поток неразрывно связан с `chain_id` сети.
Для Mainnet: `chain_id = SHA-256("simple-l1-mainnet-v1")`
Для Testnet: `chain_id = SHA-256("simple-l1-testnet-v1")`

---

## 6. Защита от Replay: Система Nonce

Каждая replay-защищённая lane в глобальном состоянии Simple-L1 хранит поле `current_nonce: u64` (по умолчанию `0`).

Nonce lane должна быть привязана к `entity_l1_address` и может дополнительно скоупиться по `proof_key_l1_address` или account/resource scope.

1.  При формировании Intent клиент устанавливает: `intent_nonce = state.current_nonce + 1`.
2.  При валидации на Ноде:
    *   Нода извлекает `intent_nonce` из расшифрованного Intent.
    *   **Условие валидности:** `intent_nonce == state.current_nonce + 1`.
    *   В случае успеха: `state.current_nonce` инкрементируется.
    *   В случае расхождения: IntentApproval мгновенно отбрасывается как невалидный.

---

## 7. Хэшируемый Конверт Подтверждения (IntentApproval Envelope)

Для построения дерева Merkle и генерации Inclusion Proofs, `Intent + IntentApproval` упаковывается в канонический объект «Конверта», от которого вычисляется глобальный `approval_hash`.

### 7.1 Схема Конверта (Borsh)
```rust
struct IntentApprovalEnvelope {
    intent_bytes: Vec<u8>,           // Оригинальный бинарный Borsh Intent
    entity_l1_address: String,       // Stable Entity, not derived from key material
    proof_key_l1_address: String,    // Controller/passkey proof material
    authenticator_data: Vec<u8>,     // WebAuthn authenticatorData от чипа
    client_data_json: String,        // Исходный JSON от браузера
    signature: [u8; 64],             // ECDSA подпись (r, s)
}
```

### 7.2 Вычисление Approval Hash
Глобальный уникальный идентификатор cryptographic approval:
$$\text{ApprovalHash} = \text{BLAKE3}(\text{Borsh}(\text{IntentApprovalEnvelope}))$$

Этот хэш может использоваться как leaf в Merkle Tree. Он доказывает включение approval envelope, но не доказывает authority, execution или settlement.

---

## 8. Алгоритм сборки Payload для WebAuthn (Final Pipeline)

1.  Собрать структуру `Intent`.
2.  Сериализовать её через Borsh в байты: `intent_bytes`.
3.  Вычислить хэш: `H_intent = BLAKE3(intent_bytes)`.
4.  Передать `H_intent` как `challenge` в WebAuthn.
5.  Получить `authenticator_data`, `client_data_json` и `signature`.
6.  Упаковать элементы в `IntentApprovalEnvelope`.
7.  Сериализовать конверт и отправить его в L1 Mempool или authorization pipeline.
8.  Проверить authority lineage отдельно:
    ```text
    IntentApproval
      -> Authorization
      -> Execution
      -> Settlement
    ```
