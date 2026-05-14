const path = require('path');
const fs = require('fs');
const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'www'),
    prefix: '/', // Serve at root
    index: 'index.html',
});
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');

// --- DATABASE (LowDB-like simple JSON ledger) ---
const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
let ledger = {
    accounts: {}, // address -> { handle, publicKey, balances, authority_policies, provenance_log }
    transactions: [],
    treasury: {
        btc_deposits: {}
    }
};

if (fs.existsSync(LEDGER_FILE)) {
    ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
}

const saveLedger = () => {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
};

// --- HELPERS ---
const calculateAddress = (pubKeyHex) => {
    // In a real implementation, we'd use SHA-256
    // For now, let's keep it consistent with the browser demo
    return `sl1_${pubKeyHex.substring(0, 40)}`;
};

// --- API ROUTES ---

// Node Status
fastify.get('/api/status', async (request, reply) => {
    const handles = Object.values(ledger.accounts).map(a => a.handle).filter(Boolean);
    return {
        network: "Simple-L1 Alpha",
        version: "0.1.0",
        uptime: process.uptime(),
        total_accounts: Object.keys(ledger.accounts).length,
        total_transactions: ledger.transactions.length,
        active_handles: handles
    };
});

// 2. Get Registration Options (for Portal)
fastify.get('/api/register/options', async (request, reply) => {
    const { handle } = request.query;
    const userHandle = handle || 'anonymous';
    
    // In a real L1, this challenge is deterministic or linked to block height
    const challenge = Buffer.from(Date.now().toString()).toString('base64').replace(/=/g, '');
    
    return {
        challenge,
        rp: { name: "Simple-L1 Network", id: request.hostname },
        user: {
            id: Buffer.from(userHandle).toString('base64').replace(/=/g, ''),
            name: userHandle,
            displayName: userHandle
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ES256
        timeout: 60000,
        attestation: "none"
    };
});

// 3. Register Account (Onboarding)
fastify.post('/accounts', async (request, reply) => {
    const { address, publicKey, credentialId, handle } = request.body;

    if (ledger.accounts[address]) {
        return reply.code(409).send({ error: 'Account already exists' });
    }

    const external_addresses = {
        BTC: `bc1_${Math.random().toString(36).substring(2, 12)}`,
        ETH: `0x${Math.random().toString(16).substring(2, 42)}`,
        SOL: `${Math.random().toString(36).substring(2, 32)}`
    };

    const newAccount = {
        handle: handle || 'anonymous',
        publicKey,
        credentialId,
        balances: { SL1: 1000, BTC: 0, ETH: 0 },
        external_addresses,
        authority_policies: {
            session_limit: 1000,
            co_signing_required: false,
            intent_scope: ['payments', 'identity-claims'],
            active_policies: ['Daily Limit 1000 SL1']
        },
        provenance_log: [
            { type: 'GENESIS', detail: 'Authority Root established via Secure Enclave', timestamp: new Date().toISOString() },
            { type: 'PROJECTION', detail: 'BTC/ETH interfaces derived', timestamp: new Date().toISOString() }
        ],
        nonce: 0,
        createdAt: new Date().toISOString()
    };

    ledger.accounts[address] = newAccount;

    if (!ledger.treasury.btc_deposits) ledger.treasury.btc_deposits = {};
    ledger.treasury.btc_deposits[external_addresses.BTC] = address;

    saveLedger();
    console.log(`[DAOS] Authority State Transition: Genesis ${handle}`);
    return { success: true, account: newAccount };
});

// 4. Generate BTC Deposit Address (Simulated Treasury)
fastify.post('/api/assets/deposit', async (request, reply) => {
    const { sl1_address, asset } = request.body;
    if (asset !== 'BTC') return reply.code(400).send({ error: 'Only BTC supported' });
    
    // Generate a unique BTC address linked to this SL1 account
    const btcAddress = `bc1_${Math.random().toString(36).substring(2, 15)}`;
    
    if (!ledger.treasury.btc_deposits) ledger.treasury.btc_deposits = {};
    ledger.treasury.btc_deposits[btcAddress] = sl1_address;
    
    saveLedger();
    return { deposit_address: btcAddress, asset: 'BTC' };
});

// 5. Simulate BTC Deposit (For Demo)
fastify.post('/api/assets/simulate-mint', async (request, reply) => {
    const { btc_address, amount } = request.body;
    const sl1_address = ledger.treasury.btc_deposits[btc_address];
    
    if (!sl1_address || !ledger.accounts[sl1_address]) {
        return reply.code(404).send({ error: 'Deposit address not found' });
    }
    
    ledger.accounts[sl1_address].balances.BTC += parseFloat(amount);
    
    // Log pseudo-transaction
    ledger.transactions.push({
        type: 'MINT',
        asset: 'BTC',
        to: sl1_address,
        amount,
        timestamp: new Date().toISOString()
    });
    
    saveLedger();
    return { success: true, new_balance: ledger.accounts[sl1_address].balances.BTC };
});


// 3. Get Account State
fastify.get('/accounts/:address', async (request, reply) => {
    const { address } = request.params;
    const account = ledger.accounts[address];

    if (!account) {
        return reply.code(404).send({ error: 'Account not found' });
    }

    return account;
});

// 4. Submit Transaction
fastify.post('/transactions', async (request, reply) => {
    const { from, to, amount, signature, challenge } = request.body;

    const sender = ledger.accounts[from];
    if (!sender) return reply.code(404).send({ error: 'Sender not found' });

    if (sender.balance < amount) {
        return reply.code(400).send({ error: 'Insufficient funds' });
    }

    // --- MDK KERNEL VALIDATION ---
    const { execSync } = require('child_process');
    let mdkResult;
    try {
        const input = JSON.stringify({ type: 'TRANSFER', from, to, amount, signature });
        const output = execSync(`php ${path.join(__dirname, 'php', 'bridge.php')}`, { input });
        mdkResult = JSON.parse(output.toString());
    } catch (err) {
        return reply.code(500).send({ error: 'MDK Kernel Error', details: err.message });
    }

    if (!mdkResult.success) {
        return reply.code(400).send({ error: 'MDK Validation Failed', trace: mdkResult.trace });
    }
    
    // Process TX
    sender.balance -= amount;
    sender.nonce += 1;

    if (!ledger.accounts[to]) {
        ledger.accounts[to] = { balance: 0, nonce: 0 };
    }
    ledger.accounts[to].balance += amount;

    const txHash = `0x${Math.random().toString(16).slice(2)}`;
    ledger.transactions.push({
        hash: txHash,
        from,
        to,
        amount,
        timestamp: new Date().toISOString()
    });

    saveLedger();

    return { 
        success: true, 
        hash: txHash,
        newBalance: sender.balance 
    };
});

// --- START SERVER ---
const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log(`🚀 Simple-L1 Node running at http://localhost:3000`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
