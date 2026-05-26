'use strict';

/**
 * SIMPLE-L1 Constitutional DSL Interpreter
 *
 * Transforms the declarative constitutional document (constitution.json)
 * into live, evaluatable policy logic.
 *
 * The DSL supports:
 *
 * ── Conditions ───────────────────────────────────────────────────────────────
 *   { field, op, value }           — simple field comparison
 *   { and: [...conditions] }       — logical AND
 *   { or:  [...conditions] }       — logical OR
 *   { not: condition }             — logical NOT
 *
 * ── Operators ────────────────────────────────────────────────────────────────
 *   eq / neq                       — equality / inequality
 *   gt / gte / lt / lte            — numeric comparison
 *   in / not_in                    — set membership
 *   exists / not_exists            — field presence check
 *   matches                        — regex match (string fields)
 *
 * ── Actions ──────────────────────────────────────────────────────────────────
 *   deny     — block the intent with reason
 *   require  — annotate the intent with additional requirements
 *   allow    — explicit pass (terminates rule evaluation early)
 *
 * ── Evaluation ───────────────────────────────────────────────────────────────
 *   Rules are evaluated in declaration order.
 *   First "deny" terminates with VIOLATION.
 *   "require" annotates but does not block — adds to context.requirements[].
 *   "allow"  terminates with PASS (short-circuit).
 *   If all rules pass/require: PASS.
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// DSLEvalResult
// ---------------------------------------------------------------------------

class DSLViolation {
    constructor(rule_id, reason, context = {}) {
        this.ok       = false;
        this.rule_id  = rule_id;
        this.reason   = reason;
        this.context  = context;
        this.action   = 'deny';
    }
}

class DSLPass {
    constructor(rules_evaluated, requirements = []) {
        this.ok               = true;
        this.rules_evaluated  = rules_evaluated;
        this.requirements     = requirements;   // Accumulated "require" annotations
        this.evaluated_at     = new Date().toISOString();
    }
}

// ---------------------------------------------------------------------------
// ConstitutionalDSLInterpreter
// ---------------------------------------------------------------------------

class ConstitutionalDSLInterpreter {
    /**
     * @param {string} [constitutionPath]  - Path to constitution.json
     *                                       Defaults to ./constitution.json
     */
    constructor(constitutionPath = null) {
        const filePath = constitutionPath ||
            path.join(__dirname, 'constitution.json');

        this.constitution = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this._index       = this._buildIndex(this.constitution);

        console.log(
            `[CONSTITUTIONAL DSL] Loaded "${this.constitution.name}" v${this.constitution.version}. ` +
            `${this.constitution.policies.length} policies, ` +
            `${this.constitution.policies.reduce((s, p) => s + p.rules.length, 0)} rules.`
        );
    }

    // -----------------------------------------------------------------------
    // Core evaluation
    // -----------------------------------------------------------------------

    /**
     * Evaluate all DSL rules for an intent type against a context.
     *
     * @param {string} intent_type    - e.g. 'CROSS_CHAIN_DEPOSIT'
     * @param {object} facts          - Flat key-value map of evaluatable facts
     *                                  (merged from intent + proof + request context)
     * @returns {DSLPass | DSLViolation}
     */
    evaluate(intent_type, facts) {
        const policy = this._index[intent_type];

        if (!policy) {
            // No DSL policy — pass to code-level engine
            return new DSLPass(0, []);
        }

        const requirements = [];
        let   evaluated    = 0;

        for (const rule of policy.rules) {
            evaluated++;

            const conditionMet = this._evaluateCondition(rule.condition, facts);

            if (!conditionMet) {
                // Condition not triggered — skip this rule
                continue;
            }

            // Condition matched — apply action
            switch (rule.action) {
                case 'deny':
                    return new DSLViolation(rule.id, rule.reason, { facts_snapshot: this._snapshot(facts) });

                case 'allow':
                    // Explicit allow — short-circuit remaining rules
                    return new DSLPass(evaluated, requirements);

                case 'require':
                    // Annotate with requirements — do NOT block
                    requirements.push({
                        rule_id:      rule.id,
                        reason:       rule.reason,
                        requirements: rule.requirements || {},
                    });
                    break;

                default:
                    console.warn(`[DSL] Unknown action: ${rule.action} in rule ${rule.id}`);
            }
        }

        return new DSLPass(evaluated, requirements);
    }

    /**
     * Build a facts map from an intent and additional context.
     * Flattens all relevant fields into a single evaluatable object.
     *
     * @param {object} intent
     * @param {object} [context]
     * @returns {object}
     */
    buildFacts(intent, context = {}) {
        return {
            // Intent fields
            network:           intent?.network,
            asset:             intent?.asset,
            amount:            parseFloat(intent?.amount || intent?.expected_amount || context?.amount || 0),
            sl1_address:       intent?.sl1_address,
            intent_type:       intent?.type,
            intent_state:      intent?.state,

            // Settlement context
            confirmations:     context?.proof?.evidence?.confirmations ?? context?.confirmations ?? 0,
            block_number:      context?.proof?.evidence?.block_number ?? null,

            // Treasury / governance
            treasury_signature: context?.treasury_signature ?? false,

            // Time delay (for withdrawal delay rule)
            delay_elapsed_ms: this._computeDelay(intent),

            // Jurisdiction (extensible)
            jurisdiction:    context?.jurisdiction ?? null,

            // Self-transfer detection
            self_transfer: intent?.sl1_address && context?.recipient
                ? intent.sl1_address === context.recipient
                : false,

            // Pass through any extra context fields
            ...context,
        };
    }

    // -----------------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------------

    /**
     * Get the full constitution document.
     */
    getConstitution() {
        return this.constitution;
    }

    /**
     * Get all rules for a specific intent type with human-readable descriptions.
     */
    describePolicy(intent_type) {
        const policy = this._index[intent_type];
        if (!policy) return null;

        return {
            intent_type,
            description: policy.description,
            rule_count:  policy.rules.length,
            rules: policy.rules.map(r => ({
                id:          r.id,
                description: r.description,
                action:      r.action,
                reason:      r.reason,
                condition:   this._describeCondition(r.condition),
                requirements: r.requirements || null,
            })),
        };
    }

    /**
     * Explain WHY a given fact set would be denied.
     * Returns the first matching deny rule, or null if the intent would pass.
     *
     * @param {string} intent_type
     * @param {object} facts
     * @returns {{ rule, reason } | null}
     */
    explain(intent_type, facts) {
        const result = this.evaluate(intent_type, facts);
        if (result.ok) return null;
        return { rule_id: result.rule_id, reason: result.reason, context: result.context };
    }

    // -----------------------------------------------------------------------
    // Private — condition evaluation
    // -----------------------------------------------------------------------

    _evaluateCondition(condition, facts) {
        if (!condition) return false;

        // Logical operators
        if (condition.and) return condition.and.every(c => this._evaluateCondition(c, facts));
        if (condition.or)  return condition.or.some(c  => this._evaluateCondition(c, facts));
        if (condition.not) return !this._evaluateCondition(condition.not, facts);

        // Simple field comparison
        const { field, op, value } = condition;
        const factValue = this._getField(facts, field);

        switch (op) {
            case 'eq':         return factValue == value;
            case 'neq':        return factValue != value;
            case 'gt':         return parseFloat(factValue) >  parseFloat(value);
            case 'gte':        return parseFloat(factValue) >= parseFloat(value);
            case 'lt':         return parseFloat(factValue) <  parseFloat(value);
            case 'lte':        return parseFloat(factValue) <= parseFloat(value);
            case 'in':         return Array.isArray(value) && value.includes(factValue);
            case 'not_in':     return Array.isArray(value) && !value.includes(factValue);
            case 'exists':     return factValue !== undefined && factValue !== null;
            case 'not_exists': return factValue === undefined || factValue === null;
            case 'matches':    return typeof factValue === 'string' && new RegExp(value).test(factValue);
            default:
                console.warn(`[DSL] Unknown operator: ${op}`);
                return false;
        }
    }

    _getField(facts, field) {
        // Support dot notation: e.g. "proof.confirmations"
        return field.split('.').reduce((obj, key) => obj?.[key], facts);
    }

    _computeDelay(intent) {
        if (!intent?.state_history) return Infinity;   // No history → no delay imposed
        const verifiedEntry = intent.state_history.find(h => h.to === 'VERIFIED');
        if (!verifiedEntry) return Infinity;
        return Date.now() - new Date(verifiedEntry.at).getTime();
    }

    _describeCondition(condition) {
        if (!condition) return 'always';
        if (condition.and) return `ALL OF: [${condition.and.map(c => this._describeCondition(c)).join(', ')}]`;
        if (condition.or)  return `ANY OF: [${condition.or.map(c => this._describeCondition(c)).join(', ')}]`;
        if (condition.not) return `NOT: ${this._describeCondition(condition.not)}`;
        return `${condition.field} ${condition.op} ${JSON.stringify(condition.value)}`;
    }

    _buildIndex(constitution) {
        const index = {};
        for (const policy of constitution.policies) {
            index[policy.intent_type] = policy;
        }
        return index;
    }

    _snapshot(facts) {
        // Omit verbose fields from violation context
        const { treasury_signature, ...rest } = facts;
        return rest;
    }
}

module.exports = { ConstitutionalDSLInterpreter, DSLViolation, DSLPass };
