'use strict';

/**
 * SIMPLE-L1 Intent Receipt Engine
 *
 * Issues constitutional proofs of value transition.
 * A receipt is NOT a transaction confirmation.
 * A receipt is: "The constitutional runtime accepted this settlement as legitimate."
 *
 * Receipt anatomy:
 *   receipt_id          — Deterministic, globally unique identifier
 *   constitutional_status  — Human-readable final state
 *   intent_hash         — Canonical digest of the original intent
 *   settlement_proof    — Portable proof object (self-verifiable)
 *   quorum_attestation  — Validator signatures bundle
 *   issued_at           — ISO 8601 timestamp
 *   receipt_signature   — Node-level signature over the entire receipt
 *
 * Receipts are:
 *   - Immutable once issued
 *   - Portable (verifiable by any party with the node's public key)
 *   - Self-describing (contain all data needed for independent verification)
 *   - Stored permanently in ledger.receipts[]
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constitutional status labels — what users see
// ---------------------------------------------------------------------------
const CONSTITUTIONAL_STATUS = Object.freeze({
    FINALIZED: 'FINALIZED',
    DISPUTED:  'DISPUTED',
    REJECTED:  'REJECTED',
    REVERTED:  'REVERTED',
});

// ---------------------------------------------------------------------------
// ReceiptEngine
// ---------------------------------------------------------------------------
class ReceiptEngine {
    /**
     * @param {object} ledger         - Live ledger
     * @param {object} [nodeKey]      - Node signing key
     * @param {object} [governance]   - Reference to governance engine (for epoch context)
     */
    constructor(ledger, nodeKey = null, governance = null) {
        this.ledger      = ledger;
        this.governance  = governance;   // Optional — enriches receipts with constitutional context

        if (!this.ledger.receipts) {
            this.ledger.receipts = {};
        }

        // Node signing keypair (P-256) — used to sign all receipts
        if (nodeKey) {
            this._nodeKey = nodeKey;
        } else {
            const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
                namedCurve: 'prime256v1',
                publicKeyEncoding:  { type: 'spki',  format: 'der' },
                privateKeyEncoding: { type: 'pkcs8', format: 'der' },
            });
            this._nodePrivateKey = privateKey;
            this.nodePublicKey   = publicKey.toString('hex');
        }

        console.log(`[RECEIPT ENGINE] Ready. Node public key: ${this.nodePublicKey?.slice(0, 20)}…`);
    }

    // -----------------------------------------------------------------------
    // Issue a receipt
    // -----------------------------------------------------------------------

    /**
     * Issue a constitutional receipt for a fulfilled + attested intent.
     *
     * @param {object} params
     * @param {object} params.intent              - The fulfilled intent record
     * @param {object} params.proof               - SettlementProof object
     * @param {object} params.attestationResult   - AttestationEngine result
     * @returns {IntentReceipt}
     */
    issue({ intent, proof, attestationResult }) {
        if (!intent.fulfillment) {
            throw new Error(`[ReceiptEngine] Cannot issue receipt: intent ${intent.intent_id} is not fulfilled`);
        }

        // Deterministic receipt_id: H(intent_id + proof_fingerprint + fulfilled_at)
        const receiptSeed = `${intent.intent_id}:${proof.proof_fingerprint}:${intent.fulfillment.fulfilled_at}`;
        const receipt_id  = 'rcpt_' + crypto.createHash('sha256').update(receiptSeed).digest('hex').slice(0, 24);

        // Idempotent
        if (this.ledger.receipts[receipt_id]) {
            return this.ledger.receipts[receipt_id];
        }

        // Canonical intent hash (what the user committed to)
        const intent_hash = this._hashIntent(intent);

        const receipt = {
            receipt_id,
            receipt_version:        '1.0',

            // Constitutional verdict
            constitutional_status:  CONSTITUTIONAL_STATUS.FINALIZED,
            state_description:      'The constitutional runtime accepted this settlement as legitimate.',

            // Identity
            sl1_address:            intent.sl1_address,
            intent_id:              intent.intent_id,
            intent_type:            intent.type,
            intent_hash,

            // Settlement details
            settlement: {
                network:            intent.fulfillment.network,
                asset:              intent.asset,
                amount:             String(intent.fulfillment.amount),
                tx_hash:            intent.fulfillment.tx_hash,
                block_number:       intent.fulfillment.block_number,
                confirmations:      intent.fulfillment.confirmations,
                explorer_url:       intent.fulfillment.explorer_url,
            },

            // Proof bundle (portable, self-verifiable)
            proof: {
                proof_type:        proof.proof_type,
                proof_fingerprint: proof.proof_fingerprint,
                verified_at:       proof.verification?.confirmed_at,
            },

            // Quorum attestation summary
            attestation: attestationResult ? {
                quorum_met:          attestationResult.quorum_met,
                validator_count:     attestationResult.total_validators,
                accepted:            attestationResult.accepted,
                required:            attestationResult.required_threshold,
                validators:          attestationResult.attestations?.map(a => a.validator_id),
            } : null,

            // ⛓️ Constitutional Universe Context
            ...this._getConstitutionalContext(),

            // Timestamps
            intent_created_at:      intent.created_at,
            settlement_fulfilled_at: intent.fulfillment.fulfilled_at,
            issued_at:              new Date().toISOString(),

            // Node-level signature
            issuer_public_key:      this.nodePublicKey,
            receipt_signature:      null,   // Filled below
        };

        // 📜 Semantic Attestation (Phase 2)
        // Validators attest to the *meaning* of the execution, not just the raw bytes.
        const semantic_statement = this._generateSemanticStatement(intent, attestationResult, receipt);
        receipt.semantic_hash = crypto.createHash('sha256').update(semantic_statement).digest('hex');

        receipt.receipt_signature = this._sign(receipt);

        // Persist
        this.ledger.receipts[receipt_id] = receipt;

        console.log(`[RECEIPT ENGINE] ✅ Issued receipt ${receipt_id} for intent ${intent.intent_id.slice(0, 8)}…`);
        return receipt;
    }

    _generateSemanticStatement(intent, attestationResult, context) {
        const intentType = intent.type || 'TRANSACTION';
        const network = intent.fulfillment?.network || intent.network || 'unknown';
        const asset = intent.fulfillment?.asset || intent.asset || 'unknown';
        const amount = intent.fulfillment?.amount || intent.expected_amount || '0';
        const epoch = context.constitutional_epoch ?? 0;
        const policyVer = context.policy_version ?? '1.0';

        let statement = `STATEMENT OF CONSTITUTIONAL LEGITIMACY\n`;
        statement += `======================================\n`;
        statement += `The sovereign federation operating under Epoch ${epoch} (Policy v${policyVer})\n`;

        if (intentType === 'CROSS_CHAIN_DEPOSIT') {
            statement += `HEREBY DECLARES the inbound settlement of ${amount} ${asset} on ${network} to be CONSTITUTIONALLY ADMISSIBLE.\n`;
        } else if (intentType === 'CROSS_CHAIN_WITHDRAWAL') {
            statement += `HEREBY DECLARES the outbound withdrawal of ${amount} ${asset} to ${network} to be CONSTITUTIONALLY ADMISSIBLE.\n`;
        } else {
            statement += `HEREBY DECLARES the state transition of type ${intentType} to be CONSTITUTIONALLY ADMISSIBLE.\n`;
        }

        if (attestationResult?.quorum_met) {
            statement += `\nATTESTATION:\n`;
            statement += `A verified quorum of ${attestationResult.accepted}/${attestationResult.required_threshold} sovereign validators certified this execution.\n`;
            statement += `ATTESTING NODES: [${(attestationResult.attestations?.map(a => a.validator_id) || []).sort().join(', ')}]\n`;
        } else {
            statement += `\nWARNING: Attestation Quorum was NOT met.\n`;
        }

        if (context.state_root) {
            statement += `\nANCHOR:\n`;
            statement += `This judgment is immutably anchored in State Root: ${context.state_root}\n`;
        }

        return statement;
    }

    /**
     * Issue a rejection receipt.
     *
     * @param {object} intent
     * @param {string} reason
     * @returns {IntentReceipt}
     */
    issueRejection(intent, reason) {
        const receiptSeed = `rejected:${intent.intent_id}:${reason}`;
        const receipt_id  = 'rcpt_' + crypto.createHash('sha256').update(receiptSeed).digest('hex').slice(0, 24);

        if (this.ledger.receipts[receipt_id]) return this.ledger.receipts[receipt_id];

        const receipt = {
            receipt_id,
            receipt_version:       '1.0',
            constitutional_status: CONSTITUTIONAL_STATUS.REJECTED,
            state_description:     `Settlement rejected: ${reason}`,
            sl1_address:           intent.sl1_address,
            intent_id:             intent.intent_id,
            intent_type:           intent.type,
            intent_hash:           this._hashIntent(intent),
            rejection_reason:      reason,
            intent_created_at:     intent.created_at,
            issued_at:             new Date().toISOString(),
            issuer_public_key:     this.nodePublicKey,
            receipt_signature:     null,
        };

        receipt.receipt_signature = this._sign(receipt);
        this.ledger.receipts[receipt_id] = receipt;
        return receipt;
    }

    // -----------------------------------------------------------------------
    // Verification
    // -----------------------------------------------------------------------

    /**
     * Verify a receipt's node signature.
     *
     * @param {object} receipt
     * @returns {{ valid: boolean, error?: string }}
     */
    verify(receipt) {
        try {
            const { receipt_signature, issuer_public_key, ...body } = receipt;
            const canonical = JSON.stringify(body, Object.keys(body).sort());

            const verifier = crypto.createVerify('SHA256');
            verifier.update(canonical);
            const valid = verifier.verify(
                crypto.createPublicKey({
                    key:    Buffer.from(issuer_public_key, 'hex'),
                    format: 'der',
                    type:   'spki',
                }),
                Buffer.from(receipt_signature, 'hex')
            );
            return { valid };
        } catch (err) {
            return { valid: false, error: err.message };
        }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    getReceipt(receipt_id) {
        return this.ledger.receipts[receipt_id] || null;
    }

    getReceiptByIntent(intent_id) {
        return Object.values(this.ledger.receipts)
            .find(r => r.intent_id === intent_id) || null;
    }

    getReceiptsByAddress(sl1_address) {
        return Object.values(this.ledger.receipts)
            .filter(r => r.sl1_address === sl1_address)
            .sort((a, b) => b.issued_at.localeCompare(a.issued_at));
    }

    getStats() {
        const receipts = Object.values(this.ledger.receipts);
        return {
            total:       receipts.length,
            finalized:   receipts.filter(r => r.constitutional_status === 'FINALIZED').length,
            rejected:    receipts.filter(r => r.constitutional_status === 'REJECTED').length,
            disputed:    receipts.filter(r => r.constitutional_status === 'DISPUTED').length,
        };
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _sign(receipt) {
        const { receipt_signature, ...body } = receipt;
        const canonical = JSON.stringify(body, Object.keys(body).sort());

        const signer = crypto.createSign('SHA256');
        signer.update(canonical);
        return signer.sign({
            key:    crypto.createPrivateKey({ key: this._nodePrivateKey, format: 'der', type: 'pkcs8' }),
            format: 'der',
        }).toString('hex');
    }

    /**
     * Build the constitutional universe context for receipt embedding.
     * If governance engine is wired, returns full epoch context.
     * Otherwise returns a minimal stub.
     */
    _getConstitutionalContext() {
        if (!this.governance) {
            return {
                constitutional_epoch:  null,
                constitution_root:     null,
                policy_version:        null,
                state_root:            null,
            };
        }
        const gov = this.governance.ledger?.governance;
        return {
            constitutional_epoch:  gov?.current_epoch ?? 0,
            constitution_root:     gov?.constitution_root ?? null,
            policy_version:        this.governance.dsl?.getConstitution()?.version ?? null,
            state_root:            this.ledger.state_root ?? null,
        };
    }

    _hashIntent(intent) {
        const canonical = JSON.stringify({
            intent_id:       intent.intent_id,
            type:            intent.type,
            sl1_address:     intent.sl1_address,
            network:         intent.network,
            asset:           intent.asset,
            expected_amount: intent.expected_amount,
            created_at:      intent.created_at,
        });
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }
}

module.exports = { ReceiptEngine, CONSTITUTIONAL_STATUS };
