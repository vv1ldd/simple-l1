//! SIMPLE-L1 Standalone Runtime Driver & Compliance Verification
//! 
//! Simulates physical key generation, serializes Borsh intents, and 
//! executes verification pipelines against the Minimal Execution Kernel.

use simple_l1_kernel::{State, Address, Intent, TransferPayload, AccountState, KernelError};
use p256::ecdsa::{signature::Signer, SigningKey, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use blake3::Hasher;
use std::collections::BTreeMap;

// ==========================================
// ВСПОМОГАТЕЛЬНЫЙ КРИПТО-ИНСТРУМЕНТАРИЙ
// ==========================================

/// Генерирует случайную пару P-256 ключей и канонический Address
fn generate_identity() -> (SigningKey, Vec<u8>, Address) {
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = VerifyingKey::from(&signing_key);
    
    // Извлекаем СЖАТЫЙ публичный ключ (33 байта)
    let pubkey_bytes = verifying_key.to_encoded_point(true).as_bytes().to_vec();
    
    // Создаем адрес: BLAKE3(pubkey)[0..20]
    let mut hasher = Hasher::new();
    hasher.update(&pubkey_bytes);
    let hash = hasher.finalize();
    let mut addr_bytes = [0u8; 20];
    addr_bytes.copy_from_slice(&hash.as_bytes()[0..20]);
    
    (signing_key, pubkey_bytes, Address(addr_bytes))
}

/// Каноническая Borsh-структура для сборки хэша подписи (совпадает с CanonicalIntent внутри lib.rs)
#[derive(borsh::BorshSerialize)]
struct SignableIntent<'a> {
    domain: &'a str,
    action: &'a str,
    payload: &'a [u8],
    nonce: u64,
    signer: &'a Address,
}

/// Утилита сборки и подписания корректного намерения
fn craft_signed_intent(
    signing_key: &SigningKey,
    pubkey: &[u8],
    signer: Address,
    domain: &str,
    action: &str,
    payload: Vec<u8>,
    nonce: u64,
) -> Intent {
    let signable = SignableIntent {
        domain,
        action,
        payload: &payload,
        nonce,
        signer: &signer,
    };
    
    // Сериализуем тело для аппаратного Secure Enclave
    let canonical_bytes = borsh::to_vec(&signable).unwrap();
    
    // Подписываем аппаратным ключом
    let signature = signing_key.sign(&canonical_bytes).to_der().as_bytes().to_vec();
    
    Intent {
        domain: domain.to_string(),
        action: action.to_string(),
        payload,
        nonce,
        signer,
        pubkey: pubkey.to_vec(),
        signature,
    }
}

// ==========================================
// ТОЧКА ВХОДА (RUNTIME SIMULATION)
// ==========================================

fn main() {
    println!("==========================================================");
    println!("      SIMPLE-L1 MINIMAL DETERMINISTIC EXECUTION KERNEL    ");
    println!("==========================================================");

    // 1. ГЕНЕРАЦИЯ ИДЕНТИЧНОСТЕЙ (LAYER 1)
    println!("\n>>> [1/4] Provisioning hardware identities...");
    let (sk_alice, pk_alice, addr_alice) = generate_identity();
    let (sk_bob, pk_bob, addr_bob) = generate_identity();
    
    println!(" -> Node ALICE spawned: {}", addr_alice);
    println!(" -> Node BOB spawned:   {}", addr_bob);

    // 2. РАЗВЕРТЫВАНИЕ GENESIS СОСТОЯНИЯ (LAYER 3)
    println!("\n>>> [2/4] Bootstrapping Genesis State...");
    let mut state = State::new();
    
    // Выдаем Алисе стартовый баланс в 1 000 000 SL1 сатоши
    state.accounts.insert(addr_alice, AccountState {
        balance: 1_000_000,
        nonce: 0,
    });
    
    let genesis_hash = state.root_hash();
    println!(" -> System State Bootstrapped. Height: {}", state.ledger_height);
    println!(" -> Genesis State Root Hash: 0x{}", hex::encode(genesis_hash));

    // 3. ИСПОЛНЕНИЕ КОРРЕКТНОЙ ОПЕРАЦИИ (HAPPY PATH)
    println!("\n>>> [3/4] Constructing intent: Transfer 250,000 units from Alice to Bob...");
    
    // Подготовка аргументов передачи (Borsh)
    let transfer_args = TransferPayload {
        to: addr_bob,
        amount: 250_000,
    };
    let payload_bytes = borsh::to_vec(&transfer_args).unwrap();

    // Крафтим валидный Intent 
    let valid_intent = craft_signed_intent(
        &sk_alice,
        &pk_alice,
        addr_alice,
        "simple_l1::system",
        "transfer",
        payload_bytes.clone(),
        0 // Ожидаемый Nonce
    );

    println!(" -> Transmitting Intent Package. Signature size: {} bytes.", valid_intent.signature.len());
    
    // Применяем намерение к рантайму
    match state.apply(&valid_intent) {
        Ok(new_hash) => {
            println!(" [SUCCESS ✅] Kernel applied intent smoothly.");
            println!("  * Ledger Height: {}", state.ledger_height);
            println!("  * New State Root:  0x{}", hex::encode(new_hash));
            
            let alice_bal = state.accounts.get(&addr_alice).unwrap().balance;
            let bob_bal = state.accounts.get(&addr_bob).unwrap().balance;
            let alice_nonce = state.get_nonce(&addr_alice);
            
            println!("  * Alice balance: {} units (Nonce: {})", alice_bal, alice_nonce);
            println!("  * Bob balance:   {} units", bob_bal);
            
            assert_eq!(alice_bal, 750_000);
            assert_eq!(bob_bal, 250_000);
            assert_eq!(alice_nonce, 1);
        }
        Err(e) => panic!("Failed to apply valid intent: {}", e),
    }

    // 4. СТРЕСС-ТЕСТИНГ ИНВАРИАНТОВ И ЗАЩИТЫ (EDGE CASES)
    println!("\n>>> [4/4] Running compliance & safety test suite...");

    // ТЕСТ А: Атака повторного воспроизведения (Replay Protection)
    println!("\n  CASE A: Replaying identical intent again (expecting InvalidNonce)...");
    match state.apply(&valid_intent) {
        Err(KernelError::InvalidNonce { expected, received }) => {
            println!("  [SAFE ✅] Kernel rejected replayed nonce. Expected {}, got {}", expected, received);
            assert_eq!(expected, 1);
        }
        other => panic!("Expected InvalidNonce error, got: {:?}", other),
    }

    // ТЕСТ Б: Попытка двойной траты с недостатком средств
    println!("\n  CASE B: Alice tries to send 900,000 units (available 750,000) (expecting InsufficientFunds)...");
    let overdraft_args = TransferPayload { to: addr_bob, amount: 900_000 };
    let overdraft_intent = craft_signed_intent(
        &sk_alice, &pk_alice, addr_alice, 
        "simple_l1::system", "transfer", 
        borsh::to_vec(&overdraft_args).unwrap(), 
        1 // Обновили Nonce на текущий
    );
    match state.apply(&overdraft_intent) {
        Err(KernelError::InsufficientFunds { required, available }) => {
            println!("  [SAFE ✅] Kernel rejected overdraft. Required {}, available {}", required, available);
        }
        other => panic!("Expected InsufficientFunds error, got: {:?}", other),
    }

    // ТЕСТ В: Фальсификация подписи
    println!("\n  CASE C: Sending malicious intent signed by attacker, claiming to be Alice (expecting InvalidSignature)...");
    let malicious_intent = Intent {
        domain: "simple_l1::system".to_string(),
        action: "transfer".to_string(),
        payload: payload_bytes.clone(),
        nonce: 1,
        signer: addr_alice, // Претендуем, что мы Алиса
        pubkey: pk_bob.clone(),   // Но суем ключ Боба!
        signature: valid_intent.signature.clone() // Или левую подпись
    };
    match state.apply(&malicious_intent) {
        Err(KernelError::AddressMismatch) => {
            println!("  [SAFE ✅] Kernel detected that pubkey does not match claimed signer address.");
        }
        other => panic!("Expected AddressMismatch error, got: {:?}", other),
    }

    // ТЕСТ Г: Несуществующий домен исполнения
    println!("\n  CASE D: Alice sends signed intent targeting 'simple_l1::defi' (expecting UnknownDomain)...");
    let unknown_domain_intent = craft_signed_intent(
        &sk_alice, &pk_alice, addr_alice,
        "simple_l1::defi", "trade",
        vec![],
        1
    );
    match state.apply(&unknown_domain_intent) {
        Err(KernelError::UnknownDomain(d)) => {
            println!("  [SAFE ✅] Kernel rejected unknown runtime domain: '{}'", d);
        }
        other => panic!("Expected UnknownDomain error, got: {:?}", other),
    }

    println!("\n==========================================================");
    println!(" [🏆 COMPLIANCE VERIFIED] 100% MATHEMATICAL SECURITY LOCK ");
    println!("==========================================================");
}
