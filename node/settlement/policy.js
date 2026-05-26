'use strict';

const { ConstitutionalDSLInterpreter } = require('./dsl');

/**
 * SIMPLE-L1 Constitutional Execution Policy Engine
 *
 * Policies define the RULES OF LEGITIMACY — not just validity.
 *
 * Core distinction:
 *   Cryptographic validity:   "Is the signature correct?"
 *   Constitutional legitimacy: "Does this intent satisfy our rules of governance?"
 *
 * A policy is a set of composable rules that an intent MUST satisfy
 * before it can advance through the constitutional pipeline.
 *
 * Policy rules:
 *   quorum          — Required validator fraction (e.g. "2/3", "3/4")
 *   min_confirmations — Per-network block confirmation requirements
 *   amount_limit    — Maximum amount per intent
 *   daily_limit     — Cumulative daily limit per address
 *   time_delay      — Minimum time between VERIFIED and FULFILLED
 *   treasury_multisig — Requires explicit treasury co-signature
 *   network_whitelist — Only certain external networks allowed
 *   asset_whitelist  — Only certain assets allowed
 *   require_receipt  — Prior receipts required (KYC-like gate)
 *
 * Policies are composable:
 *   each intent type has a policy,
 *   each network can override specific rules,
 *   each asset can override specific rules.
 */

// ---------------------------------------------------------------------------
// Policy rule constants
// ---------------------------------------------------------------------------
const POLICY_RULES = Object.freeze({
    QUORUM:             'quorum',
    MIN_CONFIRMATIONS:  'min_confirmations',
    AMOUNT_LIMIT:       'amount_limit',
    DAILY_LIMIT:        'daily_limit',
    TIME_DELAY_MS:      'time_delay_ms',
    TREASURY_MULTISIG:  'treasury_multisig',
    NETWORK_WHITELIST:  'network_whitelist',
    ASSET_WHITELIST:    'asset_whitelist',
    REQUIRE_PRIOR_RECEIPT: 'require_prior_receipt',
});

// ---------------------------------------------------------------------------
// Built-in policy registry
// ---------------------------------------------------------------------------
// Each entry is an array of rule objects evaluated in order.
// First FAIL stops evaluation and returns the violation.
// ---------------------------------------------------------------------------

const DEFAULT_POLICIES = {

    // ── CROSS_CHAIN_DEPOSIT ─────────────────────────────────────────────────
    // Incoming value from external chains.
    // Lower friction — no time delay, but quorum still required.
    CROSS_CHAIN_DEPOSIT: [
        {
            rule:    POLICY_RULES.NETWORK_WHITELIST,
            allowed: ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism', 'bitcoin', 'ton', 'solana'],
            reason:  'Deposit network not whitelisted',
        },
        {
            rule:    POLICY_RULES.ASSET_WHITELIST,
            allowed: ['ETH', 'USDT', 'USDC', 'WBTC', 'BTC', 'MATIC', 'BNB', 'TON', 'SOL'],
            reason:  'Asset not approved for deposits',
        },
        {
            rule:      POLICY_RULES.AMOUNT_LIMIT,
            max:       1_000_000,
            currency:  'USD_EQUIVALENT',
            reason:    'Single deposit exceeds constitutional limit (1M USD)',
        },
        {
            rule:        POLICY_RULES.MIN_CONFIRMATIONS,
            by_network: {
                ethereum: 12,
                base:     6,
                arbitrum: 1,
                polygon:  30,
                bsc:      15,
                optimism: 1,
                bitcoin:  6,
                ton:      3,
                solana:   32,
            },
            reason: 'Insufficient confirmations for this network',
        },
        {
            rule:      POLICY_RULES.QUORUM,
            numerator: 2,
            denominator: 3,
            reason:  'Deposit requires 2/3 validator quorum',
        },
    ],

    // ── CROSS_CHAIN_WITHDRAWAL ──────────────────────────────────────────────
    // Outgoing value to external chains.
    // Higher friction — time delay, treasury multisig for large amounts.
    CROSS_CHAIN_WITHDRAWAL: [
        {
            rule:    POLICY_RULES.NETWORK_WHITELIST,
            allowed: ['ethereum', 'base', 'arbitrum', 'polygon', 'bsc', 'optimism', 'bitcoin', 'ton', 'solana'],
            reason:  'Withdrawal network not whitelisted',
        },
        {
            rule:    POLICY_RULES.ASSET_WHITELIST,
            allowed: ['ETH', 'USDT', 'USDC', 'WBTC', 'BTC', 'MATIC', 'BNB', 'TON', 'SOL'],
            reason:  'Asset not approved for withdrawals',
        },
        {
            rule:      POLICY_RULES.AMOUNT_LIMIT,
            max:       500_000,
            currency:  'USD_EQUIVALENT',
            reason:    'Single withdrawal exceeds constitutional limit (500K USD)',
        },
        {
            rule:               POLICY_RULES.TREASURY_MULTISIG,
            threshold_amount:   10_000,    // Treasury co-sign required above 10K
            currency:           'USD_EQUIVALENT',
            reason:             'Withdrawal above 10K USD requires treasury multisig',
        },
        {
            rule:         POLICY_RULES.TIME_DELAY_MS,
            delay_ms:     0,               // 0 for now — set to 86_400_000 (24h) for large amounts
            large_amount: 50_000,          // "Large" threshold
            large_delay:  86_400_000,      // 24 hours for large withdrawals
            reason:       'Large withdrawal requires 24h constitutional delay',
        },
        {
            rule:        POLICY_RULES.DAILY_LIMIT,
            max_per_day: 2_000_000,
            currency:    'USD_EQUIVALENT',
            reason:      'Daily withdrawal limit exceeded',
        },
        {
            rule:        POLICY_RULES.QUORUM,
            numerator:   2,
            denominator: 3,
            reason:      'Withdrawal requires 2/3 validator quorum',
        },
    ],

    // ── TRANSFER (native SL1 transfer) ─────────────────────────────────────
    // Internal L1 transfers. No external network, minimal friction.
    TRANSFER: [
        {
            rule:   POLICY_RULES.AMOUNT_LIMIT,
            max:    10_000_000,
            reason: 'Transfer exceeds constitutional limit',
        },
        {
            rule:        POLICY_RULES.QUORUM,
            numerator:   1,
            denominator: 1,
            reason:      'Transfer requires at least one self-attestation',
        },
    ],
};

// ---------------------------------------------------------------------------
// PolicyEvaluationResult
// ---------------------------------------------------------------------------

class PolicyViolation {
    constructor(rule, reason, context = {}) {
        this.ok      = false;
        this.rule    = rule;
        this.reason  = reason;
        this.context = context;
    }
}

class PolicyPass {
    constructor(policies_evaluated) {
        this.ok                 = true;
        this.policies_evaluated = policies_evaluated;
        this.evaluated_at       = new Date().toISOString();
    }
}

// ---------------------------------------------------------------------------
// ConstitutionalPolicyEngine
// ---------------------------------------------------------------------------
class ConstitutionalPolicyEngine {
    /**
     * @param {object} ledger    - Live ledger (for daily limit lookups)
     * @param {object} [custom]  - Custom policies to override defaults
     */
    constructor(ledger, custom = {}) {
        this.ledger      = ledger;
        this.policies    = { ...DEFAULT_POLICIES, ...custom };
        this.dsl         = new ConstitutionalDSLInterpreter();

        if (!this.ledger.policy_audit) {
            this.ledger.policy_audit = [];
        }

        console.log(`[POLICY ENGINE] Loaded ${Object.keys(this.policies).length} code-level policies + DSL constitution v${this.dsl.getConstitution().version}`);
    }

    // -----------------------------------------------------------------------
    // Core evaluation
    // -----------------------------------------------------------------------

    /**
     * Evaluate all rules for an intent type.
     * Returns a PolicyPass or PolicyViolation — never throws.
     *
     * @param {string} intent_type    - e.g. 'CROSS_CHAIN_DEPOSIT'
     * @param {object} intent         - The intent record
     * @param {object} context        - Evaluation context (proof, attestations, etc.)
     * @returns {PolicyPass | PolicyViolation}
     */
    evaluate(intent_type, intent, context = {}) {
        // ── Stage A: DSL Constitutional Layer (declarative, human-readable) ────
        const facts     = this.dsl.buildFacts(intent, context);
        const dslResult = this.dsl.evaluate(intent_type, facts);

        if (!dslResult.ok) {
            // DSL denied this intent — constitutional violation
            this._audit(intent_type, intent, { rule: dslResult.rule_id }, dslResult, 'VIOLATION');
            return new PolicyViolation(dslResult.rule_id, dslResult.reason, dslResult.context);
        }

        // Carry DSL requirements into context for code-level rules
        if (dslResult.requirements?.length) {
            context._dsl_requirements = dslResult.requirements;
        }

        // ── Stage B: Code-level Policy Rules (programmatic, precise) ──────────
        const rules = this.policies[intent_type];
        if (!rules) {
            // No code-level policy — DSL pass is sufficient
            const pass = new PolicyPass(dslResult.rules_evaluated);
            this._audit(intent_type, intent, null, pass, 'PASS');
            return pass;
        }

        for (const rule of rules) {
            const result = this._evaluateRule(rule, intent, context);
            if (!result.ok) {
                this._audit(intent_type, intent, rule, result, 'VIOLATION');
                return result;
            }
        }

        const pass = new PolicyPass(rules.length + dslResult.rules_evaluated);
        this._audit(intent_type, intent, null, pass, 'PASS');
        return pass;
    }

    /**
     * Get the policy definition for an intent type.
     *
     * @param {string} intent_type
     * @returns {object[] | null}
     */
    getPolicy(intent_type) {
        return this.policies[intent_type] || null;
    }

    /**
     * Get all registered policies.
     */
    getAllPolicies() {
        return Object.entries(this.policies).map(([type, rules]) => ({
            intent_type: type,
            rule_count:  rules.length,
            rules:       rules.map(r => ({ rule: r.rule, reason: r.reason })),
        }));
    }

    /**
     * Get recent policy audit log entries.
     *
     * @param {number} limit
     */
    /**
     * Get the full living constitutional document.
     */
    getConstitution() {
        return this.dsl.getConstitution();
    }

    /**
     * Describe a policy in DSL human-readable terms.
     * Combines DSL rules + code-level rule descriptions.
     */
    describeFullPolicy(intent_type) {
        return {
            dsl_policy:  this.dsl.describePolicy(intent_type),
            code_policy: this.describe(intent_type),
        };
    }

    /**
     * Explain why a given intent would be denied.
     * Returns the exact rule and reason, or null if it would pass.
     *
     * @param {string} intent_type
     * @param {object} intent
     * @param {object} context
     * @returns {{ source, rule_id, reason } | null}
     */
    explainViolation(intent_type, intent, context = {}) {
        const facts     = this.dsl.buildFacts(intent, context);
        const dslResult = this.dsl.evaluate(intent_type, facts);

        if (!dslResult.ok) {
            return { source: 'DSL', rule_id: dslResult.rule_id, reason: dslResult.reason, context: dslResult.context };
        }

        const rules = this.policies[intent_type] || [];
        for (const rule of rules) {
            const result = this._evaluateRule(rule, intent, context);
            if (!result.ok) {
                return { source: 'CODE', rule: result.rule, reason: result.reason, context: result.context };
            }
        }

        return null;  // Would pass
    }

    getAuditLog(limit = 100) {
        return [...this.ledger.policy_audit].reverse().slice(0, limit);
    }

    /**
     * Describe a policy in human-readable form.
     *
     * @param {string} intent_type
     */
    describe(intent_type) {
        const rules = this.policies[intent_type];
        if (!rules) return null;

        return {
            intent_type,
            constitutional_requirements: rules.map(r => {
                switch (r.rule) {
                    case POLICY_RULES.QUORUM:
                        return `Requires ${r.numerator}/${r.denominator} validator quorum`;
                    case POLICY_RULES.MIN_CONFIRMATIONS:
                        return `Minimum confirmations: ${JSON.stringify(r.by_network)}`;
                    case POLICY_RULES.AMOUNT_LIMIT:
                        return `Maximum amount: ${r.max?.toLocaleString()} ${r.currency || 'native'}`;
                    case POLICY_RULES.DAILY_LIMIT:
                        return `Daily limit: ${r.max_per_day?.toLocaleString()} ${r.currency || 'native'}`;
                    case POLICY_RULES.TIME_DELAY_MS:
                        return r.large_delay
                            ? `Time delay: ${r.delay_ms / 3600000}h standard, ${r.large_delay / 3600000}h for amounts > ${r.large_amount?.toLocaleString()}`
                            : `Time delay: ${r.delay_ms / 3600000}h`;
                    case POLICY_RULES.TREASURY_MULTISIG:
                        return `Treasury multisig required for amounts > ${r.threshold_amount?.toLocaleString()} ${r.currency || ''}`;
                    case POLICY_RULES.NETWORK_WHITELIST:
                        return `Allowed networks: ${r.allowed?.join(', ')}`;
                    case POLICY_RULES.ASSET_WHITELIST:
                        return `Allowed assets: ${r.allowed?.join(', ')}`;
                    default:
                        return r.reason || r.rule;
                }
            }),
        };
    }

    // -----------------------------------------------------------------------
    // Private — rule evaluators
    // -----------------------------------------------------------------------

    _evaluateRule(rule, intent, context) {
        switch (rule.rule) {

            case POLICY_RULES.NETWORK_WHITELIST: {
                const network = intent.network || context.network;
                if (!network || !rule.allowed.includes(network)) {
                    return new PolicyViolation(rule.rule, rule.reason, { network, allowed: rule.allowed });
                }
                return { ok: true };
            }

            case POLICY_RULES.ASSET_WHITELIST: {
                const asset = intent.asset || context.asset;
                if (!asset || !rule.allowed.includes(asset)) {
                    return new PolicyViolation(rule.rule, rule.reason, { asset, allowed: rule.allowed });
                }
                return { ok: true };
            }

            case POLICY_RULES.AMOUNT_LIMIT: {
                const amount = parseFloat(intent.expected_amount || intent.amount || context.amount || 0);
                if (amount > rule.max) {
                    return new PolicyViolation(rule.rule, rule.reason, { amount, max: rule.max });
                }
                return { ok: true };
            }

            case POLICY_RULES.MIN_CONFIRMATIONS: {
                const network       = intent.network || context.network;
                const required      = rule.by_network?.[network] ?? 1;
                const confirmations = context.proof?.evidence?.confirmations ?? context.confirmations ?? 0;
                if (confirmations < required) {
                    return new PolicyViolation(rule.rule, rule.reason, { confirmations, required, network });
                }
                return { ok: true };
            }

            case POLICY_RULES.QUORUM: {
                const attestations = context.attestationResult;
                if (!attestations) return { ok: true };   // No attestations yet — skip for pre-attest stages
                if (!attestations.quorum_met) {
                    return new PolicyViolation(rule.rule, rule.reason, {
                        accepted: attestations.accepted,
                        required: attestations.required_threshold,
                        total:    attestations.total_validators,
                    });
                }
                return { ok: true };
            }

            case POLICY_RULES.TREASURY_MULTISIG: {
                const amount    = parseFloat(intent.amount || context.amount || 0);
                const threshold = rule.threshold_amount || 10_000;
                if (amount >= threshold) {
                    const hasMultisig = context.treasury_signature === true;
                    if (!hasMultisig) {
                        return new PolicyViolation(rule.rule, rule.reason, { amount, threshold });
                    }
                }
                return { ok: true };
            }

            case POLICY_RULES.TIME_DELAY_MS: {
                if (!intent.state_history) return { ok: true };
                const amount    = parseFloat(intent.amount || context.amount || 0);
                const isLarge   = amount >= (rule.large_amount || Infinity);
                const delayMs   = isLarge ? rule.large_delay : rule.delay_ms;
                if (!delayMs) return { ok: true };

                const verifiedEntry = intent.state_history?.find(h => h.to === 'VERIFIED');
                if (!verifiedEntry) return { ok: true };

                const elapsed = Date.now() - new Date(verifiedEntry.at).getTime();
                if (elapsed < delayMs) {
                    return new PolicyViolation(rule.rule, rule.reason, {
                        elapsed_ms:   elapsed,
                        required_ms:  delayMs,
                        unlocks_at:   new Date(new Date(verifiedEntry.at).getTime() + delayMs).toISOString(),
                    });
                }
                return { ok: true };
            }

            case POLICY_RULES.DAILY_LIMIT: {
                const sl1_address = intent.sl1_address;
                const asset       = intent.asset;
                const amount      = parseFloat(intent.amount || 0);
                const today       = new Date().toISOString().slice(0, 10);

                // Sum today's fulfilled withdrawals from the audit log
                const todayTotal = (this.ledger.policy_audit || [])
                    .filter(e =>
                        e.intent_type === 'CROSS_CHAIN_WITHDRAWAL' &&
                        e.outcome === 'PASS' &&
                        e.sl1_address === sl1_address &&
                        e.asset === asset &&
                        e.timestamp?.startsWith(today)
                    )
                    .reduce((sum, e) => sum + (e.amount || 0), 0);

                if (todayTotal + amount > rule.max_per_day) {
                    return new PolicyViolation(rule.rule, rule.reason, {
                        today_total:  todayTotal,
                        this_amount:  amount,
                        daily_limit:  rule.max_per_day,
                    });
                }
                return { ok: true };
            }

            default:
                // Unknown rule — pass by default (open world assumption)
                console.warn(`[POLICY ENGINE] Unknown rule type: ${rule.rule} — skipping`);
                return { ok: true };
        }
    }

    _audit(intent_type, intent, rule, result, outcome) {
        this.ledger.policy_audit.push({
            timestamp:   new Date().toISOString(),
            intent_type,
            intent_id:   intent?.intent_id,
            sl1_address: intent?.sl1_address,
            asset:       intent?.asset,
            amount:      parseFloat(intent?.amount || intent?.expected_amount || 0),
            rule:        rule?.rule || null,
            outcome,
            reason:      result.reason || null,
        });

        // Keep audit log bounded (last 5000 entries)
        if (this.ledger.policy_audit.length > 5000) {
            this.ledger.policy_audit.shift();
        }
    }
}

module.exports = { ConstitutionalPolicyEngine, DEFAULT_POLICIES, POLICY_RULES };
