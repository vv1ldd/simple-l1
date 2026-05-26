'use strict';

/**
 * SIMPLE-L1 Multi-Constitution Federation Registry
 *
 * Different sovereign subnetworks with different constitutions
 * coordinated under a shared settlement, attestation, and receipt standard.
 *
 * Architecture:
 *   Federation Root
 *       ├── Subnet "wildflow-mainnet"   → constitution A, validators A, adapters [EVM, BTC]
 *       ├── Subnet "wildflow-commerce"  → constitution B, validators B, adapters [TON, EVM]
 *       └── Subnet "wildflow-treasury"  → constitution C, validators C, adapters [BTC, EVM]
 *
 * Shared across all subnets:
 *   - Receipt format (v1.0)
 *   - Attestation standard (P-256, 2F+1)
 *   - Settlement event protocol
 *   - Intent DSL operators
 *
 * Divergent per subnet:
 *   - Constitutional rules (policy DSL)
 *   - Validator sets
 *   - Quorum thresholds
 *   - Whitelisted networks / assets
 *   - Epoch history
 *
 * Federation Root Hash:
 *   H(subnet_a_constitution_root | subnet_b_constitution_root | ... )
 *   Allows cross-subnet verification without full state knowledge.
 *
 * Cross-subnet intents:
 *   An intent can specify source_subnet + target_subnet.
 *   The federation arbitrates legitimacy at both ends.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Subnet status
// ---------------------------------------------------------------------------
const SUBNET_STATUS = Object.freeze({
    ACTIVE:    'ACTIVE',
    PAUSED:    'PAUSED',
    SUSPENDED: 'SUSPENDED',
    PROPOSED:  'PROPOSED',
});

// ---------------------------------------------------------------------------
// FederationRegistry
// ---------------------------------------------------------------------------
class FederationRegistry {
    /**
     * @param {object} ledger    - Live ledger (federation state stored in ledger.federation)
     * @param {Function} saveLedger
     */
    constructor(ledger, saveLedger) {
        this.ledger      = ledger;
        this.saveLedger  = saveLedger;

        if (!this.ledger.federation) {
            this.ledger.federation = {
                subnets:       {},          // subnet_id → SubnetRecord
                federation_root: null,      // H(all active subnet constitution roots)
                created_at:    new Date().toISOString(),
            };
        }

        // Register this node as the primary subnet if none exist
        if (Object.keys(this.ledger.federation.subnets).length === 0) {
            this._registerGenesis();
        }

        this._recomputeFederationRoot();

        console.log(
            `[FEDERATION] Registry active. Subnets: ${Object.keys(this.ledger.federation.subnets).length}. ` +
            `Federation root: ${this.ledger.federation.federation_root?.slice(0, 16)}…`
        );
    }

    // -----------------------------------------------------------------------
    // Subnet management
    // -----------------------------------------------------------------------

    /**
     * Register a new sovereign subnetwork in the federation.
     *
     * @param {object} params
     * @param {string} params.subnet_id          - Unique identifier
     * @param {string} params.name               - Human-readable name
     * @param {string} params.description        - Purpose / scope
     * @param {string} params.constitution_root  - Initial constitution root hash
     * @param {string} params.constitution_version
     * @param {object} params.validator_set      - Array of validator public keys
     * @param {object} params.quorum             - { numerator, denominator }
     * @param {string[]} params.settlement_networks - Allowed external networks
     * @param {string[]} params.assets           - Allowed assets
     * @param {object} params.metadata           - Arbitrary metadata
     * @returns {SubnetRecord}
     */
    registerSubnet({
        subnet_id, name, description,
        constitution_root, constitution_version,
        validator_set, quorum,
        settlement_networks, assets,
        metadata = {},
    }) {
        if (this.ledger.federation.subnets[subnet_id]) {
            throw new Error(`Subnet already registered: ${subnet_id}`);
        }

        const subnet = {
            subnet_id,
            name,
            description,
            status: SUBNET_STATUS.ACTIVE,

            // Constitutional identity
            constitution_root,
            constitution_version: constitution_version || '1.0',
            constitutional_epoch: 0,

            // Governance
            validator_set: validator_set || [],
            quorum:        quorum || { numerator: 2, denominator: 3 },

            // Capabilities
            settlement_networks: settlement_networks || [],
            assets:              assets || [],
            metadata,

            // Federation membership
            registered_at:    new Date().toISOString(),
            last_updated_at:  new Date().toISOString(),
            epoch_history:    [{
                epoch:            0,
                constitution_root,
                recorded_at:      new Date().toISOString(),
            }],
        };

        this.ledger.federation.subnets[subnet_id] = subnet;
        this._recomputeFederationRoot();
        this.saveLedger();

        console.log(`[FEDERATION] 🌐 Subnet registered: ${subnet_id} ("${name}")`);
        return subnet;
    }

    /**
     * Update a subnet's constitution root (called when its governance enacts an amendment).
     *
     * @param {string} subnet_id
     * @param {string} new_constitution_root
     * @param {number} new_epoch
     * @param {string} proposal_id
     * @returns {SubnetRecord}
     */
    updateSubnetConstitution(subnet_id, new_constitution_root, new_epoch, proposal_id) {
        const subnet = this._getSubnet(subnet_id);

        subnet.constitution_root     = new_constitution_root;
        subnet.constitutional_epoch  = new_epoch;
        subnet.last_updated_at       = new Date().toISOString();
        subnet.epoch_history.push({
            epoch:            new_epoch,
            constitution_root: new_constitution_root,
            proposal_id,
            recorded_at:      new Date().toISOString(),
        });

        this._recomputeFederationRoot();
        this.saveLedger();

        console.log(`[FEDERATION] 📝 Subnet ${subnet_id} constitutional epoch updated: ${new_epoch} (root: ${new_constitution_root.slice(0, 12)}…)`);
        return subnet;
    }

    /**
     * Pause or suspend a subnet.
     *
     * @param {string} subnet_id
     * @param {string} status    - PAUSED | SUSPENDED
     * @param {string} reason
     */
    setSubnetStatus(subnet_id, status, reason = '') {
        const subnet = this._getSubnet(subnet_id);
        if (!SUBNET_STATUS[status]) throw new Error(`Invalid status: ${status}`);
        subnet.status         = status;
        subnet.status_reason  = reason;
        subnet.last_updated_at = new Date().toISOString();
        this._recomputeFederationRoot();
        this.saveLedger();
        return subnet;
    }

    // -----------------------------------------------------------------------
    // Cross-subnet verification
    // -----------------------------------------------------------------------

    /**
     * Verify a receipt is valid under its claimed subnet and constitutional epoch.
     *
     * @param {object} receipt
     * @param {string} subnet_id
     * @returns {{ valid: boolean, reason?: string }}
     */
    verifyReceiptSubnet(receipt, subnet_id) {
        const subnet = this.ledger.federation.subnets[subnet_id];
        if (!subnet) return { valid: false, reason: `Subnet not found: ${subnet_id}` };

        const { constitutional_epoch, constitution_root } = receipt;
        if (constitutional_epoch === undefined) {
            return { valid: false, reason: 'Receipt missing constitutional context' };
        }

        // Find the historical epoch in subnet's history
        const epochRecord = subnet.epoch_history.find(e => e.epoch === constitutional_epoch);
        if (!epochRecord) {
            return { valid: false, reason: `No epoch ${constitutional_epoch} record for subnet ${subnet_id}` };
        }

        const rootMatch = epochRecord.constitution_root === constitution_root;
        return {
            valid:         rootMatch,
            subnet_id,
            epoch:         constitutional_epoch,
            expected_root: epochRecord.constitution_root,
            receipt_root:  constitution_root,
            reason:        rootMatch ? null : 'Constitution root mismatch for this epoch',
        };
    }

    /**
     * Check if a specific settlement network is allowed by a subnet's constitution.
     *
     * @param {string} subnet_id
     * @param {string} network
     * @returns {boolean}
     */
    isNetworkAllowed(subnet_id, network) {
        const subnet = this.ledger.federation.subnets[subnet_id];
        return subnet?.settlement_networks.includes(network) ?? false;
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    getSubnet(subnet_id) {
        return this.ledger.federation.subnets[subnet_id] || null;
    }

    getAllSubnets() {
        return Object.values(this.ledger.federation.subnets);
    }

    getActiveSubnets() {
        return this.getAllSubnets().filter(s => s.status === SUBNET_STATUS.ACTIVE);
    }

    getFederationRoot() {
        return this.ledger.federation.federation_root;
    }

    getFederationStats() {
        const subnets = this.getAllSubnets();
        return {
            federation_root:   this.ledger.federation.federation_root,
            total_subnets:     subnets.length,
            active_subnets:    subnets.filter(s => s.status === SUBNET_STATUS.ACTIVE).length,
            subnets: subnets.map(s => ({
                subnet_id:            s.subnet_id,
                name:                 s.name,
                status:               s.status,
                constitutional_epoch: s.constitutional_epoch,
                constitution_root:    s.constitution_root?.slice(0, 16) + '…',
                networks:             s.settlement_networks,
                assets:               s.assets,
            })),
        };
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _registerGenesis() {
        // Primary subnet represents this node itself
        this.ledger.federation.subnets['simple-l1-primary'] = {
            subnet_id:            'simple-l1-primary',
            name:                 'Simple L1 Primary',
            description:          'Genesis subnet — the originating constitutional network',
            status:               SUBNET_STATUS.ACTIVE,
            constitution_root:    null,   // Filled by governance engine after init
            constitution_version: '1.0',
            constitutional_epoch: 0,
            validator_set:        [],
            quorum:               { numerator: 2, denominator: 3 },
            settlement_networks:  ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism', 'bitcoin', 'ton', 'solana'],
            assets:               ['ETH', 'USDT', 'USDC', 'WBTC', 'BTC', 'MATIC', 'BNB', 'TON', 'SOL'],
            metadata:             { genesis: true },
            registered_at:        new Date().toISOString(),
            last_updated_at:      new Date().toISOString(),
            epoch_history:        [],
        };
    }

    _recomputeFederationRoot() {
        // Federation root = H(sorted active subnet constitution roots)
        const activeRoots = this.getActiveSubnets()
            .filter(s => s.constitution_root)
            .sort((a, b) => a.subnet_id.localeCompare(b.subnet_id))
            .map(s => `${s.subnet_id}:${s.constitution_root}:${s.constitutional_epoch}`)
            .join('|');

        this.ledger.federation.federation_root = activeRoots
            ? crypto.createHash('sha256').update(activeRoots).digest('hex')
            : 'genesis';
    }

    _getSubnet(subnet_id) {
        const subnet = this.ledger.federation.subnets[subnet_id];
        if (!subnet) throw new Error(`Subnet not found: ${subnet_id}`);
        return subnet;
    }
}

module.exports = { FederationRegistry, SUBNET_STATUS };
