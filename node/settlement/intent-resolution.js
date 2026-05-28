'use strict';

/**
 * SIMPLE-L1 Intent Resolution Engine
 *
 * The constitutional bridge between raw external settlement evidence
 * and accepted Simple L1 intents.
 *
 * Core principle:
 *   external tx  ≠  fulfilled intent
 *   verifyDeposit() + resolveIntent() = constitutional fulfillment
 *
 * Flow:
 *   1. User submits CROSS_CHAIN_DEPOSIT_INTENT  →  intent is registered (PENDING)
 *   2. External settlement occurs on EVM/BTC/TON
 *   3. Node calls verifyDeposit() via registry   →  cryptographic proof
 *   4. resolveIntent(intentId, proof)            →  CROSS_CHAIN_DEPOSIT_FULFILLED
 *   5. Ledger state mutates ONLY at step 4
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Intent States — the lifecycle of a constitutional intent
// ---------------------------------------------------------------------------
const INTENT_STATE = {
    PENDING:          'PENDING',           // Created, waiting for external settlement
    OBSERVING:        'OBSERVING',         // Settlement seen, awaiting confirmations
    VERIFYING:        'VERIFYING',         // Confirmation threshold reached, running proof
    FULFILLED:        'FULFILLED',         // Cryptographically verified, ledger mutated
    REJECTED:         'REJECTED',          // Proof failed or expired
    EXPIRED:          'EXPIRED',           // TTL exceeded without fulfillment
};

// Intent TTL: 24 hours in milliseconds
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// IntentResolutionEngine
// ---------------------------------------------------------------------------
class IntentResolutionEngine {
    /**
     * @param {object} ledger  - Reference to the live ledger object
     * @param {object} eventBus - Reference to the SettlementEventBus instance
     */
    constructor(ledger, eventBus = null) {
        this.ledger   = ledger;
        this.eventBus = eventBus;

        // In-memory index for fast lookup
        // In production: persist to ledger.intent_registry
        if (!this.ledger.intent_registry) {
            this.ledger.intent_registry = {};
        }
    }

    // -----------------------------------------------------------------------
    // Intent Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Register a new cross-chain deposit intent.
     * Returns a deterministic intent_id and deposit_address.
     *
     * @param {object} params
     * @param {string} params.sl1_address     - The SL1 account expecting the deposit
     * @param {string} params.pubkey          - The account's registered public key
     * @param {string} params.network         - Target external network (e.g. 'ethereum')
     * @param {string} params.asset           - Asset symbol (e.g. 'USDC')
     * @param {string|number} params.amount   - Expected amount (optional, for validation)
     * @returns {IntentRecord}
     */
    createDepositIntent({ sl1_address, pubkey, network, asset, amount = null }) {
        // Deterministic intent_id: H(sl1_address + pubkey + network + asset + timestamp_bucket)
        // timestamp_bucket = floor(Date.now() / 3600000) — 1-hour buckets, prevents replay
        const bucket = Math.floor(Date.now() / 3600000).toString();
        const intentSeed = `${sl1_address}:${pubkey}:${network}:${asset}:${bucket}`;
        const intent_id = crypto.createHash('sha256').update(intentSeed).digest('hex').slice(0, 32);

        // Idempotent — return existing intent if already created in this hour
        if (this.ledger.intent_registry[intent_id]) {
            return this.ledger.intent_registry[intent_id];
        }

        // Deterministic deposit address: H(intent_id + pubkey + network + asset)
        const depositSeed = `${intent_id}:${pubkey}:${network}:${asset}`;
        const depositHash = crypto.createHash('sha256').update(depositSeed).digest('hex');

        // Format deposit address according to network family
        const deposit_address = this._formatDepositAddress(network, depositHash);

        const intent = {
            intent_id,
            type:            'CROSS_CHAIN_DEPOSIT',
            state:           INTENT_STATE.PENDING,
            sl1_address,
            pubkey,
            network,
            asset,
            expected_amount: amount,
            deposit_address,
            created_at:      new Date().toISOString(),
            expires_at:      new Date(Date.now() + INTENT_TTL_MS).toISOString(),
            fulfillment:     null,    // Filled when FULFILLED
            rejection:       null,    // Filled when REJECTED
            observations:    [],      // Timeline of settlement observations
        };

        this.ledger.intent_registry[intent_id] = intent;
        this._emit('INTENT_CREATED', intent);

        return intent;
    }

    /**
     * Register a cross-chain withdrawal intent.
     *
     * @param {object} params
     * @returns {IntentRecord}
     */
    createWithdrawalIntent({ sl1_address, pubkey, network, asset, amount, external_recipient }) {
        const nonce = (this.ledger.accounts[sl1_address]?.nonce || 0).toString();
        const intentSeed = `withdraw:${sl1_address}:${pubkey}:${network}:${asset}:${amount}:${nonce}`;
        const intent_id = crypto.createHash('sha256').update(intentSeed).digest('hex').slice(0, 32);

        if (this.ledger.intent_registry[intent_id]) {
            return this.ledger.intent_registry[intent_id];
        }

        const intent = {
            intent_id,
            type:               'CROSS_CHAIN_WITHDRAWAL',
            state:              INTENT_STATE.PENDING,
            sl1_address,
            pubkey,
            network,
            asset,
            amount,
            external_recipient,
            created_at:         new Date().toISOString(),
            expires_at:         new Date(Date.now() + INTENT_TTL_MS).toISOString(),
            fulfillment:        null,
            rejection:          null,
            observations:       [],
        };

        this.ledger.intent_registry[intent_id] = intent;
        this._emit('INTENT_CREATED', intent);

        return intent;
    }

    /**
     * Record an observation of an external tx for an intent (without committing).
     * Transitions intent to OBSERVING state.
     *
     * @param {string} intent_id
     * @param {object} settlementEvent  - Raw event from adapter.observe()
     * @returns {IntentRecord}
     */
    observe(intent_id, settlementEvent) {
        const intent = this._getIntent(intent_id);

        intent.observations.push({
            observed_at:   new Date().toISOString(),
            tx_hash:       settlementEvent.txHash || settlementEvent.tx_hash,
            confirmations: settlementEvent.confirmations || 0,
            status:        settlementEvent.status,
        });

        if (intent.state === INTENT_STATE.PENDING) {
            intent.state = INTENT_STATE.OBSERVING;
        }

        this._emit('INTENT_OBSERVED', intent, { settlementEvent });
        return intent;
    }

    /**
     * Fulfill an intent — the constitutional commitment.
     * Called after verifyDeposit() returns ok: true.
     *
     * Deprecated: fulfillment no longer mutates economic state directly.
     * Settlement must be applied through the lineage-complete runtime path.
     *
     * @param {string} intent_id
     * @param {object} proof          - Result from registry.verifyDeposit()
     * @returns {IntentRecord}
     */
    fulfill(intent_id, proof) {
        const intent = this._getIntent(intent_id);

        if (intent.state === INTENT_STATE.FULFILLED) {
            throw new Error(`Intent ${intent_id} already fulfilled — replay protection active`);
        }
        if (intent.state === INTENT_STATE.REJECTED) {
            throw new Error(`Intent ${intent_id} was rejected and cannot be fulfilled`);
        }
        if (new Date() > new Date(intent.expires_at)) {
            intent.state = INTENT_STATE.EXPIRED;
            throw new Error(`Intent ${intent_id} has expired`);
        }

        intent.state = INTENT_STATE.FULFILLED;
        intent.fulfillment = {
            fulfilled_at:   new Date().toISOString(),
            tx_hash:        proof.txHash,
            network:        proof.network,
            amount:         proof.amount,
            confirmations:  proof.confirmations,
            block_number:   proof.blockNumber,
            explorer_url:   proof.explorerUrl,
            proof_summary:  this._digestProof(proof),
        };

        this._emit('INTENT_FULFILLED', intent, { proof });
        return intent;
    }

    /**
     * Reject an intent — constitutional rejection with reason.
     *
     * @param {string} intent_id
     * @param {string} reason
     * @param {object} evidence
     * @returns {IntentRecord}
     */
    reject(intent_id, reason, evidence = {}) {
        const intent = this._getIntent(intent_id);

        if ([INTENT_STATE.FULFILLED, INTENT_STATE.REJECTED].includes(intent.state)) {
            throw new Error(`Intent ${intent_id} is already terminal (${intent.state})`);
        }

        intent.state     = INTENT_STATE.REJECTED;
        intent.rejection = { rejected_at: new Date().toISOString(), reason, evidence };

        this._emit('INTENT_REJECTED', intent, { reason, evidence });
        return intent;
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    getIntent(intent_id) {
        return this.ledger.intent_registry[intent_id] || null;
    }

    getIntentsByAddress(sl1_address) {
        return Object.values(this.ledger.intent_registry)
            .filter(i => i.sl1_address === sl1_address);
    }

    getPendingIntents() {
        return Object.values(this.ledger.intent_registry)
            .filter(i => [INTENT_STATE.PENDING, INTENT_STATE.OBSERVING, INTENT_STATE.VERIFYING].includes(i.state));
    }

    expireStale() {
        const now = new Date();
        let expired = 0;
        for (const intent of Object.values(this.ledger.intent_registry)) {
            if ([INTENT_STATE.PENDING, INTENT_STATE.OBSERVING].includes(intent.state)) {
                if (now > new Date(intent.expires_at)) {
                    intent.state = INTENT_STATE.EXPIRED;
                    this._emit('INTENT_EXPIRED', intent);
                    expired++;
                }
            }
        }
        return expired;
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _getIntent(intent_id) {
        const intent = this.ledger.intent_registry[intent_id];
        if (!intent) throw new Error(`Intent not found: ${intent_id}`);
        return intent;
    }

    _formatDepositAddress(network, hash) {
        // EVM family: 0x + first 40 hex chars (valid EVM address format)
        const evmNetworks = ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism'];
        if (evmNetworks.includes(network)) {
            // Use ethers for proper EIP-55 checksum
            try {
                const { ethers } = require('ethers');
                return ethers.getAddress('0x' + hash.slice(0, 40));
            } catch {
                return '0x' + hash.slice(0, 40);
            }
        }
        if (network === 'bitcoin')  return `bc1q${hash.slice(0, 38)}`;
        if (network === 'solana')   return hash.slice(0, 44).toUpperCase();
        if (network === 'ton')      return `EQ${hash.slice(0, 46)}`;
        if (network === 'tron')     return `T${hash.slice(0, 33)}`;
        return `${network.slice(0, 3)}_${hash.slice(0, 30)}`;
    }

    _digestProof(proof) {
        // A compact, deterministic fingerprint of the verification proof
        const raw = JSON.stringify({
            txHash:      proof.txHash,
            network:     proof.network,
            amount:      proof.amount,
            blockNumber: proof.blockNumber,
        });
        return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    }

    _emit(type, intent, extra = {}) {
        if (this.eventBus) {
            this.eventBus.emit({ type, intent_id: intent.intent_id, intent_state: intent.state, ...extra });
        }
    }
}

module.exports = { IntentResolutionEngine, INTENT_STATE };
