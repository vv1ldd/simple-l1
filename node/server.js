const path = require('path');
const fs = require('fs');
const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const crypto = require('crypto');

const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
const GENESIS_FILE = path.join(__dirname, 'genesis.json');
let ledger = {
    accounts: {},      // Derived state (View)
    event_log: [],     // Primary Source of Truth (Signed Transitions)
    pending_settlements: [],
    cluster_genesis: null, // Network Birthday
    treasury: { btc_deposits: {} }
};

// --- REPLAY ENGINE (The Heart of the Node) ---
function applyEvent(event, isInitialReplay = false) {
    console.log(`[REPLAY] Processing event: ${event.type} (${event.id})`);
    
    // Set network birthday if not set
    if (!ledger.cluster_genesis && event.timestamp) {
        ledger.cluster_genesis = event.timestamp;
    }
    
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
        ledger.state_root = calculateStateRoot(); // New: Deterministic State Proof
        saveLedger();
    }
}

function calculateStateRoot() {
    // Canonical serialization (MUST MATCH PHP MDK implementation)
    const sortedAddresses = Object.keys(ledger.accounts).sort();
    let stateString = "";
    for (const addr of sortedAddresses) {
        const acc = ledger.accounts[addr];
        stateString += addr + ":" + (acc.balances.SL1 || 0) + ":" + (acc.nonce || 0) + "|";
    }
    return crypto.createHash('sha256').update(stateString).digest('hex');
}

async function start() {
    // 1. Initial Load from persistence
    if (fs.existsSync(LEDGER_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
            ledger.event_log = data.event_log || [];
        } catch (e) { console.error('[BOOT] Failed to parse ledger_db.json'); }
    }

    // 2. Inject Genesis Block if empty
    if (ledger.event_log.length === 0 && fs.existsSync(GENESIS_FILE)) {
        try {
            const genesisEvent = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
            console.log('[BOOT] Injecting Genesis Block 0...');
            ledger.event_log.push(genesisEvent);
        } catch (e) { console.error('[BOOT] Failed to load genesis.json'); }
    }

    // 3. Replay History
    console.log(`[BOOT] Replaying ${ledger.event_log.length} events...`);
    const history = [...ledger.event_log];
    ledger.event_log = []; 
    ledger.accounts = {};
    history.forEach(ev => applyEvent(ev, true));
    ledger.state_root = calculateStateRoot(); // Initial root after replay

    // 4. Start HTTP Server
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        console.log(`[DAOS] ${NODE_NAME} is active on port ${process.env.PORT || 3000}`);
        
        // 5. Automated Discovery
        discoverPeers();
        setInterval(discoverPeers, 60000); // Refresh every minute
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
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

const IDENTITY_FILE = path.join(__dirname, 'node_identity.json');
let NODE_NAME = process.env.NODE_NAME;

// 1. Load or Define Identity
if (fs.existsSync(IDENTITY_FILE)) {
    try {
        const idData = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
        NODE_NAME = idData.name;
        NODE_ID = idData.id || NODE_ID;
    } catch (e) {}
}
if (!NODE_NAME) NODE_NAME = process.env.NODE_NAME || 'node-pending';

// Regional Compliance & Branding
const NETWORK_NAME = process.env.NETWORK_NAME || "Simple-L1 Alpha";
const NODE_TYPE_LABEL = process.env.NODE_TYPE_LABEL || "Sovereign Node";

const GREEK_ALPHABET = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];
const SEED_NODES = [
    'https://l1.wildflow.dev',
    'https://l1-beta.wildflow.dev',
    'https://l1-gamma.wildflow.dev'
];

// Node Metadata & Capabilities
const NODE_VERSION = "0.2.0-alpha.1";
const NODE_CAPABILITIES = ["REPLAY", "GOSSIP", "VALIDATOR", "GATEWAY"];
let NODE_ID = crypto.randomBytes(16).toString('hex');

let PEERS = [...new Set([...(process.env.PEERS || '').split(','), ...SEED_NODES])].filter(Boolean);

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

// Node Status (Enhanced for Observability & Registry)
fastify.get('/api/status', async (request, reply) => {
    const handles = Object.values(ledger.accounts).map(a => a.handle).filter(Boolean);
    const network_uptime = ledger.cluster_genesis 
        ? Math.floor((Date.now() - new Date(ledger.cluster_genesis).getTime()) / 1000)
        : process.uptime();

    return {
        network: NETWORK_NAME,
        node_type: NODE_TYPE_LABEL,
        node_id: NODE_ID,
        node_name: NODE_NAME,
        version: NODE_VERSION,
        state_root: ledger.state_root || "genesis", // The Proof of Correctness
        capabilities: NODE_CAPABILITIES,
        peers_count: PEERS.length,
        peers: PEERS, // In production, we might want to truncate this
        total_accounts: Object.keys(ledger.accounts).length,
        total_events: ledger.event_log.length,
        active_handles: handles,
        uptime: network_uptime,
        status: "OPERATIONAL"
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

// Peer Announcement Receiver (For Dynamic Discovery)
fastify.post('/api/network/announce', async (request, reply) => {
    const { url } = request.body;
    if (!url) return reply.code(400).send({ error: 'URL required' });
    
    const cleanUrl = url.replace(/\/$/, '');
    if (!PEERS.includes(cleanUrl) && cleanUrl !== process.env.SELF_WEBHOOK) {
        console.log(`[PEX] New peer announced: ${cleanUrl}`);
        PEERS.push(cleanUrl);
        PEERS = [...new Set(PEERS)]; // Keep unique
    }
    return { success: true, known_peers: PEERS };
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
// (Already handled in the main start() function above)

// --- STATIC FILES (Last Resort) ---
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, 'www'),
    prefix: '/',
    index: 'index.html',
});

// Peer Exchange (PEX)
fastify.get('/api/network/peers', async () => {
    return {
        node: NODE_NAME,
        peers: PEERS.join(',') 
    };
});

// Deployment Info (for Relay)
fastify.get('/api/network/deploy-info', async () => {
    return {
        node: NODE_NAME,
        webhook: process.env.SELF_WEBHOOK || null
    };
});

// Self-Announce to Seeds
async function announceSelf() {
    const selfUrl = process.env.SELF_WEBHOOK;
    if (!selfUrl) return;

    console.log(`[PEX] Announcing self (${selfUrl}) to seeds...`);
    for (const seed of SEED_NODES) {
        if (selfUrl.includes(seed)) continue; // Don't announce to self
        try {
            await fetch(`${seed.replace(/\/$/, '')}/api/network/announce`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: selfUrl })
            });
        } catch (e) {}
    }
}

// Startup: Peer Discovery
async function discoverPeers() {
    await announceSelf();
    const initialPeers = [...PEERS];
    const discoveredNames = [];

    for (const peer of initialPeers) {
        try {
            console.log(`[PEX] Discovering peers from ${peer}...`);
            const res = await fetch(`${peer.replace(/\/$/, '')}/api/network/peers`);
            if (res.ok) {
                const data = await res.json();
                if (data.node) discoveredNames.push(data.node);
                
                const neighbors = (data.peers || '').split(',').filter(Boolean);
                const newPeers = neighbors.filter(p => p && !PEERS.includes(p));
                
                if (newPeers.length > 0) {
                    PEERS = [...new Set([...PEERS, ...newPeers])].filter(Boolean);
                    console.log(`[PEX] Discovered new neighbors: ${newPeers.join(', ')}`);
                }
            }
        } catch (e) {}
    }

    // Dynamic Naming Logic
    if (NODE_NAME === 'node-pending') {
        const nextLetter = GREEK_ALPHABET.find(letter => !discoveredNames.includes(`node-${letter}`));
        NODE_NAME = `node-${nextLetter || 'omega'}`;
        console.log(`[IDENTITY] Adopted name: ${NODE_NAME} (ID: ${NODE_ID})`);
        fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ name: NODE_NAME, id: NODE_ID }));
    }
}

start();
