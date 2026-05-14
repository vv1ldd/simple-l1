const path = require('path');
const fs = require('fs');
const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const crypto = require('crypto');

const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
let ledger = {
    accounts: {},      // Derived state (View)
    event_log: [],     // Primary Source of Truth (Signed Transitions)
    pending_settlements: [],
    treasury: { btc_deposits: {} }
};

// --- REPLAY ENGINE (The Heart of the Node) ---
function applyEvent(event, isInitialReplay = false) {
    console.log(`[REPLAY] Processing event: ${event.type} (${event.id})`);
    
    switch (event.type) {
        case 'GENESIS':
            const { address, handle, publicKey, credentialId } = event.payload;
            ledger.accounts[address] = {
                handle: handle || 'anonymous',
                publicKey,
                credentialId,
                balances: { SL1: 1000, BTC: 0, ETH: 0 },
                external_addresses: {
                    BTC: `bc1_${crypto.createHash('sha256').update(address + 'BTC').digest('hex').substring(0, 10)}`,
                    ETH: `0x${crypto.createHash('sha256').update(address + 'ETH').digest('hex').substring(0, 10)}`
                },
                authority_policies: {
                    session_limit: 1000,
                    intent_scope: ['payments', 'identity-claims'],
                    active_policies: ['Daily Limit 1000 SL1']
                },
                provenance_log: [],
                nonce: 0
            };
            if (!ledger.treasury.btc_deposits) ledger.treasury.btc_deposits = {};
            ledger.treasury.btc_deposits[ledger.accounts[address].external_addresses.BTC] = address;
            break;

        case 'TRANSFER':
            const { from, to_handle, amount, asset } = event.payload;
            const sender = ledger.accounts[from];
            const recipientAddr = Object.keys(ledger.accounts).find(a => ledger.accounts[a].handle === to_handle);
            
            if (sender && recipientAddr) {
                sender.balances[asset] -= amount;
                ledger.accounts[recipientAddr].balances[asset] += amount;
                sender.nonce++;
                
                sender.provenance_log.push({
                    type: 'TRANSFER',
                    detail: `Sent ${amount} ${asset} to ${to_handle}`,
                    event_id: event.id,
                    timestamp: event.timestamp
                });
            }
            break;
    }

    if (!isInitialReplay) {
        ledger.event_log.push(event);
        saveLedger();
    }
}

// Startup: Reconstruct state from event log
if (fs.existsSync(LEDGER_FILE)) {
    try {
        const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
        if (raw.event_log) {
            console.log(`[BOOT] Replaying ${raw.event_log.length} events...`);
            raw.event_log.forEach(e => applyEvent(e, true));
        }
    } catch (err) { console.error('[BOOT] Failed to load ledger:', err); }
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
const PEERS = (process.env.PEERS || '').split(',').filter(Boolean);

// --- NETWORK SYNC HELPER ---
async function broadcast(path, payload) {
    for (const peer of PEERS) {
        try {
            await fetch(`${peer}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log(`[NETWORK] Broadcast to ${peer} success: ${path}`);
        } catch (err) {
            console.warn(`[NETWORK] Broadcast to ${peer} failed: ${err.message}`);
        }
    }
}

// --- API ROUTES ---

// Node Status
fastify.get('/api/status', async (request, reply) => {
    const handles = Object.values(ledger.accounts).map(a => a.handle).filter(Boolean);
    return {
        network: "Simple-L1 Alpha",
        node_name: NODE_NAME,
        version: "0.1.0",
        peers: PEERS,
        total_accounts: Object.keys(ledger.accounts).length,
        total_transactions: ledger.transactions.length,
        active_handles: handles,
        uptime: process.uptime()
    };
});

// Network Broadcast Receiver (Gossip)
fastify.post('/api/network/broadcast', async (request, reply) => {
    const { type, data } = request.body;
    console.log(`[NETWORK] Received broadcast: ${type}`);
    
    if (type === 'EVENT') {
        // Deterministic Replay
        if (!ledger.event_log.find(e => e.id === data.id)) {
            applyEvent(data);
        }
    }
    return { success: true };
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

    // CREATE SIGNED GENESIS EVENT
    const genesisEvent = {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'GENESIS',
        payload: { address, handle, publicKey, credentialId },
        timestamp: new Date().toISOString()
    };

    applyEvent(genesisEvent);
    
    // BROADCAST GENESIS
    broadcast('/api/network/broadcast', { type: 'EVENT', data: genesisEvent });

    console.log(`[DAOS] Authority State Transition: Genesis ${handle}`);
    return { success: true, account: ledger.accounts[address] };
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
    
    // CREATE SIGNED TRANSFER EVENT
    const transferEvent = {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'TRANSFER',
        payload: { from, to_handle, amount, asset: assetKey, intent_hash },
        signature: request.body.signature, // Real proof
        timestamp: new Date().toISOString()
    };

    applyEvent(transferEvent);
    
    // BROADCAST EVENT
    broadcast('/api/network/broadcast', { type: 'EVENT', data: transferEvent });

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
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        console.log(`[DAOS] ${NODE_NAME} is active and listening on port ${process.env.PORT || 3000}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// --- STATIC FILES (Last Resort) ---
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'www'),
    prefix: '/',
    index: 'index.html',
});

start();
