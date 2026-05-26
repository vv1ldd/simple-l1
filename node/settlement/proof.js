'use strict';

/**
 * SIMPLE-L1 Settlement Proof Objects
 *
 * Canonical, portable, deterministically-serializable proof structures.
 * A proof is the cryptographic evidence that external reality satisfies an intent.
 *
 * Proof types:
 *   EVM_TX_PROOF     — Ethereum-family transaction proof
 *   UTXO_PROOF       — Bitcoin/UTXO chain proof  (future)
 *   ACCOUNT_PROOF    — Solana/TON account-model  (future)
 *   ORACLE_PROOF     — Multi-source oracle aggregation
 *   QUORUM_PROOF     — Validator attestation bundle
 *
 * A SettlementProof is:
 *   1. Deterministically serializable (canonical JSON)
 *   2. Self-describing (contains all verification metadata)
 *   3. Portable (verifiable without the original node context)
 *   4. Hashable (produces a stable proof_fingerprint)
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Proof type constants
// ---------------------------------------------------------------------------
const PROOF_TYPES = Object.freeze({
    EVM_TX:   'EVM_TX_PROOF',
    UTXO:     'UTXO_PROOF',
    ACCOUNT:  'ACCOUNT_PROOF',
    ORACLE:   'ORACLE_PROOF',
    QUORUM:   'QUORUM_PROOF',
});

// ---------------------------------------------------------------------------
// SettlementProofFactory
// ---------------------------------------------------------------------------
class SettlementProofFactory {
    /**
     * Build a canonical EVM transaction proof from a raw adapter verification result.
     *
     * @param {object} verificationResult  - Result from EVMAdapter.verifyDeposit()
     * @param {string} intent_id           - Related intent
     * @returns {SettlementProof}
     */
    static fromEVMVerification(verificationResult, intent_id) {
        const {
            network, txHash, asset, amount,
            recipient, confirmations, blockNumber, explorerUrl, settledAt,
        } = verificationResult;

        const proof = {
            proof_type:    PROOF_TYPES.EVM_TX,
            proof_version: '1.0',
            intent_id,
            network,

            // Settlement evidence
            evidence: {
                tx_hash:      txHash,
                block_number: blockNumber,
                confirmations,
                explorer_url: explorerUrl,
                asset,
                amount:       String(amount),
                recipient,
                settled_at:   settledAt,
            },

            // Verification metadata
            verification: {
                method:         'EVM_RPC_RECEIPT',
                confirmed_at:   new Date().toISOString(),
                threshold_met:  true,
                proof_type:     PROOF_TYPES.EVM_TX,
            },

            // Canonical fingerprint — deterministic hash of the proof
            proof_fingerprint: null,   // Filled below
            created_at: new Date().toISOString(),
        };

        proof.proof_fingerprint = SettlementProofFactory.fingerprint(proof);
        return proof;
    }

    /**
     * Build a quorum proof from a set of validator attestations.
     *
     * @param {object[]} attestations   - Array of ValidatorAttestation objects
     * @param {string}   intent_id
     * @returns {SettlementProof}
     */
    static fromQuorum(attestations, intent_id) {
        const proof = {
            proof_type:    PROOF_TYPES.QUORUM,
            proof_version: '1.0',
            intent_id,

            evidence: {
                attestation_count:  attestations.length,
                validator_ids:      attestations.map(a => a.validator_id),
                quorum_threshold:   Math.ceil(attestations.length * (2/3)) + 1,
                all_agree:          attestations.every(a => a.decision === 'ACCEPT'),
            },

            verification: {
                method:        'VALIDATOR_QUORUM',
                confirmed_at:  new Date().toISOString(),
                threshold_met: attestations.length >= 1,
                proof_type:    PROOF_TYPES.QUORUM,
            },

            attestations,
            proof_fingerprint: null,
            created_at: new Date().toISOString(),
        };

        proof.proof_fingerprint = SettlementProofFactory.fingerprint(proof);
        return proof;
    }

    /**
     * Compute a deterministic fingerprint for any proof object.
     * Uses canonical JSON serialization (sorted keys).
     *
     * @param {object} proof
     * @returns {string}  - 32-char hex fingerprint
     */
    static fingerprint(proof) {
        // Exclude the fingerprint field itself from hashing
        const { proof_fingerprint, ...rest } = proof;
        const canonical = JSON.stringify(rest, Object.keys(rest).sort());
        return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
    }

    /**
     * Verify a proof's fingerprint hasn't been tampered with.
     *
     * @param {object} proof
     * @returns {boolean}
     */
    static verify(proof) {
        const expected = SettlementProofFactory.fingerprint(proof);
        return proof.proof_fingerprint === expected;
    }

    /**
     * Serialize a proof to canonical JSON string (for storage / broadcast).
     *
     * @param {object} proof
     * @returns {string}
     */
    static serialize(proof) {
        return JSON.stringify(proof, null, 0);
    }

    /**
     * Deserialize and validate a proof from canonical JSON.
     *
     * @param {string} json
     * @returns {{ ok: boolean, proof: object, error?: string }}
     */
    static deserialize(json) {
        try {
            const proof = JSON.parse(json);
            if (!SettlementProofFactory.verify(proof)) {
                return { ok: false, error: 'Proof fingerprint mismatch — proof may have been tampered' };
            }
            return { ok: true, proof };
        } catch (err) {
            return { ok: false, error: `Invalid proof JSON: ${err.message}` };
        }
    }
}

module.exports = { SettlementProofFactory, PROOF_TYPES };
