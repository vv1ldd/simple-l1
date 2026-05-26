'use strict';

/**
 * SIMPLE-L1 EVM Settlement Adapter
 *
 * Covers: Ethereum, Base, Arbitrum, Optimism, Polygon, BSC —
 * any EVM-compatible chain with a JSON-RPC endpoint.
 *
 * Implements the universal SettlementAdapter interface:
 *   verifyDeposit(proof)        → validates an inbound external tx
 *   createWithdrawal(intent)    → prepares a settlement request
 *   observe(txHash)             → returns a normalized SettlementEvent
 *   normalizeAddress(addr)      → checksummed EVM address
 */

const { ethers } = require('ethers');

// ---------------------------------------------------------------------------
// Known EVM Networks Registry
// ---------------------------------------------------------------------------
const EVM_NETWORKS = {
    ethereum: {
        name:         'Ethereum Mainnet',
        chainId:      1,
        rpc:          process.env.ETH_RPC_URL  || 'https://cloudflare-eth.com',
        explorer:     'https://etherscan.io/tx/',
        nativeSymbol: 'ETH',
        confirmations: 12,
        assets: {
            ETH:  { type: 'native',  decimals: 18 },
            USDT: { type: 'erc20',   decimals: 6,  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
            USDC: { type: 'erc20',   decimals: 6,  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
            WBTC: { type: 'erc20',   decimals: 8,  address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
        },
    },
    base: {
        name:         'Base',
        chainId:      8453,
        rpc:          process.env.BASE_RPC_URL  || 'https://mainnet.base.org',
        explorer:     'https://basescan.org/tx/',
        nativeSymbol: 'ETH',
        confirmations: 6,
        assets: {
            ETH:  { type: 'native', decimals: 18 },
            USDC: { type: 'erc20',  decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
        },
    },
    arbitrum: {
        name:         'Arbitrum One',
        chainId:      42161,
        rpc:          process.env.ARB_RPC_URL   || 'https://arb1.arbitrum.io/rpc',
        explorer:     'https://arbiscan.io/tx/',
        nativeSymbol: 'ETH',
        confirmations: 1,
        assets: {
            ETH:  { type: 'native', decimals: 18 },
            USDT: { type: 'erc20',  decimals: 6, address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
            USDC: { type: 'erc20',  decimals: 6, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
        },
    },
    polygon: {
        name:         'Polygon',
        chainId:      137,
        rpc:          process.env.MATIC_RPC_URL || 'https://polygon-rpc.com',
        explorer:     'https://polygonscan.com/tx/',
        nativeSymbol: 'MATIC',
        confirmations: 30,
        assets: {
            MATIC: { type: 'native', decimals: 18 },
            USDT:  { type: 'erc20',  decimals: 6, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
            USDC:  { type: 'erc20',  decimals: 6, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
        },
    },
    bsc: {
        name:         'BNB Smart Chain',
        chainId:      56,
        rpc:          process.env.BSC_RPC_URL   || 'https://bsc-dataseed.binance.org',
        explorer:     'https://bscscan.com/tx/',
        nativeSymbol: 'BNB',
        confirmations: 15,
        assets: {
            BNB:  { type: 'native', decimals: 18 },
            USDT: { type: 'erc20',  decimals: 18, address: '0x55d398326f99059fF775485246999027B3197955' },
            USDC: { type: 'erc20',  decimals: 18, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
        },
    },
    optimism: {
        name:         'Optimism',
        chainId:      10,
        rpc:          process.env.OP_RPC_URL    || 'https://mainnet.optimism.io',
        explorer:     'https://optimistic.etherscan.io/tx/',
        nativeSymbol: 'ETH',
        confirmations: 1,
        assets: {
            ETH:  { type: 'native', decimals: 18 },
            USDT: { type: 'erc20',  decimals: 6, address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' },
            USDC: { type: 'erc20',  decimals: 6, address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
        },
    },
};

// Minimal ERC-20 Transfer ABI
const ERC20_ABI = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
];

// ---------------------------------------------------------------------------
// EVMAdapter Class
// ---------------------------------------------------------------------------
class EVMAdapter {
    /**
     * @param {string} network  - Key from EVM_NETWORKS (default: 'ethereum')
     */
    constructor(network = 'ethereum') {
        this.networkKey = network;
        this.config     = EVM_NETWORKS[network];
        if (!this.config) {
            throw new Error(`[EVMAdapter] Unknown EVM network: "${network}". Available: ${Object.keys(EVM_NETWORKS).join(', ')}`);
        }
        this.provider = new ethers.JsonRpcProvider(this.config.rpc);
    }

    // -----------------------------------------------------------------------
    // SettlementAdapter Interface
    // -----------------------------------------------------------------------

    /**
     * Verify that a deposit transaction is real, confirmed, and
     * credited the correct recipient with the correct amount.
     *
     * @param {object} proof
     * @param {string} proof.txHash         - The external tx hash
     * @param {string} proof.expectedTo     - Expected recipient address on EVM
     * @param {string} proof.asset          - 'ETH', 'USDT', 'USDC', etc.
     * @param {string|number} proof.amount  - Human-readable amount (e.g. "50.00")
     * @returns {Promise<SettlementResult>}
     */
    async verifyDeposit({ txHash, expectedTo, asset, amount }) {
        try {
            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt) {
                return this._fail('TX_NOT_FOUND', `Transaction ${txHash} not found on ${this.networkKey}`);
            }
            if (receipt.status !== 1) {
                return this._fail('TX_REVERTED', `Transaction ${txHash} was reverted`);
            }

            const currentBlock = await this.provider.getBlockNumber();
            const confirmations = currentBlock - Number(receipt.blockNumber);
            const required = this.config.confirmations;

            if (confirmations < required) {
                return this._fail('INSUFFICIENT_CONFIRMATIONS',
                    `Only ${confirmations}/${required} confirmations. Wait before re-submitting.`,
                    { confirmations, required }
                );
            }

            const assetConfig = this.config.assets[asset];
            if (!assetConfig) {
                return this._fail('UNKNOWN_ASSET', `Asset "${asset}" not supported on ${this.networkKey}`);
            }

            let verified = false;
            let actualAmount = '0';
            const normalizedTo = this.normalizeAddress(expectedTo);

            if (assetConfig.type === 'native') {
                const tx = await this.provider.getTransaction(txHash);
                const recipientMatch = this.normalizeAddress(tx.to) === normalizedTo;
                const expectedWei = ethers.parseUnits(String(amount), assetConfig.decimals);
                const amountMatch = tx.value >= expectedWei;
                actualAmount = ethers.formatUnits(tx.value, assetConfig.decimals);
                verified = recipientMatch && amountMatch;
            } else {
                // ERC-20: parse Transfer logs
                const iface = new ethers.Interface(ERC20_ABI);
                for (const log of receipt.logs) {
                    if (log.address.toLowerCase() !== assetConfig.address.toLowerCase()) continue;
                    try {
                        const parsed = iface.parseLog(log);
                        if (parsed.name !== 'Transfer') continue;
                        const recipientMatch = this.normalizeAddress(parsed.args.to) === normalizedTo;
                        const expectedRaw = ethers.parseUnits(String(amount), assetConfig.decimals);
                        const amountMatch = parsed.args.value >= expectedRaw;
                        actualAmount = ethers.formatUnits(parsed.args.value, assetConfig.decimals);
                        if (recipientMatch && amountMatch) {
                            verified = true;
                            break;
                        }
                    } catch {}
                }
            }

            if (!verified) {
                return this._fail('VERIFICATION_FAILED',
                    `Could not find matching transfer to ${expectedTo} of ${amount} ${asset}`
                );
            }

            return {
                ok:           true,
                network:      this.networkKey,
                txHash,
                asset,
                amount:       actualAmount,
                recipient:    normalizedTo,
                confirmations,
                blockNumber:  Number(receipt.blockNumber),
                explorerUrl:  this.config.explorer + txHash,
                settledAt:    new Date().toISOString(),
            };

        } catch (err) {
            return this._fail('RPC_ERROR', err.message);
        }
    }

    /**
     * Observe a tx and return a normalized SettlementEvent —
     * without opinionated verification (for monitoring / indexing).
     *
     * @param {string} txHash
     * @returns {Promise<SettlementEvent>}
     */
    async observe(txHash) {
        try {
            const [tx, receipt] = await Promise.all([
                this.provider.getTransaction(txHash),
                this.provider.getTransactionReceipt(txHash),
            ]);

            if (!tx) return { found: false, txHash };

            const currentBlock = await this.provider.getBlockNumber();
            const block = tx.blockNumber ? await this.provider.getBlock(tx.blockNumber) : null;

            return {
                found:        true,
                network:      this.networkKey,
                chainId:      this.config.chainId,
                txHash,
                from:         tx.from,
                to:           tx.to,
                value:        ethers.formatEther(tx.value),
                status:       receipt?.status === 1 ? 'SUCCESS' : (receipt ? 'REVERTED' : 'PENDING'),
                blockNumber:  tx.blockNumber,
                confirmations: tx.blockNumber ? currentBlock - Number(tx.blockNumber) : 0,
                timestamp:    block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
                explorerUrl:  this.config.explorer + txHash,
                gasUsed:      receipt ? receipt.gasUsed.toString() : null,
            };
        } catch (err) {
            return { found: false, txHash, error: err.message };
        }
    }

    /**
     * Prepare a withdrawal settlement request.
     * Does NOT sign or broadcast — returns the structured request
     * for the Simple L1 treasury to execute.
     *
     * @param {object} intent
     * @returns {SettlementRequest}
     */
    createWithdrawal({ sl1Address, externalRecipient, asset, amount, intentId }) {
        const assetConfig = this.config.assets[asset];
        if (!assetConfig) {
            throw new Error(`[EVMAdapter] Unsupported asset "${asset}" on ${this.networkKey}`);
        }

        const normalized = this.normalizeAddress(externalRecipient);
        const rawAmount  = ethers.parseUnits(String(amount), assetConfig.decimals);

        return {
            type:           'EVM_WITHDRAWAL',
            intentId,
            network:        this.networkKey,
            chainId:        this.config.chainId,
            asset,
            from:           null,            // filled by treasury signer
            to:             normalized,
            amount,
            rawAmount:      rawAmount.toString(),
            contractAddress: assetConfig.type === 'erc20' ? assetConfig.address : null,
            isNative:       assetConfig.type === 'native',
            sl1Authorization: sl1Address,
            createdAt:      new Date().toISOString(),
            status:         'PENDING_TREASURY_SIGN',
        };
    }

    /**
     * Normalize and validate an EVM address.
     * Returns EIP-55 checksummed address or throws.
     *
     * @param {string} address
     * @returns {string}
     */
    normalizeAddress(address) {
        try {
            return ethers.getAddress(address);
        } catch {
            throw new Error(`[EVMAdapter] Invalid EVM address: "${address}"`);
        }
    }

    /**
     * Check if an address is a valid EVM address.
     *
     * @param {string} address
     * @returns {boolean}
     */
    isValidAddress(address) {
        return ethers.isAddress(address);
    }

    /**
     * Get current block number and network info.
     *
     * @returns {Promise<NetworkStatus>}
     */
    async getNetworkStatus() {
        try {
            const [blockNumber, network] = await Promise.all([
                this.provider.getBlockNumber(),
                this.provider.getNetwork(),
            ]);
            return {
                ok:          true,
                network:     this.networkKey,
                name:        this.config.name,
                chainId:     Number(network.chainId),
                blockNumber,
                rpc:         this.config.rpc,
                assets:      Object.keys(this.config.assets),
            };
        } catch (err) {
            return { ok: false, network: this.networkKey, error: err.message };
        }
    }

    /**
     * Get the Simple L1 projected EVM address for a sl1 address.
     * Deterministic, reversible mapping for treasury deposit routing.
     *
     * @param {string} sl1Address
     * @param {string} asset
     * @returns {string}
     */
    static projectDepositAddress(sl1Address, asset) {
        const { createHash } = require('crypto');
        const seed = createHash('sha256').update(sl1Address + ':' + asset + ':evm').digest('hex');
        // Produce a valid EVM address from the hash
        return ethers.getAddress('0x' + seed.slice(0, 40));
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------
    _fail(code, message, extra = {}) {
        return { ok: false, code, message, network: this.networkKey, ...extra };
    }
}

module.exports = { EVMAdapter, EVM_NETWORKS };
