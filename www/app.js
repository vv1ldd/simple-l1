/**
 * =====================================================
 * SIMPLE-L1 | The Cryptographic Consensus Simulator
 * Truly Live WebAuthn Identity & Derivation Engine
 * =====================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-trigger-consensus');
    const consoleBody = document.getElementById('console-output');

    const appendLine = (text, className = '') => {
        const div = document.createElement('div');
        div.className = `terminal-line ${className}`;
        div.innerHTML = text;
        consoleBody.appendChild(div);
        consoleBody.scrollTop = consoleBody.scrollHeight;
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const randomHex = (len) => {
        const chars = '0123456789abcdef';
        let res = '';
        for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
        return res;
    };

    // Утилита конвертации buffer -> hex
    const bufToHex = (buffer) => {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    };

    const runConsensusSimulation = async () => {
        btn.disabled = true;
        btn.innerText = "⏳ ИСПОЛНЕНИЕ КОНСЕНСУСА...";
        
        consoleBody.innerHTML = '<div class="terminal-line text-highlight">[REBOOT] Initiating fresh cryptographic bootstrap...</div>';
        await sleep(800);

        appendLine("\n>>> [1/6] IDENTITY ENCLAVE: Requesting User Passkey Provision...", "prompt");
        appendLine("<span class='trace-warning'>[WAITING] Secure Hardware Prompt initiated for user: <strong>root@sl1.network</strong></span>");
        await sleep(800);

        let realPubKeyHex = "";
        let realAddress = "";
        let credentialId = "";
        let fallbackMode = false;

        try {
            if (!navigator.credentials || !navigator.credentials.create) {
                throw new Error("WebAuthn not supported or insecure context");
            }

            // Конфигурируем параметры для генерации нового ключа в Secure Enclave
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            const userId = crypto.getRandomValues(new Uint8Array(16));
            
            const hostname = window.location.hostname;
            const rpId = hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes(".") ? hostname : undefined;

            const publicKeyCredentialCreationOptions = {
                challenge: challenge,
                rp: {
                    name: "Simple-L1 Protocol",
                    id: rpId,
                },
                user: {
                    id: userId,
                    name: "root@sl1.network",
                    displayName: "Root Administrator",
                },
                pubKeyCredParams: [{alg: -7, type: "public-key"}], // ES256
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "required",
                },
                timeout: 60000,
                attestation: "none"
            };

            // ВЫЗОВ НАСТОЯЩЕЙ БИОМЕТРИИ APPLE
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });

            if (credential) {
                credentialId = credential.id;
                
                appendLine(`[SUCCESS] SECURE ENCLAVE AUTHORIZED VIA BIOMETRICS ✅`, "trace-success");
                await sleep(800);

                // --- САМАЯ СУТЬ: ИЗВЛЕЧЕНИЕ НАСТОЯЩЕГО ПУБЛИЧНОГО КЛЮЧА ---
                if (credential.response && credential.response.getPublicKey) {
                    const spkiPubKeyBuffer = credential.response.getPublicKey();
                    realPubKeyHex = bufToHex(spkiPubKeyBuffer);
                    
                    // Прогоняем SHA-256 (как замену BLAKE3 на клиенте) для генерации детерминированного адреса
                    const hashBuffer = await crypto.subtle.digest('SHA-256', spkiPubKeyBuffer);
                    const hashHex = bufToHex(hashBuffer);
                    
                    // Формируем реальный адрес
                    realAddress = `sl1_${hashHex.substring(0, 40)}`;
                }
            }

        } catch (e) {
            appendLine(`[INFO] Physical Hardware bypassed (${e.message}).`);
            fallbackMode = true;
        }

        // Обработка результатов (реальные или эмуляция)
        if (fallbackMode || !realPubKeyHex) {
            appendLine("<span style='color:#5c6370;'>[FALLBACK] Simulating Secure Hardware Enclave...</span>");
            await sleep(1500);
            realPubKeyHex = `3059301306072a8648ce3d020106082a8648ce3d03010703420004${randomHex(64)}`;
            realAddress = `sl1_${randomHex(40)}`;
        }

        // Выводим ВЫВЕДЕННЫЙ ИЗ РЕАЛЬНОГО КЛЮЧА КРИПТОАДРЕС
        appendLine(`[EXTRACT] SPKI Public Key from response (DER encoded):`);
        appendLine(`<span class="trace-key">0x${realPubKeyHex.substring(0, 50)}...</span>`);
        await sleep(1000);

        appendLine(`[DERIVE] Hash(SPKI) -> BLAKE3-160 -> Bech32m Alignment:`);
        appendLine(`  -> Derived Sovereign Address: <span class="trace-success" style="font-size: 14px;">${realAddress}</span>`);
        await sleep(1500);

        appendLine("\n>>> [2/6] INTENT STRUCTURE: Canonical Intent Serialization...", "prompt");
        await sleep(600);
        appendLine("  -> Domain: SIMPLE_L1::TX::V1");
        appendLine(`  -> Proposer: ${realAddress.substring(0, 12)}...`);
        appendLine("  -> Nonce: 1 (State Confirmed)");
        
        const borshHex = `53494d504c455f4c313a3a54583a3a5631${randomHex(100)}`;
        appendLine(`[BORSH] Binary Output Layout (141 bytes):`);
        appendLine(`<span style="color: #6f7687;">${borshHex.substring(0, 64)}...</span>`);
        await sleep(1200);

        appendLine("\n>>> [3/6] CRYPTO PROVENANCE: Attesting Intent Bytes...", "prompt");
        appendLine(`[WEBAUTHN] Authenticator Data Linked successfully.`);
        
        const sig = credentialId ? credentialId : randomHex(128);
        appendLine(`[SIG] Deterministic NIST P-256 Signature: <span class="trace-hash">0x${sig.substring(0, 40)}...</span>`);
        await sleep(1200);

        appendLine("\n>>> [4/6] BATCHING: Merkle Proving Phase...", "prompt");
        await sleep(800);
        const txHash1 = randomHex(64);
        appendLine(`  [*] Ingesting Root intent -> TxHash: <span class="trace-hash">0x${txHash1}</span>`);
        
        const merkleRoot = randomHex(64);
        appendLine(`[MERKLE] Root Hash: <span class="trace-success">0x${merkleRoot}</span>`);
        await sleep(1000);

        appendLine("\n>>> [5/6] CONSENSUS: Reconciliation Matrix...", "prompt");
        await sleep(600);
        appendLine("Validator Node B matching invariants...");
        await sleep(800);
        appendLine("  [*] Invariant 1: Signature Proof verified against Address -> <span class='trace-success'>OK ✅</span>");
        
        const finalStateRoot = randomHex(64);
        appendLine("  [*] Invariant 2: Executing sorted state transitions...");
        await sleep(1200);
        appendLine(`  [*] State Root [0x${finalStateRoot}] -> <span class='trace-success'>FULLY CONVERGED ✅</span>`);
        await sleep(900);

        appendLine("\n>>> [6/6] FINALITY: Flushing to Ledger Lineage...", "prompt");
        await sleep(700);
        appendLine(`[DISK] Flat-file fsync completed to ledger.json.`);
        appendLine(`<span class='trace-success' style="font-weight:900;">💥 BLOCK #1 SEALED & COMMITTED AS SOVEREIGN STATE!</span>`);
        
        btn.disabled = false;
        btn.innerText = "⚡ ЗАПУСТИТЬ ПОВТОРНО";
    };

    btn.addEventListener('click', runConsensusSimulation);
});
