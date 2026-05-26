'use strict';

/**
 * SIMPLE-L1 Settlement Adapter Registry
 *
 * The Universal Settlement Interface — a single coordination point
 * that routes between all external network adapters.
 *
 * Architecture:
 *   Simple L1 (Identity + Intent + Consensus)
 *       ↓
 *   SettlementAdapterRegistry   ← YOU ARE HERE
 *       ↓
 *   [EVMAdapter] [BitcoinAdapter] [TONAdapter] [SolanaAdapter] ...
 *       ↓
 *   External Networks (RPC / Oracle Layer)
 */

const { EVMAdapter, EVM_NETWORKS } = require('./evm');

// ---------------------------------------------------------------------------
// Network catalog — canonical list of all supported external networks
// ---------------------------------------------------------------------------
const NETWORK_CATALOG = {
    // ── EVM ──────────────────────────────────────────────────────────────
    ethereum:  { adapter: 'evm', family: 'evm',     status: 'active'  },
    base:      { adapter: 'evm', family: 'evm',     status: 'active'  },
    arbitrum:  { adapter: 'evm', family: 'evm',     status: 'active'  },
    polygon:   { adapter: 'evm', family: 'evm',     status: 'active'  },
    bsc:       { adapter: 'evm', family: 'evm',     status: 'active'  },
    optimism:  { adapter: 'evm', family: 'evm',     status: 'active'  },

    // ── Non-EVM (adapters to be built) ───────────────────────────────────
    bitcoin:   { adapter: 'bitcoin', family: 'utxo',   status: 'planned' },
    solana:    { adapter: 'solana',  family: 'sealevel',status: 'planned' },
    ton:       { adapter: 'ton',     family: 'ton',     status: 'planned' },
    tron:      { adapter: 'tron',    family: 'tvm',     status: 'planned' },
    cosmos:    { adapter: 'cosmos',  family: 'cosmos',  status: 'planned' },
};

// ---------------------------------------------------------------------------
// SettlementAdapterRegistry
// ---------------------------------------------------------------------------
class SettlementAdapterRegistry {
    constructor() {
        this._adapters = new Map();
        this._initEVMAdapters();
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /**
     * Pre-instantiate all active EVM adapters at startup.
     * This reuses a single provider connection per network.
     */
    _initEVMAdapters() {
        for (const [networkKey, meta] of Object.entries(NETWORK_CATALOG)) {
            if (meta.adapter === 'evm' && meta.status === 'active') {
                try {
                    this._adapters.set(networkKey, new EVMAdapter(networkKey));
                } catch (err) {
                    console.warn(`[SettlementRegistry] Could not init adapter for "${networkKey}": ${err.message}`);
                }
            }
        }
        console.log(`[SettlementRegistry] Initialized ${this._adapters.size} EVM adapters: ${[...this._adapters.keys()].join(', ')}`);
    }

    // -----------------------------------------------------------------------
    // Universal SettlementAdapter Interface
    // -----------------------------------------------------------------------

    /**
     * Get a specific adapter instance by network key.
     *
     * @param {string} network
     * @returns {EVMAdapter}
     */
    adapter(network) {
        if (!this._adapters.has(network)) {
            const meta = NETWORK_CATALOG[network];
            if (!meta) {
                throw new Error(`[SettlementRegistry] Unknown network: "${network}"`);
            }
            if (meta.status === 'planned') {
                throw new Error(`[SettlementRegistry] Adapter for "${network}" is not yet implemented (status: planned)`);
            }
            throw new Error(`[SettlementRegistry] No adapter available for "${network}"`);
        }
        return this._adapters.get(network);
    }

    /**
     * Verify a CROSS_CHAIN_DEPOSIT intent proof against the external network.
     *
     * @param {object} intent   - The parsed CROSS_CHAIN_DEPOSIT intent payload
     * @returns {Promise<SettlementResult>}
     */
    async verifyDeposit(intent) {
        const { external_network, external_tx_hash, external_recipient, asset, amount } = intent;
        const adp = this.adapter(external_network);
        return adp.verifyDeposit({
            txHash:      external_tx_hash,
            expectedTo:  external_recipient,
            asset,
            amount,
        });
    }

    /**
     * Observe any transaction on any supported network.
     *
     * @param {string} network
     * @param {string} txHash
     * @returns {Promise<SettlementEvent>}
     */
    async observe(network, txHash) {
        return this.adapter(network).observe(txHash);
    }

    /**
     * Create a structured withdrawal request from a CROSS_CHAIN_WITHDRAWAL intent.
     *
     * @param {object} intent
     * @returns {SettlementRequest}
     */
    createWithdrawal(intent) {
        const adp = this.adapter(intent.external_network);
        return adp.createWithdrawal({
            sl1Address:        intent.sl1_sender,
            externalRecipient: intent.external_recipient,
            asset:             intent.asset,
            amount:            intent.amount,
            intentId:          intent.id,
        });
    }

    /**
     * Validate an external address for any supported network.
     *
     * @param {string} network
     * @param {string} address
     * @returns {boolean}
     */
    isValidAddress(network, address) {
        try {
            return this.adapter(network).isValidAddress(address);
        } catch {
            return false;
        }
    }

    /**
     * Normalize an external address (e.g. EIP-55 checksum for EVM).
     *
     * @param {string} network
     * @param {string} address
     * @returns {string}
     */
    normalizeAddress(network, address) {
        return this.adapter(network).normalizeAddress(address);
    }

    /**
     * Get the canonical projected deposit address for an sl1 account on a network.
     * This is a deterministic mapping: same sl1 address → same deposit address forever.
     *
     * @param {string} sl1Address
     * @param {string} network
     * @param {string} asset
     * @returns {string}
     */
    getDepositAddress(sl1Address, network, asset) {
        const meta = NETWORK_CATALOG[network];
        if (!meta) throw new Error(`Unknown network: ${network}`);

        if (meta.family === 'evm') {
            return EVMAdapter.projectDepositAddress(sl1Address, asset);
        }

        // For planned adapters, fall back to the hash-stub from server.js
        const { createHash } = require('crypto');
        const hash = createHash('sha256').update(sl1Address + network + asset).digest('hex');
        return `${network.slice(0, 3)}_${hash.substring(0, 20)}`;
    }

    // -----------------------------------------------------------------------
    // Registry Introspection
    // -----------------------------------------------------------------------

    /**
     * Get all supported networks and their status.
     *
     * @returns {object}
     */
    getCatalog() {
        return Object.entries(NETWORK_CATALOG).map(([key, meta]) => ({
            network:    key,
            family:     meta.family,
            status:     meta.status,
            hasAdapter: this._adapters.has(key),
        }));
    }

    /**
     * Live health check of all active adapters.
     *
     * @returns {Promise<object[]>}
     */
    async healthCheck() {
        const results = [];
        for (const [network, adapter] of this._adapters.entries()) {
            if (typeof adapter.getNetworkStatus === 'function') {
                const status = await adapter.getNetworkStatus();
                results.push(status);
            }
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// Singleton export — one registry for the entire node process
// ---------------------------------------------------------------------------
const registry = new SettlementAdapterRegistry();

module.exports = { registry, SettlementAdapterRegistry, NETWORK_CATALOG };
