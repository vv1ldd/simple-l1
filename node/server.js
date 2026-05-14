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

const crypto = require('crypto');

const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
let ledger = {
    accounts: {}, 
    pending_settlements: [], // { id, sl1_address, asset, amount, state: 'SETTLING' | 'FINALIZED' }
    transactions: [],
    treasury: { btc_deposits: {} }
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

const NODE_NAME = process.env.NODE_NAME || 'node-alpha';

// --- API ROUTES ---

// Node Status
fastify.get('/api/status', async (request, reply) => {
    const handles = Object.values(ledger.accounts).map(a => a.handle).filter(Boolean);
    return {
        network: "Simple-L1 Alpha",
        node_name: NODE_NAME,
        version: "0.1.0",
        nodes_count: 2,
        peers: ["node-alpha", "node-beta"],
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
    if (!ledger.accounts[sl1_address]) return reply.code(404).send({ error: 'Account not found' });
    const deposit_address = ledger.accounts[sl1_address].external_addresses[asset] || `bc1_${crypto.randomBytes(5).toString('hex')}`;
    ledger.treasury.btc_deposits[deposit_address] = sl1_address;
    saveLedger();
    return { deposit_address };
});

// 5. Simulate Bridge Intent (Asynchronous Settlement)
fastify.post('/api/assets/simulate-mint', async (request, reply) => {
    const { btc_address, amount } = request.body;
    const sl1_address = ledger.treasury.btc_deposits[btc_address];
    if (!sl1_address) return reply.code(404).send({ error: 'Deposit address not recognized' });

    const settlement_id = crypto.randomBytes(4).toString('hex');
    const settlement = {
        id: settlement_id, sl1_address, asset: 'BTC', amount, state: 'SETTLING', startedAt: new Date().toISOString()
    };
    if (!ledger.pending_settlements) ledger.pending_settlements = [];
    ledger.pending_settlements.push(settlement);

    const account = ledger.accounts[sl1_address];
    account.provenance_log.push({
        type: 'SETTLE_START',
        detail: `Bridge intent detected: ${amount} BTC (ID: ${settlement_id})`,
        state: 'SETTLING',
        timestamp: settlement.startedAt
    });

    saveLedger();

    // Simulate asynchronous finality (8s delay)
    setTimeout(() => {
        const s = ledger.pending_settlements.find(x => x.id === settlement_id);
        if (s && ledger.accounts[s.sl1_address]) {
            const acc = ledger.accounts[s.sl1_address];
            s.state = 'FINALIZED';
            acc.balances.BTC += parseFloat(amount);
            acc.provenance_log.push({
                type: 'SETTLE_FINAL',
                detail: `Bridge finalized: ${amount} BTC credited`,
                state: 'FINALIZED',
                timestamp: new Date().toISOString()
            });
            saveLedger();
            console.log(`[SETTLEMENT] Finalized ID: ${settlement_id} for ${acc.handle}`);
        }
    }, 8000);

    return { success: true, settlement_id, state: 'SETTLING' };
});


// 6. Process Cryptographically Authorized Intent
fastify.post('/transactions', async (request, reply) => {
    const { from, to_handle, amount, asset, signature, delegation_proof } = request.body;
    
    let sender = ledger.accounts[from];
    const assetKey = asset || 'SL1';

    // DELEGATION CHECK: Is this a delegated action?
    if (delegation_proof) {
        const delegator = ledger.accounts[delegation_proof.delegator];
        const permission = delegator.authority_policies.delegations?.find(d => d.to === sender.handle && d.asset === assetKey);
        
        if (!permission || amount > permission.limit) {
            return reply.code(403).send({ error: 'Delegation limit exceeded or permission denied' });
        }
        sender = delegator; // Redirect execution context to delegator
    }

    if (!sender) return reply.code(404).send({ error: 'Authority context not found' });
    
    // POLICY CHECK
    if (amount > (sender.authority_policies.session_limit || 1000)) {
        return reply.code(403).send({ error: 'Policy violation: Session limit exceeded' });
    }

    const recipientAddress = Object.keys(ledger.accounts).find(addr => ledger.accounts[addr].handle === to_handle);
    if (!recipientAddress) return reply.code(404).send({ error: 'Recipient not found' });

    // EXECUTION
    sender.balances[assetKey] -= amount;
    ledger.accounts[recipientAddress].balances[assetKey] += amount;
    
    const intent_hash = crypto.createHash('sha256').update(JSON.stringify({ from, to_handle, amount, assetKey, nonce: sender.nonce })).digest('hex');
    sender.nonce++;
    
    // PROVENANCE
    sender.provenance_log.push({
        type: delegation_proof ? 'DELEGATED_EXEC' : 'TRANSFER',
        detail: `${delegation_proof ? sender.handle + ' (via delegation)' : 'Sent'} ${amount} ${assetKey} to ${to_handle}`,
        intent_hash,
        timestamp: new Date().toISOString()
    });

    saveLedger();
    return { success: true, intent_hash };
});

// 7. Manage Authority (Delegate/Revoke)
fastify.post('/api/authority/manage', async (request, reply) => {
    const { address, type, target, asset, limit } = request.body;
    const account = ledger.accounts[address];
    if (!account) return reply.code(404).send({ error: 'Account not found' });

    if (type === 'DELEGATE') {
        if (!account.authority_policies.delegations) account.authority_policies.delegations = [];
        account.authority_policies.delegations.push({ to: target, asset, limit });
        account.provenance_log.push({
            type: 'AUTHORIZE',
            detail: `Delegated ${limit} ${asset} authority to ${target}`,
            timestamp: new Date().toISOString()
        });
    } else if (type === 'REVOKE') {
        delete account.external_addresses[asset];
        account.provenance_log.push({
            type: 'REVOKE',
            detail: `Revoked settlement projection for ${asset}`,
            timestamp: new Date().toISOString()
        });
    }

    saveLedger();
    return { success: true };
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
fastify.post('/transactions-legacy', async (request, reply) => {
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
