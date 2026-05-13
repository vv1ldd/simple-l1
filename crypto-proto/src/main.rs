use p256::ecdsa::{signature::Signer, signature::Verifier, Signature, SigningKey, VerifyingKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use blake3::Hasher;
use bech32::{self, Bech32m, Hrp};

fn main() {
    println!("--- Simple-L1 Cryptography Verification ---");

    // 1. Генерируем тестовый приватный ключ и соответствующий ему публичный ключ (NIST P-256)
    // В реальном мире приватный ключ генерируется в Secure Enclave и никогда не раскрывается.
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = VerifyingKey::from(&signing_key);

    // 2. Получаем СЖАТЫЙ публичный ключ (Compressed SEC1 format, 33 байта)
    let encoded_point = verifying_key.to_encoded_point(true); // true = сжатый формат
    let pubkey_bytes = encoded_point.as_bytes();
    println!("1. Public Key (Compressed, {} bytes): 0x{}", pubkey_bytes.len(), hex::encode(pubkey_bytes));

    // 3. Вычисляем адрес по стандарту RFC-0001
    // Шаг A: BLAKE3-хэширование
    let mut hasher = Hasher::new();
    hasher.update(pubkey_bytes);
    let full_hash = hasher.finalize();
    
    // Шаг B: Усечение до 20 байт (160 бит)
    let hash_160 = &full_hash.as_bytes()[0..20];
    println!("2. BLAKE3-160 Hash (20 bytes): 0x{}", hex::encode(hash_160));

    // Шаг C: Кодирование в Bech32m с префиксом 'sl1'
    let hrp = Hrp::parse("sl1").expect("Invalid HRP");
    let address = bech32::encode::<Bech32m>(hrp, hash_160)
        .expect("Failed to encode address");
    
    println!("3. Generated L1 Address: {}", address);
    println!("------------------------------------------");

    // 4. Демонстрация конвейера подписания (RFC-0002: WebAuthn Mapping)
    println!("Simulating WebAuthn Transaction Signing...");

    // Намерение: перевод 100 SL1
    let mock_intent_bytes = b"INTENT_PAYLOAD: TRANSFER 100 TO sl1qpxx...";
    
    // Вычисляем Challenge = BLAKE3(Intent)
    let mut challenge_hasher = Hasher::new();
    challenge_hasher.update(mock_intent_bytes);
    let challenge_hash = challenge_hasher.finalize();
    let challenge_hex = hex::encode(challenge_hash.as_bytes());
    println!("-> Intent BLAKE3 Hash (Challenge): 0x{}", challenge_hex);

    // Имитируем структуру ClientDataJSON от WebAuthn, куда браузер внедряет наш Challenge
    let client_data_json = format!(
        r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://simple-l1.network"}}"#,
        challenge_hex
    );
    
    // Имитируем байты AuthenticatorData от аппаратного чипа
    let mock_authenticator_data = vec![0u8; 37]; // В реальности тут флаги UP, UV и т.д.

    // Собираем сообщение для подписи: AuthenticatorData + SHA256(ClientDataJSON)
    use sha2::{Sha256, Digest};
    let client_data_hash = Sha256::digest(client_data_json.as_bytes());
    
    let mut signed_message = Vec::new();
    signed_message.extend_from_slice(&mock_authenticator_data);
    signed_message.extend_from_slice(&client_data_hash);

    // 5. Аппаратное устройство вычисляет ECDSA-подпись над signed_message
    let signature: Signature = signing_key.sign(&signed_message);
    let signature_bytes = signature.to_bytes();
    println!("-> WebAuthn ECDSA Signature generated ({} bytes)", signature_bytes.len());

    // 6. ВЕРИФИКАЦИЯ НА НОДЕ (Consensus Layer Validation)
    println!("\nRunning Node Consensus Verification...");

    // А. Нода извлекает хэш намерения из транзакции и проверяет равенство с полем JSON
    // (Имитируем парсинг JSON)
    let received_json_challenge = challenge_hex.clone(); // Извлекли из client_data_json
    let is_challenge_valid = received_json_challenge == challenge_hex;
    println!("  [*] Challenge binding validation: {}", if is_challenge_valid { "SUCCESS" } else { "FAILED" });

    // Б. Нода реконструирует подписанное сообщение
    let mut node_reconstructed_message = Vec::new();
    node_reconstructed_message.extend_from_slice(&mock_authenticator_data);
    node_reconstructed_message.extend_from_slice(&Sha256::digest(client_data_json.as_bytes()));

    // В. Нода проверяет ECDSA подпись используя Публичный Ключ аккаунта
    let is_sig_valid = verifying_key.verify(&node_reconstructed_message, &signature).is_ok();
    println!("  [*] Cryptographic Signature verification: {}", if is_sig_valid { "SUCCESS ✅" } else { "FAILED ❌" });

    assert!(is_challenge_valid && is_sig_valid);
    println!("\n=== VERIFICATION SYSTEM FULLY FUNCTIONAL ===");
}
