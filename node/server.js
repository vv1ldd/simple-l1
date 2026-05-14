const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'www'),
    prefix: '/', // Serve at root
});
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const fs = require('fs');
const path = require('path');

// --- DATABASE (LowDB-like simple JSON ledger) ---
const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
let ledger = {
    accounts: {}, // address -> { publicKey, balance, nonce }
    transactions: []
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

// --- ROUTES ---

// 1. Root Info
fastify.get('/', async () => {
    return {
        network: 'Simple-L1 Alpha',
        version: '0.1.0',
        uptime: process.uptime(),
        total_accounts: Object.keys(ledger.accounts).length
    };
});

// 2. Register Account (Onboarding)
fastify.post('/accounts', async (request, reply) => {
    const { address, publicKey, credentialId } = request.body;

    if (ledger.accounts[address]) {
        return reply.code(409).send({ error: 'Account already exists' });
    }

    ledger.accounts[address] = {
        publicKey,
        credentialId,
        balance: 1000, // Genesis gift
        nonce: 0,
        createdAt: new Date().toISOString()
    };

    saveLedger();
    return { success: true, address, balance: 1000 };
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
