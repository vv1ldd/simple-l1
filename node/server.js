const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const fastify = require('fastify')({ logger: { transport: { target: 'pino-pretty' } } });
fastify.register(require('@fastify/cors'), { origin: '*' });
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const crypto = require('crypto');
const identityKernel = require('./identity-kernel');
const { decideCapability } = require('./capability-resolution');
const {
    buildAuthorization,
    createControlGrant,
    ensureAuthorityStores,
    revokeControlGrant,
    verifyAuthorization,
} = require('./authority-runtime');
const {
    ensurePolicyStores,
    evaluatePolicyToArtifacts,
    recordPolicyArtifacts,
} = require('./policy-artifacts');
const {
    createExternalProof,
    ensureExternalProofStores,
    verifyExternalProof,
} = require('./external-proof-runtime');
const { MemoryConnectRuntimeStore } = require('./connect-runtime-store');
const {
    createIdentityProof,
    createIdentityProofEnvelope,
    verifyIdentityProof,
} = require('./identity-proof-runtime');
const { emailDisclosureFromClaimHistory } = require('./subject-claim-history-runtime');
const {
    createIdentityStateEnvelope,
    verifyIdentityStateEnvelope,
    assertNoAuthorityLeak: assertNoIdentityMeshAuthorityLeak,
} = require('./identity-mesh-runtime');
const {
    ensureMarketplaceStores,
    executeMarketplaceSettlement,
    explainSettlement,
} = require('./marketplace-flow-runtime');
const {
    activateSeller,
    ensureSellerStores,
    normalizeListing,
    normalizeSeller,
    refreshSellerActivation,
    sellerSummary,
    upsertByKey,
} = require('./marketplace-seller-runtime');
const {
    isAllowedSl1eRedirectUri,
    normalizeAuthorizeQuery,
} = require('./sl1e-client-registry');
const {
    pushAuthorizeRequest,
    resolveAuthorizeRequestRef,
} = require('./sl1e-authorize-requests');
const {
    parseIssuerCeremonyMap,
    ceremonyHostForIssuer,
} = require('./issuer-ceremony-delegation');

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

const EMBEDDED_RUNTIME = ['1', 'true', 'yes', 'on'].includes(String(process.env.SL1_EMBEDDED || '').toLowerCase());
const DATA_DIR = process.env.SL1_DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const RUNTIME_PORT_FILE = process.env.SL1_RUNTIME_PORT_FILE || '';
const RUNTIME_HOST = process.env.SL1_HOST || process.env.HOST || (EMBEDDED_RUNTIME ? '127.0.0.1' : '0.0.0.0');
const RUNTIME_PORT = Number(process.env.PORT ?? (EMBEDDED_RUNTIME ? 0 : 3000));

const LEDGER_FILE = path.join(DATA_DIR, 'ledger_db.json');
const NETWORK_JOIN_REQUESTS_FILE = path.join(DATA_DIR, 'network_join_requests.json');
const INSTALL_REPORTS_FILE = path.join(DATA_DIR, 'install_reports.json');
const MESH_MAILBOX_FILE = path.join(DATA_DIR, 'mesh_mailbox.json');
const GENESIS_FILE = path.join(__dirname, 'genesis.json');
let ledger = {
    accounts: {},              // Derived state (View)
    event_log: [],             // Primary Source of Truth (Signed Transitions)
    claim_history: [],         // Append-only versionable claim stream (not authority history)
    pending_settlements: [],
    intent_registry: {},       // Intent Resolution Engine store
    settlement_events: [],     // Settlement Event Bus stream
    receipts: {},              // Intent Receipt store
    policy_audit: [],          // Constitutional Policy audit log
    capability_grants: [],     // CRE v1 explicit grant table
    capabilities: [],          // RFC-0016 first-class capabilities
    control_grants: [],        // RFC-0016 first-class authority grants
    authorizations: [],        // RFC-0016 authorization artifacts
    revocations: [],           // RFC-0016 grant revocations
    intent_approvals: [],      // RFC-0018 IntentApproval artifacts
    intent_approval_replay_keys: [],
    controller_bindings: [],
    controller_binding_proposals: [],
    policy_evaluations: [],    // RFC-0014 policy input artifacts
    policy_decisions: [],      // RFC-0014 policy decision artifacts
    external_proofs: [],       // RFC-0017 external proof artifacts
    normalized_facts: [],      // RFC-0017 normalized facts
    verification_paths: [],    // RFC-0017 verification paths
    finality_claims: [],       // RFC-0017 finality claims
    external_proof_replay_keys: [],
    transactions: [],          // RFC-0026 reference-flow transactions
    settlement_operations: [], // RFC-0026 settlement mutations
    settlement_proofs: [],     // RFC-0026 lineage proofs
    settlement_idempotency_keys: [],
    marketplace_sellers: [],    // App-layer seller launch records; not protocol authority
    marketplace_listings: [],   // App-layer listings for seller launch MVP
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
            const credentialPublicKey = event.payload.credentialPublicKey || event.payload.credential_public_key || null;
            const credentialCounter = Number(event.payload.counter || event.payload.credential_counter || 0);
            const credentialTransports = event.payload.transports || event.payload.credential_transports || [];
            const credentialRpId = event.payload.rp_id || event.payload.rpId || null;
            const alias = event.payload.alias || null;
            const displayAlias = event.payload.display_alias || event.payload.displayAlias || null;
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
                credentialPublicKey,
                counter: credentialCounter,
                transports: credentialTransports,
                rp_id: credentialRpId,
                alias,
                display_alias: displayAlias,
                keys: keyAddress ? [{
                    key_l1_address: keyAddress,
                    publicKey,
                    credentialId,
                    credentialPublicKey,
                    counter: credentialCounter,
                    transports: credentialTransports,
                    rp_id: credentialRpId,
                    alias,
                    display_alias: displayAlias,
                    role: 'primary',
                    status: 'active',
                    registered_at: event.timestamp
                }] : [],
                balances: { SL: 1000, BTC: 0, ETH: 0 },
                external_addresses: {
                    BTC: `bc1_${crypto.createHash('sha256').update(entityAddress + 'BTC').digest('hex').substring(0, 10)}`,
                    ETH: `0x${crypto.createHash('sha256').update(entityAddress + 'ETH').digest('hex').substring(0, 10)}`
                },
                authority_policies: {
                    session_limit: 1000,
                    intent_scope: ['payments', 'identity-claims'],
                    active_policies: ['Daily Limit 1000 SL']
                },
                provenance_log: [],
                nonce: 0
            };
            if (credentialId && credentialPublicKey && keyAddress) {
                ledger.controller_bindings = ledger.controller_bindings || [];
                ledger.controller_bindings = ledger.controller_bindings.filter((binding) => binding.credential_id !== credentialId);
                ledger.controller_bindings.push({
                    id: `cb_${crypto.createHash('sha256').update(`${entityAddress}:${keyAddress}:${credentialId}`).digest('hex').slice(0, 20)}`,
                    object_type: 'ControllerBinding',
                    entity_l1_address: entityAddress,
                    controller_l1_address: keyAddress,
                    key_l1_address: keyAddress,
                    credential_id: credentialId,
                    credential_public_key: credentialPublicKey,
                    credentialPublicKey,
                    rp_id: credentialRpId,
                    status: 'active',
                    source: 'GENESIS',
                    created_at: event.timestamp
                });
            }
            if (!ledger.treasury.btc_deposits) ledger.treasury.btc_deposits = {};
            ledger.treasury.btc_deposits[ledger.accounts[entityAddress].external_addresses.BTC] = entityAddress;
            break;

        case 'PASSKEY_ADDED': {
            const entityAddress = identityKernel.assertEntityAddress(event.payload.entity_l1_address);
            const account = ledger.accounts[entityAddress];
            if (!account) throw new Error('PASSKEY_ENTITY_NOT_FOUND');
            const credentialPublicKey = event.payload.credentialPublicKey || event.payload.credential_public_key || null;
            const credentialId = event.payload.credentialId || event.payload.credential_id || null;
            const keyAddress = event.payload.key_l1_address
                ? identityKernel.assertKeyAddress(event.payload.key_l1_address)
                : identityKernel.keyAddressFromPublicKey(credentialPublicKey);
            const keyRecord = {
                key_l1_address: keyAddress,
                publicKey: credentialPublicKey,
                credentialId,
                credentialPublicKey,
                counter: Number(event.payload.counter || 0),
                transports: event.payload.transports || [],
                rp_id: event.payload.rp_id || null,
                alias: account.alias || null,
                display_alias: account.display_alias || null,
                role: event.payload.role || 'secondary',
                status: 'active',
                registered_at: event.timestamp,
            };
            account.keys = [
                ...(account.keys || []).filter((key) => String(key.credentialId || key.credential_id) !== String(credentialId)),
                keyRecord,
            ];
            ledger.controller_bindings = ledger.controller_bindings || [];
            ledger.controller_bindings = ledger.controller_bindings.filter((binding) => binding.credential_id !== credentialId);
            ledger.controller_bindings.push({
                id: `cb_${crypto.createHash('sha256').update(`${entityAddress}:${keyAddress}:${credentialId}`).digest('hex').slice(0, 20)}`,
                object_type: 'ControllerBinding',
                entity_l1_address: entityAddress,
                controller_l1_address: keyAddress,
                key_l1_address: keyAddress,
                credential_id: credentialId,
                credential_public_key: credentialPublicKey,
                credentialPublicKey,
                rp_id: keyRecord.rp_id,
                status: 'active',
                source: 'PASSKEY_ADDED',
                created_at: event.timestamp,
            });
            break;
        }

        case 'NATIVE_CONTROLLER_BOOTSTRAPPED': {
            const entityAddress = identityKernel.assertEntityAddress(event.payload.entity_l1_address);
            const keyAddress = identityKernel.assertKeyAddress(event.payload.key_l1_address);
            const publicKey = String(event.payload.publicKey || event.payload.public_key || '');
            const label = String(event.payload.label || event.payload.device_name || 'Meanly One');
            const now = event.timestamp;
            const existing = ledger.accounts[entityAddress] || {};
            ledger.accounts[entityAddress] = {
                ...existing,
                entity_l1_address: entityAddress,
                address: entityAddress,
                address_version: existing.address_version || identityKernel.ENTITY_ADDRESS_VERSION,
                key_l1_address: existing.key_l1_address || keyAddress,
                key_address_version: existing.key_address_version || identityKernel.KEY_ADDRESS_VERSION,
                handle: existing.handle || label,
                alias: existing.alias || null,
                display_alias: existing.display_alias || label,
                publicKey: existing.publicKey || publicKey,
                keys: [
                    ...(existing.keys || []).filter((key) => String(key.key_l1_address || '') !== keyAddress),
                    {
                        key_l1_address: keyAddress,
                        publicKey,
                        controller_type: 'native_macos_p256',
                        role: existing.keys?.length ? 'secondary' : 'primary',
                        status: 'active',
                        registered_at: now,
                    },
                ],
                balances: existing.balances || { SL: 1000, BTC: 0, ETH: 0 },
                external_addresses: existing.external_addresses || {},
                authority_policies: existing.authority_policies || {
                    session_limit: 1000,
                    intent_scope: ['payments', 'identity-claims'],
                    active_policies: ['Daily Limit 1000 SL'],
                },
                provenance_log: existing.provenance_log || [],
                nonce: existing.nonce || 0,
                identity_source: existing.identity_source || 'native-wallet-bootstrap',
            };
            ledger.controller_bindings = ledger.controller_bindings || [];
            ledger.controller_bindings = ledger.controller_bindings.filter((binding) =>
                String(binding.entity_l1_address || '') !== entityAddress || String(binding.key_l1_address || binding.controller_l1_address || '') !== keyAddress
            );
            ledger.controller_bindings.push({
                id: controllerBindingId(entityAddress, keyAddress, 'native_macos_p256'),
                object_type: 'ControllerBinding',
                entity_l1_address: entityAddress,
                controller_l1_address: keyAddress,
                key_l1_address: keyAddress,
                controller_type: 'native_macos_p256',
                controller_public_key: publicKey,
                status: 'active',
                source: 'NATIVE_CONTROLLER_BOOTSTRAPPED',
                created_at: now,
            });
            break;
        }

        case 'CONTROLLER_BINDING_PROPOSED': {
            ledger.controller_binding_proposals = ledger.controller_binding_proposals || [];
            ledger.controller_binding_proposals = ledger.controller_binding_proposals.filter((proposal) => proposal.proposal_id !== event.payload.proposal_id);
            ledger.controller_binding_proposals.push({
                ...event.payload,
                status: 'pending',
                proposed_at: event.timestamp,
            });
            break;
        }

        case 'CONTROLLER_BINDING_APPROVED': {
            let approvedProposal = null;
            ledger.controller_binding_proposals = (ledger.controller_binding_proposals || []).map((proposal) => {
                if (proposal.proposal_id !== event.payload.proposal_id) return proposal;
                approvedProposal = proposal;
                return {
                    ...proposal,
                    status: 'approved',
                    approved_by_key_l1_address: event.payload.approved_by_key_l1_address,
                    approved_at: event.timestamp,
                    approval_hash: event.payload.approval_hash || null,
                };
            });
            if (approvedProposal) {
                const entityAddress = identityKernel.assertEntityAddress(approvedProposal.entity_l1_address);
                const keyAddress = identityKernel.assertKeyAddress(approvedProposal.proposed_controller_key_l1_address);
                const account = ledger.accounts[entityAddress];
                if (account) {
                    const credentialId = approvedProposal.credential_id || null;
                    const credentialPublicKey = approvedProposal.credential_public_key || approvedProposal.credentialPublicKey || approvedProposal.controller_public_key || null;
                    const keyRecord = {
                        key_l1_address: keyAddress,
                        publicKey: credentialPublicKey,
                        credentialId,
                        credentialPublicKey,
                        counter: Number(approvedProposal.counter || 0),
                        transports: approvedProposal.transports || ['internal', 'hybrid'],
                        rp_id: approvedProposal.rp_id || null,
                        controller_type: approvedProposal.controller_type || 'trusted_device',
                        label: approvedProposal.label || null,
                        role: (account.keys || []).length ? 'secondary' : 'primary',
                        status: 'active',
                        registered_at: event.timestamp,
                    };
                    account.keys = [
                        ...(account.keys || []).filter((key) => String(key.key_l1_address || '') !== keyAddress),
                        keyRecord,
                    ];
                    ledger.controller_bindings = ledger.controller_bindings || [];
                    ledger.controller_bindings = ledger.controller_bindings.filter((binding) =>
                        String(binding.entity_l1_address || '') !== entityAddress || String(binding.key_l1_address || binding.controller_l1_address || '') !== keyAddress
                    );
                    ledger.controller_bindings.push({
                        id: controllerBindingId(entityAddress, keyAddress, credentialId || approvedProposal.proposal_id),
                        object_type: 'ControllerBinding',
                        entity_l1_address: entityAddress,
                        controller_l1_address: keyAddress,
                        key_l1_address: keyAddress,
                        controller_type: approvedProposal.controller_type || 'trusted_device',
                        credential_id: credentialId,
                        credential_public_key: credentialPublicKey,
                        credentialPublicKey,
                        rp_id: approvedProposal.rp_id || null,
                        transports: approvedProposal.transports || [],
                        label: approvedProposal.label || null,
                        status: 'active',
                        source: 'CONTROLLER_BINDING_APPROVED',
                        proposal_id: approvedProposal.proposal_id,
                        created_at: event.timestamp,
                    });
                }
            }
            break;
        }

        case 'PASSKEY_REVOKED': {
            const entityAddress = identityKernel.assertEntityAddress(event.payload.entity_l1_address);
            const account = ledger.accounts[entityAddress];
            if (!account) throw new Error('PASSKEY_ENTITY_NOT_FOUND');
            const credentialId = String(event.payload.credential_id || event.payload.credentialId || '');
            account.keys = (account.keys || []).map((key) => {
                if (String(key.credentialId || key.credential_id) !== credentialId) return key;
                return {
                    ...key,
                    status: 'revoked',
                    revoked_at: event.timestamp,
                    revocation_reason: event.payload.reason || 'user_removed',
                };
            });
            if (String(account.credentialId || account.credential_id || '') === credentialId) {
                account.credential_status = 'revoked';
            }
            ledger.controller_bindings = (ledger.controller_bindings || []).map((binding) => {
                if (String(binding.credential_id || '') !== credentialId) return binding;
                return {
                    ...binding,
                    status: 'revoked',
                    revoked_at: event.timestamp,
                    revocation_reason: event.payload.reason || 'user_removed',
                };
            });
            break;
        }

        case 'TRANSFER':
            throw new Error('Legacy TRANSFER events are disabled: mutation requires lineage-complete execution');

        case 'CAPABILITY_GRANT_CREATED':
        case 'CONTROL_GRANT_CREATED':
            createControlGrant(ledger, {
                ...event.payload,
                granted_at: event.payload.granted_at || event.timestamp,
            }, new Date(event.timestamp));
            break;

        case 'CONTROL_GRANT_REVOKED':
            revokeControlGrant(ledger, {
                ...event.payload,
                revoked_at: event.payload.revoked_at || event.timestamp,
            }, new Date(event.timestamp));
            break;

        case 'POLICY_ARTIFACT_RECORDED':
            recordPolicyArtifacts(
                ledger,
                event.payload.input,
                event.payload.result,
                new Date(event.timestamp)
            );
            break;

        case 'AUTHORIZATION_CREATED':
            buildAuthorization(ledger, {
                ...event.payload,
                authorized_at: event.payload.authorized_at || event.timestamp,
            }, new Date(event.timestamp));
            break;

        case 'EXTERNAL_PROOF_RECORDED':
            createExternalProof(ledger, {
                ...event.payload,
                observed_at: event.payload.observed_at || event.timestamp,
            }, new Date(event.timestamp));
            break;

        case 'MARKETPLACE_SETTLEMENT_RECORDED':
            const settlementResult = executeMarketplaceSettlement(ledger, {
                ...event.payload,
                applied_at: event.payload.applied_at || event.timestamp,
            }, new Date(event.timestamp));
            if (!settlementResult.ok) {
                throw new Error(settlementResult.reason_codes.join(', '));
            }
            break;

        case 'MARKETPLACE_SELLER_UPSERTED': {
            ensureSellerStores(ledger);
            const seller = normalizeSeller({
                ...event.payload,
                created_at: event.payload.created_at || event.timestamp,
            }, new Date(event.timestamp));
            upsertByKey(ledger.marketplace_sellers, 'seller_id', seller);
            refreshSellerActivation(ledger, seller.seller_id, new Date(event.timestamp));
            break;
        }

        case 'MARKETPLACE_LISTING_UPSERTED': {
            ensureSellerStores(ledger);
            const listing = normalizeListing({
                ...event.payload,
                created_at: event.payload.created_at || event.timestamp,
            }, new Date(event.timestamp));
            const seller = ledger.marketplace_sellers.find((candidate) => candidate.seller_id === listing.seller_id);
            if (!seller) throw new Error('seller_not_found');
            upsertByKey(ledger.marketplace_listings, 'listing_id', listing);
            refreshSellerActivation(ledger, listing.seller_id, new Date(event.timestamp));
            break;
        }

        case 'MARKETPLACE_SELLER_ACTIVATED': {
            ensureSellerStores(ledger);
            activateSeller(ledger, event.payload.seller_id, new Date(event.timestamp));
            break;
        }
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
        stateString += addr + ":" + nativeBalance(acc) + ":" + (acc.nonce || 0) + "|";
    }
    // Bind state root to active constitutional epoch
    const constitutionRoot = ledger.governance?.constitution_root || 'genesis';
    const epoch            = ledger.governance?.current_epoch ?? 0;
    stateString += `|constitution:${constitutionRoot}:epoch:${epoch}`;
    return crypto.createHash('sha256').update(stateString).digest('hex');
}

function nativeBalance(account) {
    return Number(account?.balances?.SL ?? account?.balances?.SL1 ?? 0);
}

function normalizeWalletAsset(asset) {
    return asset === 'SL1' ? 'SL' : asset;
}

function legacyAccountGenesisEvent(account) {
    const credentialId = account?.credentialId || account?.credential_id;
    const credentialPublicKey = account?.credentialPublicKey || account?.credential_public_key;
    const entityAddress = account?.entity_l1_address || account?.address;
    const publicKey = account?.publicKey || credentialPublicKey;

    if (!entityAddress || !publicKey || !credentialId || !credentialPublicKey) {
        return null;
    }

    return {
        id: `legacy_${crypto.createHash('sha256').update(`${entityAddress}:${credentialId}`).digest('hex').slice(0, 16)}`,
        type: 'GENESIS',
        payload: {
            address: entityAddress,
            entity_l1_address: entityAddress,
            key_l1_address: account.key_l1_address,
            address_version: account.address_version || identityKernel.ENTITY_ADDRESS_VERSION,
            key_address_version: account.key_address_version || identityKernel.KEY_ADDRESS_VERSION,
            handle: account.handle || account.alias || 'anonymous',
            alias: account.alias || null,
            publicKey,
            credentialId,
            credentialPublicKey,
            counter: Number(account.counter || 0),
            transports: account.transports || ['internal', 'hybrid'],
            rp_id: account.rp_id || 'simplelayer.one',
        },
        timestamp: account.keys?.[0]?.registered_at || new Date().toISOString(),
    };
}

async function start() {
    // 1. Initial Load from persistence
    let persistedAccounts = {};
    if (fs.existsSync(LEDGER_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
            ledger.event_log = data.event_log || [];
            ledger.claim_history = Array.isArray(data.claim_history) ? data.claim_history : [];
            persistedAccounts = data.accounts || {};
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

    const knownCredentialIds = new Set(
        ledger.event_log
            .map((event) => event?.payload?.credentialId || event?.payload?.credential_id)
            .filter(Boolean)
            .map(String)
    );
    const legacyGenesisEvents = Object.values(persistedAccounts)
        .map(legacyAccountGenesisEvent)
        .filter((event) => event && !knownCredentialIds.has(String(event.payload.credentialId)));
    if (legacyGenesisEvents.length > 0) {
        console.log(`[BOOT] Backfilled ${legacyGenesisEvents.length} legacy passkey account(s) into event history.`);
        ledger.event_log = ledger.event_log.concat(legacyGenesisEvents);
    }

    // 3. Replay History
    console.log(`[BOOT] Replaying ${ledger.event_log.length} events...`);
    const history = [...ledger.event_log];
    ledger.event_log = []; 
    ledger.accounts = {};
    ledger.capability_grants = [];
    ledger.capabilities = [];
    ledger.control_grants = [];
    ledger.authorizations = [];
    ledger.revocations = [];
    ledger.intent_approvals = [];
    ledger.intent_approval_replay_keys = [];
    ledger.controller_bindings = [];
    ledger.controller_binding_proposals = [];
    ledger.policy_evaluations = [];
    ledger.policy_decisions = [];
    ledger.external_proofs = [];
    ledger.normalized_facts = [];
    ledger.verification_paths = [];
    ledger.finality_claims = [];
    ledger.external_proof_replay_keys = [];
    ledger.transactions = [];
    ledger.settlement_operations = [];
    ledger.settlement_proofs = [];
    ledger.settlement_idempotency_keys = [];
    ledger.marketplace_sellers = [];
    ledger.marketplace_listings = [];
    history.forEach(ev => applyEvent(ev, true));
    ledger.event_log = history;
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
            balances: { SL: 5000, BTC: 1.45, ETH: 12.8, USDC: 2500 },
            external_addresses: {
                BTC: 'bc1_q3059301306072a8648ce03020706052b810400',
                ETH: '0x3059301306072a8648ce03020706052b8104000'
            },
            authority_policies: {
                session_limit: 5000,
                intent_scope: ['payments', 'identity-claims', 'cross-chain-settlement'],
                active_policies: ['Daily Limit 5000 SL']
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

        await fastify.listen({ port: RUNTIME_PORT, host: RUNTIME_HOST });
        writeEmbeddedRuntimePortFile();
        const address = fastify.server.address();
        const boundPort = typeof address === 'object' && address ? address.port : RUNTIME_PORT;
        console.log(`[DAOS] ${NODE_NAME} is active on ${RUNTIME_HOST}:${boundPort}`);
        
        // 5. Automated Discovery
        if (!EMBEDDED_RUNTIME) {
            discoverPeers();
            setInterval(discoverPeers, 60000); // Refresh every minute
        }
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

const saveLedger = () => {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
};

const writeEmbeddedRuntimePortFile = () => {
    if (!RUNTIME_PORT_FILE) return;

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : RUNTIME_PORT;
    const host = RUNTIME_HOST === '0.0.0.0' ? '127.0.0.1' : RUNTIME_HOST;
    const payload = {
        status: 'ready',
        embedded: EMBEDDED_RUNTIME,
        pid: process.pid,
        host,
        port,
        base_url: `http://${host}:${port}`,
        data_dir: DATA_DIR,
        started_at: new Date().toISOString(),
    };

    fs.mkdirSync(path.dirname(RUNTIME_PORT_FILE), { recursive: true });
    fs.writeFileSync(RUNTIME_PORT_FILE, JSON.stringify(payload, null, 2));
};

// --- HELPERS ---
const calculateKeyAddress = (pubKeyHex) => identityKernel.keyAddressFromPublicKey(pubKeyHex);

const IDENTITY_FILE = path.join(DATA_DIR, 'node_identity.json');
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
const IDENTITY_PROTOCOL_VERSION = process.env.SL1_IDENTITY_PROTOCOL_VERSION || 'capsule-v0';
const NODE_CAPABILITIES = ["REPLAY", "GOSSIP", "VALIDATOR", "GATEWAY"];
let NODE_ID = crypto.randomBytes(16).toString('hex');

let PEERS = [...new Set([...(process.env.PEERS || '').split(','), ...SEED_NODES])].filter(Boolean);
const sl1eRuntimeStore = new MemoryConnectRuntimeStore();
const SL1_CONNECT_SECRET = process.env.SL1_CONNECT_SECRET || crypto.createHash('sha256').update(`sl1-connect:${NODE_ID}`).digest('hex');
const IDENTITY_CAPSULE_VERSION = 'simple-l1.identity-capsule.v0';
const STATE_PROOF_VERSION = 'simple-l1.identity-state-proof.v0';

function legacyMutationDisabled(reply, endpoint, replacement) {
    return reply.code(410).send({
        error: 'legacy_mutation_disabled',
        endpoint,
        replacement,
        invariant: 'Mutation without lineage is impossible.',
        required_lineage: [
            'NormalizedFact',
            'PolicyEvaluation',
            'PolicyDecision',
            'Capability',
            'ControlGrant',
            'Authorization',
            'Transaction',
            'SettlementProof',
        ],
    });
}

const htmlEscape = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const firstIdentityAccount = () => {
    const accounts = Object.values(ledger.accounts || {});
    return accounts.find(account => account.handle === 'admin') || accounts[0] || null;
};

const base64UrlFromBuffer = (value) => Buffer.from(value).toString('base64url');

const base64UrlFromUnknown = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return Buffer.from(value).toString('base64url');
};

const bufferFromStoredKey = (value) => {
    if (!value) return null;
    const stringValue = String(value);
    if (/^[0-9a-f]+$/i.test(stringValue) && stringValue.length % 2 === 0) {
        return Buffer.from(stringValue, 'hex');
    }

    try {
        return Buffer.from(stringValue, 'base64url');
    } catch (error) {
        return null;
    }
};

const rpIdForHost = (host) => {
    const hostname = String(host || '').split(':')[0].toLowerCase();
    if (hostname === '127.0.0.1' || hostname === '::1') return 'localhost';
    if (hostname.startsWith('connect.') && hostname.split('.').length > 2) {
        return hostname.replace(/^connect\./, '');
    }

    return hostname;
};

const originForHost = (host) => {
    const hostname = String(host || '').split(':')[0].toLowerCase();
    if (hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost') {
        return `http://localhost:${RUNTIME_PORT || 3000}`;
    }

    return `https://${hostname}`;
};

const PROTOCOL_SITE_HOST = String(process.env.SL1_PROTOCOL_SITE_HOST || 'simplelayer.one').split(':')[0].toLowerCase();
const PASS_ISSUER_HOST = String(process.env.SL1_PASS_ISSUER_HOST || 'pass.simplelayer.one').split(':')[0].toLowerCase();
const ISSUER_CEREMONY_MAP = parseIssuerCeremonyMap(process.env.SL1_ISSUER_CEREMONY_MAP || '');

const normalizedHost = (host) => String(host || '').split(':')[0].toLowerCase();

const isPassIssuerHost = (host) => {
    const hostname = normalizedHost(host);
    if (!hostname) {
        return false;
    }

    if (hostname === PASS_ISSUER_HOST || hostname === 'pass.simplelayer.test') {
        return true;
    }

    return hostname.startsWith('pass.')
        && (hostname.endsWith('.simplelayer.one') || hostname.endsWith('.simplelayer.test'));
};

const isProtocolSiteHost = (host) => {
    const hostname = normalizedHost(host);
    if (!hostname) {
        return false;
    }

    if (hostname === PROTOCOL_SITE_HOST || hostname === 'simplelayer.test' || hostname === 'www.simplelayer.one') {
        return true;
    }

    return false;
};

const isProtocolIssuerHost = (host) => {
    if (isPassIssuerHost(host) || isProtocolSiteHost(host)) {
        return true;
    }

    const hostname = normalizedHost(host);
    if (!hostname) {
        return false;
    }

    return hostname.endsWith('.simplelayer.one') || hostname.endsWith('.simplelayer.test');
};

// ADR-0028: `connect.identity.*` is the dedicated WebAuthn ceremony origin.
// This host exists only to run the connect authorization, so it carries no
// commerce chrome (Shop / Categories / Vault) — only the connect window.
const isConnectCeremonyHost = (host) => {
    const hostname = normalizedHost(host);
    if (!hostname) {
        return false;
    }

    return hostname.startsWith('connect.') && hostname.split('.').length > 2;
};

const passIssuerOrigin = () => {
    if (PASS_ISSUER_HOST === '127.0.0.1' || PASS_ISSUER_HOST === 'localhost') {
        return `http://localhost:${RUNTIME_PORT || 3000}`;
    }

    return `https://${PASS_ISSUER_HOST}`;
};

const protocolSiteOrigin = () => {
    if (PROTOCOL_SITE_HOST === '127.0.0.1' || PROTOCOL_SITE_HOST === 'localhost') {
        return `http://localhost:${RUNTIME_PORT || 3000}`;
    }

    return `https://${PROTOCOL_SITE_HOST}`;
};

const redirectAuthorizeToPassHost = (request, reply) => {
    if (!isProtocolSiteHost(request.hostname) || isPassIssuerHost(request.hostname)) {
        return false;
    }

    reply.redirect(302, `${passIssuerOrigin()}${request.url}`);
    return true;
};

const redirectIssuerToCeremonyHost = (request, reply) => {
    const ceremonyHost = ceremonyHostForIssuer(request.hostname, ISSUER_CEREMONY_MAP);
    if (!ceremonyHost) {
        return false;
    }

    reply.redirect(`${originForHost(ceremonyHost)}${request.url}`);
    return true;
};

const CONNECT_REQUEST_COOKIE = 'sl1e_connect_request';

const parseCookieHeader = (header = '') => Object.fromEntries(
    String(header || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const index = part.indexOf('=');
            if (index === -1) return [part, ''];
            return [
                decodeURIComponent(part.slice(0, index).trim()),
                decodeURIComponent(part.slice(index + 1).trim()),
            ];
        })
);

const connectRequestCookieValue = (request) => parseCookieHeader(request.headers?.cookie || '')[CONNECT_REQUEST_COOKIE] || '';

const setConnectRequestCookie = (reply, requestRef) => {
    reply.header(
        'Set-Cookie',
        `${CONNECT_REQUEST_COOKIE}=${encodeURIComponent(String(requestRef || ''))}; Path=/; Max-Age=180; HttpOnly; Secure; SameSite=Lax`
    );
};

const renderPassIssuerHome = (issuerHost) => {
    const hostname = htmlEscape(normalizedHost(issuerHost));
    const siteUrl = protocolSiteOrigin();

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SL1 Pass | Simple Layer One</title>
    <meta name="description" content="Sign in with your SL1 passkey. This host only handles identity and authorization.">
    <meta name="theme-color" content="#090a0f">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css?v=3.0.0">
    <link rel="stylesheet" href="/authorize-protocol.css?v=1.1.0">
</head>
<body>
    <div class="page-shell authorize-page pass-home">
        <nav class="nav authorize-nav">
            <a class="brand" href="/">
                <span class="brand-mark">SL1</span>
                <span>
                    <strong>Simple Layer One</strong>
                    <small>${hostname}</small>
                </span>
            </a>
            <a class="nav-cta" href="${htmlEscape(siteUrl)}">About SL1</a>
        </nav>
        <section class="authorize-stage">
            <article class="hero-card authorize-card pass-home-card">
                <div class="authorize-orb" aria-hidden="true"><span>SL1</span></div>
                <h1>Identity issuer</h1>
                <p class="connect-lead">This domain signs you in with a passkey when another site asks for SL1 Connect. It does not host the public protocol site.</p>
                <a class="button primary pass-home-cta" href="${htmlEscape(siteUrl)}">Go to simplelayer.one</a>
            </article>
        </section>
        <footer class="footer pass-home-footer">
            <strong>Simple Layer One</strong>
            <span>Passkey sign-in only on this host.</span>
        </footer>
    </div>
</body>
</html>`;
};

const contourKeyForHost = (host) => {
    const rpId = rpIdForHost(host);
    if (rpId.endsWith('.ru')) return 'ru';
    if (rpId.endsWith('.one')) return 'one';
    return 'global';
};

const CEREMONY_STRINGS = {
    en: {
        loading: 'Loading',
        preparingWallet: 'Preparing your wallet...',
        createAccount: 'Create account',
        signIn: 'Sign in',
        continueWithMeanly: 'Continue with Meanly',
        openMeanlyVault: 'Open Meanly Vault',
        usePasskeyContinue: 'Use your passkey to continue.',
        chooseNamePasskey: 'Choose a name and continue with your passkey.',
        confirmPasskey: 'Confirm with your passkey.',
        createYourAccount: 'Create your account.',
        username: 'Username',
        usernamePlaceholder: '@username',
        continue: 'Continue',
        chooseAnotherAccount: 'Choose another account',
        alreadyHaveAccount: 'I already have an account',
        newHereCreate: 'New here? Create an account',
        haveAccountSignIn: 'Already have an account? Sign in',
        continueTo: 'Continue to',
        useIdentity: 'Use ',
        switchToIdentity: 'Switch to ',
        yourVault: 'Your Vault',
        vaultReady: 'Saved items and orders are ready here.',
        openVault: 'Open Vault',
        switchAccount: 'Switch account',
        signOut: 'Sign out',
        chooseAccountHere: 'Choose the account you want to use here.',
        tryAgain: 'Try again',
        couldNotLoadWallet: 'Could not load wallet.',
        reload: 'Reload',
        gettingPasskeyReady: 'Getting your passkey ready...',
        confirmFaceId: 'Confirm with Face ID, Touch ID, or your security key...',
        confirming: 'Confirming...',
        confirmedReturning: 'Confirmed. Taking you back to Meanly...',
        connectLandingTitle: 'Secure identity connection',
        connectLandingBody: 'This page runs the WebAuthn ceremony for Meanly. Start sign-in from the storefront or app that sent you here.',
    },
    ru: {
        loading: 'Загрузка',
        preparingWallet: 'Подготавливаем сейф...',
        createAccount: 'Создать аккаунт',
        signIn: 'Войти',
        continueWithMeanly: 'Продолжить с Meanly',
        openMeanlyVault: 'Открыть сейф Meanly',
        usePasskeyContinue: 'Подтвердите вход с помощью passkey.',
        chooseNamePasskey: 'Выберите имя и продолжите с passkey.',
        confirmPasskey: 'Подтвердите вход passkey.',
        createYourAccount: 'Создайте аккаунт.',
        username: 'Имя пользователя',
        usernamePlaceholder: '@имя',
        continue: 'Продолжить',
        chooseAnotherAccount: 'Выбрать другой аккаунт',
        alreadyHaveAccount: 'У меня уже есть аккаунт',
        newHereCreate: 'Впервые здесь? Создать аккаунт',
        haveAccountSignIn: 'Уже есть аккаунт? Войти',
        continueTo: 'Продолжить в',
        useIdentity: 'Использовать ',
        switchToIdentity: 'Переключиться на ',
        yourVault: 'Ваш сейф',
        vaultReady: 'Заказы, коды и настройки — здесь.',
        openVault: 'Открыть сейф',
        switchAccount: 'Сменить аккаунт',
        signOut: 'Выйти',
        chooseAccountHere: 'Выберите аккаунт для входа.',
        tryAgain: 'Повторить',
        couldNotLoadWallet: 'Не удалось загрузить сейф.',
        reload: 'Обновить',
        gettingPasskeyReady: 'Готовим passkey...',
        confirmFaceId: 'Подтвердите Face ID, Touch ID или ключ безопасности...',
        confirming: 'Подтверждаем...',
        confirmedReturning: 'Подтверждено. Возвращаем в Meanly...',
        connectLandingTitle: 'Безопасное подключение Meanly',
        connectLandingBody: 'Здесь выполняется WebAuthn-церемония Meanly. Начните вход в магазине или приложении, которое вас сюда направило.',
    },
};

const ceremonyStringsForHost = (host, localeHint = '') => {
    const contour = contourKeyForHost(host);
    const locale = normalizeLocale(localeHint || (contour === 'ru' ? 'ru' : 'en'));
    const strings = CEREMONY_STRINGS[locale] || CEREMONY_STRINGS.en;
    return { locale, contour, strings };
};

const walletSurfaceForHost = (host, localeHint = '') => {
    if (isProtocolIssuerHost(host)) {
        return {
            mode: 'protocol',
            title: 'Simple Layer One',
            brand: 'Simple Layer One',
            footer: 'Simple Layer',
            identityLabel: 'identity',
            showCommerceNav: false,
        };
    }

    if (isConnectCeremonyHost(host)) {
        const { locale, contour, strings } = ceremonyStringsForHost(host, localeHint);
        if (contour === 'ru') {
            return {
                mode: 'commerce',
                connectOnly: true,
                locale,
                contour,
                strings,
                title: 'Meanly Connect',
                brand: 'СЕЙФ MEANLY',
                footer: 'Meanly RU',
                identityLabel: 'Meanly ID',
                showCommerceNav: false,
            };
        }

        return {
            mode: 'commerce',
            connectOnly: true,
            locale,
            contour,
            strings,
            title: 'Meanly Connect',
            brand: 'Meanly Connect',
            footer: 'Meanly Connect',
            identityLabel: 'Meanly ID',
            showCommerceNav: false,
        };
    }

    return {
        mode: 'commerce',
        connectOnly: false,
        locale: normalizeLocale(localeHint),
        contour: contourKeyForHost(host),
        strings: ceremonyStringsForHost(host, localeHint).strings,
        title: 'Meanly One Web Wallet',
        brand: 'Meanly One Web Wallet',
        footer: 'Meanly',
        identityLabel: 'Meanly ID',
        showCommerceNav: true,
    };
};

const renderAuthorizePageForHost = (query, issuerHost) => {
    if (isProtocolIssuerHost(issuerHost)) {
        return renderSl1eAuthorizePage(query, issuerHost);
    }

    return renderMeanlyWalletSpaPage({ ...query, __spa_path: '/authorize' }, issuerHost);
};

const stableStringify = (value) => {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

const loadNetworkJoinStore = () => {
    if (!fs.existsSync(NETWORK_JOIN_REQUESTS_FILE)) {
        return {
            schema_version: 'simple-l1.network.join_requests.store.v1',
            bridge_role: 'discovery_inbox_only',
            join_requests: [],
            namespace_artifacts: [],
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(NETWORK_JOIN_REQUESTS_FILE, 'utf8'));
        return {
            schema_version: parsed.schema_version || 'simple-l1.network.join_requests.store.v1',
            bridge_role: parsed.bridge_role || 'discovery_inbox_only',
            join_requests: Array.isArray(parsed.join_requests) ? parsed.join_requests : [],
            namespace_artifacts: Array.isArray(parsed.namespace_artifacts) ? parsed.namespace_artifacts : [],
        };
    } catch (error) {
        console.warn(`[NETWORK JOIN] Failed to read join request store: ${error.message}`);
        return {
            schema_version: 'simple-l1.network.join_requests.store.v1',
            bridge_role: 'discovery_inbox_only',
            join_requests: [],
            namespace_artifacts: [],
        };
    }
};

const saveNetworkJoinStore = (store) => {
    fs.writeFileSync(NETWORK_JOIN_REQUESTS_FILE, JSON.stringify(store, null, 2));
};

const loadInstallReportStore = () => {
    if (!fs.existsSync(INSTALL_REPORTS_FILE)) {
        return {
            schema_version: 'simple-l1.install_reports.store.v1',
            reports: [],
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(INSTALL_REPORTS_FILE, 'utf8'));
        return {
            schema_version: parsed.schema_version || 'simple-l1.install_reports.store.v1',
            reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        };
    } catch (error) {
        console.warn(`[INSTALL REPORTS] Failed to read install report store: ${error.message}`);
        return {
            schema_version: 'simple-l1.install_reports.store.v1',
            reports: [],
        };
    }
};

const saveInstallReportStore = (store) => {
    fs.writeFileSync(INSTALL_REPORTS_FILE, JSON.stringify(store, null, 2));
};

const loadMeshMailboxStore = () => {
    if (!fs.existsSync(MESH_MAILBOX_FILE)) {
        return { schema_version: 'simple-l1.mesh-mailbox.store.v1', messages: {} };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(MESH_MAILBOX_FILE, 'utf8'));
        return {
            schema_version: parsed.schema_version || 'simple-l1.mesh-mailbox.store.v1',
            messages: parsed.messages && typeof parsed.messages === 'object' ? parsed.messages : {},
        };
    } catch (error) {
        console.warn(`[MESH MAILBOX] Failed to read mailbox store: ${error.message}`);
        return { schema_version: 'simple-l1.mesh-mailbox.store.v1', messages: {} };
    }
};

const saveMeshMailboxStore = (store) => {
    fs.writeFileSync(MESH_MAILBOX_FILE, JSON.stringify(store, null, 2));
};

const assertRelayPayloadIsObservationOnly = (payload = {}) => {
    const text = JSON.stringify(payload).toLowerCase();
    const forbidden = ['authority_grant', 'authorization_code', 'application_session', 'raw_assertion', 'clientdatajson', 'authenticatordata'];
    const hit = forbidden.find((marker) => text.includes(marker));
    if (hit) {
        const error = new Error('relay_payload_authority_or_credential_leak');
        error.statusCode = 422;
        error.marker = hit;
        throw error;
    }
};

const normalizeInstallReport = (input = {}) => {
    const status = String(input.status || '').trim().toLowerCase();
    if (!['success', 'failed'].includes(status)) {
        const error = new Error('invalid_install_report_status');
        error.statusCode = 422;
        error.expected = ['success', 'failed'];
        error.received = status;
        throw error;
    }

    const reportedAt = input.reported_at ? String(input.reported_at) : new Date().toISOString();
    const reportIdSeed = stableStringify({
        reported_at: reportedAt,
        intent_hash: input.intent_hash || null,
        domain_hash: input.domain_hash || null,
        status,
        error_class: input.error_class || null,
    });

    return {
        schema_version: 'simple-l1.install_report.v1',
        report_id: input.report_id || `sl1install_${sha256Hex(reportIdSeed).slice(0, 24)}`,
        reported_at: reportedAt,
        status,
        mode: input.mode ? String(input.mode) : null,
        network_id: input.network_id ? String(input.network_id) : null,
        intent_hash: input.intent_hash ? String(input.intent_hash) : null,
        domain_hash: input.domain_hash ? String(input.domain_hash) : null,
        runtime: {
            repository: input.runtime?.repository ? String(input.runtime.repository) : null,
            branch: input.runtime?.branch ? String(input.runtime.branch) : null,
            channel: input.runtime?.channel ? String(input.runtime.channel) : null,
        },
        error_class: input.error_class ? String(input.error_class) : null,
        install_duration_seconds: Number.isFinite(Number(input.install_duration_seconds))
            ? Number(input.install_duration_seconds)
            : null,
        client: {
            installer: input.client?.installer ? String(input.client.installer) : 'sovereign-host',
            version: input.client?.version ? String(input.client.version) : null,
        },
    };
};

const requestHostFromIssuer = (issuerUrl) => {
    if (!issuerUrl) return '';
    try {
        return new URL(issuerUrl).hostname.toLowerCase();
    } catch (error) {
        return '';
    }
};

const normalizeNetworkJoinRequest = (input = {}) => {
    const hostDomain = String(input.host_domain || input.requested_fqdn || requestHostFromIssuer(input.issuer_url) || '')
        .trim()
        .toLowerCase();
    const issuerUrl = input.issuer_url ? String(input.issuer_url).trim().replace(/\/+$/, '') : null;
    const requestedFqdn = input.requested_fqdn ? String(input.requested_fqdn).trim().toLowerCase() : null;
    const requestedSubdomain = input.requested_subdomain ? String(input.requested_subdomain).trim().toLowerCase() : null;

    const missing = ['request_id', 'node_id', 'requested_at']
        .filter((key) => !String(input[key] || '').trim());
    if (!issuerUrl && !requestedFqdn) {
        missing.push('issuer_url_or_requested_fqdn');
    }
    if (!hostDomain) {
        missing.push('host_domain');
    }
    if (missing.length > 0) {
        const error = new Error('invalid_join_request');
        error.statusCode = 422;
        error.missing = missing;
        throw error;
    }

    const declaration = {
        schema_version: String(input.schema_version || 'simple-l1.network.join_request.v1'),
        request_id: String(input.request_id).trim(),
        network_id: String(input.network_id || 'simplel1').trim(),
        issuer_url: issuerUrl,
        host_domain: hostDomain,
        node_id: String(input.node_id).trim(),
        public_key: input.public_key ? String(input.public_key).trim() : null,
        capabilities: Array.isArray(input.capabilities)
            ? input.capabilities.map((capability) => String(capability).trim()).filter(Boolean).sort()
            : [],
        requested_at: String(input.requested_at).trim(),
    };
    if (requestedSubdomain) declaration.requested_subdomain = requestedSubdomain;
    if (requestedFqdn) declaration.requested_fqdn = requestedFqdn;
    if (input.server_ip) declaration.server_ip = String(input.server_ip).trim();
    if (input.status) declaration.status = String(input.status).trim();

    const requestHash = `sha256:${sha256Hex(stableStringify(declaration))}`;
    if (input.request_hash && String(input.request_hash) !== requestHash) {
        const error = new Error('request_hash_mismatch');
        error.statusCode = 422;
        error.expected = requestHash;
        error.received = String(input.request_hash);
        throw error;
    }

    return {
        ...declaration,
        request_hash: requestHash,
        signature: input.signature || null,
        signature_pending: input.signature ? false : input.signature_pending !== false,
    };
};

const normalizeNamespaceArtifact = (joinRequest, input = {}) => {
    const artifactType = String(input.artifact_type || input.type || '').trim();
    if (!['dns_allocated', 'issuer_reachable', 'issuer_unreachable'].includes(artifactType)) {
        const error = new Error('invalid_namespace_artifact_type');
        error.statusCode = 422;
        throw error;
    }

    const evidence = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence)
        ? input.evidence
        : {};
    const recordedAt = String(input.recorded_at || new Date().toISOString());
    const requestedFqdn = String(input.requested_fqdn || evidence.requested_fqdn || joinRequest.requested_fqdn || joinRequest.host_domain || '')
        .trim()
        .toLowerCase();

    if (artifactType === 'issuer_reachable') {
        const issuerMetadata = evidence.issuer_metadata && typeof evidence.issuer_metadata === 'object'
            ? evidence.issuer_metadata
            : {};
        const issuerNodeId = issuerMetadata.node_id || evidence.node_id;
        if (issuerNodeId && String(issuerNodeId) !== String(joinRequest.node_id)) {
            const error = new Error('issuer_node_id_mismatch');
            error.statusCode = 409;
            error.expected = joinRequest.node_id;
            error.received = String(issuerNodeId);
            throw error;
        }
    }

    const artifactIdBasis = stableStringify({
        request_id: joinRequest.request_id,
        artifact_type: artifactType,
        requested_fqdn: requestedFqdn,
        evidence,
    });
    const artifactId = input.artifact_id || `sl1ns_${sha256Hex(artifactIdBasis).slice(0, 24)}`;
    const declaration = {
        schema_version: String(input.schema_version || 'simple-l1.network.namespace_artifact.v1'),
        artifact_id: String(artifactId),
        request_id: joinRequest.request_id,
        request_hash: joinRequest.request_hash,
        network_id: joinRequest.network_id,
        artifact_type: artifactType,
        requested_fqdn: requestedFqdn,
        evidence,
        recorded_at: recordedAt,
    };

    const artifactHash = `sha256:${sha256Hex(stableStringify(declaration))}`;
    if (input.artifact_hash && String(input.artifact_hash) !== artifactHash) {
        const error = new Error('artifact_hash_mismatch');
        error.statusCode = 422;
        error.expected = artifactHash;
        error.received = String(input.artifact_hash);
        throw error;
    }

    return {
        ...declaration,
        artifact_hash: artifactHash,
        bridge_role: 'discovery_inbox_only',
        invariants: [
            'dns_allocation != peer_admission',
            'cloudflare_api != federation_authority',
            'dns_provider != federation_authority',
            'issuer_reachable != local_trust',
        ],
    };
};

const truthyEnv = (value) => ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase());

const namespaceAutoAllocateEnabled = () => truthyEnv(process.env.SL1_NAMESPACE_AUTO_ALLOCATE);

const cloudflareConfig = () => ({
    apiToken: String(process.env.CLOUDFLARE_API_TOKEN || '').trim(),
    zoneId: String(process.env.CLOUDFLARE_ZONE_ID || '').trim(),
    zoneName: String(process.env.CLOUDFLARE_ZONE_NAME || process.env.SL1_NAMESPACE_ZONE || 'simplel1.online').trim().toLowerCase(),
    proxied: truthyEnv(process.env.CLOUDFLARE_PROXIED),
});

const cloudflareRequest = async (method, apiPath, body = null) => {
    const config = cloudflareConfig();
    if (!config.apiToken) {
        const error = new Error('cloudflare_token_not_configured');
        error.statusCode = 503;
        error.required_env = 'CLOUDFLARE_API_TOKEN';
        throw error;
    }

    const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
        method,
        headers: {
            Authorization: `Bearer ${config.apiToken}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
        const error = new Error('cloudflare_api_error');
        error.statusCode = 502;
        error.cloudflare_status = response.status;
        error.cloudflare_errors = payload.errors || [];
        throw error;
    }
    return payload;
};

const resolveCloudflareZoneId = async (zoneName) => {
    const config = cloudflareConfig();
    if (config.zoneId) return config.zoneId;

    const payload = await cloudflareRequest('GET', `/zones?name=${encodeURIComponent(zoneName)}`);
    const result = Array.isArray(payload.result) ? payload.result : [];
    if (!result[0]?.id) {
        const error = new Error('cloudflare_zone_not_found');
        error.statusCode = 404;
        error.zone = zoneName;
        throw error;
    }
    return result[0].id;
};

const upsertCloudflareARecord = async ({ zoneId, fqdn, ip, proxied }) => {
    const lookup = await cloudflareRequest('GET', `/zones/${encodeURIComponent(zoneId)}/dns_records?type=A&name=${encodeURIComponent(fqdn)}`);
    const existing = Array.isArray(lookup.result) ? lookup.result[0] : null;
    const recordPayload = {
        type: 'A',
        name: fqdn,
        content: ip,
        ttl: 1,
        proxied,
    };
    const response = existing?.id
        ? await cloudflareRequest('PUT', `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`, recordPayload)
        : await cloudflareRequest('POST', `/zones/${encodeURIComponent(zoneId)}/dns_records`, recordPayload);
    const recordId = response.result?.id;
    if (!recordId) {
        const error = new Error('cloudflare_record_id_missing');
        error.statusCode = 502;
        throw error;
    }
    return recordId;
};

const recordNamespaceArtifact = (store, joinRequest, artifactInput) => {
    const artifact = normalizeNamespaceArtifact(joinRequest, artifactInput);

    const existingByHash = store.namespace_artifacts.find((candidate) => candidate.artifact_hash === artifact.artifact_hash);
    if (existingByHash) {
        return {
            statusCode: 200,
            response: {
                protocol: 'simple-l1',
                status: 'duplicate_observed',
                bridge_role: 'discovery_inbox_only',
                namespace_artifact: existingByHash,
            },
        };
    }

    const existingById = store.namespace_artifacts.find((candidate) => candidate.artifact_id === artifact.artifact_id);
    if (existingById) {
        return {
            statusCode: 200,
            response: {
                protocol: 'simple-l1',
                status: 'duplicate_observed',
                bridge_role: 'discovery_inbox_only',
                namespace_artifact: existingById,
            },
        };
    }

    if (artifact.artifact_type === 'dns_allocated') {
        const conflictingAllocation = store.namespace_artifacts.find((candidate) => (
            candidate.artifact_type === 'dns_allocated' &&
            candidate.network_id === artifact.network_id &&
            candidate.requested_fqdn === artifact.requested_fqdn &&
            candidate.request_id !== artifact.request_id
        ));
        if (conflictingAllocation) {
            const error = new Error('namespace_allocation_conflict');
            error.statusCode = 409;
            error.requested_fqdn = artifact.requested_fqdn;
            error.existing_request_id = conflictingAllocation.request_id;
            error.received_request_id = artifact.request_id;
            throw error;
        }
    }

    const storedArtifact = {
        ...artifact,
        observed_at: new Date().toISOString(),
        bridge_node_id: NODE_ID,
    };
    store.namespace_artifacts.push(storedArtifact);

    return {
        statusCode: 201,
        response: {
            protocol: 'simple-l1',
            status: 'observed',
            bridge_role: 'discovery_inbox_only',
            namespace_artifact: storedArtifact,
        },
    };
};

const findExistingDnsAllocationArtifact = (store, joinRequest, requestedFqdn) => (
    store.namespace_artifacts.find((candidate) => (
        candidate.artifact_type === 'dns_allocated' &&
        candidate.network_id === joinRequest.network_id &&
        candidate.request_id === joinRequest.request_id &&
        candidate.requested_fqdn === requestedFqdn
    )) || null
);

const allocateNamespaceDns = async (store, joinRequest, input = {}) => {
    const provider = String(input.provider || 'cloudflare').trim().toLowerCase();
    if (provider !== 'cloudflare') {
        const error = new Error('unsupported_dns_provider');
        error.statusCode = 422;
        error.provider = provider;
        throw error;
    }

    const config = cloudflareConfig();
    const zone = String(input.zone || config.zoneName).trim().toLowerCase();
    const requestedFqdn = String(joinRequest.requested_fqdn || joinRequest.host_domain || '').trim().toLowerCase();
    const serverIp = String(input.ip || input.server_ip || joinRequest.server_ip || '').trim();
    const proxied = input.proxied === undefined ? config.proxied : truthyEnv(input.proxied);

    if (!requestedFqdn || !(requestedFqdn === zone || requestedFqdn.endsWith(`.${zone}`))) {
        const error = new Error('requested_fqdn_outside_namespace_zone');
        error.statusCode = 422;
        error.requested_fqdn = requestedFqdn;
        error.zone = zone;
        throw error;
    }

    if (!serverIp) {
        const error = new Error('server_ip_required');
        error.statusCode = 422;
        throw error;
    }

    const existingAllocation = findExistingDnsAllocationArtifact(store, joinRequest, requestedFqdn);
    if (existingAllocation) {
        return {
            statusCode: 200,
            response: {
                protocol: 'simple-l1',
                status: 'duplicate_observed',
                bridge_role: 'discovery_inbox_only',
                namespace_artifact: existingAllocation,
            },
            allocation: existingAllocation.evidence || {
                provider: 'cloudflare',
                zone,
                requested_fqdn: requestedFqdn,
                server_ip: serverIp,
            },
        };
    }

    const zoneId = await resolveCloudflareZoneId(zone);
    const recordId = await upsertCloudflareARecord({
        zoneId,
        fqdn: requestedFqdn,
        ip: serverIp,
        proxied,
    });
    const allocationPolicy = {
        mode: namespaceAutoAllocateEnabled() ? 'auto' : 'manual',
        reason: namespaceAutoAllocateEnabled()
            ? 'SL1_NAMESPACE_AUTO_ALLOCATE=true'
            : 'manual allocation path',
        namespace_zone: zone,
        request_status: joinRequest.status || null,
        trigger_source: namespaceAutoAllocateEnabled() ? 'join_request_observed' : 'operator_replay',
        bridge_node_id: NODE_ID,
    };

    const recorded = recordNamespaceArtifact(store, joinRequest, {
        artifact_type: 'dns_allocated',
        requested_fqdn: requestedFqdn,
        evidence: {
            provider: 'cloudflare',
            zone,
            zone_id: zoneId,
            requested_fqdn: requestedFqdn,
            server_ip: serverIp,
            record_id: recordId,
            proxied,
            allocation_policy: allocationPolicy,
        },
    });

    return {
        ...recorded,
        allocation: {
            provider: 'cloudflare',
            zone,
            requested_fqdn: requestedFqdn,
            server_ip: serverIp,
            record_id: recordId,
            proxied,
            allocation_policy: allocationPolicy,
        },
    };
};

const accountCredentials = (account) => {
    const seen = new Set();
    const revokedCredentialIds = new Set((account?.keys || [])
        .filter((key) => key.status === 'revoked')
        .map((key) => String(key.credentialId || key.credential_id || ''))
        .filter(Boolean));
    return [
        account,
        ...(account?.keys || []),
    ].filter(Boolean)
        .filter(candidate => candidate.status !== 'revoked' && candidate.credential_status !== 'revoked')
        .filter(candidate => candidate.credentialId || candidate.credential_id)
        .filter(candidate => !revokedCredentialIds.has(String(candidate.credentialId || candidate.credential_id)))
        .filter(candidate => {
            const id = String(candidate.credentialId || candidate.credential_id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
};

const verifiableAccountCredentials = (account) => accountCredentials(account)
    .filter(candidate => candidate.credentialPublicKey || candidate.credential_public_key);

const allVerifiableCredentials = () => {
    const seen = new Set();
    return Object.values(ledger.accounts || {}).flatMap((account) => {
        return verifiableAccountCredentials(account).map((credential) => ({ account, credential }));
    }).filter(({ credential }) => {
        const id = String(credential.credentialId || credential.credential_id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

const firstVerifiableAccount = () => allVerifiableCredentials()[0]?.account || null;

const verifiableIdentityOptions = () => Object.values(ledger.accounts || {})
    .filter(account => verifiableAccountCredentials(account).length > 0)
    .map(account => {
        const entityAddress = account.entity_l1_address || account.address || '';
        const label = accountVisibleAlias(account) || accountDisplayName(account) || shortAddress(entityAddress);
        return {
            entity_l1_address: entityAddress,
            label,
        };
    })
    .filter(option => option.entity_l1_address)
    .sort((left, right) => String(left.label || '').localeCompare(String(right.label || '')));

const normalizeIdentityHint = (value) => String(value || '').trim().toLowerCase();

const accountMatchesIdentityHint = (account, identityHint) => {
    const hint = normalizeIdentityHint(identityHint);
    if (!hint || !account) return false;
    const aliasHint = normalizeAlias(identityHint);

    const directMatch = [
        account.entity_l1_address,
        account.address,
        account.alias,
        account.display_alias,
        publicAlias(account.alias),
        accountVisibleAlias(account),
    ].some((candidate) => normalizeIdentityHint(candidate) === hint);

    if (directMatch) return true;

    return Boolean(aliasHint) && [
        account.alias,
        account.display_alias,
        publicAlias(account.alias),
    ].some((candidate) => normalizeAlias(candidate) === aliasHint);
};

const hintedVerifiableAccount = (query) => {
    const identityHint = query.identity_hint || query.login_hint || query.entity_l1_address;
    if (!identityHint) return null;

    return Object.values(ledger.accounts || {})
        .find((account) => accountMatchesIdentityHint(account, identityHint)
            && verifiableAccountCredentials(account).length > 0) || null;
};

const verifiableCredentialsForQuery = (query) => {
    const hintedAccount = hintedVerifiableAccount(query);
    if (!hintedAccount) return allVerifiableCredentials();

    return verifiableAccountCredentials(hintedAccount)
        .map((credential) => ({ account: hintedAccount, credential }));
};

const controllerBindingId = (entityAddress, keyAddress, credentialId) =>
    `cb_${crypto.createHash('sha256').update(`${entityAddress}:${keyAddress}:${credentialId}`).digest('hex').slice(0, 20)}`;

const controllerBindingHash = (binding) => sha256Hex(stableStringify({
    object_type: binding.object_type,
    version: binding.version,
    binding_id: binding.binding_id,
    entity_l1_address: binding.entity_l1_address,
    controller_type: binding.controller_type,
    controller_key_l1: binding.controller_key_l1,
    credential_id: binding.credential_id,
    credential_public_key: binding.credential_public_key,
    rp_id: binding.rp_id,
    registration_transcript_hash: binding.registration_transcript_hash,
}));

const identityCapsuleEvidenceHash = (capsule) => sha256Hex(stableStringify({
    protocol: capsule.protocol,
    object_type: capsule.object_type,
    version: capsule.version,
    evidence_role: capsule.evidence_role,
    genesis: capsule.genesis,
    controller_bindings: capsule.controller_bindings,
}));

const currentIdentityStateProof = (source = 'local-ledger') => ({
    object_type: 'StateProof',
    version: STATE_PROOF_VERSION,
    source,
    state_root: ledger.state_root || calculateStateRoot(),
    epoch: Number(ledger.governance?.current_epoch || 0),
    issued_at: new Date().toISOString(),
});

const identityGenesisEvidence = (account, credential) => {
    const entityAddress = account?.entity_l1_address || account?.address;
    const keyAddress = credential?.key_l1_address || account?.key_l1_address;
    const payload = {
        object_type: 'IdentityGenesis',
        entity_l1_address: entityAddress,
        genesis_timestamp: credential?.registered_at || account?.registered_at || null,
        genesis_hash: null,
        controller_key_l1: keyAddress,
        handle: account?.handle || null,
        alias: account?.alias || null,
        display_alias: account?.display_alias || account?.displayAlias || null,
        protocol_epoch: Number(ledger.governance?.current_epoch || 0),
    };

    payload.genesis_hash = sha256Hex(stableStringify({
        object_type: payload.object_type,
        entity_l1_address: payload.entity_l1_address,
        genesis_timestamp: payload.genesis_timestamp,
        controller_key_l1: payload.controller_key_l1,
        handle: payload.handle,
        alias: payload.alias,
        display_alias: payload.display_alias,
        protocol_epoch: payload.protocol_epoch,
    }));

    return payload;
};

const controllerBindingEvidence = (account, credential, transcript = {}) => {
    const entityAddress = account?.entity_l1_address || account?.address;
    const credentialPublicKey = credential?.credentialPublicKey || credential?.credential_public_key;
    const keyAddress = credential?.key_l1_address || account?.key_l1_address || identityKernel.keyAddressFromPublicKey(credentialPublicKey);
    const credentialId = String(credential?.credentialId || credential?.credential_id || '');
    const binding = {
        object_type: 'ControllerBinding',
        version: 'simple-l1.controller-binding.v0',
        binding_id: controllerBindingId(entityAddress, keyAddress, credentialId),
        entity_l1_address: entityAddress,
        controller_type: 'passkey',
        controller_key_l1: keyAddress,
        key_l1_address: keyAddress,
        credential_id: credentialId,
        credential_public_key: credentialPublicKey,
        rp_id: credential?.rp_id || account?.rp_id || null,
        created_at: credential?.registered_at || account?.registered_at || null,
        revocation_epoch: null,
        registration_transcript_hash: sha256Hex(stableStringify({
            rp_id: credential?.rp_id || account?.rp_id || null,
            credential_id: credentialId,
            credential_public_key_hash: credentialPublicKey ? sha256Hex(String(credentialPublicKey)) : null,
            ...transcript,
        })),
    };

    binding.binding_hash = controllerBindingHash(binding);

    return binding;
};

const identityCapsuleForAccount = (account, transcript = {}) => {
    const credential = verifiableAccountCredentials(account)[0];
    if (!account || !credential) return null;

    const capsule = {
        protocol: 'simple-l1',
        object_type: 'IdentityCapsule',
        version: IDENTITY_CAPSULE_VERSION,
        evidence_role: 'immutable_provenance',
        genesis: identityGenesisEvidence(account, credential),
        controller_bindings: [
            controllerBindingEvidence(account, credential, transcript),
        ],
    };

    capsule.evidence_hash = identityCapsuleEvidenceHash(capsule);

    return capsule;
};

const identityPortabilityPayload = (account, transcript = {}) => {
    const capsule = identityCapsuleForAccount(account, transcript);
    if (!capsule) return {};

    const entityAddress = account?.entity_l1_address || account?.address || capsule.genesis?.entity_l1_address || null;
    return {
        identity_capsule: capsule,
        state_proof: currentIdentityStateProof('local-ledger'),
        portability_contract: {
            version: 'meanly-one.identity-portability.v1',
            identity_l1_address: entityAddress,
            invariant: 'identity_address_must_never_change',
            create_identity_semantics: 'add_first_controller',
            native_link_semantics: 'approve_additional_controller',
        },
    };
};

const parseIdentityCapsule = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;

    const text = String(value).trim();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch (error) {
        // Continue to compact base64url form.
    }

    const compact = text.startsWith('sl1capsule_') ? text.slice('sl1capsule_'.length) : text;
    try {
        return JSON.parse(Buffer.from(compact, 'base64url').toString('utf8'));
    } catch (error) {
        return null;
    }
};

const localRevocationMatches = (binding) => {
    const bindingId = String(binding?.binding_id || binding?.id || '');
    const credentialId = String(binding?.credential_id || '');

    return (ledger.controller_bindings || []).some((candidate) => {
        const sameBinding = bindingId && String(candidate.id || candidate.binding_id || '') === bindingId;
        const sameCredential = credentialId && String(candidate.credential_id || '') === credentialId;
        return (sameBinding || sameCredential) && String(candidate.status || '') === 'revoked';
    });
};

const verifiedCapsuleOwner = (capsuleInput, hostname, query = {}) => {
    const capsule = parseIdentityCapsule(capsuleInput);
    if (!capsule) return null;
    if (capsule.object_type !== 'IdentityCapsule' || capsule.version !== IDENTITY_CAPSULE_VERSION) {
        return { error: 'identity_capsule_unsupported', statusCode: 422 };
    }

    const binding = (capsule.controller_bindings || [])[0];
    if (!binding) return { error: 'identity_capsule_missing_controller_binding', statusCode: 422 };
    if (!capsule.evidence_hash || capsule.evidence_hash !== identityCapsuleEvidenceHash(capsule)) {
        return { error: 'identity_capsule_evidence_hash_mismatch', statusCode: 403 };
    }
    if (!binding.binding_hash || binding.binding_hash !== controllerBindingHash(binding)) {
        return { error: 'identity_capsule_binding_hash_mismatch', statusCode: 403 };
    }

    const entityAddress = identityKernel.normalizeEntityAddress(capsule.genesis?.entity_l1_address || binding.entity_l1_address);
    const credentialId = String(binding.credential_id || '');
    const credentialPublicKey = String(binding.credential_public_key || binding.credentialPublicKey || '');
    const keyAddress = identityKernel.normalizeKeyAddress(binding.controller_key_l1 || binding.key_l1_address);
    if (!entityAddress || !credentialId || !credentialPublicKey || !keyAddress) {
        return { error: 'identity_capsule_incomplete', statusCode: 422 };
    }
    if (identityKernel.keyAddressFromPublicKey(credentialPublicKey) !== keyAddress) {
        return { error: 'identity_capsule_key_derivation_mismatch', statusCode: 403 };
    }
    if (binding.rp_id && String(binding.rp_id) !== rpIdForHost(hostname)) {
        return { error: 'identity_capsule_rp_mismatch', statusCode: 403 };
    }
    if (localRevocationMatches(binding)) {
        return { error: 'identity_capsule_controller_revoked', statusCode: 403 };
    }

    const hint = query.identity_hint || query.login_hint || query.entity_l1_address;
    if (hint && !accountMatchesIdentityHint({
        entity_l1_address: entityAddress,
        address: entityAddress,
        alias: capsule.genesis?.alias || null,
        display_alias: capsule.genesis?.display_alias || null,
    }, hint)) {
        return { error: 'identity_capsule_hint_mismatch', statusCode: 403 };
    }

    const account = {
        entity_l1_address: entityAddress,
        address: entityAddress,
        key_l1_address: keyAddress,
        handle: capsule.genesis?.handle || entityAddress,
        alias: capsule.genesis?.alias || null,
        display_alias: capsule.genesis?.display_alias || null,
        rp_id: binding.rp_id || rpIdForHost(hostname),
        keys: [{
            key_l1_address: keyAddress,
            credentialId,
            credential_id: credentialId,
            credentialPublicKey,
            credential_public_key: credentialPublicKey,
            counter: Number(binding.counter || 0),
            transports: binding.transports || ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
            rp_id: binding.rp_id || rpIdForHost(hostname),
            role: 'primary',
            status: 'active',
            registered_at: binding.created_at || capsule.genesis?.genesis_timestamp || null,
        }],
        balances: { SL: 0, BTC: 0, ETH: 0 },
        provenance_log: [],
        nonce: 0,
    };

    return {
        source: 'identity_capsule',
        assurance_level: 'AL1',
        account,
        credential: account.keys[0],
        capsule,
        state_proof: currentIdentityStateProof('local-cache'),
    };
};

const rememberVerifiedCapsuleOwner = (owner) => {
    if (!owner || owner.source !== 'identity_capsule') return false;

    const entityAddress = owner.account.entity_l1_address || owner.account.address;
    if (!entityAddress) return false;
    if (ledger.accounts?.[entityAddress]) {
        ledger.accounts[entityAddress].identity_source = ledger.accounts[entityAddress].identity_source || 'local-ledger';
        return false;
    }

    ledger.accounts[entityAddress] = {
        ...owner.account,
        identity_source: 'rebuilt_from_capsule',
        restored_from_capsule_at: new Date().toISOString(),
    };
    ledger.controller_bindings = ledger.controller_bindings || [];
    ledger.controller_bindings.push({
        id: controllerBindingId(entityAddress, owner.credential.key_l1_address, owner.credential.credentialId),
        object_type: 'ControllerBinding',
        entity_l1_address: entityAddress,
        controller_l1_address: owner.credential.key_l1_address,
        key_l1_address: owner.credential.key_l1_address,
        credential_id: owner.credential.credentialId,
        credential_public_key: owner.credential.credentialPublicKey,
        credentialPublicKey: owner.credential.credentialPublicKey,
        rp_id: owner.credential.rp_id,
        status: 'active',
        source: 'IDENTITY_CAPSULE_REHYDRATED',
        created_at: new Date().toISOString(),
    });
    ledger.state_root = calculateStateRoot();
    saveLedger();
    return true;
};

const shortAddress = (value) => {
    const address = String(value || '');
    if (address.length <= 18) return address;
    return `${address.slice(0, 9)}…${address.slice(-6)}`;
};

const CYRILLIC_TRANSLITERATION = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
    ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const transliterateCyrillic = (value) => Array.from(String(value || ''))
    .map((char) => CYRILLIC_TRANSLITERATION[char] ?? char)
    .join('');

const stripAliasDecorations = (value) => {
    const raw = String(value || '').trim().toLowerCase().normalize('NFKC');
    return raw
        .replace(/^@+/, '')
        .replace(/\.sl1\.one$/, '')
        .replace(/@simplelayer\.one$/, '')
        .replace(/@sl1$/, '')
        .split('@', 1)[0];
};

const aliasInputLabel = (value) => stripAliasDecorations(value);

const normalizeLocale = (value) => {
    const locale = String(value || '').trim().toLowerCase().replace('_', '-');
    if (locale.startsWith('ru')) return 'ru';
    return 'en';
};

const normalizeAlias = (value) => {
    const label = aliasInputLabel(value);
    const normalized = transliterateCyrillic(label)
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24)
        .replace(/-$/g, '');
    return normalized ? `${normalized}.sl1.one` : null;
};

const normalizeDisplayAlias = (value) => {
    const label = aliasInputLabel(value);
    const normalized = label
        .replace(/\s+/gu, '-')
        .replace(/[^\p{L}\p{N}-]+/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24)
        .replace(/-$/g, '');
    return normalized || null;
};

const aliasValidationError = (alias) => {
    const rawLabel = aliasInputLabel(alias);
    if (!rawLabel) return 'alias_required';
    if (/[^\p{L}\p{N}\s-]/u.test(rawLabel)) return 'alias_invalid_format';
    if (/^-|-$/.test(rawLabel.trim()) || /-{2,}/.test(rawLabel)) return 'alias_invalid_format';

    const canonical = normalizeAlias(rawLabel);
    const label = canonical ? aliasDisplayName(canonical) : '';
    if (!label) return 'alias_required';
    if (label.length < 3) return 'alias_too_short';
    if (label.length > 24) return 'alias_too_long';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)) return 'alias_invalid_format';
    return null;
};

const aliasValidationMessage = (error) => ({
    alias_required: 'Choose your SL1 username first.',
    alias_too_short: 'Username must be at least 3 characters.',
    alias_too_long: 'Username must be 24 characters or less.',
    alias_invalid_format: 'Use letters, numbers, spaces, and single hyphens only.',
}[error] || 'Username is not available.');

const publicAlias = (value) => {
    const alias = normalizeAlias(value);
    return alias ? `@${alias}` : null;
};

const aliasDisplayName = (value) => {
    const alias = normalizeAlias(value);
    if (!alias) return null;
    return alias.replace(/\.sl1\.one$/, '') || null;
};

const accountDisplayName = (account) => {
    return normalizeDisplayAlias(account?.display_alias || account?.displayAlias)
        || aliasDisplayName(account?.alias)
        || null;
};

const accountVisibleAlias = (account) => {
    const name = accountDisplayName(account);
    return name ? `@${name}` : null;
};

const passkeyAccountLabel = ({ alias, displayAlias, handle, fallback }) => {
    const name = normalizeDisplayAlias(displayAlias)
        || aliasDisplayName(alias)
        || aliasDisplayName(handle)
        || aliasDisplayName(fallback)
        || String(fallback || handle || 'sl1-identity');

    return name.startsWith('@') ? name : `@${name}`;
};

const releaseAliasReservation = (alias, ownerId) => {
    if (!alias || !ownerId) return;
    const reservation = sl1eRuntimeStore.get('aliasReservations', alias);
    if (reservation?.ownerId === ownerId) {
        sl1eRuntimeStore.delete('aliasReservations', alias);
    }
};

const aliasAvailable = (alias, ownerId = null) => {
    if (!alias) return true;
    const ledgerHasAlias = Object.values(ledger.accounts || {})
        .some((account) => normalizeAlias(account.alias) === alias);
    if (ledgerHasAlias) return false;

    const reservation = sl1eRuntimeStore.get('aliasReservations', alias);
    return !reservation || reservation.expiresAtMs <= Date.now() || reservation.ownerId === ownerId;
};

const reserveAlias = (alias, ownerId, expiresAtMs) => {
    if (!alias) return true;
    if (!aliasAvailable(alias, ownerId)) return false;

    sl1eRuntimeStore.set('aliasReservations', alias, { ownerId, expiresAtMs });
    return true;
};

const transferAliasReservation = (alias, fromOwnerId, toOwnerId, expiresAtMs) => {
    if (!alias || !fromOwnerId || !toOwnerId) return false;
    const reservation = sl1eRuntimeStore.get('aliasReservations', alias);
    if (!reservation || reservation.expiresAtMs <= Date.now()) {
        sl1eRuntimeStore.delete('aliasReservations', alias);
        return reserveAlias(alias, toOwnerId, expiresAtMs);
    }
    if (reservation.ownerId !== fromOwnerId) return false;

    sl1eRuntimeStore.set('aliasReservations', alias, { ownerId: toOwnerId, expiresAtMs });
    return true;
};

const findCredentialOwner = (credentialId) => {
    for (const account of Object.values(ledger.accounts || {})) {
        const credential = accountCredentials(account)
            .find(candidate => String(candidate.credentialId || candidate.credential_id) === String(credentialId));
        if (credential) {
            return { account, credential };
        }
    }

    return null;
};

const cleanupSl1eArtifacts = () => {
    sl1eRuntimeStore.cleanup({
        registrationChallenges: (_id, record) => releaseAliasReservation(record.alias, record.aliasReservationOwner),
        deviceHandoffs: (_id, record) => releaseAliasReservation(record.alias, record.aliasReservationOwner),
    });
};

const authorizationRedirectUrl = (query, code) => {
    const target = new URL(String(query.redirect_uri));
    target.searchParams.set('state', String(query.state));
    target.searchParams.set('code', code);

    return target.toString();
};

const prepareAuthorizeQuery = (rawQuery, options = {}) => {
    return normalizeAuthorizeQuery(rawQuery, options);
};

// Parameters the user supplies during the ceremony (on connect.identity.*),
// not at PAR push time. These must survive request_ref resolution, but must
// never override the issuer-owned stored request (client_id, redirect_uri,
// state, nonce, scope remain authoritative).
const CEREMONY_INTERACTIVE_PARAMS = [
    'alias',
    'display_alias',
    'alias_locale',
    'ui_locale',
    'alias_reservation_owner',
    'identity_hint',
    'login_hint',
    'entity_l1_address',
    'browser_identity_hint',
    'remembered_identity_hint',
    'identity_capsule',
    'sl1e_switch',
];

const ceremonyInteractiveOverlay = (liveQuery = {}) => {
    const overlay = {};
    for (const key of CEREMONY_INTERACTIVE_PARAMS) {
        const value = liveQuery[key];
        if (value !== undefined && value !== null && String(value) !== '') {
            overlay[key] = value;
        }
    }
    return overlay;
};

const authorizeQueryFromRequest = (request, options = {}) => {
    if (options.requestRef || request.query?.request_ref) {
        const resolved = resolveAuthorizeRequestRef(
            sl1eRuntimeStore,
            options.requestRef || request.query.request_ref,
        );
        if (!resolved.ok) {
            return resolved;
        }
        return {
            ok: true,
            query: {
                ...ceremonyInteractiveOverlay(request.query || {}),
                ...resolved.query,
                __spa_path: '/authorize',
                request_ref: options.requestRef || request.query.request_ref,
            },
        };
    }

    const normalized = prepareAuthorizeQuery(request.query || {}, options);
    if (!normalized.ok) {
        return normalized;
    }

    return {
        ok: true,
        query: {
            ...normalized.query,
            __spa_path: '/authorize',
        },
    };
};

const sendAuthorizeValidationError = (reply, result) => reply.code(422).send({
    error: result.error || 'invalid_authorization_request',
    missing: result.missing,
});

const proofIntentFromQuery = (query) => {
    const type = String(query.intent_type || '').trim();
    if (!type) return null;

    return {
        type,
        title: String(query.intent_title || '').trim() || undefined,
        description: String(query.intent_description || '').trim() || undefined,
        cta: String(query.intent_cta || '').trim() || undefined,
        nonce: String(query.intent_nonce || '').trim() || undefined,
        resource: String(query.intent_resource || '').trim() || undefined,
    };
};

const signedToken = (payload, ttlMs) => {
    const body = {
        ...payload,
        exp: Date.now() + ttlMs,
        iat: Date.now(),
        jti: crypto.randomBytes(12).toString('base64url'),
    };
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = crypto.createHmac('sha256', SL1_CONNECT_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
};

const verifySignedToken = (token, expected = {}) => {
    const [encoded, signature] = String(token || '').split('.');
    if (!encoded || !signature) return null;
    const expectedSignature = crypto.createHmac('sha256', SL1_CONNECT_SECRET).update(encoded).digest('base64url');
    if (signature.length !== expectedSignature.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch (error) {
        return null;
    }
    if (!payload.exp || payload.exp <= Date.now()) return null;
    for (const [key, value] of Object.entries(expected)) {
        if (value !== undefined && String(payload[key] || '') !== String(value)) return null;
    }
    return payload;
};

const ownerTokenSubject = (request) => {
    const ua = String(request.headers['user-agent'] || '').slice(0, 120);
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(`${ip}:${ua}`).digest('base64url');
};

const browserOwnerToken = (request) => signedToken({
    typ: 'alias_reservation_owner',
    sub: ownerTokenSubject(request),
}, 5 * 60 * 1000);

const verifyBrowserOwnerToken = (_request, token) => verifySignedToken(token, {
    typ: 'alias_reservation_owner',
});

const identitySessionToken = (entityAddress) => signedToken({
    typ: 'identity_management_session',
    entity_l1_address: entityAddress,
}, 10 * 60 * 1000);

const requireIdentitySession = (request, reply, entityAddress) => {
    const header = String(request.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const token = bearer || request.body?.identity_session_token || request.query?.identity_session_token;
    const payload = verifySignedToken(token, {
        typ: 'identity_management_session',
        entity_l1_address: entityAddress,
    });
    if (!payload) {
        reply.code(401).send({ error: 'identity_session_required' });
        return null;
    }
    return payload;
};

const checkRateLimit = (request, reply, bucket, limit = 30, windowMs = 60 * 1000) => {
    const subject = request.ip || request.socket?.remoteAddress || 'unknown';
    const result = sl1eRuntimeStore.incrementRateLimit(`${bucket}:${subject}`, { limit, windowMs });
    if (result.allowed) return true;
    reply
        .code(429)
        .header('Retry-After', String(Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000))))
        .send({ error: 'rate_limited' });
    return false;
};

const createSl1eAuthenticationOptions = (query, hostname, extraChallenge = {}) => {
    const capsuleOwner = verifiedCapsuleOwner(query.identity_capsule || query.identityCapsule, hostname, query);
    if (capsuleOwner?.error) {
        return {
            statusCode: capsuleOwner.statusCode || 422,
            payload: { error: capsuleOwner.error },
        };
    }

    const localVerifiableCredentials = verifiableCredentialsForQuery(query);
    const verifiableCredentials = capsuleOwner
        ? [
            capsuleOwner,
            ...localVerifiableCredentials.filter(({ credential }) =>
                String(credential.credentialId || credential.credential_id) !== String(capsuleOwner.credential.credentialId || capsuleOwner.credential.credential_id)
            ),
        ]
        : localVerifiableCredentials;

    if (Object.keys(ledger.accounts || {}).length === 0 && !capsuleOwner) {
        return { statusCode: 404, payload: { error: 'no_identity_account_registered' } };
    }

    const credentials = verifiableCredentials.map(({ credential }) => credential);
    if (credentials.length === 0) {
        return {
            statusCode: 409,
            payload: {
                error: 'no_verifiable_passkey_registered_for_identity',
                detail: 'Register a passkey credentialPublicKey with this Connect issuer before issuing production IdentityProof artifacts.',
            },
        };
    }

    const authorizationRequestId = `sl1ar_${crypto.randomBytes(18).toString('hex')}`;
    const challenge = base64UrlFromBuffer(crypto.randomBytes(32));
    const rpId = rpIdForHost(hostname);

    sl1eRuntimeStore.set('authChallenges', authorizationRequestId, {
        challenge,
        query: { ...query },
        rpId,
        origin: originForHost(hostname),
        expiresAtMs: Date.now() + 2 * 60 * 1000,
        capsuleOwner: capsuleOwner || null,
        assurance_level: capsuleOwner?.assurance_level || 'AL2',
        credential_source: capsuleOwner ? 'capsule_binding' : 'local_ledger',
        ledger_lookup: !capsuleOwner,
        ...extraChallenge,
    });

    const publicKey = {
        challenge,
        timeout: 60000,
        rpId,
        userVerification: 'preferred',
    };

    if (credentials.length === 1) {
        publicKey.allowCredentials = credentials.map((credential) => ({
            id: String(credential.credentialId || credential.credential_id),
            type: 'public-key',
            transports: credential.transports || ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
        }));
    }

    return {
        statusCode: 200,
        payload: {
            authorization_request_id: authorizationRequestId,
            assurance_level: capsuleOwner?.assurance_level || 'AL2',
            evidence_source: capsuleOwner ? 'identity_capsule' : 'local-ledger',
            credential_source: capsuleOwner ? 'capsule_binding' : 'local_ledger',
            ledger_lookup: !capsuleOwner,
            state_proof: capsuleOwner?.state_proof || currentIdentityStateProof('local-ledger'),
            publicKey,
        },
    };
};

const verifySl1eAuthenticationChallenge = async (authorizationRequestId, assertion) => {
    const challengeRecord = sl1eRuntimeStore.get('authChallenges', String(authorizationRequestId || ''));
    if (!challengeRecord) {
        const error = new Error('authorization_challenge_not_found');
        error.statusCode = 404;
        throw error;
    }

    const credentialId = String(assertion?.id || assertion?.rawId || '');
    const capsuleOwner = challengeRecord.capsuleOwner;
    const localOwner = findCredentialOwner(credentialId);
    const localOwnerHasPublicKey = Boolean(localOwner?.credential?.credentialPublicKey || localOwner?.credential?.credential_public_key);
    const capsuleMatchesCredential = String(capsuleOwner?.credential?.credentialId || capsuleOwner?.credential?.credential_id || '') === credentialId;
    const owner = localOwnerHasPublicKey
        ? localOwner
        : (capsuleMatchesCredential ? capsuleOwner : localOwner);
    if (!owner) {
        const error = new Error('credential_not_bound_to_identity');
        error.statusCode = 403;
        throw error;
    }

    const storedKey = owner.credential.credentialPublicKey || owner.credential.credential_public_key;
    const publicKey = bufferFromStoredKey(storedKey);
    if (!publicKey) {
        const error = new Error('credential_public_key_not_available');
        error.statusCode = 409;
        throw error;
    }

    const verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: challengeRecord.origin,
        expectedRPID: challengeRecord.rpId,
        credential: {
            id: credentialId,
            publicKey,
            counter: Number(owner.credential.counter || 0),
            transports: owner.credential.transports || undefined,
        },
        requireUserVerification: false,
    });

    if (!verification.verified) {
        const error = new Error('passkey_verification_failed');
        error.statusCode = 403;
        throw error;
    }

    owner.credential.counter = verification.authenticationInfo?.newCounter ?? owner.credential.counter ?? 0;
    const projectionRebuilt = rememberVerifiedCapsuleOwner(owner);
    sl1eRuntimeStore.delete('authChallenges', String(authorizationRequestId));

    return {
        ...owner,
        credentialId,
        challengeRecord,
        assertion_verified: true,
        projection_rebuilt: projectionRebuilt,
        identity_restored: owner.source === 'identity_capsule',
        verification,
    };
};

const issueSl1eProof = (query, verifiedAccount = null, proofContext = {}) => {
    cleanupSl1eArtifacts();

    const account = verifiedAccount || firstIdentityAccount();
    const entityAddress = account?.entity_l1_address || account?.address || identityKernel.systemEntityAddress('simple-l1:connect:guest');
    const keyAddress = account?.key_l1_address || null;
    const mode = ['register', 'connect'].includes(query.mode) ? query.mode : 'login';
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const proofToken = `sl1p_${crypto.randomBytes(24).toString('hex')}`;
    const code = `sl1c_${crypto.randomBytes(18).toString('hex')}`;
    const accountAlias = publicAlias(account?.alias) || null;
    const accountName = accountDisplayName(account) || account?.handle || 'SL1 Controller';
    const intent = proofIntentFromQuery(query);

    const proof = createIdentityProof({
        account,
        query,
        challenge: proofContext.challenge || query.nonce,
        controllerCredential: proofContext.controllerCredential || null,
        intent,
        mode,
        now: issuedAt,
        ttlMs: expiresAt.getTime() - issuedAt.getTime(),
        secret: SL1_CONNECT_SECRET,
        publicAlias: accountAlias,
        displayAlias: accountDisplayName(account) || accountName,
    });
    proof.entityAddress = proof.entityAddress || entityAddress;
    proof.entity_l1_address = proof.entity_l1_address || entityAddress;
    proof.keyAddress = proof.keyAddress || keyAddress;
    proof.controller_l1_address = proof.controller_l1_address || keyAddress;
    proof.username = proof.username || accountName;
    proof.displayName = proof.displayName || accountName;

    // ADR-0057: email disclosure is derived from claim_history, not account fields.
    // The active claim projection is not subject authority and never becomes a subject key.
    const consentedEmail = emailDisclosureFromClaimHistory({
        claimHistory: ledger.claim_history || [],
        subject: entityAddress,
        scope: query.scope,
    });

    const response = {
        protocol: 'simple-l1',
        success: true,
        active: true,
        proof_token: proofToken,
        proof,
        identity: {
            entity_l1_address: entityAddress,
            key_l1_address: keyAddress,
            alias: accountAlias,
            display_alias: accountDisplayName(account) || null,
            email: consentedEmail.email,
            email_hash: consentedEmail.email_hash,
        },
    };

    const record = {
        response,
        clientId: proof.clientId,
        redirectUri: proof.redirectUri,
        intent: proof.intent || null,
        scope: query.scope ? String(query.scope) : null,
        disclosedEmail: consentedEmail.email,
        disclosedEmailHash: consentedEmail.email_hash,
        expiresAtMs: expiresAt.getTime(),
    };

    sl1eRuntimeStore.set('authorizationCodes', code, { ...record, proofToken });
    sl1eRuntimeStore.set('proofTokens', proofToken, record);

    return { code, proofToken, response };
};

const authorizeBootstrapState = (query, issuerHost = 'connect.simplelayer.one') => {
    const queryWithBrowserHint = { ...query };
    const browserIdentityHint = query.browser_identity_hint || query.remembered_identity_hint;
    if (!queryWithBrowserHint.identity_hint && !queryWithBrowserHint.login_hint && !queryWithBrowserHint.entity_l1_address && browserIdentityHint) {
        queryWithBrowserHint.identity_hint = browserIdentityHint;
    }

    const { strings } = ceremonyStringsForHost(issuerHost, query.ui_locale || query.alias_locale);
    const clientName = String(query.client_name || query.client_id || 'External app');
    const isMeanlyReference = String(query.client_id || '') === 'meanly.reference';
    const isConnectMode = query.flow === 'connect' || query.mode === 'connect';
    const wantsIdentitySwitch = String(query.sl1e_switch || '') === '1';
    const hintedAccount = hintedVerifiableAccount(queryWithBrowserHint);
    const displayAccount = hintedAccount || (wantsIdentitySwitch ? null : firstVerifiableAccount());
    const selectedIdentity = displayAccount
        ? {
            entity_l1_address: displayAccount.entity_l1_address || displayAccount.address,
            label: accountVisibleAlias(displayAccount) || shortAddress(displayAccount.entity_l1_address || displayAccount.address),
            display_alias: accountDisplayName(displayAccount) || null,
        }
        : null;
    const hasIntent = Boolean(String(query.intent_type || '').trim());
    const rawIntentTitle = String(query.intent_title || '').trim();
    const rawIntentCta = String(query.intent_cta || '').trim();
    const initialAction = wantsIdentitySwitch
        ? 'login'
        : (isConnectMode && !displayAccount
            ? 'register'
            : (query.mode === 'register' ? 'register' : 'login'));

    return {
        protocol: 'simple-l1',
        issuer: originForHost(issuerHost),
        rp_id: rpIdForHost(issuerHost),
        request: {
            client_id: query.client_id || null,
            client_name: clientName,
            redirect_uri: query.redirect_uri || null,
            state: query.state || null,
            nonce: query.nonce || null,
            has_intent: hasIntent,
            intent_title: rawIntentTitle || strings.continueWithMeanly,
            intent_cta: rawIntentCta || (isMeanlyReference ? strings.continueWithMeanly : strings.continue),
            is_connect_mode: isConnectMode,
            wants_identity_switch: wantsIdentitySwitch,
        },
        ui: {
            mode: initialAction === 'register'
                ? strings.createAccount
                : (hasIntent ? (rawIntentTitle || rawIntentCta || (isMeanlyReference ? strings.continueWithMeanly : strings.continue)) : strings.signIn),
            initial_action: initialAction,
            status: initialAction === 'register'
                ? strings.createYourAccount
                : (hasIntent
                    ? strings.confirmPasskey
                    : strings.usePasskeyContinue),
        },
        selected_identity: selectedIdentity,
        identities: verifiableIdentityOptions(),
    };
};

const walletBootstrapState = (query = {}, issuerHost = 'connect.simplelayer.one') => {
    const queryWithBrowserHint = { ...query };
    const browserIdentityHint = query.browser_identity_hint || query.remembered_identity_hint;
    if (!queryWithBrowserHint.identity_hint && !queryWithBrowserHint.login_hint && !queryWithBrowserHint.entity_l1_address && browserIdentityHint) {
        queryWithBrowserHint.identity_hint = browserIdentityHint;
    }

    const switchMode = String(query.sl1e_switch || '') === '1';
    const hintedAddress = queryWithBrowserHint.identity_hint || queryWithBrowserHint.login_hint || queryWithBrowserHint.entity_l1_address;
    const hintedLocalAccount = hintedAddress ? accountByEntityAddress(hintedAddress) : null;
    const account = switchMode ? null : (hintedVerifiableAccount(queryWithBrowserHint) || hintedLocalAccount || firstVerifiableAccount());
    const profile = identityProfile(account);

    return {
        protocol: 'simple-l1',
        issuer: originForHost(issuerHost),
        rp_id: rpIdForHost(issuerHost),
        profile,
        selected_identity: profile
            ? {
                entity_l1_address: profile.entity_l1_address,
                label: profile.display_alias || profile.username || shortAddress(profile.entity_l1_address),
                display_alias: profile.display_alias || null,
            }
            : null,
        identities: verifiableIdentityOptions(),
        switch_mode: switchMode,
    };
};

const renderSl1eAuthorizePage = (query, issuerHost = 'connect.simplelayer.one') => {
    const surface = walletSurfaceForHost(issuerHost);
    const identityLabel = surface.identityLabel;
    const clientName = htmlEscape(query.client_name || query.client_id || 'External app');
    const isMeanlyReference = String(query.client_id || '') === 'meanly.reference';
    const isConnectMode = query.flow === 'connect' || query.mode === 'connect';
    const aliasLocale = normalizeLocale(query.alias_locale || query.ui_locale || query.locale);
    const aliasPlaceholder = aliasLocale === 'ru' ? '@имя' : '@username';
    const wantsIdentitySwitch = String(query.sl1e_switch || '') === '1';
    const hintedAccount = hintedVerifiableAccount(query);
    const displayAccount = hintedAccount || (wantsIdentitySwitch ? null : firstVerifiableAccount());
    const displayIdentity = displayAccount
        ? (accountVisibleAlias(displayAccount) || shortAddress(displayAccount.entity_l1_address || displayAccount.address))
        : null;
    const resolvedIdentityHint = displayAccount
        ? String(displayAccount.entity_l1_address || displayAccount.address || '').trim()
        : '';
    const identitySwitchButtons = verifiableIdentityOptions()
        .filter(option => normalizeIdentityHint(option.entity_l1_address) !== normalizeIdentityHint(resolvedIdentityHint))
        .map(option => `<button type="button" role="menuitem" data-sl1e-switch-identity="${htmlEscape(option.entity_l1_address)}">Use ${htmlEscape(option.label || shortAddress(option.entity_l1_address))}</button>`)
        .join('');
    const lockToExistingIdentity = isConnectMode && Boolean(displayAccount);
    const initialAction = wantsIdentitySwitch
        ? 'login'
        : (isConnectMode && !lockToExistingIdentity
        ? 'register'
        : (query.mode === 'register' ? 'register' : 'login'));
    const hasIntent = Boolean(String(query.intent_type || '').trim());
    const rawIntentTitle = String(query.intent_title || '').trim();
    const rawIntentDescription = String(query.intent_description || '').trim();
    const rawIntentCta = String(query.intent_cta || '').trim();
    const humanActionTitle = rawIntentTitle || rawIntentCta || (isMeanlyReference ? 'Continue with Meanly' : 'Continue');
    const initialStatus = initialAction === 'register'
        ? 'Create your account.'
        : (hasIntent
            ? 'Confirm with your passkey.'
            : 'Use your passkey to continue.');
    const mode = isConnectMode
        ? (initialAction === 'register'
            ? 'Create account'
            : (hasIntent ? humanActionTitle : 'Sign in'))
        : (query.mode === 'register'
        ? 'Create account'
            : 'Sign in');
    const lead = wantsIdentitySwitch
        ? 'Choose the identity you want to use here.'
        : (isConnectMode && !lockToExistingIdentity
        ? 'Create your account with a passkey.'
        : (isConnectMode && hasIntent
            ? `Use your passkey to continue.`
            : (isConnectMode
            ? `Use your passkey to continue.`
            : `Use your passkey to continue.`)));
    const intentTitle = htmlEscape(rawIntentTitle || 'Continue with Meanly');
    const intentDescription = htmlEscape(rawIntentDescription || 'Use your passkey to continue.');
    const intentCta = rawIntentCta;
    const approveWithPasskeyLabel = hasIntent
        ? (intentCta || (isMeanlyReference ? 'Continue with Meanly' : 'Continue'))
        : 'Sign in';
    const requestedIdentityHint = normalizeIdentityHint(query.identity_hint || query.login_hint || query.entity_l1_address);
    const connectClass = isConnectMode ? ` connect-mode${hasIntent ? ' has-intent' : ''}${lockToExistingIdentity ? '' : ' no-identity'}${initialAction === 'register' ? ' register-ready' : (initialAction === 'login' ? ' login-ready' : '')}` : '';
    const clientAuthorizeQuery = Object.fromEntries(
        Object.entries(query).filter(([key, value]) => !key.startsWith('__') && value != null && String(value) !== ''),
    );
    const hiddenFields = Object.entries(query)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, value]) => `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(value)}">`)
        .join('\n');

    const issuerHostname = htmlEscape(String(issuerHost || 'pass.simplelayer.one').split(':')[0]);

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(surface.title)}</title>
    <meta name="application-name" content="${htmlEscape(surface.title)}">
    <meta name="theme-color" content="#090a0f">
    <meta name="apple-mobile-web-app-title" content="${htmlEscape(surface.title)}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/style.css?v=3.0.0">
    <link rel="stylesheet" href="/authorize-protocol.css?v=1.1.0">
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
</head>
<body>
    <div class="page-shell authorize-page">
        <nav class="nav authorize-nav">
            <a class="brand" href="/">
                <span class="brand-mark">SL1</span>
                <span>
                    <strong>Simple Layer One</strong>
                    <small>${issuerHostname}</small>
                </span>
            </a>
            <a class="nav-cta" href="${htmlEscape(protocolSiteOrigin())}">About SL1</a>
        </nav>
        <section class="authorize-stage">
            <article class="hero-card authorize-card">
                <div class="card-topline">
                    <span>SL1 Connect</span>
                    <strong class="online">${clientName}</strong>
                </div>
                <div class="authorize-orb" aria-hidden="true"><span>SL1</span></div>
                <div class="sl1e-authorize-panel ${connectClass}">
        <div class="brand authorize-brand"><span class="brand-mark">SL1</span> Simple Layer One</div>
        <h1 id="sl1e-title">${mode}</h1>
        <p id="sl1e-lead" class="connect-lead">${htmlEscape(lead)}</p>
        ${wantsIdentitySwitch && identitySwitchButtons ? `<div class="identity-switch-panel" aria-label="Choose ${htmlEscape(identityLabel)}">${identitySwitchButtons}</div>` : ''}
        ${displayIdentity ? `<div class="identity-menu">
            <button id="sl1e-identity-pill" class="identity-pill" type="button" aria-haspopup="true" aria-expanded="false">${htmlEscape(displayIdentity)}</button>
            <div id="sl1e-identity-actions" class="identity-actions" role="menu">
                <button id="sl1e-manage-identity" type="button" role="menuitem">Manage ${htmlEscape(identityLabel)}</button>
                ${identitySwitchButtons ? `<div class="identity-action-divider" aria-hidden="true"></div>${identitySwitchButtons}` : ''}
                <button id="sl1e-forget-identity" type="button" role="menuitem">Sign out / choose another</button>
                <button id="sl1e-replace-identity" type="button" role="menuitem">Create new ${htmlEscape(identityLabel)}</button>
            </div>
        </div>` : ''}
        <section id="approval-step" class="approval-step${isConnectMode ? ' active' : ''}">
            <div id="sl1e-alias-field" class="alias-field${initialAction === 'register' ? ' visible' : ''}">
                <label id="sl1e-alias-label" for="sl1e-alias">Choose your alias</label>
                <div id="sl1e-alias-wrap" class="alias-wrap"><input id="sl1e-alias" name="alias" autocomplete="username" maxlength="25" placeholder="${htmlEscape(aliasPlaceholder)}"></div>
            </div>
            <div class="proof">
                <div><span>You are opening</span><b>${intentTitle}</b></div>
                <div><span>For</span><b>${clientName}</b></div>
                <div><span>Safety</span><b>Only this sign-in is approved</b></div>
            </div>
            <p class="${isConnectMode ? 'intent-description' : ''}">${intentDescription}</p>
            <p class="intent-confirmation">The requesting app will not get your passkey. It only receives a one-time identity proof.</p>
            <form id="sl1e-form" method="POST" action="/api/sl1e/authorize/complete">
                ${hiddenFields}
                <button id="sl1e-approve" type="submit">${htmlEscape(initialAction === 'register' ? 'Create account' : approveWithPasskeyLabel)}</button>
            </form>
            ${isConnectMode && !hasIntent ? `<a id="sl1e-secondary-action" class="text-action visible" href="#">${lockToExistingIdentity ? 'Create new account' : 'I already have an account'}</a>` : ''}
            <div id="sl1e-status" class="status">${htmlEscape(initialStatus)}</div>
            ${isConnectMode ? `<button id="sl1e-handoff-link" class="handoff-link" type="button">Use native app or another device</button>
            <div id="sl1e-handoff-panel" class="handoff-panel" aria-live="polite">
                <img id="sl1e-handoff-qr" alt="QR code to continue on another device">
                <p id="sl1e-handoff-meta">Optional: scan with a phone or native client that has your SL1 controller. This screen will continue automatically.</p>
                <button id="sl1e-handoff-refresh" class="handoff-refresh" type="button">Refresh QR</button>
            </div>` : ''}
            <div class="note">Your identity address stays the same across web and native.</div>
        </section>
                </div>
            </article>
        </section>
        <footer class="footer">
            <strong>Simple Layer One</strong>
            <span>Meaning is representational. Authority is relational. Settlement mutates state.</span>
        </footer>
    </div>
    <script>
        const authorizeQuerySeed = ${JSON.stringify(clientAuthorizeQuery)};
        const buildAuthorizeParams = () => {
            const params = new URLSearchParams();
            Object.entries(authorizeQuerySeed).forEach(([key, value]) => params.set(key, String(value)));
            const urlParams = new URLSearchParams(window.location.search);
            ['identity_hint', 'login_hint', 'entity_l1_address', 'browser_identity_hint', 'sl1e_switch', 'alias', 'display_alias', 'alias_reservation_owner'].forEach((key) => {
                if (urlParams.has(key)) params.set(key, urlParams.get(key));
            });
            if (!params.has('identity_hint') && !params.has('login_hint') && !params.has('entity_l1_address')) {
                const rememberedIdentity = window.localStorage?.getItem('sl1e.identity_hint');
                if (rememberedIdentity) params.set('browser_identity_hint', rememberedIdentity);
            }
            return params;
        };
        const form = document.getElementById('sl1e-form');
        const button = document.getElementById('sl1e-approve');
        const approveWithPasskeyLabel = ${JSON.stringify(approveWithPasskeyLabel)};
        const lockToExistingIdentity = ${lockToExistingIdentity ? 'true' : 'false'};
        let activeIdentityHint = ${JSON.stringify(resolvedIdentityHint)};
        const requestedIdentityHint = ${JSON.stringify(requestedIdentityHint)};
        const aliasPlaceholder = ${JSON.stringify(aliasPlaceholder)};
        const titleNode = document.getElementById('sl1e-title');
        const leadNode = document.getElementById('sl1e-lead');
        const statusNode = document.getElementById('sl1e-status');
        const identityPill = document.getElementById('sl1e-identity-pill');
        const identityActions = document.getElementById('sl1e-identity-actions');
        const manageIdentityButton = document.getElementById('sl1e-manage-identity');
        const forgetIdentityButton = document.getElementById('sl1e-forget-identity');
        const replaceIdentityButton = document.getElementById('sl1e-replace-identity');
        const aliasField = document.getElementById('sl1e-alias-field');
        const aliasLabel = document.getElementById('sl1e-alias-label');
        const aliasWrap = document.getElementById('sl1e-alias-wrap');
        const aliasInput = document.getElementById('sl1e-alias');
        const card = document.querySelector('.sl1e-authorize-panel');
        const secondaryAction = document.getElementById('sl1e-secondary-action');
        const handoffButton = document.getElementById('sl1e-handoff-link');
        const handoffPanel = document.getElementById('sl1e-handoff-panel');
        const handoffQr = document.getElementById('sl1e-handoff-qr');
        const handoffMeta = document.getElementById('sl1e-handoff-meta');
        const handoffRefresh = document.getElementById('sl1e-handoff-refresh');
        const registrationReservationMinutes = 5;
        const registerHandoffQrText = () => {
            const alias = aliasLabelFromInput();
            const visibleAlias = alias ? '@' + alias : 'this account';
            return 'Optional: scan with a native client or phone to finish creating ' + visibleAlias + '. The username is reserved for about ' + registrationReservationMinutes + ' minutes. This screen will continue automatically.';
        };
        const loginHandoffQrText = 'Optional: scan with a native client or phone that has your SL1 controller. This screen will continue automatically.';
        const setStatus = (message) => { statusNode.textContent = message; };
        const approvalStep = document.getElementById('approval-step');
        const isConnectMode = ${isConnectMode ? 'true' : 'false'};
        const hasIntent = ${hasIntent ? 'true' : 'false'};
        let selectedAction = '${initialAction}';
        let handoffPollTimer = null;
        let pendingRegistrationRequestId = null;
        let activeAliasReservationOwner = null;
        let isBusy = false;
        let updatePrimaryButtonState = () => {};
        const aliasReservationStorageKey = 'sl1e.alias_reservation';

        const rememberIdentity = (payload) => {
            const identityHint = payload?.identity?.entity_l1_address || activeIdentityHint;
            if (!identityHint) return;
            activeIdentityHint = identityHint;
            try {
                window.localStorage?.setItem('sl1e.identity_hint', identityHint);
                if (payload?.identity_capsule) {
                    window.localStorage?.setItem('sl1e.identity_capsule', JSON.stringify(payload.identity_capsule));
                }
                if (payload?.portability_contract) {
                    window.localStorage?.setItem('sl1e.portability_contract', JSON.stringify(payload.portability_contract));
                }
            } catch (error) {
                // Ignore private browsing or storage-disabled contexts.
            }
        };

        const aliasLabelFromStoredValue = (value) => {
            const raw = String(value || '').trim().toLowerCase();
            const withoutPrefix = raw.replace(/^@+/, '');
            const withoutSuffix = withoutPrefix
                .replace(/\\.sl1\\.one$/, '')
                .replace(/@simplelayer\\.one$/, '')
                .replace(/@sl1$/, '');
            return withoutSuffix
                .replace(/\\s+/gu, '-')
                .replace(/[^\\p{L}\\p{N}-]+/gu, '')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 24)
                .replace(/-$/g, '');
        };
        const rawAliasLabelFromInput = () => {
            const raw = String(aliasInput?.value || '').trim().toLowerCase();
            return raw.replace(/^@+/, '')
                .replace(/\\.sl1\\.one$/, '')
                .replace(/@simplelayer\\.one$/, '')
                .replace(/@sl1$/, '');
        };

        const readAliasReservation = () => {
            try {
                const raw = window.localStorage?.getItem(aliasReservationStorageKey);
                if (!raw) return null;
                const reservation = JSON.parse(raw);
                const expiresAtMs = Date.parse(reservation.expires_at || '');
                const alias = aliasLabelFromStoredValue(reservation.alias);
                if (!alias || !reservation.owner_id || !expiresAtMs || expiresAtMs <= Date.now()) {
                    window.localStorage?.removeItem(aliasReservationStorageKey);
                    return null;
                }
                reservation.alias = alias;
                return reservation;
            } catch (error) {
                return null;
            }
        };

        const rememberAliasReservation = (alias, ownerId, expiresAt) => {
            if (!alias || !ownerId || !expiresAt) return;
            try {
                window.localStorage?.setItem(aliasReservationStorageKey, JSON.stringify({
                    alias,
                    owner_id: ownerId,
                    expires_at: expiresAt,
                }));
            } catch (error) {
                // Registration can still continue without local recovery.
            }
        };

        const clearAliasReservation = () => {
            try {
                window.localStorage?.removeItem(aliasReservationStorageKey);
            } catch (error) {
                // Ignore storage-disabled contexts.
            }
        };

        const releasePendingRegistrationReservation = async () => {
            const requestId = pendingRegistrationRequestId;
            if (!requestId) return true;

            try {
                const response = await fetch('/api/sl1e/registration/' + encodeURIComponent(requestId) + '/release', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json' },
                });
                if (!response.ok) return false;

                pendingRegistrationRequestId = null;
                activeAliasReservationOwner = null;
                clearAliasReservation();
                return true;
            } catch (error) {
                return false;
            }
        };

        const forgetActiveIdentity = () => {
            try {
                window.localStorage?.removeItem('sl1e.identity_hint');
                window.localStorage?.removeItem('sl1e.identity_capsule');
                window.localStorage?.removeItem('sl1e.portability_contract');
                window.localStorage?.removeItem('sl1e.alias_reservation');
                window.sessionStorage?.removeItem('meanly.reference.state');
            } catch (error) {
                // Storage may be unavailable; navigation still clears query-scoped hint.
            }

            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete('identity_hint');
            nextUrl.searchParams.delete('login_hint');
            nextUrl.searchParams.delete('entity_l1_address');
            nextUrl.searchParams.delete('mode');
            nextUrl.searchParams.set('flow', 'connect');
            nextUrl.searchParams.set('sl1e_switch', '1');
            window.location.replace(nextUrl.toString());
        };

        const switchActiveIdentity = (identityHint) => {
            const normalizedHint = String(identityHint || '').trim();
            if (!normalizedHint) return;
            try {
                window.localStorage?.setItem('sl1e.identity_hint', normalizedHint);
                window.localStorage?.removeItem('sl1e.identity_capsule');
                window.localStorage?.removeItem('sl1e.portability_contract');
            } catch (error) {
                // Storage may be unavailable; query hint is enough for this request.
            }

            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set('identity_hint', normalizedHint);
            nextUrl.searchParams.delete('login_hint');
            nextUrl.searchParams.delete('entity_l1_address');
            nextUrl.searchParams.delete('sl1e_switch');
            if (isConnectMode) nextUrl.searchParams.set('flow', 'connect');
            window.location.replace(nextUrl.toString());
        };

        const closeIdentityMenu = () => {
            identityActions?.classList.remove('visible');
            identityPill?.setAttribute('aria-expanded', 'false');
        };

        identityPill?.addEventListener('click', (event) => {
            event.stopPropagation();
            const visible = identityActions?.classList.toggle('visible');
            identityPill.setAttribute('aria-expanded', visible ? 'true' : 'false');
        });
        document.addEventListener('click', closeIdentityMenu);
        identityActions?.addEventListener('click', (event) => event.stopPropagation());
        document.querySelectorAll('[data-sl1e-switch-identity]').forEach((button) => {
            button.addEventListener('click', () => switchActiveIdentity(button.dataset.sl1eSwitchIdentity));
        });
        manageIdentityButton?.addEventListener('click', () => {
            const nextUrl = new URL('/identity', window.location.origin);
            const identityHint = activeIdentityHint || requestedIdentityHint;
            if (identityHint) nextUrl.searchParams.set('identity_hint', identityHint);
            window.location.href = nextUrl.toString();
        });
        forgetIdentityButton?.addEventListener('click', forgetActiveIdentity);
        replaceIdentityButton?.addEventListener('click', () => {
            closeIdentityMenu();
            selectAction('register', 'Create a new account. It will become active on this device.');
            aliasInput?.focus();
        });

        const aliasLabelFromInput = () => aliasLabelFromStoredValue(aliasInput?.value);
        const aliasValidationMessage = (alias) => {
            if (selectedAction !== 'register') return '';
            const rawAlias = rawAliasLabelFromInput();
            if (!alias) return 'Choose your SL1 username first.';
            if (/[^\\p{L}\\p{N}\\s-]/u.test(rawAlias) || /^-|-$/.test(rawAlias.trim()) || /-{2,}/.test(rawAlias)) {
                return 'Use letters, numbers, spaces, and single hyphens only.';
            }
            if (alias.length < 3) return 'Username must be at least 3 characters.';
            if (alias.length > 24) return 'Username must be 24 characters or less.';
            if (!/^[a-z0-9\\p{L}]+(?:-[a-z0-9\\p{L}]+)*$/u.test(alias)) {
                return 'Use letters, numbers, spaces, and single hyphens only.';
            }
            return '';
        };

        const restoreAliasReservation = () => {
            if (!isConnectMode || !aliasInput) return;
            const reservation = readAliasReservation();
            if (!reservation) return;

            selectAction('register', 'Continue creating @' + reservation.alias + '. The username is still reserved on this browser.');
            aliasInput.value = '@' + reservation.alias;
            updateAliasPreview();
            activeAliasReservationOwner = reservation.owner_id;
        };

        const updateAliasPreview = () => {
            if (!aliasInput) return;
            const label = aliasLabelFromInput();
            const visibleAlias = label ? '@' + label : '';
            if (aliasInput.value !== visibleAlias) aliasInput.value = visibleAlias;
            if (selectedAction === 'register') {
                const aliasError = aliasValidationMessage(label);
                if (label && aliasError) setStatus(aliasError);
                if (label && !aliasError) setStatus('Create a new account with a passkey. No private key leaves your device.');
            }
            updatePrimaryButtonState();
        };
        const syncAliasPlaceholder = () => {
            if (!aliasInput) return;
            aliasInput.placeholder = document.activeElement === aliasInput && !aliasInput.value
                ? ''
                : aliasPlaceholder;
        };
        aliasInput?.addEventListener('input', updateAliasPreview);
        aliasInput?.addEventListener('focus', syncAliasPlaceholder);
        aliasInput?.addEventListener('blur', syncAliasPlaceholder);
        updateAliasPreview();
        syncAliasPlaceholder();

        const showDeviceHandoff = () => {
            if (isConnectMode) handoffButton?.classList.add('visible');
        };

        const stopDeviceHandoffPolling = () => {
            if (handoffPollTimer) {
                clearInterval(handoffPollTimer);
                handoffPollTimer = null;
            }
        };

        const pollDeviceHandoff = (pollUrl) => {
            stopDeviceHandoffPolling();
            handoffPollTimer = setInterval(async () => {
                try {
                    const response = await fetch(pollUrl, { headers: { 'Accept': 'application/json' } });
                    const payload = await response.json();
                    if (!response.ok || payload.status === 'expired') {
                        stopDeviceHandoffPolling();
                        setStatus('Device handoff expired. Generate a new QR code.');
                        return;
                    }
                    if (payload.status === 'complete' && payload.redirect_url) {
                        stopDeviceHandoffPolling();
                        clearAliasReservation();
                        setStatus('Proof verified on phone. Returning to application...');
                        await redirectFromPayload({ redirect_url: payload.redirect_url });
                    }
                } catch (error) {
                    // Keep polling; transient network failures should not cancel the QR session.
                }
            }, 1500);
        };

        const startDeviceHandoff = async () => {
            handoffButton.disabled = true;
            setStatus('Preparing QR handoff...');
            try {
                const handoffQuery = buildAuthorizeParams();
                if (selectedAction === 'register') {
                    const alias = aliasLabelFromInput();
                    if (!alias) {
                        aliasInput?.focus();
                        setStatus('Choose your SL1 alias first.');
                        return;
                    }
                    const aliasError = aliasValidationMessage(alias);
                    if (aliasError) {
                        aliasInput?.focus();
                        setStatus(aliasError);
                        return;
                    }
                    handoffQuery.delete('identity_hint');
                    handoffQuery.delete('login_hint');
                    handoffQuery.delete('entity_l1_address');
                    handoffQuery.set('handoff_action', 'register');
                    handoffQuery.set('alias', alias);
                    handoffQuery.set('display_alias', alias);
                    const storedReservation = readAliasReservation();
                    const priorReservationOwner = activeAliasReservationOwner
                        || (storedReservation?.alias === alias ? storedReservation.owner_id : null);
                    if (priorReservationOwner) {
                        handoffQuery.set('prior_alias_reservation_owner', priorReservationOwner);
                    }
                } else {
                const identityHint = activeIdentityHint;
                    if (identityHint && !handoffQuery.has('identity_hint')) {
                        handoffQuery.set('identity_hint', identityHint);
                    }
                    const identityCapsule = window.localStorage?.getItem('sl1e.identity_capsule');
                    if (identityCapsule && !handoffQuery.has('identity_capsule')) {
                        handoffQuery.set('identity_capsule', identityCapsule);
                    }
                }
                const query = Object.fromEntries(handoffQuery);
                const response = await fetch('/api/sl1e/device-handoff', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ query }),
                });
                const payload = await response.json();
                if (!response.ok) {
                    if (payload.error === 'alias_unavailable') {
                        const alias = aliasLabelFromInput();
                        selectAction('login', '@' + alias + ' already exists. Sign in or recover it from your phone.');
                        const unavailableError = new Error('@' + alias + ' already exists.');
                        unavailableError.handled = true;
                        throw unavailableError;
                    }
                    throw new Error(payload.message || payload.error || 'Could not create device handoff.');
                }
                if (selectedAction === 'register' && payload.handoff_id) {
                    activeAliasReservationOwner = payload.alias_reservation_owner || payload.handoff_id;
                    const alias = aliasLabelFromInput();
                    rememberAliasReservation(alias, activeAliasReservationOwner, payload.expires_at);
                }

                handoffQr.src = payload.qr_svg_url;
                handoffPanel?.classList.add('visible');
                handoffButton?.classList.remove('visible');
                if (handoffMeta) {
                    handoffMeta.textContent = selectedAction === 'register'
                        ? registerHandoffQrText()
                        : loginHandoffQrText;
                }
                setStatus('Scan the QR code with your phone.');
                pollDeviceHandoff(payload.poll_url);
            } catch (error) {
                if (!error.handled) {
                    setStatus(error.message || 'Could not create device handoff.');
                }
                if (!handoffPanel?.classList.contains('visible')) {
                    handoffButton?.classList.remove('visible');
                }
            } finally {
                handoffButton.disabled = false;
                if (handoffRefresh) handoffRefresh.disabled = false;
            }
        };

        const hasRequiredAlias = () => selectedAction !== 'register' || Boolean(aliasLabelFromInput());
        const hasValidAlias = () => !aliasValidationMessage(aliasLabelFromInput());

        updatePrimaryButtonState = () => {
            button.disabled = isBusy || !hasRequiredAlias() || !hasValidAlias();
        };

        const setBusy = (busy) => {
            isBusy = busy;
            updatePrimaryButtonState();
            document.querySelectorAll('[data-sl1e-choice]').forEach((choice) => {
                choice.disabled = busy;
            });
        };

        const selectAction = (action, message) => {
            stopDeviceHandoffPolling();
            handoffButton?.classList.remove('visible');
            handoffPanel?.classList.remove('visible');
            if (handoffQr) handoffQr.removeAttribute('src');
            if (handoffMeta) handoffMeta.textContent = loginHandoffQrText;
            activeAliasReservationOwner = null;

            selectedAction = action === 'register' ? 'register' : 'login';
            const asksForAlias = selectedAction === 'register';
            document.querySelectorAll('[data-sl1e-choice]').forEach((choice) => {
                choice.classList.toggle('selected', choice.dataset.sl1eChoice === selectedAction);
            });
            approvalStep.classList.add('active');
            aliasField?.classList.toggle('visible', asksForAlias);
            if (aliasLabel) aliasLabel.textContent = selectedAction === 'register' ? 'Choose your alias' : 'Your SL1 alias';
            card?.classList.toggle('register-ready', selectedAction === 'register');
            card?.classList.toggle('login-ready', selectedAction === 'login' && !lockToExistingIdentity);
            if (selectedAction === 'register') {
                activeAliasReservationOwner = null;
            }
            if (secondaryAction) {
                secondaryAction.textContent = selectedAction === 'register' ? 'I already have an account' : 'Create new account';
                secondaryAction.classList.add('visible');
            }
            button.textContent = selectedAction === 'register'
                ? 'Create account'
                : (lockToExistingIdentity ? approveWithPasskeyLabel : 'Sign in');
            updatePrimaryButtonState();
            setStatus(message || (selectedAction === 'register'
                ? 'Create your account with a passkey. You can use the same account later in the app.'
                : 'Confirm with your passkey. We will return you to the requesting app.'));
        };

        const hydrateAuthorizeState = async () => {
            if (!isConnectMode) return;
            try {
                const query = buildAuthorizeParams();
                if (!query.has('identity_hint') && !query.has('login_hint') && !query.has('entity_l1_address')) {
                    const rememberedIdentity = window.localStorage?.getItem('sl1e.identity_hint');
                    if (rememberedIdentity) query.set('browser_identity_hint', rememberedIdentity);
                }

                const response = await fetch('/api/sl1e/authorize/bootstrap?' + query.toString(), {
                    headers: { 'Accept': 'application/json' },
                    cache: 'no-store',
                });
                if (!response.ok) return;
                const state = await response.json();
                const selectedIdentity = state?.selected_identity;
                if (selectedIdentity?.entity_l1_address) {
                    activeIdentityHint = selectedIdentity.entity_l1_address;
                    if (identityPill && selectedIdentity.label) identityPill.textContent = selectedIdentity.label;
                    try { window.localStorage?.setItem('sl1e.identity_hint', activeIdentityHint); } catch (error) {}
                    if (titleNode && state?.ui?.mode) titleNode.textContent = state.ui.mode;
                    if (leadNode && state?.request?.has_intent) {
                        leadNode.textContent = 'Confirm with your passkey. We will return you to ' + state.request.client_name + ' automatically.';
                    }
                    if (selectedAction === 'register') {
                        selectAction('login', state?.ui?.status || 'Confirm with your passkey. We will return you to the requesting app.');
                    }
                    card?.classList.remove('no-identity', 'register-ready');
                    card?.classList.add('login-ready');
                    aliasField?.classList.remove('visible');
                    updatePrimaryButtonState();
                } else if (state?.ui?.initial_action === 'register' && selectedAction !== 'register') {
                    if (titleNode && state.ui.mode) titleNode.textContent = state.ui.mode;
                    selectAction('register', state.ui.status);
                }
            } catch (error) {
                // Bootstrap is an enhancement; existing form flow still works.
            }
        };

        const isNativeShell = () => /SovereignApp|MeanlyOne|Meanly One/i.test(String(navigator.userAgent || ''));

        const redirectFromPayload = async (payload) => {
            if (payload.redirect_url) {
                if (isNativeShell()) {
                    setStatus('Proof approved. Returning to the browser that started this request...');
                    try {
                        await fetch(payload.redirect_url, {
                            method: 'GET',
                            mode: 'no-cors',
                            credentials: 'omit',
                            cache: 'no-store',
                        });
                    } catch (error) {
                        // The originating browser polls the marketplace for completion.
                    }
                    return;
                }

                window.location.href = payload.redirect_url;
                return;
            }

            throw new Error('Connect response did not include a redirect URL.');
        };

        const completeLogin = async (query) => {
            const identityHint = activeIdentityHint;
            if (identityHint && !query.has('identity_hint')) {
                query.set('identity_hint', identityHint);
            }
            const identityCapsule = window.localStorage?.getItem('sl1e.identity_capsule');
            if (identityCapsule && !query.has('identity_capsule')) {
                query.set('identity_capsule', identityCapsule);
            }
            const optionsResponse = await fetch('/api/sl1e/authentication/options?' + query.toString(), {
                headers: { 'Accept': 'application/json' },
            });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) {
                const optionsError = new Error(optionsPayload.error || 'Could not prepare passkey challenge.');
                if ([
                    'no_verifiable_passkey_registered_for_identity',
                    'no_identity_account_registered',
                ].includes(optionsPayload.error)) {
                    optionsError.passkeyUnavailable = true;
                }
                throw optionsError;
            }

            setStatus('Confirm with Face ID, Touch ID, or your security key...');
            let assertion;
            try {
                assertion = await SimpleWebAuthnBrowser.startAuthentication({
                    optionsJSON: optionsPayload.publicKey,
                });
            } catch (error) {
                const unavailableError = new Error('Passkey was not found on this device.');
                unavailableError.passkeyUnavailable = true;
                throw unavailableError;
            }

            setStatus('Verifying passkey proof...');
            const completeResponse = await fetch('/api/sl1e/authorize/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    authorization_request_id: optionsPayload.authorization_request_id,
                    assertion,
                }),
            });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok) {
                throw new Error(completePayload.error || 'Passkey proof was rejected.');
            }

            return completePayload;
        };

        const completeRegistration = async (query) => {
            const alias = (aliasInput?.value || '').trim();
            const aliasLabel = aliasLabelFromInput();
            query.delete('identity_hint');
            query.delete('login_hint');
            query.delete('entity_l1_address');
            if (alias) {
                query.set('alias', alias);
                query.set('display_alias', alias);
                const storedReservation = readAliasReservation();
                if (storedReservation?.alias === aliasLabel) {
                    query.set('alias_reservation_owner', storedReservation.owner_id);
                }
            }
            const optionsResponse = await fetch('/api/sl1e/registration/options?' + query.toString(), {
                headers: { 'Accept': 'application/json' },
            });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) {
                if (optionsPayload.error === 'alias_unavailable') {
                    const storedReservation = readAliasReservation();
                    const alias = aliasLabelFromInput();
                    if (storedReservation?.alias === alias) {
                        activeAliasReservationOwner = storedReservation.owner_id;
                        selectAction('register', 'Continue creating @' + alias + '. The username is still reserved on this browser.');
                        await startDeviceHandoff();
                        const reservedError = new Error('Continue registration on your phone.');
                        reservedError.handled = true;
                        throw reservedError;
                    }

                    selectAction('login', '@' + alias + ' already exists. Sign in or recover it from your phone.');
                    const unavailableError = new Error('@' + alias + ' already exists.');
                    unavailableError.handled = true;
                    throw unavailableError;
                }

                throw new Error(optionsPayload.message || optionsPayload.error || 'Could not prepare passkey registration.');
            }
            pendingRegistrationRequestId = optionsPayload.registration_request_id;
            activeAliasReservationOwner = optionsPayload.alias_reservation_owner || null;
            rememberAliasReservation(
                aliasLabelFromInput(),
                activeAliasReservationOwner || optionsPayload.registration_request_id,
                optionsPayload.alias_reservation_expires_at,
            );

            setStatus('Create your SL1 passkey identity...');
            let attestation;
            try {
                attestation = await SimpleWebAuthnBrowser.startRegistration({
                    optionsJSON: optionsPayload.publicKey,
                });
            } catch (error) {
                await releasePendingRegistrationReservation();
                const unavailableError = new Error('Passkey creation was cancelled or is not available on this device.');
                unavailableError.passkeyUnavailable = true;
                throw unavailableError;
            }

            setStatus('Verifying and anchoring your passkey identity...');
            const completeResponse = await fetch('/api/sl1e/registration/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    registration_request_id: optionsPayload.registration_request_id,
                    attestation,
                }),
            });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok) {
                throw new Error(completePayload.error || 'Passkey registration was rejected.');
            }
            pendingRegistrationRequestId = null;
            activeAliasReservationOwner = null;
            clearAliasReservation();

            return completePayload;
        };

        const runSelectedAction = async () => {
            if (selectedAction === 'register' && !aliasLabelFromInput()) {
                aliasInput?.focus();
                setStatus('Choose your SL1 alias first.');
                updatePrimaryButtonState();
                return;
            }
            if (selectedAction === 'register') {
                const aliasError = aliasValidationMessage(aliasLabelFromInput());
                if (aliasError) {
                    aliasInput?.focus();
                    setStatus(aliasError);
                    updatePrimaryButtonState();
                    return;
                }
            }

            if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) {
                if (selectedAction === 'login') {
                    setStatus('This device cannot use passkeys here. Continue on your phone.');
                } else {
                    setStatus('Create your SL1 identity on a device that supports passkeys, like your phone.');
                }
                await startDeviceHandoff();
                return;
            }

            setBusy(true);
            setStatus('Getting your passkey ready...');

            try {
                const query = buildAuthorizeParams();
                const completePayload = selectedAction === 'register'
                    ? await completeRegistration(query)
                    : await completeLogin(query);

                rememberIdentity(completePayload);
                setStatus('Confirmed. Returning you to the requesting app...');
                await redirectFromPayload(completePayload);
            } catch (error) {
                const message = error.message || 'Passkey approval failed.';
                if (error.handled) {
                    setBusy(false);
                    return;
                }

                if (selectedAction === 'register' && error.passkeyUnavailable) {
                    selectAction('register', 'Passkey creation was cancelled here. Continue on another device with this alias.');
                    setBusy(false);
                    await startDeviceHandoff();
                    return;
                }

                if (selectedAction === 'register' && /previously registered|already registered|excluded/i.test(message)) {
                    selectAction('login', 'This passkey is already registered. Sign in instead.');
                    setBusy(false);
                    return;
                }

                if (selectedAction === 'login' && error.passkeyUnavailable) {
                    if (lockToExistingIdentity) {
                        selectAction('login', 'Passkey was not found on this device. Continue on another device that has this passkey.');
                    } else {
                        selectAction('login', 'Passkey was not found on this device. Continue on your phone.');
                    }
                    setBusy(false);
                    await startDeviceHandoff();
                    return;
                } else {
                    setStatus(message);
                }
                setBusy(false);
            }
        };

        document.querySelectorAll('[data-sl1e-choice]').forEach((choice) => {
            choice.addEventListener('click', () => {
                selectAction(choice.dataset.sl1eChoice);
                if (selectedAction === 'login') {
                    if (lockToExistingIdentity && !hasIntent) {
                        runSelectedAction();
                    } else if (lockToExistingIdentity && hasIntent) {
                        setStatus('Press the button to continue.');
                    }
                } else {
                    aliasInput?.focus();
                }
            });
        });

        handoffButton?.addEventListener('click', startDeviceHandoff);
        handoffRefresh?.addEventListener('click', () => {
            handoffRefresh.disabled = true;
            startDeviceHandoff();
        });
        secondaryAction?.addEventListener('click', (event) => {
            event.preventDefault();
            if (selectedAction === 'register') {
                selectAction('login', 'Use your passkey here, or continue on your phone.');
            } else {
                selectAction('register', 'Create a new account with a passkey. No private key leaves your device.');
                aliasInput?.focus();
            }
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            runSelectedAction();
        });
        hydrateAuthorizeState();
        restoreAliasReservation();
        updatePrimaryButtonState();
    </script>
</body>
</html>`;
};

const renderSl1eDeviceHandoffPage = (handoffId, token, record, issuerHost = 'connect.simplelayer.one') => {
    const clientName = htmlEscape(record.query.client_name || record.query.client_id || 'External app');
    const handoffIdJson = JSON.stringify(String(handoffId));
    const tokenJson = JSON.stringify(String(token));
    const handoffQueryJson = JSON.stringify(record.query || {});
    const isRegisterHandoff = record.action === 'register';
    const handoffTitle = isRegisterHandoff ? 'Create identity here' : 'Continue on this device';
    const handoffBody = isRegisterHandoff
        ? `${clientName} is waiting on your other screen. Create ${normalizeDisplayAlias(record.display_alias) ? `@${normalizeDisplayAlias(record.display_alias)}` : (aliasDisplayName(record.alias) ? `@${aliasDisplayName(record.alias)}` : 'your SL1 identity')} on this device and return there. The username reservation expires in about 5 minutes.`
        : `${clientName} is waiting on your other screen. Confirm with this device's passkey and return there.`;
    const handoffButton = isRegisterHandoff ? 'Create phone passkey' : 'Approve with phone passkey';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Continue with SL1 Passkey</title>
    <meta name="theme-color" content="#090a0f">
    <style>
        :root { color-scheme: dark; --bg:#090a0f; --panel:rgba(255,255,255,.08); --text:#f7f8ff; --muted:#aab0c4; --green:#75ffb0; --blue:#8eb8ff; --border:rgba(255,255,255,.16); --shadow:0 24px 90px rgba(0,0,0,.45); }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; display:grid; place-items:center; padding:20px; background:radial-gradient(circle at 15% 0%, rgba(117,255,176,.18), transparent 26rem),linear-gradient(180deg,#090a0f 0%,#111421 58%,#08090d 100%); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
        main { width:min(430px,100%); padding:26px 22px; border:1px solid var(--border); border-radius:28px; background:var(--panel); box-shadow:var(--shadow); backdrop-filter:blur(18px); text-align:center; }
        .brand { display:inline-flex; align-items:center; justify-content:center; gap:10px; margin-bottom:18px; font-size:11px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
        .dot { width:12px; height:12px; border-radius:999px; background:linear-gradient(135deg,var(--green),var(--blue)); display:inline-block; }
        h1 { margin:0 0 10px; font-size:34px; line-height:.98; letter-spacing:-.07em; }
        p { margin:0; color:var(--muted); line-height:1.5; font-size:14px; font-weight:750; }
        button { width:100%; margin-top:22px; padding:17px 22px; border:1px solid rgba(255,255,255,.22); border-radius:999px; background:linear-gradient(135deg,var(--green),var(--blue)); color:#07100b; font-weight:950; cursor:pointer; }
        button:disabled { opacity:.72; cursor:wait; }
        .status { min-height:18px; margin-top:13px; color:var(--muted); font-size:12px; font-weight:850; }
    </style>
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
</head>
<body>
    <main>
        <div class="brand"><span class="dot"></span>Simple Layer Identity</div>
        <h1>${htmlEscape(handoffTitle)}</h1>
        <p>${htmlEscape(handoffBody)}</p>
        <button id="sl1e-handoff-approve" type="button">${htmlEscape(handoffButton)}</button>
        <div id="sl1e-handoff-status" class="status">Issued by ${htmlEscape(issuerHost)}.</div>
    </main>
    <script>
        const handoffId = ${handoffIdJson};
        const token = ${tokenJson};
        const handoffQuery = ${handoffQueryJson};
        const isRegisterHandoff = ${isRegisterHandoff ? 'true' : 'false'};
        const button = document.getElementById('sl1e-handoff-approve');
        const statusNode = document.getElementById('sl1e-handoff-status');
        const setStatus = (message) => { statusNode.textContent = message; };

        const completeMobileLogin = async () => {
            setStatus('Preparing passkey challenge...');
            const optionsResponse = await fetch('/api/sl1e/device-handoff/' + encodeURIComponent(handoffId) + '/authentication/options?token=' + encodeURIComponent(token), {
                headers: { 'Accept': 'application/json' },
            });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) {
                throw new Error(optionsPayload.error || 'Could not prepare passkey challenge.');
            }

            setStatus('Confirm with Face ID, Touch ID, or your security key...');
            const assertion = await SimpleWebAuthnBrowser.startAuthentication({
                optionsJSON: optionsPayload.publicKey,
            });

            setStatus('Verifying passkey proof...');
            const completeResponse = await fetch('/api/sl1e/authorize/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    authorization_request_id: optionsPayload.authorization_request_id,
                    assertion,
                }),
            });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok || !completePayload.redirect_url) {
                throw new Error(completePayload.error || 'Passkey proof was rejected.');
            }

            return completePayload.redirect_url;
        };

        const completeMobileRegistration = async () => {
            const query = new URLSearchParams(handoffQuery);
            query.delete('identity_hint');
            query.delete('login_hint');
            query.delete('entity_l1_address');
            query.set('handoff_action', 'register');

            setStatus('Preparing passkey creation...');
            const optionsResponse = await fetch('/api/sl1e/registration/options?' + query.toString(), {
                headers: { 'Accept': 'application/json' },
            });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) {
                throw new Error(optionsPayload.error || 'Could not prepare passkey registration.');
            }

            setStatus('Create your SL1 passkey identity...');
            const attestation = await SimpleWebAuthnBrowser.startRegistration({
                optionsJSON: optionsPayload.publicKey,
            });

            setStatus('Verifying and anchoring your identity...');
            const completeResponse = await fetch('/api/sl1e/registration/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    registration_request_id: optionsPayload.registration_request_id,
                    attestation,
                }),
            });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok || !completePayload.redirect_url) {
                throw new Error(completePayload.error || 'Passkey registration was rejected.');
            }

            return completePayload.redirect_url;
        };

        const approve = async () => {
            if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) {
                setStatus('This device does not support WebAuthn passkeys.');
                return;
            }

            button.disabled = true;
            try {
                const redirectUrl = isRegisterHandoff
                    ? await completeMobileRegistration()
                    : await completeMobileLogin();

                const handoffResponse = await fetch('/api/sl1e/device-handoff/' + encodeURIComponent(handoffId) + '/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        token,
                        redirect_url: redirectUrl,
                    }),
                });
                const handoffPayload = await handoffResponse.json();
                if (!handoffResponse.ok) {
                    throw new Error(handoffPayload.error || 'Could not return proof to the first device.');
                }

                setStatus('Done. Return to the first device.');
                button.textContent = 'Approved';
            } catch (error) {
                setStatus(error.message || 'Passkey approval failed.');
                button.disabled = false;
            }
        };

        button.addEventListener('click', approve);
    </script>
</body>
</html>`;
};

const renderSl1ConnectHome = (issuerHost = 'connect.simplelayer.one') => `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Simple Layer Identity</title>
    <meta name="application-name" content="Simple Layer Identity">
    <meta name="theme-color" content="#f6f6f1">
    <meta name="apple-mobile-web-app-title" content="Simple Layer Identity">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <style>
        :root { color-scheme: light; --bg:#f6f6f1; --panel:#fff; --text:#090909; --muted:#555; --accent:#8b3dff; --border:#090909; }
        * { box-sizing: border-box; }
        body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
        main { width:min(520px,calc(100% - 28px)); padding:34px; background:var(--panel); border:4px solid var(--border); box-shadow:10px 10px 0 var(--border); }
        .brand { display:inline-flex; align-items:center; gap:8px; margin-bottom:22px; font-size:12px; font-weight:950; letter-spacing:.06em; text-transform:uppercase; }
        .dot { width:12px; height:12px; border:2px solid var(--border); background:var(--accent); display:inline-block; }
        h1 { margin:0 0 12px; font-size:42px; line-height:.95; letter-spacing:-.07em; }
        p { margin:0 0 18px; color:var(--muted); line-height:1.55; font-weight:750; }
        .proof { margin:22px 0; padding:16px; border:2px solid var(--border); background:#f4efff; font-size:13px; font-weight:850; }
        .proof div { display:flex; justify-content:space-between; gap:12px; margin:7px 0; }
        .proof span { color:var(--muted); }
        .button { display:inline-flex; align-items:center; justify-content:center; width:100%; padding:14px 18px; border:3px solid var(--border); background:linear-gradient(135deg,#7c3cff,#b94cff); box-shadow:4px 4px 0 var(--border); color:#fff; text-decoration:none; font-weight:950; }
        .note { margin-top:16px; font-size:12px; color:var(--muted); text-align:center; }
    </style>
</head>
<body>
    <main>
        <div class="brand"><span class="dot"></span>Simple Layer Identity</div>
        <h1>SL1 Connect</h1>
        <p>Standalone identity proof runtime for Simple Layer One. It authenticates controllers and issues audience-bound IdentityProof artifacts.</p>
        <div class="proof">
            <div><span>Origin</span><b>${htmlEscape(issuerHost)}</b></div>
            <div><span>Artifact</span><b>IdentityProof</b></div>
            <div><span>Rule</span><b>Identity != Authority</b></div>
        </div>
        <a class="button" href="/">Open Simple Layer One</a>
        <div class="note">Install this site as an app to open SL1 Identity in standalone mode.</div>
    </main>
</body>
</html>`;

const accountByEntityAddress = (entityAddress) => {
    const normalized = String(entityAddress || '').trim();
    return ledger.accounts?.[normalized] || null;
};

const identityProfile = (account) => {
    if (!account) return null;
    const entityAddress = account.entity_l1_address || account.address;
    const bindings = (ledger.controller_bindings || [])
        .filter((binding) =>
            String(binding.entity_l1_address || '') === entityAddress
            && String(binding.status || 'active') === 'active'
        );
    const bindingForCredential = (credential, keyAddress) => bindings.find((binding) => {
        const credentialId = credential?.credentialId || credential?.credential_id;
        return (credentialId && String(binding.credential_id || '') === String(credentialId))
            || (keyAddress && String(binding.key_l1_address || binding.controller_l1_address || '') === String(keyAddress));
    });
    const keyRecords = accountCredentials(account).map((credential, index) => {
        const keyAddress = credential.key_l1_address || account.key_l1_address || null;
        const binding = bindingForCredential(credential, keyAddress);
        return {
            credential_id: credential.credentialId || credential.credential_id || binding?.credential_id || null,
            key_l1_address: keyAddress,
            role: credential.role || (index === 0 ? 'primary' : 'secondary'),
            controller_type: credential.controller_type || binding?.controller_type || (credential.rp_id || binding?.rp_id ? 'webauthn_passkey' : 'native_controller'),
            label: credential.label || binding?.label || null,
            rp_id: credential.rp_id || binding?.rp_id || account.rp_id || null,
            transports: credential.transports || binding?.transports || [],
            registered_at: credential.registered_at || binding?.created_at || null,
            status: credential.status || credential.credential_status || binding?.status || 'active',
            source: binding?.source || credential.source || null,
        };
    });
    const knownKeyAddresses = new Set(keyRecords.map((key) => String(key.key_l1_address || '')).filter(Boolean));
    const bindingOnlyRecords = bindings
        .filter((binding) => !knownKeyAddresses.has(String(binding.key_l1_address || binding.controller_l1_address || '')))
        .map((binding, index) => ({
            credential_id: binding.credential_id || null,
            key_l1_address: binding.key_l1_address || binding.controller_l1_address || null,
            role: index === 0 && keyRecords.length === 0 ? 'primary' : 'secondary',
            controller_type: binding.controller_type || 'trusted_device',
            label: binding.label || null,
            rp_id: binding.rp_id || null,
            transports: binding.transports || [],
            registered_at: binding.created_at || null,
            status: binding.status || 'active',
            source: binding.source || null,
        }));
    const keys = [...keyRecords, ...bindingOnlyRecords];
    const pendingRequests = (ledger.controller_binding_proposals || [])
        .filter((proposal) =>
            String(proposal.entity_l1_address || '') === entityAddress
            && String(proposal.status || 'pending') === 'pending'
        )
        .map((proposal) => ({
            proposal_id: proposal.proposal_id,
            proposed_controller_key_l1_address: proposal.proposed_controller_key_l1_address,
            controller_type: proposal.controller_type || 'unknown',
            label: proposal.label || null,
            proposed_at: proposal.proposed_at || null,
            status: proposal.status || 'pending',
        }));

    return {
        entity_l1_address: entityAddress,
        username: accountVisibleAlias(account) || account.handle || shortAddress(entityAddress),
        alias: publicAlias(account.alias) || null,
        display_alias: accountDisplayName(account) || null,
        active_key_count: keys.length,
        keys,
        pending_device_requests: pendingRequests,
    };
};

const renderSl1IdentityPage = (query = {}, issuerHost = 'connect.simplelayer.one') => {
    const switchMode = String(query.sl1e_switch || '') === '1';
    const hintedAddress = query.identity_hint || query.login_hint || query.entity_l1_address;
    const hintedLocalAccount = hintedAddress ? accountByEntityAddress(hintedAddress) : null;
    const hinted = switchMode ? null : (hintedVerifiableAccount(query) || hintedLocalAccount || firstVerifiableAccount());
    const profile = identityProfile(hinted);
    const entityAddress = profile?.entity_l1_address || '';
    const profileJson = JSON.stringify(profile);
    const initialIdentitySessionToken = verifySignedToken(query.identity_session_token, {
        typ: 'identity_management_session',
        entity_l1_address: entityAddress,
    })?.entity_l1_address === entityAddress
        ? String(query.identity_session_token)
        : null;
    const identitySwitchButtons = verifiableIdentityOptions()
        .filter(option => normalizeIdentityHint(option.entity_l1_address) !== normalizeIdentityHint(entityAddress))
        .map(option => `<button class="secondary subtle" type="button" data-switch-identity="${htmlEscape(option.entity_l1_address)}">Switch to ${htmlEscape(option.label || shortAddress(option.entity_l1_address))}</button>`)
        .join('');
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Meanly One Web Wallet</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <style>
        :root { color-scheme:dark; --bg:#080808; --panel:#101011; --panel-2:#151517; --line:#28282b; --line-strong:#3a3a40; --text:#f4f4f5; --muted:#8d8d93; --muted-2:#636369; --button:#f4f4f5; --good:#b9f6ca; --warn:#ffe0a3; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.08),transparent 26rem),#080808; color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; display:grid; place-items:center; padding:22px; }
        main { width:min(860px,100%); border:1px solid var(--line); border-radius:24px; background:linear-gradient(180deg,#121213,#0c0c0d); box-shadow:0 28px 90px rgba(0,0,0,.55); padding:24px; }
        .brand { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.1em; text-transform:uppercase; }
        h1 { margin:10px 0 8px; font-size:42px; line-height:1; letter-spacing:-.065em; }
        h2 { margin:0 0 10px; font-size:17px; letter-spacing:-.025em; }
        p { margin:0; color:var(--muted); line-height:1.55; font-weight:650; }
        label { display:block; margin:12px 0 7px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
        input { width:100%; min-height:44px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:#111113; color:var(--text); font:inherit; font-weight:720; }
        .hero { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; align-items:end; }
        .steps { display:none; gap:8px; padding:14px; border:1px solid var(--line); border-radius:16px; background:#101012; }
        .step { display:flex; align-items:center; gap:9px; color:var(--muted); font-size:12px; font-weight:760; }
        .step span { display:grid; place-items:center; width:22px; height:22px; border-radius:999px; background:#f4f4f5; color:#09090a; font-size:11px; font-weight:900; }
        .grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.74fr); gap:14px; margin-top:18px; }
        .panel { border:1px solid var(--line); border-radius:18px; background:#141416; padding:16px; }
        .panel.soft { background:#101012; }
        .row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
        .row:last-child { border-bottom:0; }
        .empty { display:grid; gap:12px; padding:16px; border:1px dashed var(--line-strong); border-radius:14px; background:#101012; }
        .device-list { display:grid; gap:10px; margin-top:10px; }
        .device { display:grid; gap:7px; padding:13px; border:1px solid var(--line); border-radius:14px; background:var(--panel-2); }
        .device-head { display:flex; justify-content:space-between; gap:12px; align-items:center; }
        .device-title { display:flex; flex-direction:column; gap:2px; }
        .device-title strong { font-size:14px; }
        .badge { display:inline-flex; align-items:center; width:max-content; padding:4px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); font-size:11px; font-weight:780; }
        .badge.ready { color:var(--good); border-color:rgba(185,246,202,.28); background:rgba(185,246,202,.08); }
        .badge.pending { color:var(--warn); border-color:rgba(255,224,163,.28); background:rgba(255,224,163,.08); }
        details { margin-top:12px; color:var(--muted); }
        summary { cursor:pointer; font-size:12px; font-weight:820; }
        code,pre { color:#dcdce0; word-break:break-all; white-space:pre-wrap; }
        pre { max-height:260px; overflow:auto; padding:12px; border:1px solid var(--line); border-radius:12px; background:#0b0b0c; font-size:11px; }
        button,.button { display:inline-flex; justify-content:center; align-items:center; min-height:42px; padding:11px 14px; border:1px solid var(--button); border-radius:12px; background:var(--button); color:#09090a; font-weight:820; text-decoration:none; cursor:pointer; }
        button.secondary,.button.secondary { background:transparent; color:var(--text); border-color:var(--line); }
        button.subtle,.button.subtle { min-height:38px; font-size:12px; }
        button.danger { background:#2a1111; border-color:#683131; color:#ffd5d5; }
        button:disabled { opacity:.55; cursor:wait; }
        .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
        .actions button,.actions .button { flex:1 1 180px; }
        .primary-actions button { min-height:48px; font-size:14px; }
        .secondary-actions { margin-top:8px; }
        .secondary-actions button,.secondary-actions .button { min-height:38px; font-size:12px; opacity:.86; }
        .hidden { display:none !important; }
        .pairing-panel { display:none; margin-top:14px; }
        .pairing-panel.visible { display:grid; gap:12px; }
        .pairing-panel img { display:block; width:190px; height:190px; margin:0 auto; padding:8px; border-radius:12px; background:#fff; }
        .muted { color:var(--muted); font-size:12px; }
        .status { min-height:18px; margin-top:12px; color:var(--muted); font-size:13px; font-weight:720; }
        @media (max-width:760px) { .hero,.grid { grid-template-columns:1fr; } h1 { font-size:34px; } .row,.device-head { flex-direction:column; align-items:flex-start; } button,.button { width:100%; } }
        :root { color-scheme: light; --bg:#eef0fc; --panel:#ffffff; --panel-2:#f8fafc; --line:#050505; --line-strong:#050505; --text:#050505; --muted:#4b5563; --muted-2:#6b7280; --button:#7c3aed; --good:#047857; --warn:#92400e; --accent:#7c3aed; --brand-soft:#efe6ff; --acid:#d8ff6f; }
        body { background:linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px),linear-gradient(0deg,rgba(0,0,0,.035) 1px,transparent 1px),radial-gradient(circle at 50% -120px,rgba(124,58,237,.18),transparent 38rem),var(--bg); background-size:28px 28px,28px 28px,auto,auto; color:var(--text); font-family:Outfit,Inter,ui-sans-serif,system-ui,sans-serif; }
        main { background:#fff; border:3px solid var(--line); border-radius:24px; box-shadow:8px 8px 0 var(--line); }
        .brand { color:var(--line); font-family:"JetBrains Mono",ui-monospace,monospace; font-weight:900; letter-spacing:.08em; }
        .brand::before { content:""; display:inline-block; width:12px; height:12px; margin-right:8px; background:var(--accent); border:2px solid var(--line); box-shadow:2px 2px 0 var(--line); transform:rotate(-8deg); vertical-align:-2px; }
        h1 { color:var(--text); font-size:clamp(42px,7vw,64px); font-weight:950; letter-spacing:-.08em; }
        h2 { color:var(--text); font-weight:950; }
        p, .muted, .status, label { color:var(--muted); font-weight:800; }
        .panel, .panel.soft, .empty, .device, .steps, input, pre { background:#fff; border:2px solid var(--line); border-radius:16px; box-shadow:4px 4px 0 var(--line); color:var(--text); }
        .panel.soft, .empty { background:#f8fafc; }
        .row { border-bottom:2px solid rgba(5,5,5,.12); }
        .badge { border:2px solid var(--line); color:var(--line); background:#fff; font-family:"JetBrains Mono",ui-monospace,monospace; font-weight:900; }
        .badge.ready { color:#064e3b; border-color:var(--line); background:#ecfdf5; }
        .badge.pending { color:#78350f; border-color:var(--line); background:#fff7d6; }
        button,.button { border:2px solid var(--line); border-radius:14px; background:var(--accent); color:#fff; box-shadow:4px 4px 0 var(--line); font-weight:950; }
        button.secondary,.button.secondary { background:#fff; color:var(--text); border-color:var(--line); }
        button.danger { background:#ffe1e1; border-color:var(--line); color:#7f1d1d; }
        button:hover:not(:disabled),.button:hover { transform:translate(-1px,-1px); box-shadow:5px 5px 0 var(--line); }
    </style>
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
</head>
<body>
    <main>
        <section class="hero">
            <div>
                <div class="brand">Meanly One Web Wallet</div>
                <h1>Web Wallet</h1>
                <p>Create Identity means add the first controller. Your <code>sl1e_*</code> stays the same when native app, devices, or clients change.</p>
            </div>
            <div class="steps" aria-label="Identity flow">
                <div class="step"><span>1</span>Create or select identity</div>
                <div class="step"><span>2</span>Add second device</div>
                <div class="step"><span>3</span>Sync devices</div>
                <div class="step"><span>4</span>Continue with Meanly</div>
                <div class="step"><span>5</span>Receive identity proof</div>
            </div>
        </section>
        <div class="grid">
            <section class="panel" id="identity-panel"></section>
            <section class="panel soft" id="devices-panel"></section>
        </div>
        <section class="panel pairing-panel" id="pairing-panel" aria-live="polite">
            <h2>Add phone by QR</h2>
            <p>Scan this QR on your Google phone. The phone will create a device request, then you approve it here.</p>
            <img id="pairing-qr" alt="QR code to add this phone">
            <div id="pairing-status" class="muted">Waiting for phone...</div>
        </section>
        <div class="actions primary-actions">
            <button id="continue-button" type="button" disabled>Continue with Meanly</button>
            <button id="pair-button" class="secondary" type="button" disabled>Add phone</button>
            <button id="create-button" type="button">Create Web Wallet</button>
            <button id="auth-button" class="secondary" type="button">Unlock</button>
        </div>
        <div class="actions secondary-actions">
            <button id="sync-button" class="secondary" type="button" disabled>Sync Devices</button>
            <button id="add-button" class="secondary hidden" type="button" disabled>Add passkey on this Mac</button>
            ${identitySwitchButtons}
            <button id="forget-button" class="secondary" type="button">Lock / Sign out</button>
            <a class="button secondary hidden" href="/connect">Connect page</a>
        </div>
        <div id="status" class="status"></div>
    </main>
    <script>
        const initialProfile = ${profileJson};
        const initialEntity = ${JSON.stringify(entityAddress)};
        const panel = document.getElementById('identity-panel');
        const devicesPanel = document.getElementById('devices-panel');
        const statusNode = document.getElementById('status');
        const createButton = document.getElementById('create-button');
        const authButton = document.getElementById('auth-button');
        const addButton = document.getElementById('add-button');
        const pairButton = document.getElementById('pair-button');
        const syncButton = document.getElementById('sync-button');
        const continueButton = document.getElementById('continue-button');
        const forgetButton = document.getElementById('forget-button');
        const pairingPanel = document.getElementById('pairing-panel');
        const pairingQr = document.getElementById('pairing-qr');
        const pairingStatus = document.getElementById('pairing-status');
        const switchIdentityButtons = document.querySelectorAll('[data-switch-identity]');
        let identitySessionToken = ${JSON.stringify(initialIdentitySessionToken)};
        let profile = initialProfile;
        let lastSync = null;
        let pairingPollTimer = null;
        const setStatus = (message) => { statusNode.textContent = message; };
        const entityAddress = () => profile?.entity_l1_address || initialEntity;
        const escapeHtml = (value) => String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
        const shortValue = (value) => {
            const text = String(value || '');
            return text.length <= 22 ? text : text.slice(0, 12) + '...' + text.slice(-7);
        };
        const randomToken = () => {
            if (window.crypto?.randomUUID) return window.crypto.randomUUID();
            const bytes = new Uint8Array(16);
            window.crypto?.getRandomValues(bytes);
            return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const primaryDevice = () => (profile?.keys || []).find((key) => key.role === 'primary') || (profile?.keys || [])[0] || null;
        const deviceLabel = (key, index) => {
            if (key.label) return key.label;
            if (index === 0) return 'This Mac';
            const type = String(key.controller_type || '').toLowerCase();
            const transports = (key.transports || []).map((transport) => String(transport).toLowerCase());
            if (type.includes('native_macos')) return index === 0 ? 'This Mac' : 'Mac device';
            if (transports.includes('hybrid')) return 'Phone passkey';
            if (key.rp_id) return index === 0 ? 'Primary passkey' : 'Browser passkey';
            return index === 0 ? 'Primary device' : 'Trusted device ' + (index + 1);
        };
        const deviceMeta = (key) => {
            const parts = [];
            if (key.rp_id) parts.push('Passkey');
            if (key.registered_at) parts.push('Added ' + new Date(key.registered_at).toLocaleDateString());
            if (!parts.length && key.controller_type) parts.push(String(key.controller_type).replaceAll('_', ' '));
            return parts.join(' · ') || 'Trusted device';
        };
        const friendlyError = (error, fallback) => {
            const message = String(error?.message || error || '').trim();
            if (/not allowed|permission|denied|cancel|abort|user agent/i.test(message)) {
                return 'Passkey was cancelled or not allowed. Try again.';
            }
            if (/invalid domain|rp|origin|localhost|127\\.0\\.0\\.1/i.test(message)) {
                return 'Open this app on localhost and try again.';
            }
            if (/already registered/i.test(message)) {
                return 'This device is already trusted.';
            }
            return message || fallback;
        };
        const updateActions = () => {
            const hasIdentity = Boolean(profile);
            createButton.classList.toggle('hidden', hasIdentity);
            continueButton.classList.toggle('hidden', !hasIdentity);
            pairButton.classList.toggle('hidden', !hasIdentity);
            authButton.classList.toggle('hidden', !hasIdentity || Boolean(identitySessionToken));
            addButton.classList.add('hidden');
            syncButton.classList.toggle('hidden', !hasIdentity);
            forgetButton.classList.toggle('hidden', !hasIdentity);
        };

        if (!new URLSearchParams(window.location.search).has('identity_hint') && !new URLSearchParams(window.location.search).has('sl1e_switch')) {
            try {
                const remembered = window.localStorage?.getItem('sl1e.identity_hint');
                if (remembered) {
                    const nextUrl = new URL(window.location.href);
                    nextUrl.searchParams.set('identity_hint', remembered);
                    window.location.replace(nextUrl.toString());
                }
            } catch (error) {}
        }

        const renderProfile = () => {
            if (!profile) {
                panel.innerHTML = '<h2>Create your identity</h2><div class="empty"><p>This Mac becomes your first trusted device.</p><label for="identity-alias">Name</label><input id="identity-alias" autocomplete="username" maxlength="25" placeholder="@yourname"><button type="button" id="inline-create-button">Create on this Mac</button></div>';
                devicesPanel.innerHTML = '<h2>Trusted Devices</h2><p>Your Mac appears here after identity creation.</p>';
                createButton.disabled = false;
                authButton.disabled = true;
                addButton.disabled = true;
                pairButton.disabled = true;
                syncButton.disabled = true;
                continueButton.disabled = true;
                updateActions();
                document.getElementById('inline-create-button')?.addEventListener('click', createIdentityOnThisDevice);
                return;
            }
            const keys = profile.keys || [];
            const pendingRequests = profile.pending_device_requests || [];
            const displayName = profile.display_alias || profile.username || 'Meanly identity';
            panel.innerHTML = [
                '<h2>' + escapeHtml(displayName) + '</h2>',
                '<p>Your identity is ready on this device.</p>',
                '<div class="row"><span>Identity</span><strong>Ready</strong></div>',
                '<div class="row"><span>Trusted devices</span><strong>' + keys.length + '</strong></div>',
                pendingRequests.length ? '<div class="row"><span>Device requests</span><strong>' + pendingRequests.length + '</strong></div>' : '',
                lastSync ? '<div class="row"><span>Last Sync</span><strong>' + escapeHtml(lastSync) + '</strong></div>' : '',
                '<details><summary>Developer details</summary><div class="row"><span>Identity address</span><code>' + escapeHtml(profile.entity_l1_address) + '</code></div><div class="row"><span>Runtime</span><code>localhost</code></div></details>',
            ].join('');
            devicesPanel.innerHTML = [
                '<h2>Trusted Devices</h2>',
                keys.length
                    ? '<div class="device-list">' + keys.map((key, index) => '<div class="device"><div class="device-head"><div class="device-title"><strong>' + escapeHtml(deviceLabel(key, index)) + '</strong><span class="muted">' + escapeHtml(deviceMeta(key)) + '</span></div><span class="badge ready">Trusted</span></div><details><summary>Developer details</summary><code>' + escapeHtml(key.key_l1_address || 'device key unavailable') + '</code><button class="danger subtle" type="button" data-revoke="' + escapeHtml(key.credential_id || '') + '"' + (!key.credential_id || keys.length <= 1 ? ' disabled' : '') + '>Remove Device</button></details></div>').join('') + '</div>'
                    : '<p>No trusted devices yet.</p>',
                pendingRequests.length
                    ? '<h2 style="margin-top:16px">Device Requests</h2><div class="device-list">' + pendingRequests.map((request) => '<div class="device"><div class="device-head"><div class="device-title"><strong>' + escapeHtml(request.label || 'New device request') + '</strong><span class="muted">' + escapeHtml(shortValue(request.proposed_controller_key_l1_address)) + '</span></div><span class="badge pending">Waiting for approval</span></div><button class="secondary subtle" type="button" data-approve="' + escapeHtml(request.proposal_id || '') + '"' + (!identitySessionToken ? ' disabled' : '') + '>Approve Device</button></div>').join('') + '</div>'
                    : '',
            ].join('');
            panel.querySelectorAll('[data-revoke]').forEach((button) => {
                button.addEventListener('click', () => revokePasskey(button.dataset.revoke));
            });
            devicesPanel.querySelectorAll('[data-revoke]').forEach((button) => {
                button.addEventListener('click', () => revokePasskey(button.dataset.revoke));
            });
            devicesPanel.querySelectorAll('[data-approve]').forEach((button) => {
                button.addEventListener('click', () => approveDeviceRequest(button.dataset.approve));
            });
            createButton.disabled = true;
            authButton.disabled = false;
            addButton.disabled = !identitySessionToken;
            pairButton.disabled = false;
            syncButton.disabled = false;
            continueButton.disabled = false;
            updateActions();
        };

        const refreshProfile = async () => {
            const response = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()), { headers: { 'Accept': 'application/json' } });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Could not read identity.');
            profile = payload.identity;
            renderProfile();
        };

        const authenticate = async () => {
            if (!profile) return false;
            authButton.disabled = true;
            setStatus('Confirm this identity on a trusted device...');
            try {
                const optionsResponse = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/authentication/options', { headers: { 'Accept': 'application/json' } });
                const optionsPayload = await optionsResponse.json();
                if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Could not prepare authentication.');
                const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optionsPayload.publicKey });
                const completeResponse = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/authentication/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ authorization_request_id: optionsPayload.authorization_request_id, assertion }),
                });
                const completePayload = await completeResponse.json();
                if (!completeResponse.ok) throw new Error(completePayload.error || 'Could not unlock identity.');
                identitySessionToken = completePayload.identity_session_token;
                addButton.disabled = false;
                pairButton.disabled = false;
                updateActions();
                setStatus('Identity unlocked. You can add or remove trusted devices.');
                return true;
            } catch (error) {
                setStatus(friendlyError(error, 'Could not unlock identity.'));
                return false;
            } finally {
                authButton.disabled = false;
            }
        };

        const addDevice = async () => {
            if (!identitySessionToken) {
                const unlocked = await authenticate();
                if (!unlocked) return;
            }
            addButton.disabled = true;
            setStatus('Preparing a new trusted device...');
            try {
                const optionsResponse = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/passkeys/registration/options', {
                    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + identitySessionToken },
                });
                const optionsPayload = await optionsResponse.json();
                if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Could not prepare device setup.');
                const attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optionsPayload.publicKey });
                const completeResponse = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/passkeys/registration/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + identitySessionToken },
                    body: JSON.stringify({ registration_request_id: optionsPayload.registration_request_id, attestation }),
                });
                const completePayload = await completeResponse.json();
                if (!completeResponse.ok) throw new Error(completePayload.error || 'Could not add device.');
                profile = completePayload.identity;
                renderProfile();
                setStatus('Device added. It can now use this identity.');
            } catch (error) {
                setStatus(friendlyError(error, 'Could not add device.'));
            } finally {
                addButton.disabled = !identitySessionToken;
            }
        };

        const approveDeviceRequest = async (proposalId) => {
            if (!proposalId) return;
            if (!identitySessionToken) {
                const unlocked = await authenticate();
                if (!unlocked) return;
            }
            setStatus('Approving device...');
            try {
                const response = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/controller-bindings/proposals/' + encodeURIComponent(proposalId) + '/approve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + identitySessionToken },
                    body: JSON.stringify({ approved_by_key_l1_address: primaryDevice()?.key_l1_address || null }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Could not approve device.');
                await refreshProfile();
                setStatus('Device approved. It is now trusted for this identity.');
            } catch (error) {
                setStatus(friendlyError(error, 'Could not approve device.'));
            }
        };

        const stopPairingPolling = () => {
            if (pairingPollTimer) {
                clearInterval(pairingPollTimer);
                pairingPollTimer = null;
            }
        };

        const pollPairing = (pollUrl) => {
            stopPairingPolling();
            pairingPollTimer = setInterval(async () => {
                try {
                    const response = await fetch(pollUrl, { headers: { 'Accept': 'application/json' } });
                    const payload = await response.json();
                    if (!response.ok) throw new Error(payload.error || 'Could not check phone pairing.');
                    if (payload.proposal && payload.status === 'pending') {
                        profile = payload.identity || profile;
                        renderProfile();
                        pairingStatus.textContent = 'Phone request received. Approve it in Trusted Devices.';
                        setStatus('Phone request received. Approve it to trust this device.');
                    }
                    if (payload.status === 'approved') {
                        stopPairingPolling();
                        profile = payload.identity || profile;
                        renderProfile();
                        pairingStatus.textContent = 'Phone approved.';
                        setStatus('Phone approved. Devices synced through the same identity.');
                    }
                } catch (error) {
                    pairingStatus.textContent = friendlyError(error, 'Could not check phone pairing.');
                }
            }, 2200);
        };

        const addPhoneByQr = async () => {
            if (!identitySessionToken) {
                const unlocked = await authenticate();
                if (!unlocked) return;
            }
            pairButton.disabled = true;
            setStatus('Preparing phone pairing...');
            try {
                const response = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/device-pairings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + identitySessionToken },
                    body: JSON.stringify({ device_kind: 'phone' }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Could not prepare phone pairing.');
                pairingQr.src = payload.qr_svg_url;
                pairingPanel.classList.add('visible');
                pairingStatus.textContent = 'Scan with your Google phone.';
                setStatus('Scan the QR with your phone, then approve the device request here.');
                pollPairing(payload.poll_url);
            } catch (error) {
                setStatus(friendlyError(error, 'Could not prepare phone pairing.'));
            } finally {
                pairButton.disabled = !identitySessionToken;
            }
        };

        const revokePasskey = async (credentialId) => {
            if (!identitySessionToken) return authenticate();
            setStatus('Removing device...');
            const response = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/passkeys/' + encodeURIComponent(credentialId) + '/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + identitySessionToken },
                body: JSON.stringify({ reason: 'user_removed' }),
            });
            const payload = await response.json();
            if (!response.ok) {
                setStatus(payload.error === 'cannot_remove_last_passkey' ? 'Keep at least one trusted device.' : (payload.error || 'Could not remove device.'));
                return;
            }
            profile = payload.identity;
            renderProfile();
            setStatus('Device removed.');
        };

        const syncDevices = async () => {
            if (!profile) return;
            const device = primaryDevice();
            const deviceKeyAddress = device?.key_l1_address;
            if (!deviceKeyAddress) {
                setStatus('No trusted device key is available to sync.');
                return;
            }
            syncButton.disabled = true;
            setStatus('Syncing devices...');
            try {
                const stateResponse = await fetch('/api/sl1e/identity/' + encodeURIComponent(entityAddress()) + '/mesh/state?device_key_l1_address=' + encodeURIComponent(deviceKeyAddress), { headers: { 'Accept': 'application/json' } });
                const statePayload = await stateResponse.json();
                if (!stateResponse.ok) throw new Error(statePayload.error || 'Could not read device state.');
                const publishResponse = await fetch('/api/sl1e/mesh/mailbox/' + encodeURIComponent(entityAddress()), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ envelope: statePayload.envelope, source: 'identity_home_reference' }),
                });
                const publishPayload = await publishResponse.json();
                if (!publishResponse.ok) throw new Error(publishPayload.error || 'Could not publish device state.');
                const mailboxResponse = await fetch('/api/sl1e/mesh/mailbox/' + encodeURIComponent(entityAddress()), { headers: { 'Accept': 'application/json' } });
                const mailboxPayload = await mailboxResponse.json();
                if (!mailboxResponse.ok) throw new Error(mailboxPayload.error || 'Could not read synced devices.');
                lastSync = new Date().toLocaleTimeString();
                renderProfile();
                setStatus('Devices synced. ' + (mailboxPayload.messages || []).length + ' observation' + ((mailboxPayload.messages || []).length === 1 ? '' : 's') + ' available.');
            } catch (error) {
                setStatus(friendlyError(error, 'Could not sync devices.'));
            } finally {
                syncButton.disabled = false;
            }
        };

        const registrationQuery = (alias) => {
            const redirectUri = window.location.origin + '/meanly/identity-proof/callback';
            const state = randomToken();
            const nonce = randomToken();
            const params = new URLSearchParams({
                client_id: 'meanly.reference',
                client_name: 'Meanly',
                redirect_uri: redirectUri,
                state,
                nonce,
                mode: 'connect',
                flow: 'connect',
                intent_type: 'meanly.login',
                intent_title: 'Continue with Meanly',
                intent_description: 'Meanly receives a verified identity result. App session creation is outside this reference flow.',
                intent_resource: 'meanly.reference',
                intent_cta: 'Continue',
            });
            if (alias) {
                const normalizedAlias = String(alias).replace(/^@+/, '').trim();
                if (normalizedAlias) {
                    params.set('alias', normalizedAlias);
                    params.set('display_alias', normalizedAlias);
                }
            }
            return { params, state };
        };

        const createIdentityOnThisDevice = async () => {
            const inlineButton = document.getElementById('inline-create-button');
            const aliasInput = document.getElementById('identity-alias');
            const alias = aliasInput?.value || '';
            inlineButton.disabled = true;
            createButton.disabled = true;
            setStatus('Creating identity on this Mac...');
            try {
                const { params, state } = registrationQuery(alias);
                try { window.sessionStorage?.setItem('meanly.reference.state', state); } catch (error) {}
                const optionsResponse = await fetch('/api/sl1e/registration/options?' + params.toString(), {
                    headers: { 'Accept': 'application/json' },
                });
                const optionsPayload = await optionsResponse.json();
                if (!optionsResponse.ok) throw new Error(optionsPayload.message || optionsPayload.error || 'Could not prepare identity creation.');
                const attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optionsPayload.publicKey });
                const completeResponse = await fetch('/api/sl1e/registration/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        registration_request_id: optionsPayload.registration_request_id,
                        attestation,
                    }),
                });
                const completePayload = await completeResponse.json();
                if (!completeResponse.ok) throw new Error(completePayload.detail || completePayload.error || 'Could not create identity.');
                const identity = completePayload.identity || {};
                if (identity.entity_l1_address) {
                    try {
                        window.localStorage?.setItem('sl1e.identity_hint', identity.entity_l1_address);
                        if (completePayload.identity_capsule) {
                            window.localStorage?.setItem('sl1e.identity_capsule', JSON.stringify(completePayload.identity_capsule));
                        }
                        if (completePayload.portability_contract) {
                            window.localStorage?.setItem('sl1e.portability_contract', JSON.stringify(completePayload.portability_contract));
                        }
                    } catch (error) {}
                    window.location.href = '/identity?identity_hint=' + encodeURIComponent(identity.entity_l1_address);
                    return;
                }
                window.location.reload();
            } catch (error) {
                setStatus(friendlyError(error, 'Could not create identity on this Mac.'));
                inlineButton.disabled = false;
                createButton.disabled = false;
            }
        };

        const startIdentityFlow = (useCurrentIdentity) => {
            const { params, state } = registrationQuery('');
            try { window.sessionStorage?.setItem('meanly.reference.state', state); } catch (error) {}
            if (useCurrentIdentity && entityAddress()) {
                params.set('identity_hint', entityAddress());
            }
            window.location.href = '/authorize?' + params.toString();
        };

        authButton.addEventListener('click', authenticate);
        addButton.addEventListener('click', addDevice);
        pairButton.addEventListener('click', addPhoneByQr);
        syncButton.addEventListener('click', syncDevices);
        createButton.addEventListener('click', () => profile ? startIdentityFlow(false) : createIdentityOnThisDevice());
        continueButton.addEventListener('click', () => startIdentityFlow(true));
        switchIdentityButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const identityHint = String(button.dataset.switchIdentity || '').trim();
                if (!identityHint) return;
                try {
                    window.localStorage?.setItem('sl1e.identity_hint', identityHint);
                    window.localStorage?.removeItem('sl1e.identity_capsule');
                } catch (error) {}
                window.location.href = '/identity?identity_hint=' + encodeURIComponent(identityHint);
            });
        });
        forgetButton.addEventListener('click', () => {
            identitySessionToken = null;
            try { window.localStorage?.removeItem('sl1e.identity_hint'); } catch (error) {}
            try { window.localStorage?.removeItem('sl1e.identity_capsule'); } catch (error) {}
            try { window.localStorage?.removeItem('sl1e.portability_contract'); } catch (error) {}
            try { window.localStorage?.removeItem('sl1e.alias_reservation'); } catch (error) {}
            try { window.sessionStorage?.removeItem('meanly.reference.state'); } catch (error) {}
            window.location.href = '/identity?sl1e_switch=1';
        });
        renderProfile();
        if (identitySessionToken) {
            addButton.disabled = false;
            pairButton.disabled = false;
            setStatus('Identity unlocked by Meanly One. You can add a trusted device.');
        }
    </script>
</body>
</html>`;
};

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
// The ceremony is issuer-owned but client-branded; the brand should link back to
// the storefront that initiated the request. Derive that origin from the
// client's redirect_uri (already validated against the registry at PAR time).
const storefrontHomeUrl = (query = {}) => {
    const candidate = String(query.client_home_url || query.redirect_uri || '').trim();
    if (!candidate) return '';
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
        return `${url.protocol}//${url.host}/`;
    } catch (error) {
        return '';
    }
};
const renderMeanlyWalletSpaPage = (query = {}, issuerHost = 'connect.simplelayer.one') => {
    const surface = walletSurfaceForHost(issuerHost, query.ui_locale || query.alias_locale);
    const clientBrand = String(query.client_brand || '').trim();
    if (clientBrand) surface.brand = clientBrand;
    const clientAccent = String(query.client_accent || '').trim();
    surface.accent = SAFE_HEX_COLOR.test(clientAccent) ? clientAccent : '';
    surface.homeUrl = storefrontHomeUrl(query);
    const initialRoute = {
        path: String(query.__spa_path || '/wallet'),
        query: Object.fromEntries(Object.entries(query).filter(([key]) => key !== '__spa_path')),
    };
    const topbarMarkup = surface.connectOnly
        ? ''
        : surface.showCommerceNav
            ? `<nav class="topbar" aria-label="Meanly navigation">
            <a href="/">Shop</a>
            <a href="/catalog">Categories</a>
            <button type="button" data-nav="/wallet">Vault</button>
        </nav>`
            : `<header class="protocol-shell" aria-label="Simple Layer protocol">${surface.homeUrl ? `<a class="brand" href="${htmlEscape(surface.homeUrl)}">${htmlEscape(surface.brand)}</a>` : `<span class="brand">${htmlEscape(surface.brand)}</span>`}</header>`;
    const footMarkup = surface.connectOnly
        ? ''
        : surface.showCommerceNav
            ? `<div class="foot"><span class="brand">${htmlEscape(surface.footer)}</span><span>2026</span></div>`
            : `<div class="protocol-foot"><span>${htmlEscape(surface.footer)}</span></div>`;

    return `<!doctype html>
<html lang="${htmlEscape(surface.locale || 'en')}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(surface.title)}</title>
    <meta name="application-name" content="${htmlEscape(surface.title)}">
    <meta name="theme-color" content="#eef0fc">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <style>
        :root { color-scheme: light; --bg:#eef0fc; --panel:#fff; --soft:#f8fafc; --text:#050505; --muted:#4b5563; --accent:#7c3aed; --acid:#d8ff6f; --warn:#fff7d6; --border:#050505; --shadow:8px 8px 0 #050505; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; background:linear-gradient(90deg,rgba(0,0,0,.035) 1px,transparent 1px),linear-gradient(0deg,rgba(0,0,0,.035) 1px,transparent 1px),radial-gradient(circle at 50% -120px,rgba(124,58,237,.18),transparent 38rem),var(--bg); background-size:28px 28px,28px 28px,auto,auto; color:var(--text); font-family:Outfit,Inter,ui-sans-serif,system-ui,sans-serif; }
        .app { min-height:100vh; display:grid; grid-template-rows:auto 1fr auto; padding:28px; }
        .topbar, .foot { justify-self:center; display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border:3px solid var(--border); border-radius:999px; background:#fff; box-shadow:4px 4px 0 var(--border); font-size:12px; font-weight:950; }
        .protocol-shell { justify-self:center; display:inline-flex; align-items:center; padding:10px 14px; border:2px solid var(--border); border-radius:999px; background:rgba(255,255,255,.92); box-shadow:3px 3px 0 var(--border); }
        .protocol-foot { justify-self:center; color:var(--muted); font-family:"JetBrains Mono",ui-monospace,monospace; font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
        body.protocol-surface { background:radial-gradient(circle at 50% -120px,rgba(15,23,42,.08),transparent 38rem),#f6f6f1; background-size:auto,auto; }
        body.protocol-surface .card { border-radius:18px; box-shadow:0 24px 80px rgba(15,23,42,.12); }
        body.protocol-surface .brand::before { background:#111827; transform:none; }
        .topbar a, .topbar button { min-height:30px; padding:6px 13px; border:0; border-radius:999px; background:transparent; box-shadow:none; color:var(--text); text-decoration:none; font:inherit; cursor:pointer; }
        .topbar a.active, .topbar button.active { background:var(--accent); color:#fff; border:2px solid var(--border); }
        main { display:grid; place-items:center; padding:60px 0; }
        .card { width:min(460px,calc(100vw - 42px)); padding:30px; border:4px solid var(--border); border-radius:26px; background:#fff; box-shadow:var(--shadow); text-align:center; }
        .card.wide { width:min(560px,calc(100vw - 42px)); text-align:center; }
        .brand { display:inline-flex; align-items:center; justify-content:center; gap:8px; margin-bottom:12px; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:10px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; color:var(--text); }
        a.brand { text-decoration:none; cursor:pointer; }
        a.brand:hover { opacity:.7; }
        .brand::before { content:""; width:12px; height:12px; background:var(--accent); border:2px solid var(--border); box-shadow:2px 2px 0 var(--border); transform:rotate(-8deg); }
        h1 { margin:0 0 10px; font-size:clamp(40px,8vw,64px); line-height:.92; letter-spacing:-.085em; font-weight:950; text-wrap:balance; }
        h2 { margin:0 0 10px; font-size:24px; letter-spacing:-.05em; font-weight:950; }
        p { margin:0; color:var(--muted); font-weight:800; line-height:1.45; }
        .pill { display:inline-flex; align-items:center; justify-content:center; gap:7px; margin:8px 0 18px; padding:5px 10px; border:3px solid var(--border); border-radius:999px; background:#fff; box-shadow:3px 3px 0 var(--border); font-size:12px; font-weight:950; }
        .panel { margin-top:18px; padding:16px; border:3px solid var(--border); border-radius:16px; background:var(--soft); box-shadow:4px 4px 0 var(--border); }
        .panel.warn { background:var(--warn); text-align:left; }
        .row { display:flex; justify-content:space-between; gap:16px; padding:7px 0; font-weight:950; }
        .row span { color:var(--muted); }
        .actions { display:grid; gap:10px; margin-top:18px; }
        button, .button { min-height:48px; padding:12px 16px; border:3px solid var(--border); border-radius:14px; background:var(--accent); color:#fff; box-shadow:4px 4px 0 var(--border); font-weight:950; cursor:pointer; text-decoration:none; }
        button.secondary, .button.secondary { background:#fff; color:var(--text); }
        button.acid { background:var(--acid); color:var(--text); }
        button:disabled { opacity:.58; cursor:wait; }
        input { width:100%; min-height:48px; padding:11px 13px; border:3px solid var(--border); border-radius:14px; background:#fff; color:var(--text); box-shadow:3px 3px 0 var(--border); font:inherit; font-weight:900; text-align:center; }
        input:focus { outline:0; border-color:var(--accent); box-shadow:4px 4px 0 var(--border); }
        label { display:block; margin:0 0 8px; color:var(--muted); font-family:"JetBrains Mono",ui-monospace,monospace; font-size:10px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; text-align:left; }
        .identity-list { display:grid; gap:9px; margin-top:16px; }
        .identity-list button { background:#111; color:#fff; text-align:left; justify-content:flex-start; }
        .split { display:grid; gap:16px; align-items:start; }
        .device { display:grid; gap:5px; padding:12px; border:2px solid var(--border); border-radius:14px; background:#fff; }
        .status { min-height:18px; margin-top:12px; color:var(--muted); font-size:12px; font-weight:900; text-align:center; }
        .muted { color:var(--muted); font-size:12px; font-weight:850; }
        .storefront-tag { margin:-4px 0 14px; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:11px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
        button.link-button, .link-button { min-height:auto; padding:8px 10px; border:0; background:transparent; box-shadow:none; color:var(--muted); font-weight:900; font-size:13px; text-decoration:underline; text-underline-offset:3px; }
        button.link-button:hover { color:var(--text); }
        .hidden { display:none !important; }
        @media (max-width:760px) { .app { padding:18px; } main { padding:34px 0; } .split { grid-template-columns:1fr; } .card, .card.wide { width:100%; } }
        /* ADR-0029 connect ceremony: rounded neobrutalism, unified with the
           storefront surface; present only the connect window. */
        body.connect-surface { background:linear-gradient(90deg,rgba(0,0,0,.05) 1px,transparent 1px),linear-gradient(0deg,rgba(0,0,0,.05) 1px,transparent 1px),radial-gradient(circle at 50% -120px,rgba(124,58,237,.2),transparent 38rem),var(--bg); background-size:28px 28px,28px 28px,auto,auto; }
        body.connect-surface .card, body.connect-surface .card.wide { border-radius:26px; border-width:4px; box-shadow:10px 10px 0 var(--border); }
        body.connect-surface .protocol-shell { border-width:3px; border-radius:999px; box-shadow:5px 5px 0 var(--border); background:#fff; padding:11px 16px; }
        body.connect-surface .protocol-shell .brand { margin:0; font-size:11px; }
        body.connect-surface .protocol-shell .brand[href] { cursor:pointer; text-decoration:none; }
        body.connect-surface .protocol-foot { border:3px solid var(--border); border-radius:999px; box-shadow:5px 5px 0 var(--border); background:#fff; padding:9px 14px; color:var(--text); }
        body.connect-only-app .app { grid-template-rows:1fr; padding:20px; }
        body.connect-only-app main { padding:24px 0; }
        .connect-links { display:flex; flex-wrap:wrap; justify-content:center; gap:8px 14px; margin-top:12px; }
        .connect-actions { margin-top:16px; }
        button.pill.secondary { cursor:pointer; }
        @media (max-width:760px) { body.connect-surface .card, body.connect-surface .card.wide { box-shadow:6px 6px 0 var(--border); } }
    </style>
    ${surface.accent ? `<style>:root{--accent:${htmlEscape(surface.accent)};}</style>` : ''}
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
</head>
<body class="${[surface.mode === 'protocol' ? 'protocol-surface' : '', surface.connectOnly ? 'connect-surface connect-only-app' : ''].filter(Boolean).join(' ')}">
    <div class="app">
        ${topbarMarkup}
        <main id="app-root"></main>
        ${footMarkup}
    </div>
    <script>
        const SL1_SURFACE = ${JSON.stringify(surface)};
        const S = SL1_SURFACE.strings || {};
        const initialRoute = ${JSON.stringify(initialRoute)};
        const root = document.getElementById('app-root');
        const navButtons = Array.from(document.querySelectorAll('[data-nav]'));
        const appState = {
            route: initialRoute,
            wallet: null,
            authorize: null,
            activeIdentityHint: '',
            profile: null,
            status: '',
            authMode: null,
        };
        const escapeHtml = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
        const brandMarkup = () => SL1_SURFACE.homeUrl
            ? '<a class="brand" href="' + escapeHtml(SL1_SURFACE.homeUrl) + '">' + escapeHtml(SL1_SURFACE.brand) + '</a>'
            : '<div class="brand">' + escapeHtml(SL1_SURFACE.brand) + '</div>';
        const shortValue = (value) => { const text = String(value || ''); return text.length <= 22 ? text : text.slice(0, 12) + '...' + text.slice(-7); };
        const setStatus = (message) => { appState.status = message || ''; const node = document.getElementById('spa-status'); if (node) node.textContent = appState.status; };
        const routeQuery = () => new URLSearchParams(appState.route.query || {});
        const rememberIdentity = (identity, payload = {}) => {
            const hint = identity?.entity_l1_address || identity?.entityAddress || identity;
            if (!hint) return;
            appState.activeIdentityHint = String(hint);
            try {
                window.localStorage?.setItem('sl1e.identity_hint', appState.activeIdentityHint);
                if (payload.identity_capsule) window.localStorage?.setItem('sl1e.identity_capsule', JSON.stringify(payload.identity_capsule));
                if (payload.portability_contract) window.localStorage?.setItem('sl1e.portability_contract', JSON.stringify(payload.portability_contract));
            } catch (error) {}
        };
        const rememberedIdentity = () => {
            try { return window.localStorage?.getItem('sl1e.identity_hint') || ''; } catch (error) { return ''; }
        };
        const randomToken = () => {
            if (window.crypto?.randomUUID) return window.crypto.randomUUID();
            const bytes = new Uint8Array(16);
            window.crypto?.getRandomValues(bytes);
            return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        };
        const routeFromLocation = () => ({ path: window.location.pathname, query: Object.fromEntries(new URLSearchParams(window.location.search)) });
        const navigate = (path, query = {}, replace = false) => {
            appState.route = { path, query };
            const qs = new URLSearchParams(query).toString();
            const next = path + (qs ? '?' + qs : '');
            if (replace) window.history.replaceState(appState.route, '', next);
            else window.history.pushState(appState.route, '', next);
            render();
        };
        window.addEventListener('popstate', () => { appState.route = routeFromLocation(); render(); });
        navButtons.forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav, {})));
        const updateNav = () => {
            navButtons.forEach((button) => button.classList.toggle('active', button.dataset.nav === '/wallet'));
        };
        const apiQueryWithBrowserHint = () => {
            const query = routeQuery();
            if (!query.has('identity_hint') && !query.has('login_hint') && !query.has('entity_l1_address')) {
                const remembered = rememberedIdentity();
                if (remembered) query.set('browser_identity_hint', remembered);
            }
            return query;
        };
        const loadWalletState = async () => {
            const query = apiQueryWithBrowserHint();
            const response = await fetch('/api/sl1e/wallet/bootstrap?' + query.toString(), { headers:{ Accept:'application/json' }, cache:'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Could not load wallet.');
            appState.wallet = payload;
            appState.profile = payload.profile || null;
            if (payload.selected_identity?.entity_l1_address) rememberIdentity(payload.selected_identity.entity_l1_address);
        };
        const loadAuthorizeState = async () => {
            const query = apiQueryWithBrowserHint();
            const response = await fetch('/api/sl1e/authorize/bootstrap?' + query.toString(), { headers:{ Accept:'application/json' }, cache:'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Could not load request.');
            appState.authorize = payload;
            if (payload.selected_identity?.entity_l1_address) rememberIdentity(payload.selected_identity.entity_l1_address);
        };
        const renderLoading = () => {
            root.innerHTML = '<section class="card">' + brandMarkup() + '<h1>' + escapeHtml(S.loading || 'Loading') + '</h1><p>' + escapeHtml(S.preparingWallet || 'Preparing your wallet...') + '</p></section>';
        };
        const renderIdentityList = (identities, current) => {
            if (!identities?.length) return '';
            return '<div class="identity-list">' + identities.map((identity) => '<button type="button" data-switch-identity="' + escapeHtml(identity.entity_l1_address) + '">' + (current === identity.entity_l1_address ? (S.useIdentity || 'Use ') : (S.switchToIdentity || 'Switch to ')) + escapeHtml(identity.label || shortValue(identity.entity_l1_address)) + '</button>').join('') + '</div>';
        };
        const setAuthMode = (mode) => { appState.authMode = mode; appState.status = ''; renderAuthorize(); };
        const openAccountSwitcher = () => {
            const query = Object.fromEntries(routeQuery());
            query.sl1e_switch = '1';
            navigate('/authorize', query);
        };
        const renderAuthorize = () => {
            const state = appState.authorize;
            const request = state.request || {};
            const identity = state.selected_identity;
            const identities = state.identities || [];
            const defaultMode = (state.ui?.initial_action === 'register' && !identity) ? 'register' : 'login';
            const mode = appState.authMode || defaultMode;
            const isRegister = mode === 'register';
            const connectOnly = Boolean(SL1_SURFACE.connectOnly);
            const storefront = String(request.client_name || '').trim();
            const showStorefront = storefront && storefront !== 'External app' && !/meanly\\.reference/i.test(String(request.client_id || ''));
            let title;
            let subtitle;
            let primaryLabel;
            if (isRegister) {
                title = S.createAccount || 'Create account';
                subtitle = S.chooseNamePasskey || 'Choose a name and continue with your passkey.';
                primaryLabel = S.createAccount || 'Create account';
            } else if (connectOnly && identity) {
                title = request.intent_title || S.continueWithMeanly || 'Continue with Meanly';
                subtitle = state.ui?.status || S.confirmPasskey || 'Confirm with your passkey.';
                primaryLabel = request.intent_cta || S.continue || 'Continue';
            } else if (identity) {
                title = state.ui?.mode || request.intent_title || (connectOnly ? (S.continueWithMeanly || 'Continue with Meanly') : (S.openMeanlyVault || 'Open Meanly Vault'));
                subtitle = S.usePasskeyContinue || 'Use your passkey to continue.';
                primaryLabel = request.intent_cta || S.continue || 'Continue';
            } else {
                title = S.signIn || 'Sign in';
                subtitle = S.usePasskeyContinue || 'Use your passkey to continue.';
                primaryLabel = S.signIn || 'Sign in';
            }
            const toggleLabel = isRegister
                ? (S.haveAccountSignIn || 'Already have an account? Sign in')
                : (S.newHereCreate || 'New here? Create an account');
            const secondaryLinks = [];
            if (!isRegister && identities.length > 1) {
                secondaryLinks.push('<button id="choose-account" class="link-button" type="button">' + escapeHtml(S.chooseAnotherAccount || 'Choose another account') + '</button>');
            }
            secondaryLinks.push('<button id="toggle-mode" class="link-button" type="button">' + escapeHtml(toggleLabel) + '</button>');
            root.innerHTML = '<section class="card' + (connectOnly ? ' connect-card' : '') + '">' +
                brandMarkup() +
                (showStorefront ? '<div class="muted storefront-tag">' + escapeHtml((S.continueTo || 'Continue to') + ' ' + storefront) + '</div>' : '') +
                '<h1>' + escapeHtml(title) + '</h1>' +
                '<p>' + escapeHtml(subtitle) + '</p>' +
                (!isRegister && identity ? '<button class="pill secondary" type="button" id="identity-pill">' + escapeHtml(identity.label || shortValue(identity.entity_l1_address)) + '</button>' : '') +
                (!isRegister && state.request?.wants_identity_switch ? renderIdentityList(identities, identity?.entity_l1_address) : '') +
                (isRegister ? '<div class="panel"><label for="spa-alias">' + escapeHtml(S.username || 'Username') + '</label><input id="spa-alias" autocomplete="username" maxlength="25" placeholder="' + escapeHtml(S.usernamePlaceholder || '@username') + '"></div>' : '') +
                '<div class="actions' + (connectOnly ? ' connect-actions' : '') + '"><button id="primary-action" type="button">' + escapeHtml(primaryLabel) + '</button>' +
                (!connectOnly && !isRegister && identities.length > 1 ? '<button id="choose-account" class="secondary" type="button">' + escapeHtml(S.chooseAnotherAccount || 'Choose another account') + '</button>' : '') +
                (!connectOnly ? '<button id="toggle-mode" class="link-button" type="button">' + escapeHtml(toggleLabel) + '</button>' : '') +
                '</div>' +
                (connectOnly ? '<div class="connect-links">' + secondaryLinks.join('') + '</div>' : '') +
                '<div id="spa-status" class="status">' + escapeHtml(appState.status || (connectOnly ? '' : (appState.authMode ? '' : (state.ui?.status || '')))) + '</div></section>';
            document.getElementById('primary-action')?.addEventListener('click', () => isRegister ? createAccountFromAuthorize() : approveAuthorize());
            document.getElementById('toggle-mode')?.addEventListener('click', () => setAuthMode(isRegister ? 'login' : 'register'));
            document.getElementById('choose-account')?.addEventListener('click', openAccountSwitcher);
            document.getElementById('identity-pill')?.addEventListener('click', () => {
                if (identities.length > 1) openAccountSwitcher();
            });
            root.querySelectorAll('[data-switch-identity]').forEach((button) => button.addEventListener('click', () => {
                rememberIdentity(button.dataset.switchIdentity);
                const query = Object.fromEntries(routeQuery());
                query.identity_hint = button.dataset.switchIdentity;
                delete query.sl1e_switch;
                navigate('/authorize', query);
            }));
        };
        const renderWallet = () => {
            const wallet = appState.wallet || {};
            const profile = wallet.profile;
            const identities = wallet.identities || [];
            if (!profile) {
                root.innerHTML = '<section class="card">' + brandMarkup() + '<h1>' + escapeHtml(S.createAccount || 'Create account') + '</h1><p>' + escapeHtml(S.chooseNamePasskey || 'Choose a name and continue with your passkey.') + '</p><div class="panel"><label for="wallet-alias">' + escapeHtml(S.username || 'Username') + '</label><input id="wallet-alias" autocomplete="username" maxlength="25" placeholder="' + escapeHtml(S.usernamePlaceholder || '@username') + '"></div><div class="actions"><button id="wallet-create" type="button">' + escapeHtml(S.createAccount || 'Create account') + '</button>' + (identities.length ? '<button id="wallet-existing" class="secondary" type="button">' + escapeHtml(S.signIn || 'Sign in') + '</button>' : '') + '</div><div id="spa-status" class="status">' + escapeHtml(appState.status || '') + '</div></section>';
                document.getElementById('wallet-create')?.addEventListener('click', createAccountForWallet);
                document.getElementById('wallet-existing')?.addEventListener('click', () => navigate('/wallet', { sl1e_switch:'1' }));
                return;
            }
            root.innerHTML = '<section class="card">' + brandMarkup() + '<h1>' + escapeHtml(S.yourVault || 'Your Vault') + '</h1><p>' + escapeHtml(S.vaultReady || 'Saved items and orders are ready here.') + '</p><div class="pill">' + escapeHtml(profile.display_alias || profile.username || shortValue(profile.entity_l1_address)) + '</div><div class="actions"><button id="open-vault" type="button">' + escapeHtml(S.openVault || 'Open Vault') + '</button><button id="switch-wallet" class="secondary" type="button">' + escapeHtml(S.switchAccount || 'Switch account') + '</button><button id="lock-wallet" class="secondary" type="button">' + escapeHtml(S.signOut || 'Sign out') + '</button></div><div id="spa-status" class="status">' + escapeHtml(appState.status || '') + '</div></section>';
            document.getElementById('open-vault')?.addEventListener('click', openVaultAuthorize);
            document.getElementById('switch-wallet')?.addEventListener('click', () => navigate('/wallet', { sl1e_switch:'1' }));
            document.getElementById('lock-wallet')?.addEventListener('click', () => {
                try {
                    window.localStorage?.removeItem('sl1e.identity_hint');
                    window.localStorage?.removeItem('sl1e.identity_capsule');
                    window.localStorage?.removeItem('sl1e.portability_contract');
                } catch (error) {}
                appState.activeIdentityHint = '';
                navigate('/wallet', { sl1e_switch:'1' });
            });
        };
        const renderSwitch = () => {
            const wallet = appState.wallet || {};
            root.innerHTML = '<section class="card">' + brandMarkup() + '<h1>' + escapeHtml(S.signIn || 'Sign in') + '</h1><p>' + escapeHtml(S.chooseAccountHere || 'Choose the account you want to use here.') + '</p>' + renderIdentityList(wallet.identities || [], '') + '<div class="actions"><button id="new-account" class="secondary" type="button">' + escapeHtml(S.createAccount || 'Create account') + '</button></div><div id="spa-status" class="status">' + escapeHtml(appState.status || '') + '</div></section>';
            root.querySelectorAll('[data-switch-identity]').forEach((button) => button.addEventListener('click', () => {
                rememberIdentity(button.dataset.switchIdentity);
                navigate('/wallet', { identity_hint: button.dataset.switchIdentity });
            }));
            document.getElementById('new-account')?.addEventListener('click', () => navigate('/wallet', { mode:'register' }));
        };
        const render = async () => {
            updateNav();
            renderLoading();
            try {
                if (appState.route.path === '/authorize') {
                    await loadAuthorizeState();
                    renderAuthorize();
                    return;
                }
                await loadWalletState();
                if (appState.route.query?.sl1e_switch === '1') renderSwitch();
                else renderWallet();
            } catch (error) {
                root.innerHTML = '<section class="card">' + brandMarkup() + '<h1>' + escapeHtml(S.tryAgain || 'Try again') + '</h1><p>' + escapeHtml(error.message || S.couldNotLoadWallet || 'Could not load wallet.') + '</p><div class="actions"><button type="button" onclick="window.location.reload()">' + escapeHtml(S.reload || 'Reload') + '</button></div></section>';
            }
        };
        const authorizeQueryWithIdentity = () => {
            const query = routeQuery();
            const identityHint = appState.activeIdentityHint || appState.authorize?.selected_identity?.entity_l1_address;
            if (identityHint && !query.has('identity_hint')) query.set('identity_hint', identityHint);
            const capsule = (() => { try { return window.localStorage?.getItem('sl1e.identity_capsule'); } catch (error) { return ''; } })();
            if (capsule && !query.has('identity_capsule')) query.set('identity_capsule', capsule);
            return query;
        };
        const redirectFromPayload = (payload) => {
            if (!payload.redirect_url) throw new Error('Connect response did not include a redirect URL.');
            window.location.href = payload.redirect_url;
        };
        const approveAuthorize = async () => {
            if (!window.PublicKeyCredential || !window.SimpleWebAuthnBrowser) throw new Error('This device cannot use passkeys here.');
            setStatus('Getting your passkey ready...');
            const query = authorizeQueryWithIdentity();
            const optionsResponse = await fetch('/api/sl1e/authentication/options?' + query.toString(), { headers:{ Accept:'application/json' } });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Could not prepare passkey.');
            setStatus('Confirm with Face ID, Touch ID, or your security key...');
            const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: optionsPayload.publicKey });
            setStatus('Confirming...');
            const completeResponse = await fetch('/api/sl1e/authorize/complete', { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify({ authorization_request_id: optionsPayload.authorization_request_id, assertion }) });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok) throw new Error(completePayload.error || 'Could not continue.');
            rememberIdentity(completePayload.identity, completePayload);
            setStatus('Confirmed. Taking you back to Meanly...');
            redirectFromPayload(completePayload);
        };
        const normalizedAlias = (value) => String(value || '').trim().replace(/^@+/, '').toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9\\-]/g, '').slice(0, 24);
        const createAccount = async (query, aliasInputId, shouldRedirect) => {
            const alias = normalizedAlias(document.getElementById(aliasInputId)?.value || '');
            if (!alias || alias.length < 3) { setStatus('Username must be at least 3 characters.'); return; }
            query.delete('identity_hint');
            query.delete('login_hint');
            query.delete('entity_l1_address');
            query.set('alias', alias);
            query.set('display_alias', alias);
            setStatus('Creating your account...');
            const optionsResponse = await fetch('/api/sl1e/registration/options?' + query.toString(), { headers:{ Accept:'application/json' } });
            const optionsPayload = await optionsResponse.json();
            if (!optionsResponse.ok) throw new Error(optionsPayload.message || optionsPayload.error || 'Could not prepare account creation.');
            const attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optionsPayload.publicKey });
            const completeResponse = await fetch('/api/sl1e/registration/complete', { method:'POST', headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify({ registration_request_id: optionsPayload.registration_request_id, attestation }) });
            const completePayload = await completeResponse.json();
            if (!completeResponse.ok) throw new Error(completePayload.detail || completePayload.error || 'Could not create account.');
            rememberIdentity(completePayload.identity, completePayload);
            if (shouldRedirect) {
                redirectFromPayload(completePayload);
                return;
            }
            setStatus('Account created.');
            navigate('/wallet', { identity_hint: completePayload.identity?.entity_l1_address || appState.activeIdentityHint }, true);
        };
        const createAccountFromAuthorize = async () => createAccount(routeQuery(), 'spa-alias', true);
        const createAccountForWallet = async () => {
            const params = new URLSearchParams({
                client_id:'meanly.reference',
                client_name:'Meanly',
                redirect_uri: window.location.origin + '/meanly/identity-proof/callback',
                state: randomToken(),
                nonce: randomToken(),
                mode:'connect',
                flow:'connect',
                intent_type:'meanly.login',
                intent_title: SL1_SURFACE.connectOnly ? 'Continue with Meanly' : 'Open Meanly Vault',
                intent_description:'Create your Meanly account.',
                intent_resource:'meanly.reference',
                intent_cta: SL1_SURFACE.connectOnly ? 'Continue with Meanly' : 'Open Vault',
            });
            await createAccount(params, 'wallet-alias', false);
        };
        const openVaultAuthorize = () => {
            const params = {
                client_id:'meanly.reference',
                client_name:'Meanly',
                redirect_uri: window.location.origin + '/meanly/identity-proof/callback',
                state: randomToken(),
                nonce: randomToken(),
                mode:'connect',
                flow:'connect',
                intent_type:'meanly.login',
                intent_title: SL1_SURFACE.connectOnly ? 'Sign in to Meanly' : 'Open Meanly Vault',
                intent_description: SL1_SURFACE.connectOnly ? 'Confirm your Meanly identity to continue.' : 'Sign in to open purchases, receipts, safe codes, and saved products.',
                intent_resource:'meanly.reference',
                intent_cta: SL1_SURFACE.connectOnly ? 'Continue with Meanly' : 'Open Vault',
            };
            if (appState.activeIdentityHint || appState.profile?.entity_l1_address) params.identity_hint = appState.activeIdentityHint || appState.profile.entity_l1_address;
            navigate('/authorize', params);
        };
        appState.route = window.location.pathname === initialRoute.path
            ? initialRoute
            : (initialRoute.path === '/authorize' ? initialRoute : routeFromLocation());
        render();
    </script>
</body>
</html>`;
};

const renderMeanlyIdentityProofCallbackPage = (issuerHost = 'connect.simplelayer.one') => `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Meanly Identity Result</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <style>
        :root { color-scheme:dark; --bg:#080808; --panel:#101011; --line:#28282b; --text:#f4f4f5; --muted:#8d8d93; --button:#f4f4f5; --good:#b9f6ca; --warn:#ffe0a3; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.08),transparent 26rem),#080808; color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; display:grid; place-items:center; padding:22px; }
        main { width:min(620px,100%); border:1px solid var(--line); border-radius:24px; background:linear-gradient(180deg,#121213,#0c0c0d); box-shadow:0 28px 90px rgba(0,0,0,.55); padding:24px; }
        .brand { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.1em; text-transform:uppercase; }
        h1 { margin:10px 0 8px; font-size:38px; line-height:1; letter-spacing:-.06em; }
        p { margin:0; color:var(--muted); line-height:1.55; font-weight:650; }
        .result { margin-top:18px; padding:16px; border:1px solid var(--line); border-radius:16px; background:#141416; }
        .badge { display:inline-flex; margin-bottom:10px; padding:5px 9px; border-radius:999px; border:1px solid rgba(185,246,202,.28); background:rgba(185,246,202,.08); color:var(--good); font-size:12px; font-weight:820; }
        .badge.warn { border-color:rgba(255,224,163,.28); background:rgba(255,224,163,.08); color:var(--warn); }
        .row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
        .row:last-child { border-bottom:0; }
        code,pre { color:#dcdce0; word-break:break-all; white-space:pre-wrap; }
        pre { max-height:260px; overflow:auto; padding:12px; border:1px solid var(--line); border-radius:12px; background:#0b0b0c; font-size:11px; }
        details { margin-top:12px; color:var(--muted); }
        summary { cursor:pointer; font-size:12px; font-weight:820; }
        .button { display:inline-flex; justify-content:center; align-items:center; width:100%; min-height:42px; margin-top:14px; padding:11px 14px; border:1px solid var(--button); border-radius:12px; background:var(--button); color:#09090a; font-weight:820; text-decoration:none; }
    </style>
</head>
<body>
    <main>
        <div class="brand">Meanly reference</div>
        <h1>Finishing identity check</h1>
        <p>This screen receives the local result from Meanly One reference runtime. It does not create a Marketplace session yet.</p>
        <section class="result" id="result">
            <span class="badge warn">Checking</span>
            <p>Exchanging the one-time code for a verified identity result...</p>
        </section>
        <a class="button" href="/identity">Back to My Identity</a>
    </main>
    <script>
        const resultNode = document.getElementById('result');
        const escapeHtml = (value) => String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
        const shortValue = (value) => {
            const text = String(value || '');
            return text.length <= 26 ? text : text.slice(0, 14) + '...' + text.slice(-8);
        };
        const renderError = (message) => {
            resultNode.innerHTML = '<span class="badge warn">Needs attention</span><p>' + escapeHtml(message) + '</p>';
        };
        const renderSuccess = (payload) => {
            const envelope = payload.identity_proof_envelope || {};
            const subject = envelope.subject || {};
            resultNode.innerHTML = [
                '<span class="badge">Identity proof received</span>',
                '<p>Meanly can now exchange this verified identity result for its own app session when the Marketplace callback exists.</p>',
                '<div class="row"><span>Identity</span><code>' + escapeHtml(shortValue(subject.entity_l1_address)) + '</code></div>',
                '<div class="row"><span>Client</span><strong>' + escapeHtml(envelope.client_id || 'Meanly') + '</strong></div>',
                '<div class="row"><span>Intent</span><strong>' + escapeHtml(envelope.intent?.type || 'meanly.login') + '</strong></div>',
                '<details><summary>Proof details</summary><pre>' + escapeHtml(JSON.stringify(envelope, null, 2)) + '</pre></details>',
            ].join('');
        };
        const finish = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            if (!code) {
                renderError('No identity result was returned. Start again from My Identity.');
                return;
            }
            try {
                const expectedState = window.sessionStorage?.getItem('meanly.reference.state');
                if (expectedState && state !== expectedState) {
                    renderError('The returned request did not match this browser session. Start again from My Identity.');
                    return;
                }
            } catch (error) {}
            try {
                const response = await fetch('/api/sl1e/authorization-code/exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        code,
                        client_id: 'meanly.reference',
                        redirect_uri: window.location.origin + window.location.pathname,
                        intent_type: 'meanly.login',
                    }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'Could not receive identity proof.');
                try { window.sessionStorage?.removeItem('meanly.reference.state'); } catch (error) {}
                renderSuccess(payload);
            } catch (error) {
                renderError(error.message || 'Could not receive identity proof.');
            }
        };
        finish();
    </script>
</body>
</html>`;

const renderMarketplaceSellerLaunchPage = () => `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Marketplace Sellers</title>
    <style>
        :root { color-scheme:light; --bg:#f6f4ee; --panel:#fff; --ink:#090909; --muted:#5f5b55; --line:#111; --accent:#8b3dff; --ok:#168039; --warn:#b56b00; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; background:linear-gradient(180deg,#faf8f1,#eee9dd); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,sans-serif; padding:24px; }
        main { width:min(1080px,100%); margin:0 auto; }
        .hero,.panel { background:var(--panel); border:3px solid var(--line); box-shadow:8px 8px 0 var(--line); border-radius:18px; padding:22px; }
        .hero { display:flex; justify-content:space-between; gap:20px; align-items:flex-end; margin-bottom:18px; }
        .brand { font-size:12px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
        h1 { margin:8px 0 0; font-size:46px; line-height:.95; letter-spacing:-.07em; }
        h2 { margin:0 0 12px; font-size:21px; letter-spacing:-.04em; }
        p { margin:0; color:var(--muted); font-weight:720; line-height:1.45; }
        .grid { display:grid; grid-template-columns:360px minmax(0,1fr); gap:18px; }
        form { display:grid; gap:10px; }
        label { display:grid; gap:5px; font-size:11px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
        input { width:100%; min-height:42px; padding:10px 12px; border:2px solid var(--line); border-radius:10px; background:#fff; color:var(--ink); font:inherit; font-weight:760; }
        button,.button { display:inline-flex; justify-content:center; align-items:center; min-height:42px; padding:11px 14px; border:2px solid var(--line); border-radius:10px; background:var(--ink); color:#fff; font-weight:900; cursor:pointer; text-decoration:none; }
        button.secondary { background:#fff; color:var(--ink); }
        .list { display:grid; gap:12px; }
        .seller { border:2px solid var(--line); border-radius:14px; padding:14px; background:#fffdf7; }
        .seller-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
        .badge { padding:5px 8px; border:2px solid var(--line); border-radius:999px; font-size:11px; font-weight:950; text-transform:uppercase; }
        .badge.active,.badge.ready { color:var(--ok); }
        .badge.draft,.badge.needs_setup { color:var(--warn); }
        .meta { margin-top:9px; display:grid; gap:6px; color:var(--muted); font-size:13px; font-weight:720; }
        .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
        .status { min-height:20px; margin-top:12px; color:var(--muted); font-size:13px; font-weight:800; }
        @media (max-width:820px) { .hero,.grid { grid-template-columns:1fr; display:grid; } h1 { font-size:36px; } }
    </style>
</head>
<body>
    <main>
        <section class="hero">
            <div>
                <div class="brand">Meanly Marketplace</div>
                <h1>Seller Launch</h1>
                <p>Fast seller activation for the marketplace. App-layer launch records only; protocol semantics stay frozen.</p>
            </div>
            <a class="button" href="/identity">Meanly One</a>
        </section>
        <div class="grid">
            <section class="panel">
                <h2>Add seller</h2>
                <form id="seller-form">
                    <label>Store name<input name="display_name" placeholder="Seller store" required></label>
                    <label>SL1 identity<input name="entity_l1_address" placeholder="sl1e_..."></label>
                    <label>Contact<input name="contact" placeholder="seller@example.com"></label>
                    <label>Payout hint<input name="payout_hint" placeholder="Stripe / bank / manual"></label>
                    <button type="submit">Create Seller</button>
                </form>
                <div class="status" id="status"></div>
            </section>
            <section class="panel">
                <h2>Launch queue</h2>
                <div id="seller-list" class="list"></div>
            </section>
        </div>
    </main>
    <script>
        const statusNode = document.getElementById('status');
        const listNode = document.getElementById('seller-list');
        const sellerForm = document.getElementById('seller-form');
        const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
        const setStatus = (message) => { statusNode.textContent = message; };
        const api = async (url, options = {}) => {
            const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', 'Accept':'application/json', ...(options.headers || {}) } });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || 'Request failed');
            return payload;
        };
        const refresh = async () => {
            const payload = await api('/api/marketplace/sellers');
            const sellers = payload.sellers || [];
            listNode.innerHTML = sellers.length ? sellers.map((seller) => {
                const checklist = seller.activation?.checklist || {};
                return '<div class="seller"><div class="seller-head"><div><strong>' + escapeHtml(seller.display_name) + '</strong><p>@' + escapeHtml(seller.slug) + '</p></div><span class="badge ' + escapeHtml(seller.status) + '">' + escapeHtml(seller.status) + '</span></div><div class="meta"><span>Identity: ' + escapeHtml(seller.entity_l1_address || 'not linked') + '</span><span>Listings: ' + escapeHtml(seller.listing_count || 0) + '</span><span>Ready: identity ' + (checklist.identity_ready ? 'yes' : 'no') + ', listing ' + (checklist.listing_ready ? 'yes' : 'no') + ', payout ' + (checklist.payout_ready ? 'yes' : 'no') + '</span></div><div class="actions"><button class="secondary" type="button" data-add-listing="' + escapeHtml(seller.seller_id) + '">Add sample listing</button><button type="button" data-activate="' + escapeHtml(seller.seller_id) + '">Activate</button></div></div>';
            }).join('') : '<p>No sellers yet. Add the first one to start launch.</p>';
            listNode.querySelectorAll('[data-add-listing]').forEach((button) => {
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try {
                        await api('/api/marketplace/sellers/' + encodeURIComponent(button.dataset.addListing) + '/listings', { method:'POST', body:JSON.stringify({ title:'Digital product launch item', description:'First seller listing for marketplace launch.', category:'digital', price:'25.00', currency:'USD', delivery_mode:'manual' }) });
                        setStatus('Listing added.');
                        await refresh();
                    } catch (error) {
                        setStatus(error.message || 'Could not add listing.');
                    } finally {
                        button.disabled = false;
                    }
                });
            });
            listNode.querySelectorAll('[data-activate]').forEach((button) => {
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try {
                        await api('/api/marketplace/sellers/' + encodeURIComponent(button.dataset.activate) + '/activate', { method:'POST', body:'{}' });
                        setStatus('Seller activated.');
                        await refresh();
                    } catch (error) {
                        setStatus(error.message || 'Seller is not ready yet.');
                    } finally {
                        button.disabled = false;
                    }
                });
            });
        };
        sellerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                await api('/api/marketplace/sellers', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(sellerForm).entries())) });
                sellerForm.reset();
                setStatus('Seller created.');
                await refresh();
            } catch (error) {
                setStatus(error.message || 'Could not create seller.');
            }
        });
        refresh().catch((error) => setStatus(error.message || 'Could not load sellers.'));
    </script>
</body>
</html>`;

const renderSl1eDevicePairingPage = (pairingId, token, pairing, issuerHost = 'connect.simplelayer.one') => {
    const identityLabel = pairing.identity_label || shortAddress(pairing.entityAddress);
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Add Device</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/identity-icon.svg" type="image/svg+xml">
    <style>
        :root { color-scheme:dark; --bg:#080808; --panel:#101011; --line:#28282b; --text:#f4f4f5; --muted:#8d8d93; --button:#f4f4f5; --good:#b9f6ca; --warn:#ffe0a3; }
        * { box-sizing:border-box; }
        body { margin:0; min-height:100vh; background:radial-gradient(circle at 50% -10%,rgba(255,255,255,.08),transparent 26rem),#080808; color:var(--text); font-family:Inter,ui-sans-serif,system-ui,sans-serif; display:grid; place-items:center; padding:22px; }
        main { width:min(520px,100%); border:1px solid var(--line); border-radius:24px; background:linear-gradient(180deg,#121213,#0c0c0d); box-shadow:0 28px 90px rgba(0,0,0,.55); padding:24px; }
        .brand { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.1em; text-transform:uppercase; }
        h1 { margin:10px 0 8px; font-size:38px; line-height:1; letter-spacing:-.06em; }
        p { margin:0; color:var(--muted); line-height:1.55; font-weight:650; }
        label { display:block; margin:18px 0 7px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
        input { width:100%; min-height:44px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:#111113; color:var(--text); font:inherit; font-weight:720; }
        button { display:inline-flex; justify-content:center; align-items:center; width:100%; min-height:44px; margin-top:14px; padding:11px 14px; border:1px solid var(--button); border-radius:12px; background:var(--button); color:#09090a; font-weight:820; cursor:pointer; }
        button:disabled { opacity:.55; cursor:wait; }
        .card { margin-top:18px; padding:14px; border:1px solid var(--line); border-radius:16px; background:#141416; }
        .status { min-height:18px; margin-top:12px; color:var(--muted); font-size:13px; font-weight:720; }
        .badge { display:inline-flex; margin-bottom:10px; padding:5px 9px; border-radius:999px; border:1px solid rgba(255,224,163,.28); background:rgba(255,224,163,.08); color:var(--warn); font-size:12px; font-weight:820; }
        .badge.ready { border-color:rgba(185,246,202,.28); background:rgba(185,246,202,.08); color:var(--good); }
    </style>
    <script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>
</head>
<body>
    <main>
        <div class="brand">Meanly One pairing</div>
        <h1>Add this device</h1>
        <p>This phone will request access to <strong>${htmlEscape(identityLabel)}</strong>. It becomes trusted only after you approve it on your existing device.</p>
        <div class="card">
            <span class="badge">Waiting for approval after setup</span>
            <p>Create a passkey on this device. Your existing trusted device will see a new device request.</p>
            <label for="device-label">Device name</label>
            <input id="device-label" autocomplete="off" value="Google phone">
            <button id="pair-button" type="button">Create device request</button>
            <div id="status" class="status">Issued by ${htmlEscape(issuerHost)}.</div>
        </div>
    </main>
    <script>
        const pairingId = ${JSON.stringify(String(pairingId))};
        const token = ${JSON.stringify(String(token))};
        const button = document.getElementById('pair-button');
        const statusNode = document.getElementById('status');
        const labelInput = document.getElementById('device-label');
        const setStatus = (message) => { statusNode.textContent = message; };
        const pair = async () => {
            button.disabled = true;
            setStatus('Preparing this device...');
            try {
                const optionsResponse = await fetch('/api/sl1e/device-pairings/' + encodeURIComponent(pairingId) + '/registration/options?token=' + encodeURIComponent(token), {
                    headers: { 'Accept': 'application/json' },
                });
                const optionsPayload = await optionsResponse.json();
                if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Could not prepare this device.');
                const attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: optionsPayload.publicKey });
                setStatus('Sending device request...');
                const completeResponse = await fetch('/api/sl1e/device-pairings/' + encodeURIComponent(pairingId) + '/registration/complete?token=' + encodeURIComponent(token), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        registration_request_id: optionsPayload.registration_request_id,
                        attestation,
                        device_label: labelInput.value || 'Google phone',
                    }),
                });
                const completePayload = await completeResponse.json();
                if (!completeResponse.ok) throw new Error(completePayload.error || 'Could not create device request.');
                document.querySelector('.badge').classList.add('ready');
                document.querySelector('.badge').textContent = 'Request sent';
                button.textContent = 'Request sent';
                setStatus('Now approve this device on your existing trusted device.');
            } catch (error) {
                setStatus(error.message || 'Could not add this device.');
                button.disabled = false;
            }
        };
        button.addEventListener('click', pair);
    </script>
</body>
</html>`;
};

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

fastify.addHook('onRequest', async (request, reply) => {
    const hostname = String(request.hostname || '').split(':')[0].toLowerCase();
    if (request.method !== 'GET' || (hostname !== '127.0.0.1' && hostname !== '::1')) return;
    const hostHeader = String(request.headers.host || 'localhost:3000');
    const port = hostHeader.includes(':') ? hostHeader.split(':').pop() : String(RUNTIME_PORT || 3000);
    return reply.redirect(`http://localhost:${port}${request.url}`, 302);
});

fastify.get('/healthcheck', async () => {
    return { status: 'ok', service: 'simple-layer-one', node_id: NODE_ID };
});

fastify.get('/api/sl1e/runtime/status', async () => {
    const address = fastify.server.address();
    const boundPort = typeof address === 'object' && address ? address.port : RUNTIME_PORT;
    const host = RUNTIME_HOST === '0.0.0.0' ? '127.0.0.1' : RUNTIME_HOST;
    return {
        status: 'ready',
        service: 'simple-layer-one',
        embedded: EMBEDDED_RUNTIME,
        node_id: NODE_ID,
        host,
        port: boundPort,
        base_url: `http://${host}:${boundPort}`,
        data_dir: DATA_DIR,
        runtime_version: NODE_VERSION,
        protocol_version: IDENTITY_PROTOCOL_VERSION,
    };
});

fastify.post('/api/sl1e/native/bootstrap', async (request, reply) => {
    cleanupSl1eArtifacts();
    const body = request.body || {};
    const entityAddress = identityKernel.normalizeEntityAddress(body.entity_l1_address || body.entityAddress);
    const keyAddress = identityKernel.normalizeKeyAddress(body.key_l1_address || body.keyAddress);
    const publicKey = String(body.public_key || body.publicKey || '');
    if (!entityAddress || !keyAddress || !publicKey) {
        return reply.code(422).send({ error: 'native_identity_bootstrap_incomplete' });
    }

    const account = accountByEntityAddress(entityAddress);
    const allowRootBootstrap = truthyEnv(process.env.SL1_ALLOW_NATIVE_ROOT_BOOTSTRAP)
        || body.allow_native_root_bootstrap === true
        || body.allowNativeRootBootstrap === true;
    if (!account && !allowRootBootstrap) {
        return reply.code(409).send({
            error: 'native_root_identity_bootstrap_disabled',
            invariant: 'identity_address_must_never_change',
            required_flow: 'link_native_controller_to_existing_identity',
            message: 'Native app must link a controller to an existing web-created sl1e identity instead of creating a second root identity.',
        });
    }
    const alreadyBound = (ledger.controller_bindings || []).some((binding) =>
        String(binding.entity_l1_address || '') === entityAddress
        && String(binding.key_l1_address || binding.controller_l1_address || '') === keyAddress
        && String(binding.status || 'active') === 'active'
    );
    if (!account || !alreadyBound) {
        applyEvent({
            id: `native_bootstrap_${crypto.randomBytes(8).toString('hex')}`,
            type: 'NATIVE_CONTROLLER_BOOTSTRAPPED',
            payload: {
                entity_l1_address: entityAddress,
                key_l1_address: keyAddress,
                publicKey,
                label: body.label || body.device_name || 'Meanly One',
            },
            timestamp: new Date().toISOString(),
        });
    }

    const updated = accountByEntityAddress(entityAddress);
    return {
        success: true,
        identity: identityProfile(updated),
        identity_session_token: identitySessionToken(entityAddress),
        state_proof: currentIdentityStateProof('native-wallet-bootstrap'),
    };
});

fastify.post('/api/sl1e/identity/:entityAddress/native-session', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    const keyAddress = String(request.body?.key_l1_address || request.body?.keyAddress || '');
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const binding = (ledger.controller_bindings || []).find((candidate) =>
        String(candidate.entity_l1_address || '') === entityAddress
        && String(candidate.key_l1_address || candidate.controller_l1_address || '') === keyAddress
        && String(candidate.controller_type || '') === 'native_macos_p256'
        && String(candidate.status || 'active') === 'active'
    );
    if (!binding) return reply.code(403).send({ error: 'native_controller_not_bound' });

    return {
        success: true,
        identity_session_token: identitySessionToken(entityAddress),
        expires_in: 600,
        identity: identityProfile(account),
    };
});

fastify.get('/api/sl1e/identity/:entityAddress/mesh/state', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });
    const deviceKeyAddress = String(request.query.device_key_l1_address || account.key_l1_address || '');
    if (!identityKernel.normalizeKeyAddress(deviceKeyAddress)) {
        return reply.code(422).send({ error: 'device_key_l1_address_required' });
    }

    return {
        success: true,
        envelope: createIdentityStateEnvelope({
            ledger,
            entityAddress,
            deviceKeyAddress,
            sequence: Number(request.query.sequence || Date.now()),
            previousStateHash: request.query.previous_state_hash || null,
            observedEpoch: Number(ledger.governance?.current_epoch || 0),
            providerStateProof: currentIdentityStateProof('local-ledger'),
        }),
    };
});

fastify.post('/api/sl1e/identity/:entityAddress/controller-bindings/proposals', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const proposedKeyAddress = identityKernel.normalizeKeyAddress(request.body?.proposed_controller_key_l1_address || request.body?.key_l1_address);
    if (!proposedKeyAddress) return reply.code(422).send({ error: 'proposed_controller_key_l1_address_required' });
    const proposalId = `cbp_${crypto.randomBytes(16).toString('hex')}`;
    const proposalHash = `sha256:${crypto.createHash('sha256').update(stableStringify({
        entity_l1_address: entityAddress,
        proposed_controller_key_l1_address: proposedKeyAddress,
        controller_type: request.body?.controller_type || 'unknown',
    })).digest('hex')}`;
    applyEvent({
        id: `proposal_${crypto.randomBytes(8).toString('hex')}`,
        type: 'CONTROLLER_BINDING_PROPOSED',
        payload: {
            proposal_id: proposalId,
            entity_l1_address: entityAddress,
            proposed_controller_key_l1_address: proposedKeyAddress,
            controller_type: request.body?.controller_type || 'unknown',
            proposal_hash: proposalHash,
        },
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        proposal: (ledger.controller_binding_proposals || []).find((proposal) => proposal.proposal_id === proposalId),
    };
});

fastify.post('/api/sl1e/identity/:entityAddress/controller-bindings/proposals/:proposalId/approve', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;
    const proposal = (ledger.controller_binding_proposals || []).find((candidate) =>
        candidate.proposal_id === String(request.params.proposalId || '')
        && candidate.entity_l1_address === entityAddress
    );
    if (!proposal) return reply.code(404).send({ error: 'controller_binding_proposal_not_found' });

    applyEvent({
        id: `proposal_approval_${crypto.randomBytes(8).toString('hex')}`,
        type: 'CONTROLLER_BINDING_APPROVED',
        payload: {
            proposal_id: proposal.proposal_id,
            approved_by_key_l1_address: request.body?.approved_by_key_l1_address || accountByEntityAddress(entityAddress)?.key_l1_address,
            approval_hash: `sha256:${crypto.createHash('sha256').update(stableStringify(proposal)).digest('hex')}`,
        },
        timestamp: new Date().toISOString(),
    });

    return {
        success: true,
        proposal: (ledger.controller_binding_proposals || []).find((candidate) => candidate.proposal_id === proposal.proposal_id),
    };
});

fastify.post('/api/sl1e/mesh/mailbox/:entityAddress', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    if (!identityKernel.normalizeEntityAddress(entityAddress)) return reply.code(422).send({ error: 'invalid_entity_l1_address' });
    const payload = request.body || {};
    try {
        assertRelayPayloadIsObservationOnly(payload);
        if (payload.envelope) {
            const verification = verifyIdentityStateEnvelope(payload.envelope, { requireTrustedSignature: false, now: new Date() });
            const boundary = assertNoIdentityMeshAuthorityLeak(verification);
            if (boundary.reason_codes.length > 0) return reply.code(422).send({ error: 'relay_payload_authority_leak', reason_codes: boundary.reason_codes });
        }
    } catch (error) {
        return reply.code(error.statusCode || 422).send({ error: error.message, marker: error.marker || null });
    }

    const store = loadMeshMailboxStore();
    const message = {
        message_id: `meshmsg_${crypto.randomBytes(12).toString('hex')}`,
        entity_l1_address: entityAddress,
        payload,
        received_at: new Date().toISOString(),
    };
    store.messages[entityAddress] = [...(store.messages[entityAddress] || []), message].slice(-100);
    saveMeshMailboxStore(store);
    return { success: true, message_id: message.message_id };
});

fastify.get('/api/sl1e/mesh/mailbox/:entityAddress', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    if (!identityKernel.normalizeEntityAddress(entityAddress)) return reply.code(422).send({ error: 'invalid_entity_l1_address' });
    const store = loadMeshMailboxStore();
    return {
        success: true,
        messages: store.messages[entityAddress] || [],
    };
});

fastify.post('/api/sl1e/identity/:entityAddress/device-pairings', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-pairing:create', 20, 60 * 1000)) return reply;

    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const pairingId = crypto.randomBytes(12).toString('base64url');
    const desktopToken = crypto.randomBytes(18).toString('base64url');
    const mobileToken = crypto.randomBytes(18).toString('base64url');
    const origin = originForHost(request.hostname);
    const mobileUrl = `${origin}/device-pairing/${encodeURIComponent(pairingId)}?token=${encodeURIComponent(mobileToken)}`;
    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    const identityLabel = accountDisplayName(account) || accountVisibleAlias(account) || shortAddress(entityAddress);

    sl1eRuntimeStore.set('devicePairings', pairingId, {
        entityAddress,
        identity_label: identityLabel,
        desktopToken,
        mobileToken,
        mobileUrl,
        status: 'pending',
        proposalId: null,
        proposedKeyAddress: null,
        expiresAtMs,
        createdAt: new Date().toISOString(),
    });

    return {
        pairing_id: pairingId,
        expires_at: new Date(expiresAtMs).toISOString(),
        mobile_url: mobileUrl,
        qr_svg_url: `/api/sl1e/identity/${encodeURIComponent(entityAddress)}/device-pairings/${encodeURIComponent(pairingId)}/qr.svg?token=${encodeURIComponent(desktopToken)}`,
        poll_url: `/api/sl1e/identity/${encodeURIComponent(entityAddress)}/device-pairings/${encodeURIComponent(pairingId)}/status?token=${encodeURIComponent(desktopToken)}`,
    };
});

fastify.get('/api/sl1e/identity/:entityAddress/device-pairings/:pairingId/qr.svg', async (request, reply) => {
    cleanupSl1eArtifacts();

    const entityAddress = String(request.params.entityAddress || '');
    const pairing = sl1eRuntimeStore.get('devicePairings', String(request.params.pairingId || ''));
    if (!pairing || pairing.entityAddress !== entityAddress || pairing.desktopToken !== String(request.query.token || '')) {
        return reply.code(404).type('image/svg+xml').send('');
    }

    const svg = await QRCode.toString(pairing.mobileUrl, {
        type: 'svg',
        margin: 1,
        width: 260,
        color: { dark: '#090a0f', light: '#ffffff' },
    });

    return reply
        .header('Cache-Control', 'no-store')
        .type('image/svg+xml')
        .send(svg);
});

fastify.get('/api/sl1e/identity/:entityAddress/device-pairings/:pairingId/status', async (request, reply) => {
    cleanupSl1eArtifacts();

    const entityAddress = String(request.params.entityAddress || '');
    const pairing = sl1eRuntimeStore.get('devicePairings', String(request.params.pairingId || ''));
    if (!pairing || pairing.entityAddress !== entityAddress || pairing.desktopToken !== String(request.query.token || '')) {
        return reply.code(404).send({ error: 'device_pairing_not_found' });
    }

    const proposal = pairing.proposalId
        ? (ledger.controller_binding_proposals || []).find((candidate) => candidate.proposal_id === pairing.proposalId)
        : null;
    const status = proposal?.status || pairing.status || 'pending';
    return {
        success: true,
        status,
        proposal: proposal || null,
        identity: identityProfile(accountByEntityAddress(entityAddress)),
    };
});

fastify.get('/device-pairing/:pairingId', async (request, reply) => {
    cleanupSl1eArtifacts();

    const pairingId = String(request.params.pairingId || '');
    const token = String(request.query.token || '');
    const pairing = sl1eRuntimeStore.get('devicePairings', pairingId);
    if (!pairing || pairing.mobileToken !== token) {
        return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Expired pairing</title><p>This device pairing expired or was not found.</p>');
    }

    return reply
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(renderSl1eDevicePairingPage(pairingId, token, pairing, request.hostname));
});

fastify.get('/api/sl1e/device-pairings/:pairingId/registration/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-pairing:registration-options', 20, 60 * 1000)) return reply;

    const pairing = sl1eRuntimeStore.get('devicePairings', String(request.params.pairingId || ''));
    if (!pairing || pairing.mobileToken !== String(request.query.token || '')) {
        return reply.code(404).send({ error: 'device_pairing_not_found' });
    }
    const account = accountByEntityAddress(pairing.entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const registrationRequestId = `sl1pair_${crypto.randomBytes(18).toString('hex')}`;
    const rpId = rpIdForHost(request.hostname);
    const activeCredentials = accountCredentials(account);
    const userLabel = passkeyAccountLabel({
        alias: account.alias,
        displayAlias: account.display_alias || account.displayAlias,
        handle: account.handle,
        fallback: pairing.entityAddress,
    });
    const publicKey = await generateRegistrationOptions({
        rpName: 'Meanly One',
        rpID: rpId,
        userID: crypto.randomBytes(16),
        userName: userLabel,
        userDisplayName: userLabel,
        timeout: 60000,
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
        excludeCredentials: activeCredentials.map((credential) => ({
            id: String(credential.credentialId || credential.credential_id),
            type: 'public-key',
            transports: credential.transports || ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
        })),
        supportedAlgorithmIDs: [-7, -257],
    });
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    sl1eRuntimeStore.set('registrationChallenges', registrationRequestId, {
        purpose: 'device_pairing',
        challenge: publicKey.challenge,
        pairingId: String(request.params.pairingId || ''),
        rpId,
        origin: originForHost(request.hostname),
        entityAddress: pairing.entityAddress,
        userHandle: account.alias || account.handle || pairing.entityAddress,
        expiresAtMs,
    });

    return {
        registration_request_id: registrationRequestId,
        expires_at: new Date(expiresAtMs).toISOString(),
        publicKey,
    };
});

fastify.post('/api/sl1e/device-pairings/:pairingId/registration/complete', async (request, reply) => {
    cleanupSl1eArtifacts();

    const pairingId = String(request.params.pairingId || '');
    const pairing = sl1eRuntimeStore.get('devicePairings', pairingId);
    if (!pairing || pairing.mobileToken !== String(request.query.token || '')) {
        return reply.code(404).send({ error: 'device_pairing_not_found' });
    }
    const account = accountByEntityAddress(pairing.entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const registrationRequestId = String(request.body?.registration_request_id || '');
    const challengeRecord = sl1eRuntimeStore.get('registrationChallenges', registrationRequestId);
    if (!challengeRecord || challengeRecord.purpose !== 'device_pairing' || challengeRecord.pairingId !== pairingId || challengeRecord.entityAddress !== pairing.entityAddress) {
        return reply.code(404).send({ error: 'registration_challenge_not_found' });
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: request.body?.attestation,
            expectedChallenge: challengeRecord.challenge,
            expectedOrigin: challengeRecord.origin,
            expectedRPID: challengeRecord.rpId,
            requireUserVerification: false,
        });
        if (!verification.verified) return reply.code(403).send({ error: 'device_registration_failed' });

        const registrationInfo = verification.registrationInfo || {};
        const credential = registrationInfo.credential || {};
        const credentialId = base64UrlFromUnknown(
            credential.id || registrationInfo.credentialID || request.body?.attestation?.id || request.body?.attestation?.rawId
        );
        const credentialPublicKey = base64UrlFromUnknown(credential.publicKey || registrationInfo.credentialPublicKey);
        const counter = Number(credential.counter ?? registrationInfo.counter ?? 0);
        const transports = request.body?.attestation?.response?.transports || credential.transports || ['internal', 'hybrid'];
        if (!credentialId || !credentialPublicKey) return reply.code(422).send({ error: 'registration_missing_credential_material' });
        if (findCredentialOwner(credentialId)) return reply.code(409).send({ error: 'device_already_registered' });

        const keyAddress = identityKernel.keyAddressFromPublicKey(credentialPublicKey);
        const deviceLabel = String(request.body?.device_label || '').trim().slice(0, 80) || 'Google phone';
        const proposalId = `cbp_${crypto.randomBytes(16).toString('hex')}`;
        const proposalHash = `sha256:${crypto.createHash('sha256').update(stableStringify({
            entity_l1_address: pairing.entityAddress,
            proposed_controller_key_l1_address: keyAddress,
            controller_type: 'webauthn_passkey',
            credential_id: credentialId,
        })).digest('hex')}`;
        applyEvent({
            id: `proposal_${crypto.randomBytes(8).toString('hex')}`,
            type: 'CONTROLLER_BINDING_PROPOSED',
            payload: {
                proposal_id: proposalId,
                entity_l1_address: pairing.entityAddress,
                proposed_controller_key_l1_address: keyAddress,
                controller_type: 'webauthn_passkey',
                proposal_hash: proposalHash,
                credential_id: credentialId,
                credential_public_key: credentialPublicKey,
                credentialPublicKey,
                counter,
                transports,
                rp_id: challengeRecord.rpId,
                label: deviceLabel,
                pairing_id: pairingId,
            },
            timestamp: new Date().toISOString(),
        });
        broadcast('/api/network/broadcast', { type: 'EVENT', data: ledger.event_log[ledger.event_log.length - 1] });
        sl1eRuntimeStore.delete('registrationChallenges', registrationRequestId);
        pairing.status = 'proposal_submitted';
        pairing.proposalId = proposalId;
        pairing.proposedKeyAddress = keyAddress;
        pairing.deviceLabel = deviceLabel;

        return {
            success: true,
            status: 'waiting_for_approval',
            proposal: (ledger.controller_binding_proposals || []).find((proposal) => proposal.proposal_id === proposalId),
        };
    } catch (error) {
        sl1eRuntimeStore.delete('registrationChallenges', registrationRequestId);
        return reply.code(403).send({ error: 'device_registration_failed', detail: error.message });
    }
});

fastify.get('/connect', async (request, reply) => {
    if (!isConnectCeremonyHost(request.hostname)) {
        return reply.type('text/html; charset=utf-8').send(renderSl1ConnectHome(request.hostname));
    }

    const requestRef = request.query?.request_ref || connectRequestCookieValue(request);
    if (!requestRef) {
        return reply
            .type('text/html; charset=utf-8')
            .send(renderConnectCeremonyLanding(request.hostname, request.query?.ui_locale || request.query?.alias_locale));
    }

    const prepared = authorizeQueryFromRequest(request, { requestRef });
    if (!prepared.ok) {
        const statusCode = prepared.error === 'authorization_request_not_found' ? 404 : 422;
        return reply.code(statusCode).send({
            error: prepared.error || 'invalid_authorization_request',
        });
    }

    return reply
        .type('text/html; charset=utf-8')
        .send(renderAuthorizePageForHost(prepared.query, request.hostname));
});

fastify.get('/identity', async (request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderMeanlyWalletSpaPage({ ...request.query, __spa_path: '/identity' }, request.hostname));
});

fastify.get('/wallet', async (request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderMeanlyWalletSpaPage({ ...request.query, __spa_path: '/wallet' }, request.hostname));
});

fastify.get('/meanly/identity-proof/callback', async (request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderMeanlyIdentityProofCallbackPage(request.hostname));
});

fastify.get('/marketplace/sellers', async (request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderMarketplaceSellerLaunchPage());
});

fastify.get('/authorize', async (request, reply) => {
    if (redirectAuthorizeToPassHost(request, reply)) {
        return;
    }
    if (redirectIssuerToCeremonyHost(request, reply)) {
        return;
    }

    const prepared = authorizeQueryFromRequest(request);
    if (!prepared.ok) {
        return sendAuthorizeValidationError(reply, prepared);
    }

    return reply
        .type('text/html; charset=utf-8')
        .send(renderAuthorizePageForHost(prepared.query, request.hostname));
});

fastify.get('/authorize/:clientId', async (request, reply) => {
    if (redirectAuthorizeToPassHost(request, reply)) {
        return;
    }
    if (redirectIssuerToCeremonyHost(request, reply)) {
        return;
    }

    const prepared = authorizeQueryFromRequest(request, {
        clientIdFromPath: request.params.clientId,
    });
    if (!prepared.ok) {
        return sendAuthorizeValidationError(reply, prepared);
    }

    return reply
        .type('text/html; charset=utf-8')
        .send(renderAuthorizePageForHost(prepared.query, request.hostname));
});

fastify.get('/r/:requestRef', async (request, reply) => {
    if (redirectAuthorizeToPassHost(request, reply)) {
        return;
    }
    if (redirectIssuerToCeremonyHost(request, reply)) {
        return;
    }

    const prepared = authorizeQueryFromRequest(request, {
        requestRef: request.params.requestRef,
    });
    if (!prepared.ok) {
        const statusCode = prepared.error === 'authorization_request_not_found' ? 404 : 422;
        return reply.code(statusCode).send({
            error: prepared.error || 'invalid_authorization_request',
        });
    }

    if (isConnectCeremonyHost(request.hostname)) {
        setConnectRequestCookie(reply, request.params.requestRef);
        return reply.redirect('/connect', 302);
    }

    return reply
        .type('text/html; charset=utf-8')
        .send(renderAuthorizePageForHost(prepared.query, request.hostname));
});

fastify.post('/api/sl1e/authorize/requests', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'authorize-request:push', 40, 60 * 1000)) return reply;

    const result = pushAuthorizeRequest(sl1eRuntimeStore, request);
    const issuerProto = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0].trim();
    const issuerHost = String(request.headers['x-forwarded-host'] || request.headers.host || 'simplel1.local').split(',')[0].trim();
    const issuerOrigin = `${issuerProto}://${issuerHost}`;

    if (result.statusCode === 201) {
        return reply.code(201).send({
            ...result.payload,
            authorize_url: `${issuerOrigin}${result.payload.request_uri}`,
        });
    }

    return reply.code(result.statusCode).send(result.payload);
});

fastify.get('/api/sl1e/authorize', async (request, reply) => {
    if (redirectAuthorizeToPassHost(request, reply)) {
        return;
    }
    if (redirectIssuerToCeremonyHost(request, reply)) {
        return;
    }

    const prepared = authorizeQueryFromRequest(request);
    if (!prepared.ok) {
        return reply.code(422).send({
            error: 'missing_required_query',
            missing: prepared.missing,
        });
    }

    return reply
        .type('text/html; charset=utf-8')
        .send(renderAuthorizePageForHost(prepared.query, request.hostname));
});

fastify.get('/api/sl1e/authorize/bootstrap', async (request, reply) => {
    const prepared = authorizeQueryFromRequest(request);
    if (!prepared.ok) {
        return reply.code(422).send({
            error: 'missing_required_query',
            missing: prepared.missing,
        });
    }

    return authorizeBootstrapState(prepared.query, request.hostname);
});

fastify.get('/api/sl1e/wallet/bootstrap', async (request) => {
    return walletBootstrapState(request.query, request.hostname);
});

fastify.get('/api/sl1e/connect/status', async (request) => {
    cleanupSl1eArtifacts();

    const accounts = Object.values(ledger.accounts || {});
    const verifiableAccounts = accounts.filter((account) => verifiableAccountCredentials(account).length > 0);
    const rebuiltFromCapsule = verifiableAccounts.filter((account) => account.identity_source === 'rebuilt_from_capsule');

    return {
        issuer: originForHost(request.hostname),
        rp_id: rpIdForHost(request.hostname),
        runtime_version: NODE_VERSION,
        protocol_version: IDENTITY_PROTOCOL_VERSION,
        has_verifiable_identity: verifiableAccounts.length > 0,
        verifiable_identity_count: verifiableAccounts.length,
        identity_source: rebuiltFromCapsule.length > 0 ? 'rebuilt_from_capsule' : (verifiableAccounts.length > 0 ? 'local-ledger' : 'none'),
        rebuilt_from_capsule_count: rebuiltFromCapsule.length,
        identity_capsules_enabled: String(process.env.SL1_IDENTITY_CAPSULES_ENABLED || 'true') !== 'false',
        storage_role: process.env.SL1_STORAGE_ROLE || 'cache',
        identity_authority: 'identity_capsule+state_proof+webauthn_assertion',
        default_assurance_level: process.env.SL1_DEFAULT_ASSURANCE_LEVEL || 'AL1',
        resolvers: {
            evidence: String(process.env.SL1_EVIDENCE_RESOLVERS || 'local-cache,client-capsule,peer,signed-export').split(',').map((item) => item.trim()).filter(Boolean),
            state: String(process.env.SL1_STATE_RESOLVERS || 'local-cache,peer,anchor,quorum,signed-export').split(',').map((item) => item.trim()).filter(Boolean),
        },
        note: 'Browser privacy does not allow silent per-person passkey enumeration; this is issuer-side registration status.',
    };
});

fastify.get('/api/sl1e/identity/:entityAddress', async (request, reply) => {
    const account = accountByEntityAddress(request.params.entityAddress);
    const profile = identityProfile(account);
    if (!profile) return reply.code(404).send({ error: 'identity_not_found' });
    return { protocol: 'simple-l1', identity: profile };
});

fastify.get('/api/sl1e/identity/:entityAddress/capsule', async (request, reply) => {
    cleanupSl1eArtifacts();
    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    return {
        protocol: 'simple-l1',
        identity: identityProfile(account),
        ...identityPortabilityPayload(account, {
            purpose: 'web_wallet_capsule_export',
            requested_at: new Date().toISOString(),
        }),
    };
});

fastify.get('/api/sl1e/identity/:entityAddress/authentication/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'identity-management:authentication-options', 20, 60 * 1000)) return reply;

    const account = accountByEntityAddress(request.params.entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const result = createSl1eAuthenticationOptions({
        client_id: 'simplelayer.one',
        client_name: 'SL1 Identity',
        redirect_uri: `${originForHost(request.hostname)}/identity`,
        state: crypto.randomBytes(12).toString('base64url'),
        nonce: crypto.randomBytes(12).toString('base64url'),
        mode: 'connect',
        flow: 'identity-management',
        identity_hint: account.entity_l1_address || account.address,
    }, request.hostname, {
        purpose: 'identity_management',
        entityAddress: account.entity_l1_address || account.address,
    });

    return reply.code(result.statusCode).send(result.payload);
});

fastify.post('/api/sl1e/identity/:entityAddress/authentication/complete', async (request, reply) => {
    cleanupSl1eArtifacts();

    const entityAddress = String(request.params.entityAddress || '');
    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    try {
        const owner = await verifySl1eAuthenticationChallenge(request.body?.authorization_request_id, request.body?.assertion);
        const ownerEntityAddress = owner.account.entity_l1_address || owner.account.address;
        if (ownerEntityAddress !== entityAddress || owner.challengeRecord.purpose !== 'identity_management') {
            return reply.code(403).send({ error: 'identity_session_context_mismatch' });
        }

        return {
            success: true,
            identity_session_token: identitySessionToken(entityAddress),
            expires_in: 600,
            identity: identityProfile(owner.account),
        };
    } catch (error) {
        return reply.code(error.statusCode || 403).send({ error: error.message || 'identity_authentication_failed' });
    }
});

fastify.get('/api/sl1e/identity/:entityAddress/passkeys/registration/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'identity-management:passkey-registration', 10, 60 * 1000)) return reply;

    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;

    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const registrationRequestId = `sl1pk_${crypto.randomBytes(18).toString('hex')}`;
    const rpId = rpIdForHost(request.hostname);
    const activeCredentials = accountCredentials(account);
    const userLabel = passkeyAccountLabel({
        alias: account.alias,
        displayAlias: account.display_alias || account.displayAlias,
        handle: account.handle,
        fallback: entityAddress,
    });
    const publicKey = await generateRegistrationOptions({
        rpName: 'Simple Layer Identity',
        rpID: rpId,
        userID: crypto.randomBytes(16),
        userName: userLabel,
        userDisplayName: userLabel,
        timeout: 60000,
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
        excludeCredentials: activeCredentials.map((credential) => ({
            id: String(credential.credentialId || credential.credential_id),
            type: 'public-key',
            transports: credential.transports || ['internal', 'hybrid', 'usb', 'nfc', 'ble'],
        })),
        supportedAlgorithmIDs: [-7, -257],
    });
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    sl1eRuntimeStore.set('registrationChallenges', registrationRequestId, {
        purpose: 'passkey_enrollment',
        challenge: publicKey.challenge,
        query: {},
        rpId,
        origin: originForHost(request.hostname),
        entityAddress,
        userHandle: account.alias || account.handle || entityAddress,
        expiresAtMs,
    });

    return {
        registration_request_id: registrationRequestId,
        expires_at: new Date(expiresAtMs).toISOString(),
        publicKey,
    };
});

fastify.post('/api/sl1e/identity/:entityAddress/passkeys/registration/complete', async (request, reply) => {
    cleanupSl1eArtifacts();

    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;

    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const registrationRequestId = String(request.body?.registration_request_id || '');
    const challengeRecord = sl1eRuntimeStore.get('registrationChallenges', registrationRequestId);
    if (!challengeRecord || challengeRecord.purpose !== 'passkey_enrollment' || challengeRecord.entityAddress !== entityAddress) {
        return reply.code(404).send({ error: 'registration_challenge_not_found' });
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: request.body?.attestation,
            expectedChallenge: challengeRecord.challenge,
            expectedOrigin: challengeRecord.origin,
            expectedRPID: challengeRecord.rpId,
            requireUserVerification: false,
        });
        if (!verification.verified) return reply.code(403).send({ error: 'passkey_registration_failed' });

        const registrationInfo = verification.registrationInfo || {};
        const credential = registrationInfo.credential || {};
        const credentialId = base64UrlFromUnknown(
            credential.id || registrationInfo.credentialID || request.body?.attestation?.id || request.body?.attestation?.rawId
        );
        const credentialPublicKey = base64UrlFromUnknown(credential.publicKey || registrationInfo.credentialPublicKey);
        const counter = Number(credential.counter ?? registrationInfo.counter ?? 0);
        const transports = request.body?.attestation?.response?.transports || credential.transports || [];
        if (!credentialId || !credentialPublicKey) return reply.code(422).send({ error: 'registration_missing_credential_material' });
        if (findCredentialOwner(credentialId)) return reply.code(409).send({ error: 'passkey_already_registered' });

        const keyAddress = identityKernel.keyAddressFromPublicKey(credentialPublicKey);
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'PASSKEY_ADDED',
            payload: {
                entity_l1_address: entityAddress,
                key_l1_address: keyAddress,
                credentialId,
                credentialPublicKey,
                counter,
                transports,
                rp_id: challengeRecord.rpId,
            },
            timestamp: new Date().toISOString(),
        };
        applyEvent(event);
        broadcast('/api/network/broadcast', { type: 'EVENT', data: event });
        sl1eRuntimeStore.delete('registrationChallenges', registrationRequestId);
        const updatedAccount = accountByEntityAddress(entityAddress);
        return {
            success: true,
            identity: identityProfile(updatedAccount),
            identity_capsule: identityCapsuleForAccount(updatedAccount, {
                purpose: 'passkey_enrollment',
                registration_request_id: registrationRequestId,
                challenge: challengeRecord.challenge,
                origin: challengeRecord.origin,
            }),
            state_proof: currentIdentityStateProof('local-ledger'),
        };
    } catch (error) {
        sl1eRuntimeStore.delete('registrationChallenges', registrationRequestId);
        return reply.code(403).send({ error: 'passkey_registration_failed', detail: error.message });
    }
});

fastify.post('/api/sl1e/identity/:entityAddress/passkeys/:credentialId/revoke', async (request, reply) => {
    cleanupSl1eArtifacts();

    const entityAddress = String(request.params.entityAddress || '');
    const session = requireIdentitySession(request, reply, entityAddress);
    if (!session) return reply;

    const account = accountByEntityAddress(entityAddress);
    if (!account) return reply.code(404).send({ error: 'identity_not_found' });

    const activeCredentials = accountCredentials(account);
    const credentialId = String(request.params.credentialId || '');
    if (!activeCredentials.some((credential) => String(credential.credentialId || credential.credential_id) === credentialId)) {
        return reply.code(404).send({ error: 'passkey_not_found' });
    }
    if (activeCredentials.length <= 1) {
        return reply.code(409).send({ error: 'cannot_remove_last_passkey' });
    }

    const event = {
        id: crypto.randomBytes(8).toString('hex'),
        type: 'PASSKEY_REVOKED',
        payload: {
            entity_l1_address: entityAddress,
            credential_id: credentialId,
            reason: String(request.body?.reason || 'user_removed'),
        },
        timestamp: new Date().toISOString(),
    };
    applyEvent(event);
    broadcast('/api/network/broadcast', { type: 'EVENT', data: event });
    return { success: true, identity: identityProfile(accountByEntityAddress(entityAddress)) };
});

fastify.post('/api/sl1e/device-handoff', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-handoff:create', 20, 60 * 1000)) return reply;

    const rawQuery = request.body?.query || {};
    const queryInput = typeof rawQuery === 'string'
        ? Object.fromEntries(new URLSearchParams(rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery))
        : Object.fromEntries(Object.entries(rawQuery).map(([key, value]) => [key, String(value ?? '')]));
    const prepared = prepareAuthorizeQuery(queryInput);
    if (!prepared.ok) {
        return reply.code(422).send({
            error: 'invalid_handoff_request',
            missing: prepared.missing,
            detail: prepared.error,
        });
    }
    const query = prepared.query;

    if (String(query.response_mode || '') === 'form_post') {
        return reply.code(422).send({ error: 'device_handoff_requires_redirect_mode' });
    }

    if (!isAllowedSl1eRedirectUri(query.redirect_uri, query.client_id)) {
        return reply.code(422).send({ error: 'invalid_redirect_uri' });
    }

    const handoffId = crypto.randomBytes(12).toString('base64url');
    const desktopToken = crypto.randomBytes(18).toString('base64url');
    const mobileToken = crypto.randomBytes(18).toString('base64url');
    const origin = originForHost(request.hostname);
    const mobileUrl = `${origin}/device-handoff/${encodeURIComponent(handoffId)}?token=${encodeURIComponent(mobileToken)}`;
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    const handoffAction = query.handoff_action === 'register' ? 'register' : 'login';
    const requestedAlias = handoffAction === 'register' ? normalizeAlias(query.alias) : null;
    const requestedDisplayAlias = handoffAction === 'register' ? normalizeDisplayAlias(query.display_alias || query.alias) : null;
    if (handoffAction === 'register' && !requestedAlias) {
        return reply.code(422).send({ error: 'alias_required_for_registration_handoff' });
    }
    const aliasError = handoffAction === 'register' ? aliasValidationError(query.alias) : null;
    if (aliasError) {
        return reply.code(422).send({ error: aliasError, message: aliasValidationMessage(aliasError) });
    }
    const browserReservationOwner = browserOwnerToken(request);
    if (requestedAlias) {
        const priorReservationOwner = verifyBrowserOwnerToken(request, query.prior_alias_reservation_owner)
            ? String(query.prior_alias_reservation_owner || '')
            : '';
        const reserved = priorReservationOwner
            ? transferAliasReservation(requestedAlias, priorReservationOwner, browserReservationOwner, expiresAtMs)
            : reserveAlias(requestedAlias, browserReservationOwner, expiresAtMs);
        if (!reserved) {
            return reply.code(409).send({ error: 'alias_unavailable', alias: requestedAlias });
        }
    }
    if (requestedAlias) {
        query.alias = requestedAlias;
        if (requestedDisplayAlias) query.display_alias = requestedDisplayAlias;
        query.alias_reservation_owner = browserReservationOwner;
        delete query.prior_alias_reservation_owner;
    }

    sl1eRuntimeStore.set('deviceHandoffs', handoffId, {
        query,
        action: handoffAction,
        alias: requestedAlias,
        display_alias: requestedDisplayAlias,
        aliasReservationOwner: requestedAlias ? browserReservationOwner : null,
        desktopToken,
        mobileToken,
        mobileUrl,
        status: 'pending',
        redirectUrl: null,
        expiresAtMs,
    });

    return {
        handoff_id: handoffId,
        expires_at: new Date(expiresAtMs).toISOString(),
        mobile_url: mobileUrl,
        qr_svg_url: `/api/sl1e/device-handoff/${encodeURIComponent(handoffId)}/qr.svg?token=${encodeURIComponent(mobileToken)}`,
        poll_url: `/api/sl1e/device-handoff/${encodeURIComponent(handoffId)}/status?token=${encodeURIComponent(desktopToken)}`,
        alias_reservation_owner: requestedAlias ? browserReservationOwner : null,
    };
});

fastify.get('/api/sl1e/device-handoff/:handoffId/qr.svg', async (request, reply) => {
    cleanupSl1eArtifacts();

    const handoff = sl1eRuntimeStore.get('deviceHandoffs', String(request.params.handoffId || ''));
    if (!handoff || handoff.mobileToken !== String(request.query.token || '')) {
        return reply.code(404).type('image/svg+xml').send('');
    }

    const svg = await QRCode.toString(handoff.mobileUrl, {
        type: 'svg',
        margin: 1,
        width: 260,
        color: { dark: '#090a0f', light: '#ffffff' },
    });

    return reply
        .header('Cache-Control', 'no-store')
        .type('image/svg+xml')
        .send(svg);
});

fastify.get('/device-handoff/:handoffId', async (request, reply) => {
    cleanupSl1eArtifacts();

    const handoffId = String(request.params.handoffId || '');
    const token = String(request.query.token || '');
    const handoff = sl1eRuntimeStore.get('deviceHandoffs', handoffId);
    if (!handoff || handoff.mobileToken !== token) {
        return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Expired handoff</title><p>This SL1 handoff expired or was not found.</p>');
    }

    return reply
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(renderSl1eDeviceHandoffPage(handoffId, token, handoff, request.hostname));
});

fastify.get('/api/sl1e/device-handoff/:handoffId/authentication/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-handoff:authentication-options', 30, 60 * 1000)) return reply;

    const handoff = sl1eRuntimeStore.get('deviceHandoffs', String(request.params.handoffId || ''));
    if (!handoff || handoff.mobileToken !== String(request.query.token || '')) {
        return reply.code(404).send({ error: 'device_handoff_not_found' });
    }

    const result = createSl1eAuthenticationOptions(handoff.query, request.hostname, {
        handoffId: String(request.params.handoffId || ''),
    });

    return reply.code(result.statusCode).send(result.payload);
});

fastify.get('/api/sl1e/device-handoff/:handoffId/status', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-handoff:poll', 80, 60 * 1000)) return reply;

    const handoff = sl1eRuntimeStore.get('deviceHandoffs', String(request.params.handoffId || ''));
    if (!handoff || handoff.desktopToken !== String(request.query.token || '')) {
        return reply.code(404).send({ status: 'expired' });
    }

    return reply.header('Cache-Control', 'no-store').send({
        status: handoff.status,
        redirect_url: handoff.status === 'complete' ? handoff.redirectUrl : null,
        expires_at: new Date(handoff.expiresAtMs).toISOString(),
    });
});

fastify.post('/api/sl1e/device-handoff/:handoffId/complete', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'device-handoff:complete', 30, 60 * 1000)) return reply;

    const handoff = sl1eRuntimeStore.get('deviceHandoffs', String(request.params.handoffId || ''));
    if (!handoff || handoff.mobileToken !== String(request.body?.token || '')) {
        return reply.code(404).send({ error: 'device_handoff_not_found' });
    }
    if (handoff.status !== 'pending') {
        return reply.code(409).send({ error: 'device_handoff_already_completed' });
    }

    const redirectUrl = String(request.body?.redirect_url || '');
    let target;
    let expected;
    try {
        target = new URL(redirectUrl);
        expected = new URL(String(handoff.query.redirect_uri));
    } catch (error) {
        return reply.code(422).send({ error: 'invalid_handoff_redirect' });
    }

    const sameCallback = target.origin === expected.origin && target.pathname === expected.pathname;
    const sameState = target.searchParams.get('state') === String(handoff.query.state);
    const hasCode = /^sl1c_[A-Za-z0-9_-]+$/.test(String(target.searchParams.get('code') || ''));
    if (!sameCallback || !sameState || !hasCode) {
        return reply.code(403).send({ error: 'handoff_redirect_mismatch' });
    }

    handoff.status = 'complete';
    handoff.redirectUrl = redirectUrl;
    handoff.expiresAtMs = Date.now() + 60 * 1000;
    releaseAliasReservation(handoff.alias, handoff.aliasReservationOwner);

    return { success: true };
});

fastify.get('/api/sl1e/authentication/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'authentication-options', 30, 60 * 1000)) return reply;

    const prepared = authorizeQueryFromRequest(request);
    if (!prepared.ok) {
        return reply.code(422).send({
            error: prepared.error || 'invalid_authorization_request',
            missing: prepared.missing,
        });
    }

    const result = createSl1eAuthenticationOptions(prepared.query, request.hostname);
    return reply.code(result.statusCode).send(result.payload);
});

fastify.get('/api/sl1e/registration/options', async (request, reply) => {
    cleanupSl1eArtifacts();
    if (!checkRateLimit(request, reply, 'registration-options', 20, 60 * 1000)) return reply;

    const prepared = authorizeQueryFromRequest(request);
    if (!prepared.ok) {
        return reply.code(422).send({
            error: prepared.error || 'invalid_registration_request',
            missing: prepared.missing,
        });
    }

    const registrationRequestId = `sl1rr_${crypto.randomBytes(18).toString('hex')}`;
    const rpId = rpIdForHost(request.hostname);
    const authorizeQuery = prepared.query;
    const requestedAlias = normalizeAlias(authorizeQuery.alias);
    const requestedDisplayAlias = normalizeDisplayAlias(authorizeQuery.display_alias || authorizeQuery.alias);
    const aliasError = aliasValidationError(authorizeQuery.alias);
    if (aliasError) {
        return reply.code(422).send({ error: aliasError, message: aliasValidationMessage(aliasError) });
    }
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    const suppliedOwnerToken = verifyBrowserOwnerToken(request, request.query.alias_reservation_owner)
        ? String(request.query.alias_reservation_owner || '')
        : '';
    const aliasReservationOwner = suppliedOwnerToken || browserOwnerToken(request);
    if (requestedAlias && !reserveAlias(requestedAlias, aliasReservationOwner, expiresAtMs)) {
        return reply.code(409).send({ error: 'alias_unavailable', alias: requestedAlias });
    }
    const userHandle = requestedAlias || `sl1e-${crypto.randomBytes(5).toString('hex')}`;
    const userLabel = passkeyAccountLabel({
        alias: requestedAlias,
        displayAlias: requestedDisplayAlias,
        handle: userHandle,
        fallback: userHandle,
    });
    const publicKey = await generateRegistrationOptions({
        rpName: 'Simple Layer Identity',
        rpID: rpId,
        userID: crypto.randomBytes(16),
        userName: userLabel,
        userDisplayName: userLabel,
        timeout: 60000,
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
        supportedAlgorithmIDs: [-7, -257],
    });
    delete publicKey.excludeCredentials;

    sl1eRuntimeStore.set('registrationChallenges', registrationRequestId, {
        challenge: publicKey.challenge,
        query: { ...authorizeQuery },
        rpId,
        origin: originForHost(request.hostname),
        userHandle,
        alias: requestedAlias,
        displayAlias: requestedDisplayAlias,
        aliasReservationOwner,
        expiresAtMs,
    });

    return {
        registration_request_id: registrationRequestId,
        alias: requestedAlias,
        display_alias: requestedDisplayAlias,
        alias_reservation_owner: aliasReservationOwner,
        alias_reservation_expires_at: new Date(expiresAtMs).toISOString(),
        publicKey,
    };
});

fastify.post('/api/sl1e/registration/:registrationRequestId/release', async (request, reply) => {
    cleanupSl1eArtifacts();

    const registrationRequestId = String(request.params.registrationRequestId || '');
    const challengeRecord = sl1eRuntimeStore.get('registrationChallenges', registrationRequestId);
    if (!challengeRecord) {
        return { success: true };
    }

    releaseAliasReservation(challengeRecord.alias, challengeRecord.aliasReservationOwner);
    sl1eRuntimeStore.delete('registrationChallenges', registrationRequestId);

    return { success: true };
});

fastify.get('/api/sl1e/authorize/complete', async (request, reply) => {
    const { redirect_uri: redirectUri, state, response_mode: responseMode } = request.query;

    if (!redirectUri || !state || !isAllowedSl1eRedirectUri(redirectUri, request.query.client_id)) {
        return reply.code(422).send({ error: 'redirect_uri and state are required' });
    }

    const { code } = issueSl1eProof(request.query);

    if (responseMode === 'form_post') {
        return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>SL1E Redirect</title></head>
<body>
    <form id="sl1e-form" method="POST" action="${htmlEscape(redirectUri)}">
        <input type="hidden" name="state" value="${htmlEscape(state)}">
        <input type="hidden" name="code" value="${htmlEscape(code)}">
    </form>
    <script>document.getElementById('sl1e-form').submit();</script>
</body>
</html>`);
    }

    const target = new URL(String(redirectUri));
    target.searchParams.set('state', String(state));
    target.searchParams.set('code', code);

    return reply.redirect(target.toString());
});

fastify.post('/api/sl1e/registration/complete', async (request, reply) => {
    cleanupSl1eArtifacts();

    const { registration_request_id: registrationRequestId, attestation } = request.body || {};
    const challengeRecord = sl1eRuntimeStore.get('registrationChallenges', String(registrationRequestId || ''));
    if (!challengeRecord) {
        return reply.code(404).send({ error: 'registration_challenge_not_found' });
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: attestation,
            expectedChallenge: challengeRecord.challenge,
            expectedOrigin: challengeRecord.origin,
            expectedRPID: challengeRecord.rpId,
            requireUserVerification: false,
        });

        if (!verification.verified) {
            return reply.code(403).send({ error: 'passkey_registration_failed' });
        }

        const registrationInfo = verification.registrationInfo || {};
        const credential = registrationInfo.credential || {};
        const credentialId = base64UrlFromUnknown(
            credential.id || registrationInfo.credentialID || attestation?.id || attestation?.rawId
        );
        const credentialPublicKey = base64UrlFromUnknown(
            credential.publicKey || registrationInfo.credentialPublicKey
        );
        const counter = Number(credential.counter ?? registrationInfo.counter ?? 0);
        const transports = attestation?.response?.transports || credential.transports || [];

        if (!credentialId || !credentialPublicKey) {
            return reply.code(422).send({ error: 'registration_missing_credential_material' });
        }

        if (findCredentialOwner(credentialId)) {
            return reply.code(409).send({ error: 'passkey_already_registered' });
        }

        const entityAddress = identityKernel.newEntityAddress();
        const keyAddress = identityKernel.keyAddressFromPublicKey(credentialPublicKey);
        const alias = challengeRecord.alias;
        const displayAlias = challengeRecord.displayAlias || null;
        const genesisEvent = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'GENESIS',
            payload: {
                address: entityAddress,
                entity_l1_address: entityAddress,
                key_l1_address: keyAddress,
                address_version: identityKernel.ENTITY_ADDRESS_VERSION,
                key_address_version: identityKernel.KEY_ADDRESS_VERSION,
                handle: challengeRecord.userHandle,
                alias,
                display_alias: displayAlias,
                publicKey: credentialPublicKey,
                credentialId,
                credentialPublicKey,
                counter,
                transports,
                rp_id: challengeRecord.rpId,
            },
            timestamp: new Date().toISOString(),
        };

        applyEvent(genesisEvent);
        broadcast('/api/network/broadcast', { type: 'EVENT', data: genesisEvent });
        releaseAliasReservation(challengeRecord.alias, challengeRecord.aliasReservationOwner);
        sl1eRuntimeStore.delete('registrationChallenges', String(registrationRequestId));

        const account = ledger.accounts[entityAddress];
        const { redirect_uri: redirectUri, state, response_mode: responseMode } = challengeRecord.query;
        const { code } = issueSl1eProof(challengeRecord.query, account, {
            challenge: challengeRecord.challenge,
            controllerCredential: account.keys?.[0] || account,
        });
        const portability = identityPortabilityPayload(account, {
            purpose: 'web_wallet_genesis',
            registration_request_id: registrationRequestId,
            challenge: challengeRecord.challenge,
            origin: challengeRecord.origin,
        });

        if (responseMode === 'form_post') {
            return {
                response_mode: 'form_post',
                state,
                code,
            };
        }

        const target = new URL(String(redirectUri));
        target.searchParams.set('state', String(state));
        target.searchParams.set('code', code);

        return {
            redirect_url: target.toString(),
            identity: {
                entity_l1_address: entityAddress,
                key_l1_address: keyAddress,
                alias,
                display_alias: displayAlias,
            },
            ...portability,
        };
    } catch (error) {
        releaseAliasReservation(challengeRecord.alias, challengeRecord.aliasReservationOwner);
        sl1eRuntimeStore.delete('registrationChallenges', String(registrationRequestId));

        return reply.code(403).send({
            error: 'passkey_registration_failed',
            detail: error.message,
        });
    }
});

fastify.post('/api/sl1e/authorize/complete', async (request, reply) => {
    cleanupSl1eArtifacts();

    const { authorization_request_id: authorizationRequestId, assertion } = request.body || {};
    try {
        const owner = await verifySl1eAuthenticationChallenge(authorizationRequestId, assertion);

        const { redirect_uri: redirectUri, state, response_mode: responseMode } = owner.challengeRecord.query;
        const { code } = issueSl1eProof(owner.challengeRecord.query, owner.account, {
            challenge: owner.challengeRecord.challenge,
            controllerCredential: owner.credential,
        });
        const portability = identityPortabilityPayload(owner.account, {
            purpose: 'web_wallet_authorization',
            authorization_request_id: authorizationRequestId,
            challenge: owner.challengeRecord.challenge,
            origin: owner.challengeRecord.origin,
        });

        if (responseMode === 'form_post') {
            return {
                response_mode: 'form_post',
                state,
                code,
            };
        }

        const target = new URL(String(redirectUri));
        target.searchParams.set('state', String(state));
        target.searchParams.set('code', code);

        return {
            redirect_url: target.toString(),
            identity: {
                entity_l1_address: owner.account.entity_l1_address || owner.account.address,
                key_l1_address: owner.account.key_l1_address || null,
                alias: publicAlias(owner.account.alias) || null,
                display_alias: accountDisplayName(owner.account) || null,
            },
            ...portability,
        };
    } catch (error) {
        return reply.code(error.statusCode || 403).send({
            error: error.message || 'passkey_verification_failed',
            detail: error.message,
        });
    }
});

fastify.post('/api/sl1e/authorization-code/exchange', async (request, reply) => {
    cleanupSl1eArtifacts();

    const { code, client_id: clientId, redirect_uri: redirectUri } = request.body || {};
    const record = sl1eRuntimeStore.get('authorizationCodes', String(code || ''));

    if (!record) {
        return reply.code(404).send({ success: false, active: false, error: 'invalid_authorization_code' });
    }

    if (record.clientId !== String(clientId || '') || record.redirectUri !== String(redirectUri || '')) {
        return reply.code(403).send({ success: false, active: false, error: 'authorization_code_context_mismatch' });
    }

    const requestedIntentType = String(request.body?.intent_type || request.body?.intent?.type || '').trim();
    if (requestedIntentType && record.intent?.type && requestedIntentType !== String(record.intent.type)) {
        return reply.code(403).send({ success: false, active: false, error: 'authorization_code_intent_mismatch' });
    }

    sl1eRuntimeStore.delete('authorizationCodes', String(code));
    const issuerProto = String(request.headers['x-forwarded-proto'] || request.protocol || 'http').split(',')[0].trim();
    const issuerHost = String(request.headers['x-forwarded-host'] || request.headers.host || 'simplel1.local').split(',')[0].trim();
    const identityProofEnvelope = createIdentityProofEnvelope({
        proof: record.response?.proof,
        issuer: {
            issuer_id: NODE_ID,
            issuer_url: `${issuerProto}://${issuerHost}`,
            key_id: `sl1-connect:${NODE_ID}`,
        },
        scope: record.scope,
        claims: {
            alias: record.response?.identity?.alias ?? null,
            display_alias: record.response?.identity?.display_alias ?? null,
            email: record.disclosedEmail ?? null,
            email_hash: record.disclosedEmailHash ?? null,
        },
        secret: SL1_CONNECT_SECRET,
    });

    return {
        ...record.response,
        protocol: 'simple-l1',
        success: true,
        active: true,
        proof_token: record.proofToken || record.response?.proof_token || '',
        proof: record.response?.proof || null,
        identity: record.response?.identity || null,
        identity_proof_envelope: identityProofEnvelope,
    };
});

fastify.post('/api/sl1e/proofs/introspect', async (request, reply) => {
    cleanupSl1eArtifacts();

    const proofToken = String((request.body || {}).proof_token || '');
    const record = sl1eRuntimeStore.get('proofTokens', proofToken);

    if (!record) {
        return reply.code(404).send({ protocol: 'simple-l1', active: false, error: 'proof_token_not_found' });
    }

    const expectedAudience = String((request.body || {}).audience || record.clientId || '');
    const verification = verifyIdentityProof(record.response?.proof, {
        audience: expectedAudience,
        now: new Date(),
        secret: SL1_CONNECT_SECRET,
        consumeProof: (proofId, expiresAtMs) => sl1eRuntimeStore.markProofConsumed(proofId, expiresAtMs),
        isControllerRevoked: (controllerAddress) => {
            if (!controllerAddress) return false;
            return (ledger.controller_bindings || [])
                .some((binding) => binding.controller_l1_address === controllerAddress && binding.status === 'revoked');
        },
    });
    sl1eRuntimeStore.delete('proofTokens', proofToken);
    if (!verification.ok) {
        return reply.code(403).send({
            protocol: 'simple-l1',
            active: false,
            error: 'identity_proof_invalid',
            reason_codes: verification.reason_codes,
        });
    }

    return record.response;
});

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
        runtime_version: NODE_VERSION,
        protocol_version: IDENTITY_PROTOCOL_VERSION,
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

fastify.post('/api/sl1/network/join-requests', async (request, reply) => {
    let normalized;
    try {
        normalized = normalizeNetworkJoinRequest(request.body || {});
    } catch (error) {
        return reply.code(error.statusCode || 422).send({
            protocol: 'simple-l1',
            error: error.message || 'invalid_join_request',
            missing: error.missing || undefined,
            expected: error.expected || undefined,
            received: error.received || undefined,
            invariant: 'join_request != peer_admission',
        });
    }

    const store = loadNetworkJoinStore();
    const existingByHash = store.join_requests.find((candidate) => candidate.request_hash === normalized.request_hash);
    if (existingByHash) {
        let namespaceAllocation = {
            status: namespaceAutoAllocateEnabled() ? 'pending' : 'skipped',
            reason: namespaceAutoAllocateEnabled() ? 'auto_allocate_enabled' : 'auto_allocate_disabled',
        };
        if (namespaceAutoAllocateEnabled() && existingByHash.status === 'pending_dns') {
            try {
                const allocationResult = await allocateNamespaceDns(store, existingByHash);
                namespaceAllocation = {
                    status: allocationResult.response.status,
                    dns_allocation: allocationResult.allocation,
                    namespace_artifact: allocationResult.response.namespace_artifact,
                };
                if (allocationResult.statusCode === 201) saveNetworkJoinStore(store);
            } catch (error) {
                namespaceAllocation = {
                    status: 'failed',
                    error: error.message || 'namespace_auto_allocation_failed',
                    required_env: error.required_env || undefined,
                    invariant: error.message === 'namespace_allocation_conflict'
                        ? 'requested_fqdn must resolve to one active namespace allocation'
                        : 'dns_allocation != peer_admission',
                };
            }
        }
        return reply.code(200).send({
            protocol: 'simple-l1',
            status: 'duplicate_observed',
            bridge_role: 'discovery_inbox_only',
            invariant: 'bridge_request_visibility != peer_trust',
            join_request: existingByHash,
            namespace_allocation: namespaceAllocation,
        });
    }

    const existingById = store.join_requests.find((candidate) => candidate.request_id === normalized.request_id);
    if (existingById) {
        return reply.code(409).send({
            protocol: 'simple-l1',
            error: 'join_request_id_conflict',
            request_id: normalized.request_id,
            existing_request_hash: existingById.request_hash,
            received_request_hash: normalized.request_hash,
            invariant: 'join_requests_are_immutable',
        });
    }

    if (normalized.requested_fqdn) {
        const namespaceConflict = store.join_requests.find((candidate) => (
            candidate.network_id === normalized.network_id &&
            candidate.requested_fqdn === normalized.requested_fqdn &&
            candidate.request_id !== normalized.request_id
        ));
        if (namespaceConflict) {
            return reply.code(409).send({
                protocol: 'simple-l1',
                error: 'namespace_request_conflict',
                requested_fqdn: normalized.requested_fqdn,
                existing_request_id: namespaceConflict.request_id,
                received_request_id: normalized.request_id,
                invariant: 'requested_fqdn must map to one pending namespace request',
            });
        }
    }

    const stored = {
        ...normalized,
        observed_at: new Date().toISOString(),
        bridge_node_id: NODE_ID,
        bridge_role: 'discovery_inbox_only',
        admission_state: 'not_admitted_by_bridge',
        invariants: [
            'join_request != peer_admission',
            'identity_bridge != network_authority',
            'observed_request != local_trust',
            'bridge_request_visibility != peer_trust',
        ],
    };

    store.join_requests.push(stored);

    let namespaceAllocation = {
        status: namespaceAutoAllocateEnabled() ? 'pending' : 'skipped',
        reason: namespaceAutoAllocateEnabled() ? 'auto_allocate_enabled' : 'auto_allocate_disabled',
    };

    if (namespaceAutoAllocateEnabled() && stored.status === 'pending_dns') {
        try {
            const allocationResult = await allocateNamespaceDns(store, stored);
            namespaceAllocation = {
                status: allocationResult.response.status,
                dns_allocation: allocationResult.allocation,
                namespace_artifact: allocationResult.response.namespace_artifact,
            };
        } catch (error) {
            namespaceAllocation = {
                status: 'failed',
                error: error.message || 'namespace_auto_allocation_failed',
                required_env: error.required_env || undefined,
                invariant: error.message === 'namespace_allocation_conflict'
                    ? 'requested_fqdn must resolve to one active namespace allocation'
                    : 'dns_allocation != peer_admission',
            };
        }
    }

    saveNetworkJoinStore(store);

    return reply.code(201).send({
        protocol: 'simple-l1',
        status: 'observed',
        bridge_role: 'discovery_inbox_only',
        join_request: stored,
        namespace_allocation: namespaceAllocation,
    });
});

fastify.post('/api/sl1/network/join-requests/:requestId/artifacts', async (request, reply) => {
    const requestId = String(request.params.requestId || '');
    const store = loadNetworkJoinStore();
    const joinRequest = store.join_requests.find((candidate) => (
        candidate.request_id === requestId || candidate.request_hash === requestId
    ));

    if (!joinRequest) {
        return reply.code(404).send({
            protocol: 'simple-l1',
            error: 'join_request_not_found',
            request_id: requestId,
        });
    }

    let recorded;
    try {
        recorded = recordNamespaceArtifact(store, joinRequest, request.body || {});
    } catch (error) {
        if (error.message === 'namespace_allocation_conflict') {
            return reply.code(error.statusCode || 409).send({
                protocol: 'simple-l1',
                error: error.message,
                requested_fqdn: error.requested_fqdn,
                existing_request_id: error.existing_request_id,
                received_request_id: error.received_request_id,
                invariant: 'requested_fqdn must resolve to one active namespace allocation',
            });
        }
        return reply.code(error.statusCode || 422).send({
            protocol: 'simple-l1',
            error: error.message || 'invalid_namespace_artifact',
            expected: error.expected || undefined,
            received: error.received || undefined,
            invariant: error.message === 'issuer_node_id_mismatch'
                ? 'issuer_metadata.node_id must match join_request.node_id'
                : 'namespace_artifacts_are_immutable',
        });
    }

    if (recorded.statusCode === 201) saveNetworkJoinStore(store);
    return reply.code(recorded.statusCode).send(recorded.response);
});

fastify.post('/api/sl1/network/join-requests/:requestId/allocate-dns', async (request, reply) => {
    return reply.code(410).send({
        protocol: 'simple-l1',
        error: 'manual_allocate_dns_removed',
        message: 'DNS allocation is bridge-internal and is triggered by accepted join requests when SL1_NAMESPACE_AUTO_ALLOCATE=true.',
        invariant: 'operator_cli != namespace_authority',
    });
});

fastify.get('/api/sl1/network/join-requests', async (request) => {
    const networkId = request.query.network_id ? String(request.query.network_id) : null;
    const store = loadNetworkJoinStore();
    const joinRequests = store.join_requests
        .filter((candidate) => !networkId || candidate.network_id === networkId)
        .slice()
        .sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')));

    return {
        protocol: 'simple-l1',
        schema_version: 'simple-l1.network.join_requests.v1',
        generated_at: new Date().toISOString(),
        bridge_role: 'discovery_inbox_only',
        network_id: networkId,
        count: joinRequests.length,
        join_requests: joinRequests,
        namespace_artifacts: store.namespace_artifacts
            .filter((candidate) => !networkId || candidate.network_id === networkId)
            .slice()
            .sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || ''))),
        invariants: [
            'join_request != peer_admission',
            'identity_bridge != network_authority',
            'observed_request != local_trust',
            'bridge_request_visibility != peer_trust',
            'dns_allocation != peer_admission',
            'dns_provider != federation_authority',
        ],
    };
});

fastify.get('/api/sl1/network/join-requests/:requestId', async (request, reply) => {
    const requestId = String(request.params.requestId || '');
    const store = loadNetworkJoinStore();
    const joinRequest = store.join_requests.find((candidate) => (
        candidate.request_id === requestId || candidate.request_hash === requestId
    ));

    if (!joinRequest) {
        return reply.code(404).send({
            protocol: 'simple-l1',
            error: 'join_request_not_found',
            request_id: requestId,
        });
    }

    return {
        protocol: 'simple-l1',
        bridge_role: 'discovery_inbox_only',
        join_request: joinRequest,
        namespace_artifacts: store.namespace_artifacts
            .filter((candidate) => candidate.request_id === joinRequest.request_id)
            .slice()
            .sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || ''))),
    };
});

fastify.post('/api/sl1/install-reports', async (request, reply) => {
    if (!checkRateLimit(request, reply, 'install-reports:create', 60, 60 * 1000)) return reply;

    let report;
    try {
        report = normalizeInstallReport(request.body || {});
    } catch (error) {
        return reply.code(error.statusCode || 422).send({
            protocol: 'simple-l1',
            error: error.message || 'invalid_install_report',
            expected: error.expected || undefined,
            received: error.received || undefined,
            invariant: 'install_report_must_be_anonymized',
        });
    }

    const store = loadInstallReportStore();
    const existing = store.reports.find((candidate) => candidate.report_id === report.report_id);
    if (existing) {
        return {
            protocol: 'simple-l1',
            status: 'duplicate_observed',
            install_report: existing,
        };
    }

    store.reports.push({
        ...report,
        observed_at: new Date().toISOString(),
        bridge_node_id: NODE_ID,
        invariants: [
            'install_report_is_observability_only',
            'install_report_must_not_contain_raw_domain_or_ip',
            'install_report_does_not_grant_authority',
        ],
    });
    saveInstallReportStore(store);

    return reply.code(201).send({
        protocol: 'simple-l1',
        status: 'observed',
        install_report: report,
    });
});

fastify.get('/api/identity/summary', async (request, reply) => {
    return buildIdentitySummaryPayload(request);
});

fastify.get('/api/wallet/summary', async (request, reply) => {
    const payload = buildIdentitySummaryPayload(request);
    payload.deprecated = 'Use /api/identity/summary. Wallet here means identity surface, not custody.';
    return payload;
});

function buildIdentitySummaryPayload(request) {
    const vaultProviderUrl = String(process.env.VAULT_PROVIDER_URL || 'https://meanly.one').replace(/\/$/, '');
    const requestedAddress = String(request.query.address || '').trim();
    const accounts = Object.values(ledger.accounts || {});
    const account = requestedAddress
        ? ledger.accounts[requestedAddress]
        : accounts.find((candidate) => candidate?.entity_l1_address || candidate?.address) || null;

    const emptyPayload = {
        schema: 'simple-l1.identity.summary.v1',
        protocol: 'simple-l1',
        status: 'empty',
        message: 'No SL1 identity has been created on this node yet.',
        identity: null,
        account: null,
        native: null,
        balances: [],
        providers: [],
        attachments: { providers: [] },
        operations: [],
        receipts: [],
        intents: [],
        identity_surface: {
            axiom: 'Identity owns attachments. Providers own instruments.',
            custody_boundary: 'protocol_native_sl_only',
            vault_provider_url: vaultProviderUrl,
        },
    };

    if (!account) {
        return emptyPayload;
    }

    const address = account.entity_l1_address || account.address;
    const slAmount = Number((account.balances || {}).SL ?? nativeBalance(account) ?? 0);
    const balances = [{
        asset: 'SL',
        amount: slAmount,
        available: slAmount,
        reserved: 0,
        kind: 'native_protocol_ledger',
    }];

    const providers = Array.isArray(account.provider_attachments)
        ? account.provider_attachments
        : [];

    const relatedEvents = (ledger.event_log || [])
        .filter((event) => JSON.stringify(event?.payload || {}).includes(address))
        .slice(-12)
        .reverse()
        .map((event) => ({
            id: event.id,
            type: event.type,
            timestamp: event.timestamp,
            direction: event.type === 'GENESIS' ? 'credit' : 'proof',
            asset: 'SL',
            amount: event.type === 'GENESIS' ? nativeBalance(account) : null,
            status: 'settled',
            description: event.type === 'GENESIS'
                ? 'SL identity created'
                : 'Ledger event linked to this identity',
        }));

    const receipts = receiptEngine
        ? receiptEngine.getReceiptsByAddress(address).slice(0, 8)
        : [];
    const intents = intentEngine
        ? intentEngine.getIntentsByAddress(address).slice(0, 8)
        : [];

    const keyCount = Array.isArray(account.keys)
        ? account.keys.filter((key) => key.status !== 'revoked').length
        : (account.key_l1_address ? 1 : 0);

    const identity = {
        entity_l1_address: address,
        handle: account.alias || account.handle || 'anonymous',
        key_l1_address: account.key_l1_address || account.keys?.[0]?.key_l1_address || null,
        active_keys: keyCount,
        policy: account.authority_policies || {},
    };

    return {
        schema: 'simple-l1.identity.summary.v1',
        protocol: 'simple-l1',
        status: 'active',
        identity,
        account: identity,
        native: balances[0],
        balances,
        providers,
        attachments: { providers },
        operations: relatedEvents,
        receipts,
        intents,
        identity_surface: {
            axiom: 'Identity owns attachments. Providers own instruments.',
            custody_boundary: 'protocol_native_sl_only',
            vault_provider_url: vaultProviderUrl,
            default_provider: {
                provider_id: 'meanly.vault',
                label: 'Meanly Vault',
                link_url: vaultProviderUrl,
                status: providers.some((entry) => entry?.provider_id === 'meanly.vault' && entry?.status === 'active')
                    ? 'linked'
                    : 'unlinked',
            },
        },
    };
}

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
        const grantInput = {
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

        if (!grantInput.capability || !grantInput.scope) {
            return reply.code(422).send({ error: 'capability and scope are required' });
        }

        if (grantInput.capability.includes('*') || grantInput.scope.includes('*')) {
            return reply.code(422).send({ error: 'wildcard grants are not part of CRE v1' });
        }

        if (!['deny', 'require_quorum', 'require_approval', 'allow'].includes(grantInput.policy)) {
            return reply.code(422).send({ error: 'Unsupported grant policy' });
        }

        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'CONTROL_GRANT_CREATED',
            payload: grantInput,
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        broadcast('/api/network/broadcast', { type: 'EVENT', data: event });

        const grant = ledger.control_grants.find((candidate) => candidate.id === grantInput.id);
        return { success: true, grant };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.post('/api/authority/grants/:grant_id/revoke', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'CONTROL_GRANT_REVOKED',
            payload: {
                grant_id: request.params.grant_id,
                reason: request.body?.reason || 'revoked',
                revoked_by_entity_l1_address: request.body?.revoked_by_entity_l1_address || null,
            },
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        broadcast('/api/network/broadcast', { type: 'EVENT', data: event });

        return {
            success: true,
            revocation: ledger.revocations.find((candidate) => candidate.grant_id === request.params.grant_id),
        };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.post('/api/authority/authorizations', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'AUTHORIZATION_CREATED',
            payload: request.body,
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        const authorization = ledger.authorizations[ledger.authorizations.length - 1];

        return { success: authorization?.can_execute === true, authorization };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.get('/api/authority/authorizations/:authorization_id/verify', async (request, reply) => {
    const result = verifyAuthorization(ledger, request.params.authorization_id);
    return reply.code(result.ok ? 200 : 422).send(result);
});

fastify.post('/api/policy/artifacts/evaluate', async (request, reply) => {
    try {
        const input = {
            intent_type: String(request.body.intent_type || ''),
            intent: request.body.intent || {},
            context: request.body.context || {},
            facts: request.body.facts || null,
        };
        const result = policyEngine.evaluate(input.intent_type, input.intent, input.context);
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'POLICY_ARTIFACT_RECORDED',
            payload: { input, result },
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        const decision = ledger.policy_decisions[ledger.policy_decisions.length - 1];
        const evaluation = ledger.policy_evaluations.find((candidate) => candidate.id === decision.policy_evaluation_id);

        return { success: decision.decision === 'allow', evaluation, decision };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.post('/api/external-proofs', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'EXTERNAL_PROOF_RECORDED',
            payload: request.body,
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        const externalProof = ledger.external_proofs[ledger.external_proofs.length - 1];

        return { success: true, externalProof };
    } catch (err) {
        return reply.code(409).send({ error: err.message });
    }
});

fastify.get('/api/external-proofs/:external_proof_id/verify', async (request, reply) => {
    const result = verifyExternalProof(ledger, request.params.external_proof_id);
    return reply.code(result.ok ? 200 : 422).send(result);
});

fastify.get('/api/marketplace/sellers', async () => {
    ensureSellerStores(ledger);
    return {
        protocol: 'meanly.marketplace.seller-launch.v0',
        status: 'ok',
        sellers: sellerSummary(ledger),
        listings: ledger.marketplace_listings || [],
        boundary: 'seller_launch_records_are_app_layer_not_protocol_authority',
    };
});

fastify.post('/api/marketplace/sellers', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'MARKETPLACE_SELLER_UPSERTED',
            payload: request.body || {},
            timestamp: new Date().toISOString(),
        };
        applyEvent(event);
        const seller = ledger.marketplace_sellers[ledger.marketplace_sellers.length - 1];
        return reply.code(201).send({
            success: true,
            seller,
            boundary: 'seller_profile != protocol_authority',
        });
    } catch (err) {
        return reply.code(err.statusCode || 422).send({ error: err.message });
    }
});

fastify.post('/api/marketplace/sellers/:sellerId/listings', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'MARKETPLACE_LISTING_UPSERTED',
            payload: {
                ...(request.body || {}),
                seller_id: request.params.sellerId,
                status: request.body?.status || 'draft',
            },
            timestamp: new Date().toISOString(),
        };
        applyEvent(event);
        const listing = ledger.marketplace_listings[ledger.marketplace_listings.length - 1];
        const seller = ledger.marketplace_sellers.find((candidate) => candidate.seller_id === request.params.sellerId);
        return reply.code(201).send({
            success: true,
            seller,
            listing,
            boundary: 'listing_publication != settlement_or_ownership_event',
        });
    } catch (err) {
        return reply.code(err.statusCode || 422).send({ error: err.message, activation: err.activation });
    }
});

fastify.post('/api/marketplace/sellers/:sellerId/activate', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'MARKETPLACE_SELLER_ACTIVATED',
            payload: { seller_id: request.params.sellerId },
            timestamp: new Date().toISOString(),
        };
        applyEvent(event);
        const seller = ledger.marketplace_sellers.find((candidate) => candidate.seller_id === request.params.sellerId);
        return { success: true, seller };
    } catch (err) {
        return reply.code(err.statusCode || 422).send({ error: err.message, activation: err.activation });
    }
});

fastify.post('/api/marketplace/reference-flow/settle', async (request, reply) => {
    try {
        const event = {
            id: crypto.randomBytes(8).toString('hex'),
            type: 'MARKETPLACE_SETTLEMENT_RECORDED',
            payload: request.body,
            timestamp: new Date().toISOString(),
        };

        applyEvent(event);
        const settlementProof = ledger.settlement_proofs[ledger.settlement_proofs.length - 1];

        return {
            success: true,
            settlementProof,
            lineage: explainSettlement(ledger, settlementProof.id),
        };
    } catch (err) {
        return reply.code(422).send({ error: err.message });
    }
});

fastify.get('/api/marketplace/reference-flow/settlements/:settlement_proof_id/lineage', async (request, reply) => {
    const result = explainSettlement(ledger, request.params.settlement_proof_id);
    return reply.code(result.ok ? 200 : 422).send(result);
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
    return legacyMutationDisabled(reply, '/api/assets/deposit', '/api/settlement/deposit-address');
});

// 5. Simulate Bridge Intent (Asynchronous Settlement)
fastify.post('/api/assets/simulate-mint', async (request, reply) => {
    return legacyMutationDisabled(reply, '/api/assets/simulate-mint', '/api/external-proofs + /api/marketplace/reference-flow/settle');
});


// 6. Process Cryptographically Authorized Intent
fastify.post('/transactions', async (request, reply) => {
    return legacyMutationDisabled(reply, '/transactions', '/api/authority/authorizations + /api/marketplace/reference-flow/settle');
});

// 7. Manage Authority (Delegate/Revoke)
fastify.post('/api/authority/manage', async (request, reply) => {
    return legacyMutationDisabled(reply, '/api/authority/manage', '/api/capabilities/grants or /api/authority/grants/:grant_id/revoke');
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
    return legacyMutationDisabled(reply, '/transactions-legacy', '/api/authority/authorizations + /api/marketplace/reference-flow/settle');
});

// --- START SERVER ---
// (Already handled in the main start() function above)

fastify.addHook('onRequest', async (request, reply) => {
    if (!isPassIssuerHost(request.hostname)) {
        return;
    }

    const pathname = new URL(request.url, 'http://localhost').pathname;
    const passPaths = [
        '/api/',
        '/authorize',
        '/r/',
        '/healthcheck',
        '/manifest',
        '/identity-icon',
        '/style.css',
        '/authorize-protocol.css',
        '/app.js',
        '/device-handoff',
        '/device-pairing',
        '/sl1',
    ];

    if (pathname === '/index.html') {
        return reply.redirect(302, '/');
    }

    if (pathname === '/') {
        return;
    }

    if (passPaths.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
        return;
    }

    if (/\.(css|js|svg|webmanifest|png|jpe?g|woff2?)$/i.test(pathname)) {
        return;
    }

    const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    return reply.redirect(302, `${protocolSiteOrigin()}${pathname}${query}`);
});

const renderConnectCeremonyLanding = (host, localeHint = '') => {
    const surface = walletSurfaceForHost(host, localeHint);
    const strings = surface.strings || CEREMONY_STRINGS.en;
    return `<!doctype html>
<html lang="${htmlEscape(surface.locale || 'en')}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(surface.brand)}</title>
    <style>
        body { margin:0; min-height:100vh; display:grid; place-items:center; background:#eef0fc; font-family:Outfit,Inter,ui-sans-serif,system-ui,sans-serif; color:#050505; }
        .card { width:min(460px,calc(100vw - 42px)); padding:30px; border:4px solid #050505; border-radius:26px; background:#fff; box-shadow:10px 10px 0 #050505; text-align:center; }
        h1 { margin:0 0 12px; font-size:clamp(32px,7vw,48px); font-weight:950; letter-spacing:-.06em; }
        p { margin:0; color:#4b5563; font-weight:800; line-height:1.5; }
        .brand { display:inline-flex; margin-bottom:14px; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:11px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
    </style>
</head>
<body>
    <section class="card">
        <div class="brand">${htmlEscape(surface.brand)}</div>
        <h1>${htmlEscape(strings.connectLandingTitle || 'Secure identity connection')}</h1>
        <p>${htmlEscape(strings.connectLandingBody || 'Start sign-in from the storefront or app that sent you here.')}</p>
    </section>
</body>
</html>`;
};

fastify.get('/', async (request, reply) => {
    if (isPassIssuerHost(request.hostname)) {
        return reply.type('text/html; charset=utf-8').send(renderPassIssuerHome(request.hostname));
    }

    if (isConnectCeremonyHost(request.hostname)) {
        return reply.type('text/html; charset=utf-8').send(renderConnectCeremonyLanding(request.hostname, request.query?.ui_locale || request.query?.alias_locale));
    }

    const indexPath = path.join(__dirname, 'www', 'index.html');
    return reply.type('text/html; charset=utf-8').send(fs.readFileSync(indexPath, 'utf8'));
});

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
    return legacyMutationDisabled(reply, '/api/settlement/verify-deposit', '/api/external-proofs');
});

// POST /api/settlement/withdraw
// Prepare a CROSS_CHAIN_WITHDRAWAL settlement request.
// Does NOT execute — returns signed withdrawal request for treasury.
// Body: { sl1_sender, external_network, external_recipient, asset, amount }
fastify.post('/api/settlement/withdraw', async (request, reply) => {
    return legacyMutationDisabled(reply, '/api/settlement/withdraw', '/api/authority/authorizations + settlement execution pipeline');
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
    const { sl1_address, network, amount } = request.body;
    const asset = normalizeWalletAsset(request.body.asset);

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
    const { sl1_address, network, amount, external_recipient } = request.body;
    const asset = normalizeWalletAsset(request.body.asset);

    if (!sl1_address || !network || !asset || !amount || !external_recipient) {
        return reply.code(400).send({ error: 'Required: sl1_address, network, asset, amount, external_recipient' });
    }
    const account = ledger.accounts[sl1_address];
    if (!account) return reply.code(404).send({ error: 'SL1 account not found' });

    const balance = asset === 'SL' ? nativeBalance(account) : (account.balances[asset] || 0);
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
    return legacyMutationDisabled(reply, '/api/intents/:intent_id/fulfill', '/api/external-proofs + /api/marketplace/reference-flow/settle');
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
