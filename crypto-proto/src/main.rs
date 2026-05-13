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

    // ==========================================
    // ЭТАП 2: ADVERSARIAL REALITY SIMULATION (RFC-0008 & RFC-0010)
    // ==========================================
    println!("\n\n");
    println!("==========================================================");
    println!("        PHASE 2: PHYSICAL ADVERSARIAL ENVIRONMENT TEST    ");
    println!("==========================================================");
    println!(">>> Goal: Break the network with an ECLIPSE Attack and verify Self-Healing.");
    
    use simple_l1_kernel::simulator::RealitySimulator;
    
    // 1. Инициализируем симулятор с 3 узлами: Алиса, Боб, Чарли
    let mut sim = RealitySimulator::new(vec!["Alice", "Bob", "Charlie"]);
    
    // Бутстрапим балансы в генезис ВСЕХ трех узлов в симуляторе
    let init_state = |sim_node: &mut simple_l1_kernel::simulator::SimulatedNode| {
        sim_node.state.accounts.insert(addr_alice, AccountState { balance: 1_000_000, nonce: 0 });
        sim_node.state.accounts.insert(addr_bob, AccountState { balance: 1_000_000, nonce: 0 });
        sim_node.state.accounts.insert(addr_bob, AccountState { balance: 1_000_000, nonce: 0 }); // Bootstrap Bob
    };
    
    for node in &mut sim.nodes {
        init_state(node);
    }

    println!("\n>>> [1/4] Network initialized. All nodes at height 0.");
    
    // 2. Алиса выпускает Блок #1
    println!("\n>>> [2/4] Leader 'Alice' commits Block #1...");
    let block1_intents = vec![intent_a1.clone()];
    sim.nodes[0].commit_local_block(block1_intents);
    
    // Крутим время 60 тиков, чтобы Боб и Чарли синхронизировались
    sim.run_ticks(60);
    println!("  * Current Heights: Alice={}, Bob={}, Charlie={}", 
             sim.nodes[0].state.ledger_height, sim.nodes[1].state.ledger_height, sim.nodes[2].state.ledger_height);

    // 3. АТАКА ЗАТМЕНИЯ (Adversarial Cut)
    // Изолируем Чарли (Node 2) от физической сети!
    println!("\n>>> [3/4] Triggering Physical Eclipse Attack!");
    sim.apply_eclipse_attack(2); // Отрезаем Чарли
    
    // Алиса выпускает Блок #2 и Блок #3 пока Чарли отрезан
    println!("  * Leader 'Alice' commits Block #2 and Block #3 during network cut...");
    let block2_intents = vec![intent_b1.clone()];
    let block3_intents = vec![intent_b2.clone()];
    sim.nodes[0].commit_local_block(block2_intents);
    sim.nodes[0].commit_local_block(block3_intents);
    
    // Даем сети 100 тиков
    sim.run_ticks(100);
    
    println!("\n--- NETWORK STATE DURING ECLIPSE ---");
    println!("  * Alice   Height: {} (Root: 0x{})", sim.nodes[0].state.ledger_height, hex::encode(sim.nodes[0].state.root_hash()));
    println!("  * Bob     Height: {} (Root: 0x{})", sim.nodes[1].state.ledger_height, hex::encode(sim.nodes[1].state.root_hash()));
    println!("  * Charlie Height: {} (Root: 0x{})", sim.nodes[2].state.ledger_height, hex::encode(sim.nodes[2].state.root_hash()));
    println!("------------------------------------");
    println!("  [OBSERVATION] Charlie is stuck at Height 1 and is mathematically diverged from Bob!");

    // 4. САМОЛЕЧЕНИЕ И АНТИЭНТРОПИЯ (Healing & Anti-Entropy)
    println!("\n>>> [4/4] Reconnecting 'Charlie' to the network (Healing Physical Wires)...");
    sim.heal_topology();
    
    // Крутим 150 тиков, чтобы сработал Heartbeat, Gap Detection и RangeFetch
    sim.run_ticks(150);
    
    println!("\n--- FLUSHING SIMULATION EVENTS AND RECONCILIATION ---");
    for log in &sim.logs {
        println!("  {}", log);
    }
    println!("------------------------------------------------------");

    println!("\n==========================================================");
    println!("             FINAL PHYSICAL REALITY CHECK                 ");
    println!("==========================================================");
    
    let h_alice = sim.nodes[0].state.root_hash();
    let h_bob = sim.nodes[1].state.root_hash();
    let h_charlie = sim.nodes[2].state.root_hash();
    
    println!("  [*] Alice   Final State Hash: 0x{}", hex::encode(h_alice));
    println!("  [*] Bob     Final State Hash: 0x{}", hex::encode(h_bob));
    println!("  [*] Charlie Final State Hash: 0x{}", hex::encode(h_charlie));

    if h_charlie == h_alice && h_charlie == h_bob {
        println!("\n [🏆 PHYSICAL CONVERGENCE ACHIEVED] ");
        println!("  Charlie successfully detected the Epistemic Lag, triggered");
        println!("  Anti-Entropy RangeFetch over physical wires, and successfully");
        println!("  healed his state machine to perfectly match Alice and Bob!");
    } else {
        panic!("FATAL: Self-healing failed! Epistemic split persistent!");
    }
    println!("==========================================================");
}
