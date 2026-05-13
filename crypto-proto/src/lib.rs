//! # SIMPLE-L1 Minimal Deterministic Execution Kernel (MDEK) v0.1
//! 
//! A pure, standalone Rust runtime designed for executing signed intents.
//! Enforces 100% strict determinism: no randomness, no hidden state, no external I/O.

use std::collections::BTreeMap;
use borsh::{BorshSerialize, BorshDeserialize};
use thiserror::Error;
use blake3::Hasher;
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use bech32::{Bech32m, Hrp};

// ==========================================
// 1. АДРЕСАЦИЯ И БАЗОВЫЕ ТИПЫ
// ==========================================

/// Детерминированный 20-байтный адрес
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
pub struct Address(pub [u8; 20]);

impl std::fmt::Debug for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let hrp = Hrp::parse("sl1").unwrap();
        let encoded = bech32::encode::<Bech32m>(hrp, &self.0).unwrap_or_else(|_| "err".to_string());
        write!(f, "Address({})", encoded)
    }
}

impl std::fmt::Display for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let hrp = Hrp::parse("sl1").unwrap();
        let encoded = bech32::encode::<Bech32m>(hrp, &self.0).unwrap_or_else(|_| "err".to_string());
        write!(f, "{}", encoded)
    }
}

// ==========================================
// 2. МОДЕЛЬ СОСТОЯНИЯ (STATE MODEL)
// ==========================================

/// Локальное состояние аккаунта
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct AccountState {
    /// Текущий баланс в базовых неделимых единицах
    pub balance: u64,
    /// Монотонный счетчик транзакций для защиты от повторов (replay protection)
    pub nonce: u64,
}

/// Глобальное состояние машины.
/// ВАЖНО: Использование BTreeMap ГАРАНТИРУЕТ детерминированный порядок перечисления ключей при хэшировании стейта.
#[derive(Clone, Debug, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct State {
    /// Карта состояний аккаунтов
    pub accounts: BTreeMap<Address, AccountState>,
    /// Порядковая высота журнала леджера
    pub ledger_height: u64,
}

// ==========================================
// 3. МОДЕЛЬ НАМЕРЕНИЯ (INTENT MODEL)
// ==========================================

/// Каноническое представление намерения до наложения подписи
#[derive(BorshSerialize)]
struct CanonicalIntent<'a> {
    domain: &'a str,
    action: &'a str,
    payload: &'a [u8],
    nonce: u64,
    signer: &'a Address,
}

/// Полный криптографический пакет намерения
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Intent {
    /// Целевой домен рантайма (например, "simple_l1::system")
    pub domain: String,
    /// Команда внутри домена (например, "transfer")
    pub action: String,
    /// Borsh-сериализованные аргументы действия
    pub payload: Vec<u8>,
    /// Заявленный Nonce отправителя
    pub nonce: u64,
    /// Заявленный адрес отправителя
    pub signer: Address,
    /// Публичный ключ NIST P-256 в сжатом SEC1 формате (33 байта)
    pub pubkey: Vec<u8>,
    /// Цифровая подпись ECDSA над сериализованным CanonicalIntent
    pub signature: Vec<u8>,
}

// ==========================================
// 4. СИСТЕМА ДЕТЕРМИНИРОВАННЫХ ДЕЙСТВИЙ (SYSTEM ACTIONS)
// ==========================================

/// Встроенные аргументы для действия "transfer"
#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct TransferPayload {
    pub to: Address,
    pub amount: u64,
}

// ==========================================
// 5. ЯДРО ИСКЛЮЧЕНИЙ (KERNEL ERROR MODEL)
// ==========================================

#[derive(Error, Debug, PartialEq, Eq)]
pub enum KernelError {
    #[error("Invalid cryptographic signature")]
    InvalidSignature,
    #[error("Signer address does not match the derived public key hash")]
    AddressMismatch,
    #[error("Invalid nonce: expected {expected}, received {received}")]
    InvalidNonce { expected: u64, received: u64 },
    #[error("Unknown execution domain: {0}")]
    UnknownDomain(String),
    #[error("Unknown action inside domain: {0}")]
    UnknownAction(String),
    #[error("Malformed intent payload: {0}")]
    MalformedPayload(String),
    #[error("Insufficient balance: required {required}, available {available}")]
    InsufficientFunds { required: u64, available: u64 },
    #[error("Overflow occurred during balance calculation")]
    MathOverflow,
}

// ==========================================
// 6. ИСПОЛНИТЕЛЬНЫЙ КЕРНЕЛ (EXECUTION KERNEL)
// ==========================================

impl State {
    /// Создает новый пустой стейт
    pub fn new() -> Self {
        Self {
            accounts: BTreeMap::new(),
            ledger_height: 0,
        }
    }

    /// Вычисляет BLAKE3 хэш всего текущего состояния.
    /// BTreeMap гарантирует детерминированный вывод на любом железе/ОС.
    pub fn root_hash(&self) -> [u8; 32] {
        let bytes = borsh::to_vec(self).expect("State serialization must not fail");
        let mut hasher = Hasher::new();
        hasher.update(&bytes);
        *hasher.finalize().as_bytes()
    }

    /// Главный детерминированный исполнительный конвейер.
    /// ПРИМЕНЯЕТ намерение к стейту ИЛИ откатывает мутацию.
    pub fn apply(&mut self, intent: &Intent) -> Result<[u8; 32], KernelError> {
        // 1. Верификация аппаратной подписи и легитимности ключа
        self.verify_cryptography(intent)?;

        // 2. Проверка и фиксация Nonce (Replay Protection)
        let current_nonce = self.get_nonce(&intent.signer);
        if intent.nonce != current_nonce {
            return Err(KernelError::InvalidNonce {
                expected: current_nonce,
                received: intent.nonce,
            });
        }

        // 3. Роутинг и исполнение логики доменов
        let next_state_accounts = self.route_and_execute(intent)?;

        // 4. Фиксация состояния в случае успеха (State Commit)
        self.accounts = next_state_accounts;
        
        // Монотонно увеличиваем Nonce отправителя
        if let Some(account) = self.accounts.get_mut(&intent.signer) {
            account.nonce += 1;
        }

        // Увеличиваем высоту журнала
        self.ledger_height += 1;

        // 5. Возврат нового хеша состояния
        Ok(self.root_hash())
    }

    /// Вспомогательный метод верификации криптографии
    fn verify_cryptography(&self, intent: &Intent) -> Result<(), KernelError> {
        // A. Проверка соответствия публичного ключа и заявленного адреса
        let mut hasher = Hasher::new();
        hasher.update(&intent.pubkey);
        let full_hash = hasher.finalize();
        let derived_bytes = &full_hash.as_bytes()[0..20];
        
        if derived_bytes != &intent.signer.0 {
            return Err(KernelError::AddressMismatch);
        }

        // B. Реконструкция канонического байтового представления намерения
        let canonical = CanonicalIntent {
            domain: &intent.domain,
            action: &intent.action,
            payload: &intent.payload,
            nonce: intent.nonce,
            signer: &intent.signer,
        };
        let canonical_bytes = borsh::to_vec(&canonical)
            .map_err(|e| KernelError::MalformedPayload(e.to_string()))?;

        // C. Верификация P-256 ECDSA подписи
        let verifying_key = VerifyingKey::from_sec1_bytes(&intent.pubkey)
            .map_err(|_| KernelError::InvalidSignature)?;
            
        let signature = Signature::from_der(&intent.signature)
            .map_err(|_| KernelError::InvalidSignature)?;

        verifying_key
            .verify(&canonical_bytes, &signature)
            .map_err(|_| KernelError::InvalidSignature)?;

        Ok(())
    }

    /// Роутинг намерений по пространствам имен (доменам)
    fn route_and_execute(&self, intent: &Intent) -> Result<BTreeMap<Address, AccountState>, KernelError> {
        // Клонируем карту для атомарной/чистой мутации во избежание повреждения исходного стейта при ошибке
        let mut next_accounts = self.accounts.clone();

        match intent.domain.as_str() {
            "simple_l1::system" => {
                self.execute_system_domain(&mut next_accounts, intent)?;
            }
            unknown => return Err(KernelError::UnknownDomain(unknown.to_string())),
        }

        Ok(next_accounts)
    }

    /// Системный домен рантайма (родные транзакции передачи средств)
    fn execute_system_domain(
        &self, 
        accounts: &mut BTreeMap<Address, AccountState>, 
        intent: &Intent
    ) -> Result<(), KernelError> {
        match intent.action.as_str() {
            "transfer" => {
                let args: TransferPayload = borsh::from_slice(&intent.payload)
                    .map_err(|e| KernelError::MalformedPayload(e.to_string()))?;
                
                // A. Вычитание баланса у отправителя
                let sender_state = accounts.get(&intent.signer).ok_or(KernelError::InsufficientFunds {
                    required: args.amount,
                    available: 0,
                })?;

                if sender_state.balance < args.amount {
                    return Err(KernelError::InsufficientFunds {
                        required: args.amount,
                        available: sender_state.balance,
                    });
                }

                let new_sender_balance = sender_state.balance.checked_sub(args.amount)
                    .ok_or(KernelError::MathOverflow)?;

                // Обновляем состояние отправителя
                accounts.get_mut(&intent.signer).unwrap().balance = new_sender_balance;

                // B. Зачисление баланса получателю
                let recipient_state = accounts.entry(args.to).or_insert(AccountState {
                    balance: 0,
                    nonce: 0,
                });

                recipient_state.balance = recipient_state.balance.checked_add(args.amount)
                    .ok_or(KernelError::MathOverflow)?;

                Ok(())
            }
            unknown => Err(KernelError::UnknownAction(unknown.to_string())),
        }
    }

    /// Безопасное извлечение текущего Nonce для любого адреса
    pub fn get_nonce(&self, addr: &Address) -> u64 {
        self.accounts.get(addr).map(|a| a.nonce).unwrap_or(0)
    }
}

// ==========================================
// 7. ДЕТЕРМИНИРОВАННЫЙ СЕКВЕНСОР (SEQUENCER CORE)
// ==========================================

/// Узел накопления и упорядочивания сырого хаоса намерений из сети
#[derive(Clone, Debug, Default)]
pub struct Sequencer {
    /// Неупорядоченный пул памяти (mempool)
    pub mempool: Vec<Intent>,
}

impl Sequencer {
    /// Инициализирует пустой секвенсор
    pub fn new() -> Self {
        Self {
            mempool: Vec::new(),
        }
    }

    /// Принимает новое сырое намерение из сетевого транспорта
    pub fn submit(&mut self, intent: Intent) {
        self.mempool.push(intent);
    }

    /// Очищает весь пул памяти
    pub fn clear(&mut self) {
        self.mempool.clear();
    }

    /// Главная функция разрешения конфликтов и линеаризации.
    /// Превращает неупорядоченный mempool в строго детерминированную очередь исполнения.
    pub fn sequence(&self) -> Vec<Intent> {
        // Шаг 1: Разрешение конфликтов эквивокации (один Signer, один Nonce)
        // Используем BTreeMap для автоматической детерминированной группировки.
        let mut deduplicated: BTreeMap<(Address, u64), Intent> = BTreeMap::new();

        for intent in &self.mempool {
            let key = (intent.signer, intent.nonce);
            
            if let Some(existing) = deduplicated.get(&key) {
                // Обнаружена попытка двойного расходования / двойного Nonce!
                // Разрешаем конфликт: вычисляем BLAKE3 хэши подписей обоих намерений.
                let h_existing = blake3::hash(&existing.signature);
                let h_current = blake3::hash(&intent.signature);

                // Выживает только то намерение, чей хэш математически МЕНЬШЕ.
                // Второе отбрасывается навсегда. Это гарантирует 100% консенсус сходимости.
                if h_current.as_bytes() < h_existing.as_bytes() {
                    deduplicated.insert(key, intent.clone());
                }
            } else {
                deduplicated.insert(key, intent.clone());
            }
        }

        // Шаг 2: Глобальное упорядочивание для подачи в рантайм (MDEK)
        let mut ordered: Vec<Intent> = deduplicated.into_values().collect();

        // Применяем строгую, тотальную функцию сортировки:
        // 1. Первичный ключ: Nonce (возрастание) — гарантирует соблюдение цепочек исполнения.
        // 2. Вторичный ключ: Адрес отправителя (лексикографически) — устраняет коллизии.
        ordered.sort_by(|a, b| {
            a.nonce.cmp(&b.nonce).then_with(|| a.signer.cmp(&b.signer))
        });

        ordered
    }
}

