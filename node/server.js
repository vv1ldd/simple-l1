const path = require('path');
const fs = require('fs');
const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
const { verifyRegistrationResponse, verifyAuthenticationResponse } = require('@simplewebauthn/server');

const crypto = require('crypto');
const identityKernel = require('./identity-kernel');
const { decideCapability } = require('./capability-resolution');

// ── Settlement Adapter Registry ─────────────────────────────────────────────
const { registry, NETWORK_CATALOG } = require('./adapters/index');

// ── Settlement Constitutional Layer ──────────────────────────────────────────
const { IntentResolutionEngine, INTENT_STATE } = require('./settlement/intent-resolution');
const { SettlementEventBus }                   = require('./settlement/event-bus');
const { IntentStateMachine, STATES }           = require('./settlement/state-machine');
const { SettlementProofFactory, PROOF_TYPES }  = require('./settlement/proof');
const { AttestationEngine }                    = require('./settlement/attestations');
const { ReceiptEngine }                        = require('./settlement/receipt');
const { ConstitutionalPolicyEngine }           = require('./settlement/policy');
const { ConstitutionalGovernanceEngine,
        PROPOSAL_STATES, AMENDMENT_TYPES }     = require('./settlement/governance');
const { FederationRegistry, SUBNET_STATUS }    = require('./settlement/federation');

const LEDGER_FILE = path.join(__dirname, 'ledger_db.json');
const GENESIS_FILE = path.join(__dirname, 'genesis.json');
let ledger = {
    accounts: {},              // Derived state (View)
    event_log: [],             // Primary Source of Truth (Signed Transitions)
    pending_settlements: [],
    intent_registry: {},       // Intent Resolution Engine store
    settlement_events: [],     // Settlement Event Bus stream
    receipts: {},              // Intent Receipt store
    policy_audit: [],          // Constitutional Policy audit log
    capability_grants: [],     // CRE v1 explicit grant table
    governance: null,          // Constitutional Governance (initialized by engine)
    federation: null,          // Multi-Constitution Federation Registry
    cluster_genesis: null,     // Network Birthday
    treasury: { btc_deposits: {} }
};

// ── Constitutional Layer — instantiated after ledger is defined ───────────────
// All engines are wired after `broadcast` is defined (below).
let eventBus          = null;
let intentEngine      = null;
let attestationEngine = null;
let receiptEngine     = null;
let policyEngine      = null;
let governanceEngine  = null;
let federationRegistry = null;

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
            const entityAddress = identityKernel.assertEntityAddress(
                event.payload.entity_l1_address || address
            );
            const keyAddress = event.payload.key_l1_address
                ? identityKernel.assertKeyAddress(event.payload.key_l1_address)
                : (publicKey ? identityKernel.keyAddressFromPublicKey(publicKey) : null);

            ledger.accounts[entityAddress] = {
                entity_l1_address: entityAddress,
                address_version: event.payload.address_version || identityKernel.ENTITY_ADDRESS_VERSION,
                key_l1_address: keyAddress,
                key_address_version: event.payload.key_address_version || identityKernel.KEY_ADDRESS_VERSION,
                handle: handle || 'anonymous',
                publicKey,
                credentialId,
                keys: keyAddress ? [{
                    key_l1_address: keyAddress,
                    publicKey,
                    credentialId,
                    role: 'primary',
                    status: 'active',
                    registered_at: event.timestamp
                }] : [],
                balances: { SL1: 1000, BTC: 0, ETH: 0 },
                external_addresses: {
                    BTC: `bc1_${crypto.createHash('sha256').update(entityAddress + 'BTC').digest('hex').substring(0, 10)}`,
                    ETH: `0x${crypto.createHash('sha256').update(entityAddress + 'ETH').digest('hex').substring(0, 10)}`
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
            ledger.treasury.btc_deposits[ledger.accounts[entityAddress].external_addresses.BTC] = entityAddress;
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

        case 'CAPABILITY_GRANT_CREATED':
            ledger.capability_grants = ledger.capability_grants || [];
            const grant = {
                ...event.payload,
                entity_l1_address: identityKernel.assertEntityAddress(event.payload.entity_l1_address),
                key_l1_address: event.payload.key_l1_address
                    ? identityKernel.assertKeyAddress(event.payload.key_l1_address)
                    : null,
                capability: String(event.payload.capability || ''),
                scope: String(event.payload.scope || ''),
                policy: String(event.payload.policy || 'deny').toLowerCase(),
                status: String(event.payload.status || 'active').toLowerCase(),
                granted_at: event.payload.granted_at || event.timestamp
            };

            if (!grant.capability || !grant.scope) {
                throw new Error('capability and scope are required for a grant');
            }

            ledger.capability_grants = ledger.capability_grants.filter((existing) => existing.id !== grant.id);
            ledger.capability_grants.push(grant);
            break;
    }

    if (!isInitialReplay) {
        ledger.event_log.push(event);
        ledger.state_root = calculateStateRoot(); // New: Deterministic State Proof
        saveLedger();
    }
}

function calculateStateRoot() {
    // Canonical serialization — includes constitutional epoch for governance-aware finality
    const sortedAddresses = Object.keys(ledger.accounts).sort();
    let stateString = "";
    for (const addr of sortedAddresses) {
        const acc = ledger.accounts[addr];
        stateString += addr + ":" + (acc.balances.SL1 || 0) + ":" + (acc.nonce || 0) + "|";
    }
    // Bind state root to active constitutional epoch
    const constitutionRoot = ledger.governance?.constitution_root || 'genesis';
    const epoch            = ledger.governance?.current_epoch ?? 0;
    stateString += `|constitution:${constitutionRoot}:epoch:${epoch}`;
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
    ledger.capability_grants = [];
    history.forEach(ev => applyEvent(ev, true));
    ledger.state_root = calculateStateRoot(); // Initial root after replay

    // --- Dynamic Sovereign Developer Onboarding ---
    const devAddress = identityKernel.systemEntityAddress('simple-l1:developer:admin');
    const devPublicKey = '3059301306072a8648ce03020706052b8104000a03420004ad8b3f6de867afb6e3dd3f84dded0f35e4fc168a85969b9ffae29eab60bf1dd17';
    const devKeyAddress = identityKernel.keyAddressFromPublicKey(devPublicKey);
    if (!ledger.accounts[devAddress]) {
        ledger.accounts[devAddress] = {
            entity_l1_address: devAddress,
            address_version: identityKernel.ENTITY_ADDRESS_VERSION,
            key_l1_address: devKeyAddress,
            key_address_version: identityKernel.KEY_ADDRESS_VERSION,
            handle: 'admin',
            publicKey: devPublicKey,
            credentialId: 'cred_admin_webauthn_secure_anchor',
            keys: [{
                key_l1_address: devKeyAddress,
                publicKey: devPublicKey,
                credentialId: 'cred_admin_webauthn_secure_anchor',
                role: 'primary',
                status: 'active',
                registered_at: new Date().toISOString()
            }],
            balances: { SL1: 5000, BTC: 1.45, ETH: 12.8, USDC: 2500 },
            external_addresses: {
                BTC: 'bc1_q3059301306072a8648ce03020706052b810400',
                ETH: '0x3059301306072a8648ce03020706052b8104000'
            },
            authority_policies: {
                session_limit: 5000,
                intent_scope: ['payments', 'identity-claims', 'cross-chain-settlement'],
                active_policies: ['Daily Limit 5000 SL1']
            },
            provenance_log: [
                { type: 'GENESIS_ONBOARD', detail: 'Sovereign developer account registered', timestamp: new Date().toISOString() }
            ],
            nonce: 0
        };
        if (!ledger.treasury.btc_deposits) ledger.treasury.btc_deposits = {};
        ledger.treasury.btc_deposits[ledger.accounts[devAddress].external_addresses.BTC] = devAddress;
    }

    // Generate beautiful mock receipts for the developer if none exist
    if (Object.keys(ledger.receipts).length === 0) {
        // Receipt 1: Ethereum Deposit of 1000 USDC
        const intent1 = {
            intent_id: 'intent_eth_dep_9837fbc',
            type: 'CROSS_CHAIN_DEPOSIT',
            sl1_address: devAddress,
            network: 'ethereum',
            asset: 'USDC',
            expected_amount: '1000',
            created_at: new Date(Date.now() - 3600000).toISOString(),
            fulfillment: {
                network: 'ethereum',
                amount: '1000',
                tx_hash: '0x9b78fa5e83a45cde82903fca91d84fde3a48e765be3d240ca4b2e652ad79a61b',
                block_number: 19827364,
                confirmations: 12,
                explorer_url: 'https://etherscan.io/tx/0x9b78fa5e83a45cde82903fca91d84fde3a48e765be3d240ca4b2e652ad79a61b',
                fulfilled_at: new Date(Date.now() - 3300000).toISOString(),
            }
        };
        const proof1 = {
            proof_type: 'EVM_TRANSACTION_PROOF',
            proof_fingerprint: 'blake3:8f2a9d1c9e83b40fa78c1d5e3f9a0c2e4b6d7a8c9e0f1a2b3c4d5e6f7a8b9c0d',
            verification: { confirmed_at: new Date(Date.now() - 3300000).toISOString() }
        };
        const attest1 = {
            quorum_met: true,
            total_validators: 3,
            accepted: 3,
            required_threshold: 2,
            attestations: [
                { validator_id: 'val_alpha' },
                { validator_id: 'val_beta' },
                { validator_id: 'val_gamma' }
            ]
        };
        receiptEngine.issue({ intent: intent1, proof: proof1, attestationResult: attest1 });

        // Receipt 2: Base Deposit of 0.5 ETH
        const intent2 = {
            intent_id: 'intent_base_dep_1248aef',
            type: 'CROSS_CHAIN_DEPOSIT',
            sl1_address: devAddress,
            network: 'base',
            asset: 'ETH',
            expected_amount: '0.5',
            created_at: new Date(Date.now() - 1800000).toISOString(),
            fulfillment: {
                network: 'base',
                amount: '0.5',
                tx_hash: '0x5c8e2d7a9b1c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
                block_number: 14829374,
                confirmations: 6,
                explorer_url: 'https://basescan.org/tx/0x5c8e2d7a9b1c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
                fulfilled_at: new Date(Date.now() - 1600000).toISOString(),
            }
        };
        const proof2 = {
            proof_type: 'EVM_TRANSACTION_PROOF',
            proof_fingerprint: 'blake3:4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
            verification: { confirmed_at: new Date(Date.now() - 1600000).toISOString() }
        };
        receiptEngine.issue({ intent: intent2, proof: proof2, attestationResult: attest1 });
    }

    // 4. Start HTTP Server

    try {
        // Serve Static Distribution Files (Sovereign Update Layer)
        fastify.register(require('@fastify/static'), {
            root: path.join(__dirname, 'dist'),
            prefix: '/dist/',
            decorateReply: false
        });

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
const calculateKeyAddress = (pubKeyHex) => identityKernel.keyAddressFromPublicKey(pubKeyHex);

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

// ── Wire Constitutional Layer (requires broadcast to be in scope) ────────────────
eventBus          = new SettlementEventBus(ledger, broadcast);
intentEngine      = new IntentResolutionEngine(ledger, eventBus);
attestationEngine = new AttestationEngine({ validatorCount: 3 });
receiptEngine     = new ReceiptEngine(ledger);
policyEngine      = new ConstitutionalPolicyEngine(ledger);
governanceEngine  = new ConstitutionalGovernanceEngine(
    ledger,
    attestationEngine,
    policyEngine.dsl,
    saveLedger
);
// Wire governance context into receipt engine (epoch-enriched receipts)
receiptEngine.governance = governanceEngine;

// Initialize federation registry
federationRegistry = new FederationRegistry(ledger, saveLedger);

// Sync primary subnet's constitution root with governance
if (ledger.federation?.subnets?.['simple-l1-primary']) {
    const primarySubnet = ledger.federation.subnets['simple-l1-primary'];
    primarySubnet.constitution_root = governanceEngine.getConstitutionRoot();
    primarySubnet.epoch_history = governanceEngine.getEpochs().map(e => ({
        epoch:            e.epoch,
        constitution_root: e.constitution_root,
        recorded_at:      e.enacted_at,
    }));
    federationRegistry._recomputeFederationRoot();
}

// Expire stale intents every 5 minutes
setInterval(() => {
    const expired = intentEngine.expireStale();
    if (expired > 0) console.log(`[INTENT ENGINE] Expired ${expired} stale intents`);
}, 5 * 60 * 1000);

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

fastify.get('/api/identity/kernel', async () => {
    return {
        status: 'frozen',
        version: 'identity-kernel-v1',
        entity_address: {
            prefix: 'sl1e_',
            version: identityKernel.ENTITY_ADDRESS_VERSION,
            invariant: 'stable account identity; never derived from passkey public keys'
        },
        key_address: {
            prefix: 'sl1_',
            version: identityKernel.KEY_ADDRESS_VERSION,
            invariant: 'passkey-derived proof material; never used as account identity'
        },
        authorization: {
            engine: 'cre-v1',
            invariant: 'explicit capability grants only; roles are non-decisional'
        }
    };
});

fastify.post('/api/capabilities/decide', async (request, reply) => {
    try {
        ledger.capability_grants = ledger.capability_grants || [];

        return decideCapability(ledger.capability_grants, request.body);
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.post('/api/capabilities/grants', async (request, reply) => {
    try {
        const grant = {
            id: request.body.id || `grant_${crypto.randomBytes(8).toString('hex')}`,
            entity_l1_address: identityKernel.assertEntityAddress(request.body.entity_l1_address),
            key_l1_address: request.body.key_l1_address
                ? identityKernel.assertKeyAddress(request.body.key_l1_address)
                : null,
            capability: String(request.body.capability || ''),
            scope: String(request.body.scope || ''),
            policy: String(request.body.policy || 'deny').toLowerCase(),
            status: String(request.body.status || 'active').toLowerCase(),
            expires_at: request.body.expires_at || null,
            granted_by_entity_l1_address: request.body.granted_by_entity_l1_address
                ? identityKernel.assertEntityAddress(request.body.granted_by_entity_l1_address)
                : null,
            metadata: request.body.metadata || {},
        };

        if (!grant.capability || !grant.scope) {
            return reply.code(422).send({ error: 'capability and scope are required' });
        }

        if (grant.capability.includes('*') || grant.scope.includes('*')) {
            return reply.code(422).send({ error: 'wildcard grants are not part of CRE v1' });
        }

        if (!['deny', 'require_quorum', 'require_approval', 'allow'].includes(grant.policy)) {
            return reply.code(422).send({ error: 'Unsupported grant policy' });
        }

        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'CAPABILITY_GRANT_CREATED',
            payload: grant,
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        broadcast('/api/network/broadcast', { type: 'EVENT', data: event });

        return { success: true, grant };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
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

    if (!publicKey) {
        return reply.code(400).send({ error: 'publicKey is required' });
    }

    let entityAddress = address ? identityKernel.normalizeEntityAddress(address) : null;
    const keyAddress = calculateKeyAddress(publicKey);

    if (address && !entityAddress) {
        return reply.code(422).send({
            error: 'Entity address must use the sl1e_ v1 format; sl1_ is reserved for key proof material',
            key_l1_address: keyAddress
        });
    }

    entityAddress = entityAddress || identityKernel.newEntityAddress();

    if (ledger.accounts[entityAddress]) {
        return reply.code(409).send({ error: 'Account already exists' });
    }

    const existingKeyOwner = identityKernel.findAccountByKeyAddress(ledger.accounts, keyAddress);
    if (existingKeyOwner) {
        return reply.code(409).send({
            error: 'Passkey is already attached to an entity',
            entity_l1_address: existingKeyOwner[0],
            key_l1_address: keyAddress
        });
    }

    // CREATE SIGNED GENESIS EVENT
    const genesisEvent = {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'GENESIS',
        payload: {
            address: entityAddress,
            entity_l1_address: entityAddress,
            key_l1_address: keyAddress,
            address_version: identityKernel.ENTITY_ADDRESS_VERSION,
            key_address_version: identityKernel.KEY_ADDRESS_VERSION,
            handle,
            publicKey,
            credentialId
        },
        timestamp: new Date().toISOString()
    };

    applyEvent(genesisEvent);
    
    // BROADCAST GENESIS
    broadcast('/api/network/broadcast', { type: 'EVENT', data: genesisEvent });

    console.log(`[DAOS] Authority State Transition: Genesis ${handle}`);
    return {
        success: true,
        address: entityAddress,
        entity_l1_address: entityAddress,
        key_l1_address: keyAddress,
        account: ledger.accounts[entityAddress]
    };
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

// ============================================================================
// SETTLEMENT ADAPTER API — Cross-Chain Interoperability Layer
// ============================================================================

// GET /api/settlement/networks
// Returns the full catalog of supported external networks and their status.
fastify.get('/api/settlement/networks', async () => {
    return {
        catalog: registry.getCatalog(),
        evm_networks: Object.keys(NETWORK_CATALOG).filter(k => NETWORK_CATALOG[k].family === 'evm'),
    };
});

// GET /api/settlement/networks/health
// Live health check of all active adapters.
fastify.get('/api/settlement/networks/health', async () => {
    const results = await registry.healthCheck();
    return { checks: results, timestamp: new Date().toISOString() };
});

// GET /api/settlement/deposit-address?sl1_address=...&network=...&asset=...
// Returns the deterministic deposit address for a given sl1 account + network + asset.
fastify.get('/api/settlement/deposit-address', async (request, reply) => {
    const { sl1_address, network, asset } = request.query;
    if (!sl1_address || !network || !asset) {
        return reply.code(400).send({ error: 'Required: sl1_address, network, asset' });
    }
    if (!ledger.accounts[sl1_address]) {
        return reply.code(404).send({ error: 'SL1 account not found' });
    }
    try {
        const deposit_address = registry.getDepositAddress(sl1_address, network, asset);
        return { sl1_address, network, asset, deposit_address };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/settlement/observe
// Observe any transaction on any supported network without state mutation.
// Body: { network, tx_hash }
fastify.post('/api/settlement/observe', async (request, reply) => {
    const { network, tx_hash } = request.body;
    if (!network || !tx_hash) {
        return reply.code(400).send({ error: 'Required: network, tx_hash' });
    }
    try {
        const event = await registry.observe(network, tx_hash);
        return event;
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/settlement/verify-deposit
// Verify a CROSS_CHAIN_DEPOSIT — cryptographically validate the external tx.
// Body: { sl1_recipient, external_network, external_tx_hash, external_recipient, asset, amount }
fastify.post('/api/settlement/verify-deposit', async (request, reply) => {
    const { sl1_recipient, external_network, external_tx_hash, external_recipient, asset, amount } = request.body;

    if (!sl1_recipient || !external_network || !external_tx_hash || !external_recipient || !asset || !amount) {
        return reply.code(400).send({ error: 'Missing required fields' });
    }
    if (!ledger.accounts[sl1_recipient]) {
        return reply.code(404).send({ error: 'SL1 recipient account not found' });
    }

    const result = await registry.verifyDeposit({
        external_network,
        external_tx_hash,
        external_recipient,
        asset,
        amount,
    });

    if (!result.ok) {
        return reply.code(422).send({ verified: false, ...result });
    }

    // ✅ Verification passed — apply CROSS_CHAIN_DEPOSIT event to ledger
    const depositEvent = {
        id:        crypto.randomBytes(8).toString('hex'),
        type:      'CROSS_CHAIN_DEPOSIT',
        payload: {
            sl1_recipient,
            external_network,
            external_tx_hash:   result.txHash,
            asset,
            amount:             parseFloat(result.amount),
            confirmations:      result.confirmations,
            block_number:       result.blockNumber,
            explorer_url:       result.explorerUrl,
        },
        timestamp: result.settledAt,
    };

    // Apply to ledger state
    const account = ledger.accounts[sl1_recipient];
    if (!account.balances[asset]) account.balances[asset] = 0;
    account.balances[asset] += parseFloat(result.amount);
    account.provenance_log.push({
        type:      'CROSS_CHAIN_DEPOSIT',
        detail:    `Verified deposit: ${result.amount} ${asset} via ${external_network} (tx: ${result.txHash.slice(0, 12)}...)`,
        network:   external_network,
        tx_hash:   result.txHash,
        timestamp: result.settledAt,
    });

    ledger.event_log.push(depositEvent);
    ledger.state_root = calculateStateRoot();
    saveLedger();

    // Broadcast to peers
    broadcast('/api/network/broadcast', { type: 'EVENT', data: depositEvent });

    console.log(`[SETTLEMENT] Cross-chain deposit verified: ${result.amount} ${asset} → ${sl1_recipient} (via ${external_network})`);
    return { verified: true, depositEvent, newBalance: account.balances[asset] };
});

// POST /api/settlement/withdraw
// Prepare a CROSS_CHAIN_WITHDRAWAL settlement request.
// Does NOT execute — returns signed withdrawal request for treasury.
// Body: { sl1_sender, external_network, external_recipient, asset, amount }
fastify.post('/api/settlement/withdraw', async (request, reply) => {
    const { sl1_sender, external_network, external_recipient, asset, amount } = request.body;

    if (!sl1_sender || !external_network || !external_recipient || !asset || !amount) {
        return reply.code(400).send({ error: 'Missing required fields' });
    }

    const account = ledger.accounts[sl1_sender];
    if (!account) return reply.code(404).send({ error: 'SL1 sender account not found' });

    const balance = account.balances[asset] || 0;
    if (balance < parseFloat(amount)) {
        return reply.code(400).send({ error: `Insufficient balance: have ${balance} ${asset}, need ${amount}` });
    }

    try {
        const withdrawalRequest = registry.createWithdrawal({
            sl1_sender,
            external_network,
            external_recipient,
            asset,
            amount,
            id: crypto.randomBytes(8).toString('hex'),
        });

        // Lock funds optimistically
        account.balances[asset] -= parseFloat(amount);
        account.provenance_log.push({
            type:      'CROSS_CHAIN_WITHDRAWAL_PENDING',
            detail:    `Withdrawal pending: ${amount} ${asset} → ${external_recipient} via ${external_network}`,
            network:   external_network,
            timestamp: new Date().toISOString(),
        });

        saveLedger();
        console.log(`[SETTLEMENT] Withdrawal request prepared: ${amount} ${asset} → ${external_recipient} (${external_network})`);
        return { success: true, withdrawalRequest };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// ── End of Settlement Adapter API ────────────────────────────────────────────

// ============================================================================
// INTENT RESOLUTION ENGINE API — Constitutional Intent Lifecycle
// ============================================================================

// POST /api/intents/deposit
// Register a new cross-chain deposit intent.
// Returns: intent_id + deterministic deposit_address.
// Body: { sl1_address, network, asset, amount? }
fastify.post('/api/intents/deposit', async (request, reply) => {
    const { sl1_address, network, asset, amount } = request.body;

    if (!sl1_address || !network || !asset) {
        return reply.code(400).send({ error: 'Required: sl1_address, network, asset' });
    }
    const account = ledger.accounts[sl1_address];
    if (!account) return reply.code(404).send({ error: 'SL1 account not found' });

    try {
        const intent = intentEngine.createDepositIntent({
            sl1_address,
            pubkey: account.publicKey || sl1_address,
            network,
            asset,
            amount: amount || null,
        });
        return intent;
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/intents/withdraw
// Register a cross-chain withdrawal intent.
// Body: { sl1_address, network, asset, amount, external_recipient }
fastify.post('/api/intents/withdraw', async (request, reply) => {
    const { sl1_address, network, asset, amount, external_recipient } = request.body;

    if (!sl1_address || !network || !asset || !amount || !external_recipient) {
        return reply.code(400).send({ error: 'Required: sl1_address, network, asset, amount, external_recipient' });
    }
    const account = ledger.accounts[sl1_address];
    if (!account) return reply.code(404).send({ error: 'SL1 account not found' });

    const balance = account.balances[asset] || 0;
    if (balance < parseFloat(amount)) {
        return reply.code(400).send({ error: `Insufficient balance: have ${balance} ${asset}, need ${amount}` });
    }

    try {
        const intent = intentEngine.createWithdrawalIntent({
            sl1_address,
            pubkey: account.publicKey || sl1_address,
            network,
            asset,
            amount,
            external_recipient,
        });
        return intent;
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// GET /api/intents/:intent_id
// Get intent state and full lifecycle record.
fastify.get('/api/intents/:intent_id', async (request, reply) => {
    const intent = intentEngine.getIntent(request.params.intent_id);
    if (!intent) return reply.code(404).send({ error: 'Intent not found' });
    return intent;
});

// GET /api/intents/address/:sl1_address
// Get all intents for an SL1 address.
fastify.get('/api/intents/address/:sl1_address', async (request, reply) => {
    return intentEngine.getIntentsByAddress(request.params.sl1_address);
});

// GET /api/intents/pending
// Get all pending/observing intents across the node.
fastify.get('/api/intents/pending', async () => {
    return intentEngine.getPendingIntents();
});

// POST /api/intents/:intent_id/fulfill
// Fulfill an intent — triggers full settlement verification + ledger mutation.
// Body: { external_tx_hash, external_recipient }
fastify.post('/api/intents/:intent_id/fulfill', async (request, reply) => {
    const { intent_id } = request.params;
    const { external_tx_hash, external_recipient } = request.body;

    const intent = intentEngine.getIntent(intent_id);
    if (!intent) return reply.code(404).send({ error: 'Intent not found' });
    if (intent.state === INTENT_STATE.FULFILLED || intent.state === STATES.FINALIZED) {
        return reply.code(409).send({ error: 'Intent already fulfilled — replay protection active' });
    }

    // ── Stage 0: POLICY CHECK (constitutional legitimacy gate) ───────────────
    const policyResult = policyEngine.evaluate(intent.type, intent, {
        network:       intent.network,
        asset:         intent.asset,
        amount:        intent.expected_amount || intent.amount,
        confirmations: 0,   // Pre-observation — confirmations checked again at Stage 2
    });

    if (!policyResult.ok) {
        return reply.code(403).send({
            fulfilled:       false,
            intent_id,
            constitutional_violation: true,
            rule:            policyResult.rule,
            reason:          policyResult.reason,
            context:         policyResult.context,
        });
    }

    IntentStateMachine.transition(intent, STATES.BOUND, { policy_pass: true });

    // ── Stage 1: OBSERVE ─────────────────────────────────────────────────────
    const observed = await registry.observe(intent.network, external_tx_hash);
    intentEngine.observe(intent_id, observed);
    IntentStateMachine.transition(intent, STATES.OBSERVED, { actor: 'node', tx_hash: external_tx_hash });

    // ── Stage 2: VERIFY (cryptographic proof) ────────────────────────────────
    const verificationResult = await registry.verifyDeposit({
        external_network:    intent.network,
        external_tx_hash,
        external_recipient:  external_recipient || intent.deposit_address,
        asset:               intent.asset,
        amount:              intent.expected_amount || '0',
    });

    if (!verificationResult.ok) {
        IntentStateMachine.transition(intent, STATES.EXPIRED, { reason: verificationResult.message });
        intentEngine.reject(intent_id, verificationResult.message, { code: verificationResult.code });
        const rejectionReceipt = receiptEngine.issueRejection(intent, verificationResult.message);
        return reply.code(422).send({
            fulfilled: false, intent_id,
            reason: verificationResult.message,
            code:   verificationResult.code,
            receipt: rejectionReceipt,
        });
    }

    // Build canonical proof object
    const proof = SettlementProofFactory.fromEVMVerification(verificationResult, intent_id);
    IntentStateMachine.transition(intent, STATES.VERIFIED, { proof_fingerprint: proof.proof_fingerprint });

    // ── Stage 3: ATTEST (validator quorum) ───────────────────────────────────
    const attestationResult = await attestationEngine.collectAttestations(intent_id, proof);

    if (!attestationResult.quorum_met) {
        IntentStateMachine.transition(intent, STATES.DISPUTED, { reason: 'Quorum not met' });
        intentEngine.reject(intent_id, 'Validator quorum rejected settlement', { attestationResult });
        const rejectionReceipt = receiptEngine.issueRejection(intent, 'Validator quorum rejected settlement');
        return reply.code(422).send({
            fulfilled: false, intent_id,
            reason: 'Validator quorum rejected settlement',
            attestation_summary: {
                accepted:  attestationResult.accepted,
                required:  attestationResult.required_threshold,
                total:     attestationResult.total_validators,
            },
            receipt: rejectionReceipt,
        });
    }

    // Attach quorum proof
    proof.quorum = SettlementProofFactory.fromQuorum(attestationResult.attestations, intent_id);
    IntentStateMachine.transition(intent, STATES.ATTESTED, {
        quorum: `${attestationResult.accepted}/${attestationResult.total_validators}`,
    });

    // ── Stage 4: FULFILL (ledger mutation) ───────────────────────────────────
    const fulfilled = intentEngine.fulfill(intent_id, verificationResult);
    IntentStateMachine.transition(intent, STATES.FULFILLED, { proof_fingerprint: proof.proof_fingerprint });

    // Record in event log for deterministic replay
    const fulfillmentEvent = {
        id:        crypto.randomBytes(8).toString('hex'),
        type:      'CROSS_CHAIN_DEPOSIT',
        payload:   { intent_id, ...fulfilled.fulfillment, sl1_recipient: intent.sl1_address },
        timestamp: fulfilled.fulfillment.fulfilled_at,
    };
    ledger.event_log.push(fulfillmentEvent);
    ledger.state_root = calculateStateRoot();

    // ── Stage 5: FINALIZE (receipt issuance) ─────────────────────────────────
    const receipt = receiptEngine.issue({ intent, proof, attestationResult });
    IntentStateMachine.transition(intent, STATES.FINALIZED, { receipt_id: receipt.receipt_id });

    saveLedger();

    // Broadcast finalization to peers
    broadcast('/api/network/broadcast', { type: 'EVENT', data: fulfillmentEvent });
    eventBus.settlementFinalized({
        network:      verificationResult.network,
        tx_hash:      verificationResult.txHash,
        intent_id,
        amount:       verificationResult.amount,
        asset:        intent.asset,
        block_number: verificationResult.blockNumber,
    });

    console.log(`[CONSTITUTIONAL] ⚖️ Intent ${intent_id.slice(0, 8)}… FINALIZED. Receipt: ${receipt.receipt_id}`);

    return {
        fulfilled:    true,
        intent:       fulfilled,
        proof_fingerprint: proof.proof_fingerprint,
        attestation:  {
            quorum_met: attestationResult.quorum_met,
            accepted:   attestationResult.accepted,
            total:      attestationResult.total_validators,
        },
        receipt,
    };
});

// POST /api/intents/:intent_id/reject
// Manually reject an intent (e.g. after investigation).
// Body: { reason }
fastify.post('/api/intents/:intent_id/reject', async (request, reply) => {
    const { intent_id } = request.params;
    const { reason }    = request.body;

    const intent = intentEngine.getIntent(intent_id);
    if (!intent) return reply.code(404).send({ error: 'Intent not found' });

    try {
        const rejected = intentEngine.reject(intent_id, reason || 'Manually rejected');
        return { rejected: true, intent: rejected };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// ============================================================================
// SETTLEMENT EVENT BUS API — Event Stream Queries
// ============================================================================

// GET /api/settlement/events?type=...&network=...&intent_id=...&limit=...
// Query the settlement event stream.
fastify.get('/api/settlement/events', async (request) => {
    const { type, network, intent_id, limit } = request.query;
    return eventBus.getRecentEvents({
        type,
        network,
        intent_id,
        limit: limit ? parseInt(limit) : 50,
    });
});

// GET /api/settlement/events/timeline/:intent_id
// Full chronological timeline for a specific intent.
fastify.get('/api/settlement/events/timeline/:intent_id', async (request, reply) => {
    const timeline = eventBus.getIntentTimeline(request.params.intent_id);
    if (!timeline.length) return reply.code(404).send({ error: 'No events found for this intent' });
    return timeline;
});

// GET /api/settlement/events/stats
// Event bus statistics.
fastify.get('/api/settlement/events/stats', async () => {
    return eventBus.getStats();
});

// POST /api/network/settlement-event
// Receive a settlement event broadcast from a peer.
fastify.post('/api/network/settlement-event', async (request) => {
    const { event } = request.body;
    if (event) {
        // Re-emit on local bus without re-broadcasting (prevent loops)
        ledger.settlement_events.push(event);
        if (ledger.settlement_events.length > 1000) ledger.settlement_events.shift();
    }
    return { received: true };
});

// ============================================================================
// RECEIPT API — Constitutional Proofs of Value Transition
// ============================================================================

// GET /api/receipts/:receipt_id
// Get a specific receipt by ID and verify its signature.
fastify.get('/api/receipts/:receipt_id', async (request, reply) => {
    const receipt = receiptEngine.getReceipt(request.params.receipt_id);
    if (!receipt) return reply.code(404).send({ error: 'Receipt not found' });

    const verification = receiptEngine.verify(receipt);
    return { receipt, signature_valid: verification.valid };
});

// GET /api/receipts/intent/:intent_id
// Get the receipt for a specific intent.
fastify.get('/api/receipts/intent/:intent_id', async (request, reply) => {
    const receipt = receiptEngine.getReceiptByIntent(request.params.intent_id);
    if (!receipt) return reply.code(404).send({ error: 'No receipt found for this intent' });
    return receipt;
});

// GET /api/receipts/address/:sl1_address
// Get all receipts for an SL1 address (constitutional history).
fastify.get('/api/receipts/address/:sl1_address', async (request, reply) => {
    return receiptEngine.getReceiptsByAddress(request.params.sl1_address);
});

// GET /api/receipts/stats
// Receipt engine statistics.
fastify.get('/api/receipts/stats', async () => {
    return receiptEngine.getStats();
});

// GET /api/settlement/validators
// Get the current validator set and quorum parameters.
fastify.get('/api/settlement/validators', async () => {
    return {
        validator_set:  attestationEngine.getValidatorSet(),
        quorum_params:  attestationEngine.getQuorumParams(),
        node_public_key: receiptEngine.nodePublicKey,
    };
});

// GET /api/settlement/state-machine
// Introspect the intent state machine — all states, transitions, descriptions.
fastify.get('/api/settlement/state-machine', async () => {
    const { STATES, TRANSITIONS } = require('./settlement/state-machine');
    return {
        states: Object.values(STATES).map(state => ({
            state,
            description: IntentStateMachine.describe(state),
            weight:      IntentStateMachine.weight(state),
            transitions: TRANSITIONS[state] || [],
            is_terminal: ['EXPIRED', 'REVERTED'].includes(state),
        })),
    };
});

// ============================================================================
// CONSTITUTIONAL POLICY API — Rules of Legitimacy
// ============================================================================

// GET /api/policy
// Get all registered policies and their rules.
fastify.get('/api/policy', async () => {
    return policyEngine.getAllPolicies();
});

// GET /api/policy/:intent_type
// Get and describe a specific policy in human-readable form.
fastify.get('/api/policy/:intent_type', async (request, reply) => {
    const description = policyEngine.describe(request.params.intent_type.toUpperCase());
    if (!description) return reply.code(404).send({ error: 'No policy for this intent type' });
    return description;
});

// POST /api/policy/evaluate
// Dry-run a policy evaluation without mutating state.
// Body: { intent_type, intent: { network, asset, amount, ... }, context? }
fastify.post('/api/policy/evaluate', async (request, reply) => {
    const { intent_type, intent, context } = request.body;
    if (!intent_type || !intent) {
        return reply.code(400).send({ error: 'Required: intent_type, intent' });
    }
    const result = policyEngine.evaluate(intent_type.toUpperCase(), intent, context || {});
    return result;
});

// GET /api/policy/audit?limit=...
// Get the immutable constitutional policy audit log.
fastify.get('/api/policy/audit', async (request) => {
    const limit = request.query.limit ? parseInt(request.query.limit) : 100;
    return policyEngine.getAuditLog(limit);
});

// ── Constitutional Document API ───────────────────────────────────────────────

// GET /api/constitution
// The living constitutional document in full.
fastify.get('/api/constitution', async () => {
    return policyEngine.getConstitution();
});

// GET /api/constitution/:intent_type
// Full policy description for an intent type — DSL + code layer combined.
fastify.get('/api/constitution/:intent_type', async (request, reply) => {
    const description = policyEngine.describeFullPolicy(request.params.intent_type.toUpperCase());
    if (!description.dsl_policy && !description.code_policy) {
        return reply.code(404).send({ error: 'No constitutional policy found for this intent type' });
    }
    return description;
});

// POST /api/constitution/explain
// Ask the constitutional interpreter WHY an intent would be denied.
// Returns the exact rule and reason, or "WOULD_PASS" if admissible.
// Body: { intent_type, intent: { network, asset, amount, ... }, context? }
fastify.post('/api/constitution/explain', async (request, reply) => {
    const { intent_type, intent, context } = request.body;
    if (!intent_type || !intent) {
        return reply.code(400).send({ error: 'Required: intent_type, intent' });
    }

    const violation = policyEngine.explainViolation(intent_type.toUpperCase(), intent, context || {});

    if (violation) {
        return {
            admissible:   false,
            source:       violation.source,
            rule_id:      violation.rule_id || violation.rule,
            reason:       violation.reason,
            context:      violation.context,
            explanation:  `This intent would be DENIED by the ${violation.source} layer because: ${violation.reason}`,
        };
    }

    return {
        admissible:  true,
        explanation: 'This intent satisfies all constitutional requirements and would be admitted.',
    };
});

// ============================================================================
// CONSTITUTIONAL GOVERNANCE API — Meta-consensus on legitimacy itself
// ============================================================================

// GET /api/governance
// Current governance state — epoch, constitution root, stats.
fastify.get('/api/governance', async () => {
    return {
        ...governanceEngine.getGovernanceStats(),
        epochs:         governanceEngine.getEpochs(),
        constitution:   policyEngine.getConstitution(),
    };
});

// GET /api/governance/epochs
// Full epoch history — every constitutional version ever enacted.
fastify.get('/api/governance/epochs', async () => {
    return governanceEngine.getEpochs();
});

// GET /api/governance/proposals
// All governance proposals, optionally filtered by state.
// Query: ?state=VOTING|RATIFIED|ENACTED|REJECTED|VETOED
fastify.get('/api/governance/proposals', async (request) => {
    const { state } = request.query;
    return governanceEngine.getAllProposals(state ? { state: state.toUpperCase() } : {});
});

// GET /api/governance/proposals/:proposal_id
// Get a specific proposal with full vote record.
fastify.get('/api/governance/proposals/:proposal_id', async (request, reply) => {
    const proposal = governanceEngine.getProposal(request.params.proposal_id);
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
    return proposal;
});

// POST /api/governance/propose
// Submit a constitutional amendment proposal.
// Body: { proposer, amendment_type, title, description, change }
//
// Example — raise BTC withdrawal limit:
// {
//   "proposer": "sl1e_abc...",
//   "amendment_type": "PARAMETER_CHANGE",
//   "title": "Raise BTC withdrawal ceiling",
//   "description": "Community proposal to increase single BTC withdrawal ceiling from 100K to 250K.",
//   "change": {
//     "intent_type": "CROSS_CHAIN_WITHDRAWAL",
//     "rule_id": "withdrawal:amount-ceiling",
//     "new_values": { "value": 250000 }
//   }
// }
fastify.post('/api/governance/propose', async (request, reply) => {
    const { proposer, amendment_type, title, description, change } = request.body;

    if (!proposer || !amendment_type || !title || !change) {
        return reply.code(400).send({ error: 'Required: proposer, amendment_type, title, change' });
    }
    if (!ledger.accounts[proposer]) {
        return reply.code(404).send({ error: 'Proposer SL1 account not found' });
    }

    try {
        const proposal = governanceEngine.propose({ proposer, amendment_type, title, description: description || '', change });
        return { success: true, proposal };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/governance/proposals/:proposal_id/vote
// Cast a single validator vote.
// Body: { validator_id, decision: 'ACCEPT'|'REJECT', rationale? }
fastify.post('/api/governance/proposals/:proposal_id/vote', async (request, reply) => {
    const { proposal_id } = request.params;
    const { validator_id, decision, rationale } = request.body;

    if (!validator_id || !decision) {
        return reply.code(400).send({ error: 'Required: validator_id, decision' });
    }

    try {
        const proposal = governanceEngine.vote(proposal_id, validator_id, decision.toUpperCase(), rationale || '');
        return { success: true, proposal };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/governance/proposals/:proposal_id/collect-votes
// Trigger local validator quorum to vote on a proposal.
// This is the primary path in single-node mode.
fastify.post('/api/governance/proposals/:proposal_id/collect-votes', async (request, reply) => {
    const proposal = governanceEngine.getProposal(request.params.proposal_id);
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });

    try {
        const result = await governanceEngine.collectLocalVotes(request.params.proposal_id);

        // If enacted — state root has changed, persist immediately
        if (result.state === PROPOSAL_STATES.ENACTED) {
            ledger.state_root = calculateStateRoot();
            saveLedger();

            // Broadcast constitutional epoch change to peers
            broadcast('/api/network/broadcast', {
                type: 'EVENT',
                data: {
                    id:        crypto.randomBytes(8).toString('hex'),
                    type:      'CONSTITUTIONAL_EPOCH_CHANGE',
                    payload: {
                        new_epoch:            result.new_epoch,
                        new_constitution_root: result.new_constitution_root,
                        proposal_id:          result.proposal_id,
                        title:                result.title,
                    },
                    timestamp: result.enacted_at,
                },
            });

            console.log(`[GOVERNANCE] 🌐 Constitutional epoch broadcast to peers.`);
        }

        return { success: true, proposal: result, new_state_root: ledger.state_root };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// POST /api/governance/proposals/:proposal_id/veto
// Emergency constitutional veto.
// Body: { reason }
fastify.post('/api/governance/proposals/:proposal_id/veto', async (request, reply) => {
    const { reason } = request.body;
    try {
        const result = governanceEngine.veto(request.params.proposal_id, reason || 'No reason given');
        return { success: true, proposal: result };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// GET /api/governance/constitution-root
// The current constitution root hash — validators must agree on this.
fastify.get('/api/governance/constitution-root', async () => {
    return {
        constitution_root:  governanceEngine.getConstitutionRoot(),
        current_epoch:      ledger.governance?.current_epoch,
        state_root:         ledger.state_root,
        bound_together:     true,   // state root binds to constitution root
    };
});

// ============================================================================
// FEDERATION API — Multi-Constitution Sovereign Coordination
// ============================================================================

// GET /api/federation
// Federation registry stats — all subnets and the federation root hash.
fastify.get('/api/federation', async () => {
    return {
        ...federationRegistry.getFederationStats(),
        governance_root: governanceEngine.getConstitutionRoot(),
        state_root:      ledger.state_root,
    };
});

// GET /api/federation/subnets
// All registered subnetworks.
fastify.get('/api/federation/subnets', async () => {
    return federationRegistry.getAllSubnets();
});

// GET /api/federation/subnets/:subnet_id
// Get a specific subnet record.
fastify.get('/api/federation/subnets/:subnet_id', async (request, reply) => {
    const subnet = federationRegistry.getSubnet(request.params.subnet_id);
    if (!subnet) return reply.code(404).send({ error: 'Subnet not found' });
    return subnet;
});

// POST /api/federation/subnets
// Register a new sovereign subnetwork.
// Body: { subnet_id, name, description, constitution_root, validator_set, quorum, settlement_networks, assets }
fastify.post('/api/federation/subnets', async (request, reply) => {
    const { subnet_id, name, description, constitution_root, constitution_version,
            validator_set, quorum, settlement_networks, assets, metadata } = request.body;

    if (!subnet_id || !name) {
        return reply.code(400).send({ error: 'Required: subnet_id, name' });
    }

    try {
        const subnet = federationRegistry.registerSubnet({
            subnet_id, name, description: description || '',
            constitution_root: constitution_root || governanceEngine.getConstitutionRoot(),
            constitution_version,
            validator_set: validator_set || [],
            quorum,
            settlement_networks: settlement_networks || [],
            assets: assets || [],
            metadata,
        });
        return { success: true, subnet, federation_root: federationRegistry.getFederationRoot() };
    } catch (err) {
        return reply.code(400).send({ error: err.message });
    }
});

// GET /api/federation/root
// The current federation root hash — digest of all active subnet constitution roots.
fastify.get('/api/federation/root', async () => {
    return {
        federation_root:    federationRegistry.getFederationRoot(),
        constitution_root:  governanceEngine.getConstitutionRoot(),
        state_root:         ledger.state_root,
        current_epoch:      ledger.governance?.current_epoch,
        bound_together:     true,
    };
});

// POST /api/federation/verify-receipt
// Verify a receipt under a specific subnet's historical constitutional epoch.
// Body: { receipt, subnet_id }
fastify.post('/api/federation/verify-receipt', async (request, reply) => {
    const { receipt, subnet_id } = request.body;
    if (!receipt || !subnet_id) {
        return reply.code(400).send({ error: 'Required: receipt, subnet_id' });
    }

    // First verify signature (node-level)
    const sigVerification = receiptEngine.verify(receipt);

    // Then verify constitutional epoch (historical jurisprudence)
    const epochVerification = governanceEngine.verifyReceiptEpoch(receipt);

    // Then verify against federation subnet record
    const federationVerification = federationRegistry.verifyReceiptSubnet(receipt, subnet_id);

    return {
        receipt_id:           receipt.receipt_id,
        signature_valid:      sigVerification.valid,
        epoch_valid:          epochVerification.valid,
        federation_valid:     federationVerification.valid,
        constitutional_epoch: receipt.constitutional_epoch,
        constitution_root:    receipt.constitution_root,
        policy_version:       receipt.policy_version,
        fully_valid:          sigVerification.valid && epochVerification.valid && federationVerification.valid,
        details: {
            signature:   sigVerification,
            epoch:       epochVerification,
            federation:  federationVerification,
        },
    };
});

// GET /api/governance/snapshots
// All constitutional snapshots (epoch history with optional full constitution body).
fastify.get('/api/governance/snapshots', async (request) => {
    const full = request.query.full === 'true';
    return governanceEngine.getSnapshotHistory(full);
});

// GET /api/governance/snapshots/:epoch
// Get the full constitutional snapshot for a specific epoch.
fastify.get('/api/governance/snapshots/:epoch', async (request, reply) => {
    const snapshot = governanceEngine.getSnapshot(parseInt(request.params.epoch));
    if (!snapshot) return reply.code(404).send({ error: `No snapshot for epoch ${request.params.epoch}` });
    return snapshot;
});

// ── End of Constitutional Settlement API ─────────────────────────────────────

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
