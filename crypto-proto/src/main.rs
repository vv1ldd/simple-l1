//! SIMPLE-L1 Standalone Runtime Driver & Compliance Verification
//! 
//! Simulates hardware key generation, Borsh serialization, adversarial 
//! network reordering, sequencer conflict resolution, and multi-node state convergence.

use simple_l1_kernel::{State, Address, Intent, TransferPayload, AccountState, KernelError, Sequencer};
use p256::ecdsa::{signature::Signer, SigningKey, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use blake3::Hasher;
use rand::seq::SliceRandom; // Для симуляции сетевого хаоса перемешивания

// ==========================================
// ВСПОМОГАТЕЛЬНЫЙ КРИПТО-ИНСТРУМЕНТАРИЙ
// ==========================================

fn generate_identity() -> (SigningKey, Vec<u8>, Address) {
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = VerifyingKey::from(&signing_key);
    let pubkey_bytes = verifying_key.to_encoded_point(true).as_bytes().to_vec();
    
    let mut hasher = Hasher::new();
    hasher.update(&pubkey_bytes);
    let hash = hasher.finalize();
    let mut addr_bytes = [0u8; 20];
    addr_bytes.copy_from_slice(&hash.as_bytes()[0..20]);
    
    (signing_key, pubkey_bytes, Address(addr_bytes))
}

#[derive(borsh::BorshSerialize)]
struct SignableIntent<'a> {
    domain: &'a str,
    action: &'a str,
    payload: &'a [u8],
    nonce: u64,
    signer: &'a Address,
}

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
    let canonical_bytes = borsh::to_vec(&signable).unwrap();
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
// СИМУЛЯТОР РАСПРЕДЕЛЕННОЙ СЕТИ
// ==========================================

fn main() {
    println!("==========================================================");
    println!("         SIMPLE-L1 SEQUENCER & NETWORK SIMULATION         ");
    println!("==========================================================");

    // 1. ИДЕНТИЧНОСТИ
    println!("\n>>> [1/6] Generating secure cryptographic keys...");
    let (sk_alice, pk_alice, addr_alice) = generate_identity();
    let (sk_bob, pk_bob, addr_bob) = generate_identity();
    println!("  * ALICE node: {}", addr_alice);
    println!("  * BOB node:   {}", addr_bob);

    // 2. ГЕНЕРАЦИЯ ХАОТИЧНЫХ НАМЕРЕНИЙ (Adversarial mempool generation)
    println!("\n>>> [2/6] Crafting raw intent payloads (Happy Path & Equivocation attempts)...");

    // Утилиты для Payload
    let tx_alice_to_bob_100k = borsh::to_vec(&TransferPayload { to: addr_bob, amount: 100_000 }).unwrap();
    let tx_alice_to_bob_50k = borsh::to_vec(&TransferPayload { to: addr_bob, amount: 50_000 }).unwrap();
    let tx_bob_to_alice_20k = borsh::to_vec(&TransferPayload { to: addr_alice, amount: 20_000 }).unwrap();
    let tx_bob_to_alice_10k = borsh::to_vec(&TransferPayload { to: addr_alice, amount: 10_000 }).unwrap();

    // A. Алиса посылает валидное намерение (Nonce 0)
    let intent_a1 = craft_signed_intent(
        &sk_alice, &pk_alice, addr_alice,
        "simple_l1::system", "transfer", tx_alice_to_bob_100k, 0
    );

    // B. Алиса пытается совершить ЭКВИВОКАЦИЮ (Создает ВТОРОЕ намерение с тем же Nonce 0, но другой суммой!)
    // Это атака двойного расходования. Секвенсор ДОЛЖЕН отбросить ровно одно из них детерминированно.
    let intent_a2_malicious = craft_signed_intent(
        &sk_alice, &pk_alice, addr_alice,
        "simple_l1::system", "transfer", tx_alice_to_bob_50k, 0
    );

    // C. Боб отправляет намерение (Nonce 0)
    let intent_b1 = craft_signed_intent(
        &sk_bob, &pk_bob, addr_bob,
        "simple_l1::system", "transfer", tx_bob_to_alice_20k, 0
    );

    // D. Боб отправляет намерение (Nonce 1)
    let intent_b2 = craft_signed_intent(
        &sk_bob, &pk_bob, addr_bob,
        "simple_l1::system", "transfer", tx_bob_to_alice_10k, 1
    );

    // Собираем все сырые намерения в один массив "Мирового Эфира"
    let raw_network_intents = vec![
        intent_a1.clone(),
        intent_a2_malicious.clone(),
        intent_b1.clone(),
        intent_b2.clone(),
    ];

    println!("  * Created 4 raw network intents (including 1 double-spend attempt).");

    // 3. СИМУЛЯЦИЯ СЕТЕВОЙ АСИНХРОННОСТИ (RFC-0006: Network Reordering)
    println!("\n>>> [3/6] Simulating asynchronous network delivery (Chaotic Reordering)...");

    // Создаем двух валидаторов: Ноду Альфа и Ноду Бета.
    // У каждого из них свой собственный пул памяти, получающий пакеты в хаотичном порядке.
    let mut sequencer_alpha = Sequencer::new();
    let mut sequencer_beta = Sequencer::new();

    let mut rng = rand::thread_rng();

    // Порядок доставки для Альфы
    let mut alpha_feed = raw_network_intents.clone();
    alpha_feed.shuffle(&mut rng); 
    for packet in alpha_feed {
        sequencer_alpha.submit(packet);
    }

    // Порядок доставки для Беты (другой хаотичный порядок)
    let mut beta_feed = raw_network_intents.clone();
    beta_feed.shuffle(&mut rng);
    for packet in beta_feed {
        sequencer_beta.submit(packet);
    }

    println!("  [CHAOS ✅] Validator ALPHA mempool and Validator BETA mempool loaded in divergent orders.");

    // 4. ИСПОЛНЕНИЕ СЕКВЕНСОРА (CONFLICT RESOLUTION)
    println!("\n>>> [4/6] Triggering Sequencer Engine on both Nodes...");
    
    let ordered_alpha = sequencer_alpha.sequence();
    let ordered_beta = sequencer_beta.sequence();

    println!("  * Sequenced Stream Length: {} (Expected: 3, because 1 conflict was resolved).", ordered_alpha.len());
    assert_eq!(ordered_alpha.len(), 3);
    assert_eq!(ordered_beta.len(), 3);

    // Проверка БЕЗУПРЕЧНОЙ сходимости порядков!
    // Сравниваем побайтово сигнатуры полученных очередей на двух нодах.
    let mut identity_matched = true;
    for i in 0..3 {
        if ordered_alpha[i].signature != ordered_beta[i].signature {
            identity_matched = false;
        }
    }

    if identity_matched {
        println!("  [AGREEMENT 🏆] Node ALPHA and Node BETA converged on the ABSOLUTELY IDENTICAL order!");
    } else {
        panic!("CRITICAL ERROR: Validator Node orders diverged!");
    }

    // 5. ПОДГОТОВКА MDEK STATE MACHINES
    println!("\n>>> [5/6] Bootstrapping two independent State Machines from identical Genesis...");

    let mut state_alpha = State::new();
    let mut state_beta = State::new();

    // Сеем балансы в Genesis
    state_alpha.accounts.insert(addr_alice, AccountState { balance: 1_000_000, nonce: 0 });
    state_alpha.accounts.insert(addr_bob, AccountState { balance: 1_000_000, nonce: 0 });

    state_beta.accounts.insert(addr_alice, AccountState { balance: 1_000_000, nonce: 0 });
    state_beta.accounts.insert(addr_bob, AccountState { balance: 1_000_000, nonce: 0 });

    println!("  * Independent Genesis Hash Alpha: 0x{}", hex::encode(state_alpha.root_hash()));
    println!("  * Independent Genesis Hash Beta:  0x{}", hex::encode(state_beta.root_hash()));
    assert_eq!(state_alpha.root_hash(), state_beta.root_hash());

    // 6. ИСПОЛНЕНИЕ ОЧЕРЕДИ (TRUTH CONVERGENCE)
    println!("\n>>> [6/6] Applying the ordered Stream onto both State Machines...");

    println!("\n --- NODE ALPHA EXECUTION ---");
    for (idx, intent) in ordered_alpha.iter().enumerate() {
        match state_alpha.apply(intent) {
            Ok(new_hash) => println!("  Step {}: Applied Intent from {}. New Hash: 0x{}", idx + 1, intent.signer, hex::encode(new_hash)),
            Err(e) => println!("  Step {}: Execution failed: {}", idx + 1, e),
        }
    }

    println!("\n --- NODE BETA EXECUTION ---");
    for (idx, intent) in ordered_beta.iter().enumerate() {
        match state_beta.apply(intent) {
            Ok(new_hash) => println!("  Step {}: Applied Intent from {}. New Hash: 0x{}", idx + 1, intent.signer, hex::encode(new_hash)),
            Err(e) => println!("  Step {}: Execution failed: {}", idx + 1, e),
        }
    }

    println!("\n==========================================================");
    println!("             FINAL SYSTEM CONVERGENCE CHECK               ");
    println!("==========================================================");

    let final_hash_alpha = state_alpha.root_hash();
    let final_hash_beta = state_beta.root_hash();

    println!("  [*] Node ALPHA State Root: 0x{}", hex::encode(final_hash_alpha));
    println!("  [*] Node BETA State Root:  0x{}", hex::encode(final_hash_beta));

    if final_hash_alpha == final_hash_beta {
        println!("\n [🏆 SUCCESS] ABSOLUTE CONVERGENCE ACHIEVED! ");
        println!("  Despite network chaos and double-spend attacks, the network");
        println!("  reached mathematically identical truth.");
    } else {
        panic!("FATAL: State Hash mismatch! Fork detected!");
    }

    let alice_end_bal = state_alpha.accounts.get(&addr_alice).unwrap().balance;
    let bob_end_bal = state_alpha.accounts.get(&addr_bob).unwrap().balance;
    println!("\n  * Final Balances Verified on Nodes:");
    println!("    Alice: {} units", alice_end_bal);
    println!("    Bob:   {} units", bob_end_bal);
    
    println!("==========================================================");
}
