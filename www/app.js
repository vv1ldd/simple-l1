/**
 * ==========================================
 * SIMPLE-L1 | The Live Consensus Simulator
 * ==========================================
 */

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-trigger-consensus');
    const consoleBody = document.getElementById('console-output');

    // Вспомогательная функция для печати строки с задержкой
    const appendLine = (text, className = '') => {
        const div = document.createElement('div');
        div.className = `terminal-line ${className}`;
        div.innerHTML = text;
        consoleBody.appendChild(div);
        // Скролл в конец терминала
        consoleBody.scrollTop = consoleBody.scrollHeight;
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Генератор фейковых хэшей для красоты
    const randomHex = (len) => {
        const chars = '0123456789abcdef';
        let res = '';
        for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
        return res;
    };

    // Логика интерактивного симулятора
    const runConsensusSimulation = async () => {
        btn.disabled = true;
        btn.innerText = "⏳ Исполнение консенсуса...";
        
        // Очищаем предыдущий вывод (оставляем стартовую строку)
        consoleBody.innerHTML = '<div class="terminal-line text-highlight">[REBOOT] Initiating fresh network bootstrap...</div>';
        await sleep(800);

        appendLine(">>> [1/6] BOOTSTRAP: Initializing Secure Enclave P-256 Keypair...", "prompt");
        await sleep(1000);
        const pubKey = `03${randomHex(64)}`;
        appendLine(`[KEYGEN] Extracted Compressed Public Key: <span class="trace-key">0x${pubKey}</span>`);
        
        const addr = `sl1_${randomHex(40)}`;
        appendLine(`[DERIVE] BLAKE3-160 Hash -> Bech32m Address: <span class="trace-success">${addr}</span>`);
        await sleep(1200);

        appendLine("\n>>> [2/6] SERIALIZATION: Structuring User Intent...", "prompt");
        await sleep(600);
        appendLine("  -> Domain: SIMPLE_L1::TX::V1");
        appendLine("  -> Chain ID: simple-l1-mainnet-v1");
        appendLine("  -> Nonce: 1");
        
        const borshHex = `53494d504c455f4c313a3a54583a3a5631${randomHex(100)}`;
        appendLine(`[BORSH] Deterministic Binary Layout (141 bytes):`);
        appendLine(`<span style="color: #6f7687;">${borshHex.substring(0, 64)}...</span>`);
        await sleep(1000);

        appendLine("\n>>> [3/6] AUTHENTICATION: Requesting WebAuthn Bio-Signature...", "prompt");
        appendLine("<span class='trace-warning'>[WAITING] Waiting for FaceID / TouchID secure hardware prompt...</span>");
        await sleep(2000);
        appendLine(`[WEBAUTHN] Received authenticatorData (37 bytes)`);
        appendLine(`[WEBAUTHN] ClientDataJSON anchor verified successfully.`);
        
        const sig = randomHex(128);
        appendLine(`[SIG] Hardware P-256 Signature Generated: <span class="trace-key">0x${sig.substring(0, 32)}...</span>`);
        await sleep(1200);

        appendLine("\n>>> [4/6] BATCH EXECUTION: Proposer node aggregating Mempool...", "prompt");
        await sleep(800);
        const txHash1 = randomHex(64);
        const txHash2 = randomHex(64);
        appendLine(`  [*] Ingested Tx1 [Alice -> Bob] -> TxHash: <span class="trace-hash">0x${txHash1}</span>`);
        appendLine(`  [*] Ingested Tx2 [Bob -> Alice] -> TxHash: <span class="trace-hash">0x${txHash2}</span>`);
        
        // Строим Merkle Root
        const merkleRoot = randomHex(64);
        appendLine(`[MERKLE] Computing Binary Tree Root: <span class="trace-success">0x${merkleRoot}</span>`);
        await sleep(1000);

        appendLine("\n>>> [5/6] CONSENSUS: Propagating Block #1 to Independent Nodes...", "prompt");
        await sleep(600);
        appendLine("Validator Node B checking block invariants...");
        await sleep(800);
        appendLine("  [*] Invariant 1: Block Transaction Merkle Root -> <span class='trace-success'>VERIFIED ✅</span>");
        
        // Сходимость State Root
        const finalStateRoot = randomHex(64);
        appendLine("  [*] Invariant 2: Executing sorted binary state transformations...");
        await sleep(1200);
        appendLine(`  [*] Resulting State Root [0x${finalStateRoot}] -> <span class='trace-success'>FULLY CONVERGED ✅</span>`);
        await sleep(900);

        appendLine("\n>>> [6/6] FINALIZATION: Recording Ledger Persistence...", "prompt");
        await sleep(700);
        appendLine(`[FLUSH] Flat-file Ledger Sync completed to ledger.json.`);
        appendLine(`<span class='trace-success'>💥 BLOCK #1 SEALED, FINALIZED & COMMITTED TO CHAIN!</span>`);
        
        btn.disabled = false;
        btn.innerText = "🚀 Запустить Повторно";
    };

    btn.addEventListener('click', runConsensusSimulation);
});
