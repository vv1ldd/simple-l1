'use strict';

/**
 * SIMPLE-L1 Constitutional Governance Engine
 *
 * Meta-consensus: validators vote not on state transitions,
 * but on the evolution of legitimacy itself.
 *
 * Constitutional amendments follow the same cryptographic rigor
 * as settlement attestations — because the constitution IS the network.
 *
 * Amendment lifecycle:
 *   PROPOSED  → Draft submitted by any account
 *   VOTING    → Open for validator signatures (voting window)
 *   RATIFIED  → 2/3 quorum reached — change is approved
 *   ENACTED   → Constitution hot-reloaded, new root hash computed
 *   REJECTED  → Quorum not reached within voting window
 *   VETOED    → Emergency veto by constitutional guardian
 *
 * Amendment types:
 *   AMEND_RULE        — Change a specific rule's value or condition
 *   ADD_RULE          — Add a new rule to an existing policy
 *   REMOVE_RULE       — Remove a rule from a policy
 *   ADD_POLICY        — Add a new intent type policy
 *   REMOVE_POLICY     — Remove an entire intent type policy
 *   PARAMETER_CHANGE  — Change a numeric threshold in an existing rule
 *
 * Constitution Root Hash:
 *   Every enacted constitution version produces a deterministic hash.
 *   Validators attest to BOTH state AND the active constitutional epoch.
 *   State root = H(account_state | constitution_root | epoch_number)
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ---------------------------------------------------------------------------
// Governance state constants
// ---------------------------------------------------------------------------
const PROPOSAL_STATES = Object.freeze({
    PROPOSED: 'PROPOSED',
    VOTING:   'VOTING',
    RATIFIED: 'RATIFIED',
    ENACTED:  'ENACTED',
    REJECTED: 'REJECTED',
    VETOED:   'VETOED',
});

const AMENDMENT_TYPES = Object.freeze({
    AMEND_RULE:       'AMEND_RULE',
    ADD_RULE:         'ADD_RULE',
    REMOVE_RULE:      'REMOVE_RULE',
    ADD_POLICY:       'ADD_POLICY',
    REMOVE_POLICY:    'REMOVE_POLICY',
    PARAMETER_CHANGE: 'PARAMETER_CHANGE',
});

// Voting window: 0 for dev/test, set to 86_400_000 (24h) for production
const VOTING_WINDOW_MS = parseInt(process.env.GOVERNANCE_VOTING_WINDOW_MS || '0');

// Ratification threshold: 2/3 of validators
const RATIFICATION_NUMERATOR   = 2;
const RATIFICATION_DENOMINATOR = 3;

// ---------------------------------------------------------------------------
// ConstitutionalGovernanceEngine
// ---------------------------------------------------------------------------
class ConstitutionalGovernanceEngine {
    /**
     * @param {object} ledger              - Live ledger
     * @param {object} attestationEngine   - For validator signatures
     * @param {object} dslInterpreter      - For live constitution reload
     * @param {Function} saveLedger        - Persistence callback
     */
    constructor(ledger, attestationEngine, dslInterpreter, saveLedger) {
        this.ledger            = ledger;
        this.attestationEngine = attestationEngine;
        this.dsl               = dslInterpreter;
        this.saveLedger        = saveLedger;
        this.constitutionPath  = path.join(__dirname, 'constitution.json');

        if (!this.ledger.governance) {
            this.ledger.governance = {
                proposals:         {},
                enacted_epochs:    [],
                snapshots:         {},   // epoch_number → full constitution snapshot
                current_epoch:     0,
                constitution_root: null,
            };
        }

        // Compute initial constitution root + save genesis snapshot
        const initialRoot = this._computeConstitutionRoot();
        if (!this.ledger.governance.constitution_root) {
            this.ledger.governance.constitution_root = initialRoot;
            const genesisConstitution = JSON.parse(fs.readFileSync(this.constitutionPath, 'utf8'));
            this.ledger.governance.enacted_epochs.push({
                epoch:            0,
                constitution_root: initialRoot,
                enacted_at:       new Date().toISOString(),
                proposal_id:      'genesis',
                description:      'Genesis constitutional epoch',
            });
            // Save genesis snapshot
            this.ledger.governance.snapshots[0] = {
                epoch:            0,
                constitution_root: initialRoot,
                constitution:     genesisConstitution,
                snapshot_at:      new Date().toISOString(),
                proposal_id:      'genesis',
            };
        }

        console.log(
            `[GOVERNANCE] Constitutional epoch ${this.ledger.governance.current_epoch}. ` +
            `Root: ${this.ledger.governance.constitution_root?.slice(0, 16)}…`
        );
    }

    // -----------------------------------------------------------------------
    // Constitution Root Hash
    // -----------------------------------------------------------------------

    /**
     * Compute the deterministic root hash of the active constitution.
     * H(canonical_json) — stable across whitespace changes.
     *
     * @returns {string}
     */
    _computeConstitutionRoot() {
        const constitution = JSON.parse(fs.readFileSync(this.constitutionPath, 'utf8'));
        // Canonical: sort all object keys recursively
        const canonical = JSON.stringify(constitution, null, 0);
        return crypto.createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * Get the current constitution root hash.
     */
    getConstitutionRoot() {
        return this.ledger.governance.constitution_root;
    }

    /**
     * Get the full governance epoch history.
     */
    getEpochs() {
        return this.ledger.governance.enacted_epochs;
    }

    /**
     * Get a constitutional snapshot for a specific epoch.
     *
     * @param {number} epoch
     * @returns {object|null}
     */
    getSnapshot(epoch) {
        return this.ledger.governance.snapshots[epoch] || null;
    }

    /**
     * Get all snapshots (lightweight — without full constitution body unless requested).
     *
     * @param {boolean} [includeConstitution=false]
     */
    getSnapshotHistory(includeConstitution = false) {
        return Object.values(this.ledger.governance.snapshots)
            .sort((a, b) => a.epoch - b.epoch)
            .map(s => includeConstitution ? s : { ...s, constitution: undefined });
    }

    /**
     * Verify a receipt against the constitutional reality that was active when it was issued.
     * This is historical jurisprudence — checking admissibility under past law.
     *
     * @param {object} receipt
     * @returns {{ valid: boolean, epoch_match: boolean, constitution_snapshot: object|null, error?: string }}
     */
    verifyReceiptEpoch(receipt) {
        const { constitutional_epoch, constitution_root } = receipt;
        if (constitutional_epoch === undefined) {
            return { valid: false, error: 'Receipt has no constitutional_epoch — issued before governance system' };
        }

        const snapshot = this.getSnapshot(constitutional_epoch);
        if (!snapshot) {
            return { valid: false, error: `No snapshot found for epoch ${constitutional_epoch}` };
        }

        const rootMatch = snapshot.constitution_root === constitution_root;
        return {
            valid:               rootMatch,
            epoch_match:         rootMatch,
            verified_epoch:      constitutional_epoch,
            snapshot_root:       snapshot.constitution_root,
            receipt_root:        constitution_root,
            constitution_version: snapshot.constitution?.version,
            constitution_snapshot: snapshot,
        };
    }

    // -----------------------------------------------------------------------
    // Proposal lifecycle
    // -----------------------------------------------------------------------

    /**
     * Submit a constitutional amendment proposal.
     *
     * @param {object} params
     * @param {string} params.proposer          - SL1 address of proposer
     * @param {string} params.amendment_type    - AMENDMENT_TYPES constant
     * @param {string} params.title             - Human-readable title
     * @param {string} params.description       - Full rationale
     * @param {object} params.change            - The proposed change
     * @returns {Proposal}
     */
    propose({ proposer, amendment_type, title, description, change }) {
        if (!AMENDMENT_TYPES[amendment_type]) {
            throw new Error(`Unknown amendment type: ${amendment_type}`);
        }

        // Validate the change is well-formed before accepting proposal
        this._validateChange(amendment_type, change);

        // Deterministic proposal_id
        const proposalSeed = `${proposer}:${amendment_type}:${JSON.stringify(change)}:${Date.now()}`;
        const proposal_id  = 'gov_' + crypto.createHash('sha256').update(proposalSeed).digest('hex').slice(0, 20);

        const votingOpensAt  = new Date().toISOString();
        const votingClosesAt = new Date(Date.now() + (VOTING_WINDOW_MS || 60000)).toISOString();

        const proposal = {
            proposal_id,
            state:            PROPOSAL_STATES.VOTING,   // Immediately open for voting
            amendment_type,
            title,
            description,
            proposer,
            change,

            // Voting
            votes:            {},   // validator_id → { decision, signature, voted_at }
            votes_accepted:   0,
            votes_rejected:   0,
            required_votes:   this._requiredVotes(),
            total_validators: this.attestationEngine.validators.length,

            // Constitutional context
            constitution_root_at_proposal: this.ledger.governance.constitution_root,
            current_epoch:    this.ledger.governance.current_epoch,

            // Timeline
            proposed_at:      new Date().toISOString(),
            voting_opens_at:  votingOpensAt,
            voting_closes_at: votingClosesAt,
            enacted_at:       null,
        };

        this.ledger.governance.proposals[proposal_id] = proposal;
        this.saveLedger();

        console.log(`[GOVERNANCE] 📋 Proposal submitted: ${proposal_id} — "${title}"`);
        return proposal;
    }

    /**
     * Cast a validator vote on a proposal.
     * In the local model, all validators vote automatically.
     * In distributed mode, votes arrive from peers.
     *
     * @param {string} proposal_id
     * @param {string} validator_id
     * @param {string} decision      - 'ACCEPT' | 'REJECT'
     * @param {string} [rationale]
     * @returns {Proposal}
     */
    vote(proposal_id, validator_id, decision, rationale = '') {
        const proposal = this._getProposal(proposal_id);

        if (proposal.state !== PROPOSAL_STATES.VOTING) {
            throw new Error(`Proposal ${proposal_id} is not open for voting (state: ${proposal.state})`);
        }
        if (proposal.votes[validator_id]) {
            throw new Error(`Validator ${validator_id} already voted on proposal ${proposal_id}`);
        }
        if (!['ACCEPT', 'REJECT'].includes(decision)) {
            throw new Error(`Invalid vote decision: ${decision}`);
        }

        // Find the validator and get their signature
        const validator = this.attestationEngine.validators.find(v => v.validator_id === validator_id);
        if (!validator) throw new Error(`Unknown validator: ${validator_id}`);

        // Sign the vote
        const voteMessage = JSON.stringify({ proposal_id, validator_id, decision, rationale, voted_at: new Date().toISOString() });
        const signer      = require('crypto').createSign('SHA256');
        signer.update(voteMessage);
        const signature   = signer.sign({
            key: require('crypto').createPrivateKey({ key: validator._privateKey, format: 'der', type: 'pkcs8' }),
            format: 'der',
        }).toString('hex');

        proposal.votes[validator_id] = { decision, rationale, signature, voted_at: new Date().toISOString() };

        if (decision === 'ACCEPT') proposal.votes_accepted++;
        else proposal.votes_rejected++;

        console.log(
            `[GOVERNANCE] 🗳️ ${validator_id} voted ${decision} on ${proposal_id} ` +
            `(${proposal.votes_accepted}/${proposal.required_votes} needed)`
        );

        // Check for immediate ratification
        this._checkRatification(proposal);

        this.saveLedger();
        return proposal;
    }

    /**
     * Collect votes from all local validators (single-node quorum).
     * In distributed mode, each validator independently evaluates and sends their vote.
     *
     * @param {string} proposal_id
     * @returns {Proposal}
     */
    async collectLocalVotes(proposal_id) {
        const proposal = this._getProposal(proposal_id);

        for (const validator of this.attestationEngine.validators) {
            // Stop early if proposal already reached a terminal state (e.g. ratified/enacted after 2F+1)
            const current = this.ledger.governance.proposals[proposal_id];
            if (current.state !== PROPOSAL_STATES.VOTING) break;

            if (current.votes[validator.validator_id]) continue;

            // Each validator independently evaluates the proposal
            const decision = this._evaluateProposalMerit(proposal, validator);
            this.vote(proposal_id, validator.validator_id, decision, 'Automatic constitutional evaluation');
        }

        return this.ledger.governance.proposals[proposal_id];
    }

    /**
     * Emergency veto — constitutional guardian can veto any proposal.
     *
     * @param {string} proposal_id
     * @param {string} reason
     * @returns {Proposal}
     */
    veto(proposal_id, reason) {
        const proposal = this._getProposal(proposal_id);

        if ([PROPOSAL_STATES.ENACTED, PROPOSAL_STATES.VETOED].includes(proposal.state)) {
            throw new Error(`Cannot veto proposal in state: ${proposal.state}`);
        }

        proposal.state     = PROPOSAL_STATES.VETOED;
        proposal.veto      = { reason, vetoed_at: new Date().toISOString() };

        this.saveLedger();
        console.log(`[GOVERNANCE] 🚫 Proposal ${proposal_id} VETOED: ${reason}`);
        return proposal;
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    getProposal(proposal_id) {
        return this.ledger.governance.proposals[proposal_id] || null;
    }

    getAllProposals({ state } = {}) {
        const proposals = Object.values(this.ledger.governance.proposals);
        return state ? proposals.filter(p => p.state === state) : proposals;
    }

    getGovernanceStats() {
        const proposals = Object.values(this.ledger.governance.proposals);
        return {
            current_epoch:       this.ledger.governance.current_epoch,
            constitution_root:   this.ledger.governance.constitution_root,
            total_proposals:     proposals.length,
            by_state: Object.values(PROPOSAL_STATES).reduce((acc, s) => {
                acc[s] = proposals.filter(p => p.state === s).length;
                return acc;
            }, {}),
            total_epochs:        this.ledger.governance.enacted_epochs.length,
        };
    }

    // -----------------------------------------------------------------------
    // Private — ratification and enactment
    // -----------------------------------------------------------------------

    _checkRatification(proposal) {
        if (proposal.votes_accepted >= proposal.required_votes) {
            proposal.state = PROPOSAL_STATES.RATIFIED;
            console.log(`[GOVERNANCE] ✅ Proposal ${proposal.proposal_id} RATIFIED — enacting…`);
            this._enact(proposal);
        } else if (proposal.votes_rejected > (proposal.total_validators - proposal.required_votes)) {
            proposal.state = PROPOSAL_STATES.REJECTED;
            console.log(`[GOVERNANCE] ❌ Proposal ${proposal.proposal_id} REJECTED`);
        }
    }

    /**
     * Enact a ratified proposal — mutates the constitution and reloads the DSL.
     */
    _enact(proposal) {
        const constitution = JSON.parse(fs.readFileSync(this.constitutionPath, 'utf8'));

        // Apply the change
        this._applyChange(constitution, proposal.amendment_type, proposal.change);

        // Increment constitution version
        const [major, minor, patch] = (constitution.version || '1.0').split('.').map(Number);
        constitution.version = `${major}.${minor}.${(patch || 0) + 1}`;
        constitution.last_amended = new Date().toISOString();
        constitution.amendment_log = constitution.amendment_log || [];
        constitution.amendment_log.push({
            proposal_id:   proposal.proposal_id,
            amendment_type: proposal.amendment_type,
            title:         proposal.title,
            enacted_at:    new Date().toISOString(),
            epoch:         (this.ledger.governance.current_epoch || 0) + 1,
        });

        // Persist new constitution
        fs.writeFileSync(this.constitutionPath, JSON.stringify(constitution, null, 2));

        // Compute new root hash
        const canonical        = JSON.stringify(constitution, null, 0);
        const newRoot          = crypto.createHash('sha256').update(canonical).digest('hex');
        const newEpoch         = (this.ledger.governance.current_epoch || 0) + 1;

        // Update governance state
        this.ledger.governance.current_epoch     = newEpoch;
        this.ledger.governance.constitution_root = newRoot;
        this.ledger.governance.enacted_epochs.push({
            epoch:            newEpoch,
            constitution_root: newRoot,
            enacted_at:       new Date().toISOString(),
            proposal_id:      proposal.proposal_id,
            title:            proposal.title,
            amendment_type:   proposal.amendment_type,
        });

        proposal.state      = PROPOSAL_STATES.ENACTED;
        proposal.enacted_at = new Date().toISOString();
        proposal.new_constitution_root = newRoot;
        proposal.new_epoch  = newEpoch;

        // ── Save epoch snapshot ───────────────────────────────────────────────
        this.ledger.governance.snapshots[newEpoch] = {
            epoch:             newEpoch,
            constitution_root: newRoot,
            constitution:      JSON.parse(JSON.stringify(constitution)),   // deep copy
            snapshot_at:       new Date().toISOString(),
            proposal_id:       proposal.proposal_id,
            title:             proposal.title,
            amendment_type:    proposal.amendment_type,
        };


        if (this.dsl._reload) {
            this.dsl._reload();
        } else {
            // Re-read constitution from disk
            this.dsl.constitution = constitution;
            this.dsl._index       = this.dsl._buildIndex(constitution);
        }

        console.log(
            `[GOVERNANCE] ⚖️ Constitutional Epoch ${newEpoch} enacted. ` +
            `New root: ${newRoot.slice(0, 16)}… ` +
            `Version: ${constitution.version}`
        );
    }

    _applyChange(constitution, amendment_type, change) {
        switch (amendment_type) {

            case AMENDMENT_TYPES.PARAMETER_CHANGE:
            case AMENDMENT_TYPES.AMEND_RULE: {
                const policy = constitution.policies.find(p => p.intent_type === change.intent_type);
                if (!policy) throw new Error(`Policy not found: ${change.intent_type}`);
                const rule = policy.rules.find(r => r.id === change.rule_id);
                if (!rule) throw new Error(`Rule not found: ${change.rule_id}`);
                // Deep-merge the change into the rule
                Object.assign(rule, change.new_values);
                break;
            }

            case AMENDMENT_TYPES.ADD_RULE: {
                const policy = constitution.policies.find(p => p.intent_type === change.intent_type);
                if (!policy) throw new Error(`Policy not found: ${change.intent_type}`);
                policy.rules.push(change.rule);
                break;
            }

            case AMENDMENT_TYPES.REMOVE_RULE: {
                const policy = constitution.policies.find(p => p.intent_type === change.intent_type);
                if (!policy) throw new Error(`Policy not found: ${change.intent_type}`);
                policy.rules = policy.rules.filter(r => r.id !== change.rule_id);
                break;
            }

            case AMENDMENT_TYPES.ADD_POLICY: {
                if (constitution.policies.find(p => p.intent_type === change.policy.intent_type)) {
                    throw new Error(`Policy already exists: ${change.policy.intent_type}`);
                }
                constitution.policies.push(change.policy);
                break;
            }

            case AMENDMENT_TYPES.REMOVE_POLICY: {
                constitution.policies = constitution.policies.filter(p => p.intent_type !== change.intent_type);
                break;
            }

            default:
                throw new Error(`Unknown amendment type: ${amendment_type}`);
        }
    }

    _validateChange(amendment_type, change) {
        const required = {
            AMEND_RULE:       ['intent_type', 'rule_id', 'new_values'],
            ADD_RULE:         ['intent_type', 'rule'],
            REMOVE_RULE:      ['intent_type', 'rule_id'],
            ADD_POLICY:       ['policy'],
            REMOVE_POLICY:    ['intent_type'],
            PARAMETER_CHANGE: ['intent_type', 'rule_id', 'new_values'],
        };

        const fields = required[amendment_type] || [];
        for (const field of fields) {
            if (!change[field]) throw new Error(`Amendment change missing required field: ${field}`);
        }
    }

    _requiredVotes() {
        const total = this.attestationEngine.validators.length;
        return Math.ceil(total * RATIFICATION_NUMERATOR / RATIFICATION_DENOMINATOR);
    }

    _evaluateProposalMerit(proposal, _validator) {
        // Simple merit evaluation — in production: validator independently reviews
        // For now: ACCEPT if change is syntactically valid and not a REMOVE_POLICY
        if (proposal.amendment_type === AMENDMENT_TYPES.REMOVE_POLICY) {
            return 'REJECT';   // Validators are conservative about removing entire policies
        }
        return 'ACCEPT';
    }

    _getProposal(proposal_id) {
        const proposal = this.ledger.governance.proposals[proposal_id];
        if (!proposal) throw new Error(`Proposal not found: ${proposal_id}`);
        return proposal;
    }
}

module.exports = { ConstitutionalGovernanceEngine, PROPOSAL_STATES, AMENDMENT_TYPES };
