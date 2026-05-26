'use strict';

/**
 * SIMPLE-L1 Validator Attestation Engine
 *
 * Transforms verifyDeposit() from a centralized RPC call
 * into a constitutional quorum decision.
 *
 * Architecture:
 *   Each validator independently observes the external settlement.
 *   Attestations are collected and a quorum threshold (2F+1) determines legitimacy.
 *   No single validator can forge or block a settlement.
 *
 * Attestation lifecycle:
 *   1. Node requests attestation from validator set
 *   2. Each validator independently verifies the settlement
 *   3. Validator signs its decision with its private key (P-256)
 *   4. Quorum engine collects signatures
 *   5. At 2F+1 threshold: ATTESTED state reached
 *   6. Quorum proof is sealed and attached to intent
 *
 * Current mode: LOCAL (single-node, self-attesting)
 * Production mode: DISTRIBUTED (validator set via P2P)
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Validator registry (in-memory for now — in production: on-chain or DHT)
// ---------------------------------------------------------------------------

/**
 * A validator entry in the local registry.
 * In production each validator runs independently and signs with its own key.
 */
class LocalValidator {
    constructor(id, weight = 1) {
        this.validator_id = id;
        this.weight       = weight;
        // Generate ephemeral P-256 keypair for this validator instance
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1',    // NIST P-256 — same as Simple L1 WebAuthn
            publicKeyEncoding:  { type: 'spki',  format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der' },
        });
        this._privateKey = privateKey;
        this.public_key  = publicKey.toString('hex');
    }

    /**
     * Independently evaluate a settlement and produce a signed attestation.
     *
     * @param {string} intent_id
     * @param {object} proof           - SettlementProof object
     * @param {object} [context]       - Optional additional context
     * @returns {ValidatorAttestation}
     */
    attest(intent_id, proof, context = {}) {
        // Evaluation logic — in production: validator independently calls RPC
        const decision = this._evaluate(proof, context);

        // Canonical message: what the validator is signing
        const message = JSON.stringify({
            intent_id,
            proof_fingerprint: proof.proof_fingerprint,
            decision,
            validator_id: this.validator_id,
            attested_at:  new Date().toISOString(),
        });

        // P-256 ECDSA signature over the canonical message
        const signer = crypto.createSign('SHA256');
        signer.update(message);
        const signature = signer.sign({
            key:    crypto.createPrivateKey({ key: this._privateKey, format: 'der', type: 'pkcs8' }),
            format: 'der',
        }).toString('hex');

        return {
            validator_id:      this.validator_id,
            validator_pubkey:  this.public_key,
            weight:            this.weight,
            intent_id,
            proof_fingerprint: proof.proof_fingerprint,
            decision,           // 'ACCEPT' | 'REJECT'
            rejection_reason:  decision === 'REJECT' ? (context.reason || 'Evaluation failed') : null,
            message_hash:      crypto.createHash('sha256').update(message).digest('hex').slice(0, 16),
            signature,
            attested_at:       new Date().toISOString(),
        };
    }

    /**
     * Verify another validator's attestation signature.
     *
     * @param {object} attestation
     * @returns {boolean}
     */
    static verifySignature(attestation) {
        try {
            const { intent_id, proof_fingerprint, decision, validator_id, attested_at, signature, validator_pubkey } = attestation;
            const message = JSON.stringify({ intent_id, proof_fingerprint, decision, validator_id, attested_at });

            const verifier = crypto.createVerify('SHA256');
            verifier.update(message);
            return verifier.verify(
                crypto.createPublicKey({ key: Buffer.from(validator_pubkey, 'hex'), format: 'der', type: 'spki' }),
                Buffer.from(signature, 'hex')
            );
        } catch {
            return false;
        }
    }

    // -----------------------------------------------------------------------
    // Private — evaluation heuristics
    // -----------------------------------------------------------------------
    _evaluate(proof, context) {
        if (!proof) return 'REJECT';
        if (context.forceReject) return 'REJECT';
        if (!proof.evidence) return 'REJECT';
        if (!proof.evidence.tx_hash) return 'REJECT';
        if (!proof.verification?.threshold_met) return 'REJECT';
        return 'ACCEPT';
    }
}

// ---------------------------------------------------------------------------
// AttestationEngine — manages the validator set and quorum collection
// ---------------------------------------------------------------------------
class AttestationEngine {
    /**
     * @param {object} options
     * @param {number} options.validatorCount     - Number of local validators (default 3)
     * @param {number} options.quorumNumerator    - Quorum fraction numerator (default 2)
     * @param {number} options.quorumDenominator  - Quorum fraction denominator (default 3)
     */
    constructor({ validatorCount = 3, quorumNumerator = 2, quorumDenominator = 3 } = {}) {
        this.quorumNumerator   = quorumNumerator;
        this.quorumDenominator = quorumDenominator;

        // Instantiate local validator set
        this.validators = Array.from({ length: validatorCount }, (_, i) =>
            new LocalValidator(`validator-${String.fromCharCode(65 + i)}`, 1)
        );

        console.log(
            `[ATTESTATION] Initialized ${validatorCount} validators. ` +
            `Quorum threshold: ${quorumNumerator}/${quorumDenominator} ` +
            `(${Math.ceil(validatorCount * quorumNumerator / quorumDenominator)} of ${validatorCount})`
        );
    }

    // -----------------------------------------------------------------------
    // Core attestation flow
    // -----------------------------------------------------------------------

    /**
     * Request attestations from all validators and evaluate quorum.
     *
     * @param {string} intent_id
     * @param {object} proof         - SettlementProof
     * @param {object} [context]     - Extra context passed to each validator
     * @returns {AttestationResult}
     */
    async collectAttestations(intent_id, proof, context = {}) {
        const attestations = this.validators.map(v => v.attest(intent_id, proof, context));

        const total       = attestations.length;
        const accepted    = attestations.filter(a => a.decision === 'ACCEPT').length;
        const rejected    = attestations.filter(a => a.decision === 'REJECT').length;
        const totalWeight = attestations.reduce((sum, a) => sum + a.weight, 0);
        const acceptWeight= attestations.filter(a => a.decision === 'ACCEPT').reduce((s, a) => s + a.weight, 0);

        // Quorum threshold: ceil(total * quorumNumerator / quorumDenominator)
        const required    = Math.ceil(total * this.quorumNumerator / this.quorumDenominator);
        const quorumMet   = accepted >= required;

        // Verify all signatures
        const allValid = attestations.every(a => LocalValidator.verifySignature(a));

        const result = {
            intent_id,
            quorum_met:          quorumMet,
            signatures_valid:    allValid,
            total_validators:    total,
            accepted,
            rejected,
            required_threshold:  required,
            total_weight:        totalWeight,
            accept_weight:       acceptWeight,
            attestations,
            evaluated_at:        new Date().toISOString(),
        };

        if (!allValid) {
            result.quorum_met = false;
            result.rejection_reason = 'One or more validator signatures are invalid';
        }

        return result;
    }

    /**
     * Get the public keys of all validators (for on-chain registration / audit).
     *
     * @returns {object[]}
     */
    getValidatorSet() {
        return this.validators.map(v => ({
            validator_id: v.validator_id,
            public_key:   v.public_key,
            weight:       v.weight,
        }));
    }

    /**
     * Get current quorum parameters.
     */
    getQuorumParams() {
        const total    = this.validators.length;
        const required = Math.ceil(total * this.quorumNumerator / this.quorumDenominator);
        return {
            validator_count:    total,
            quorum_numerator:   this.quorumNumerator,
            quorum_denominator: this.quorumDenominator,
            required_threshold: required,
            fault_tolerance:    total - required,    // F in 2F+1
        };
    }
}

module.exports = { AttestationEngine, LocalValidator };
