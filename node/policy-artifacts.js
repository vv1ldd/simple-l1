'use strict';

const { artifactId, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');

function ensurePolicyStores(ledger) {
    ensureArrayStore(ledger, 'policy_evaluations');
    ensureArrayStore(ledger, 'policy_decisions');

    return ledger;
}

function normalizePolicyDecision(result) {
    if (result?.decision) {
        return String(result.decision).toLowerCase();
    }

    if (result?.ok === true) {
        return 'allow';
    }

    if (result?.requires_more_evidence) {
        return 'require_more_evidence';
    }

    if (result?.requires_more_authorization) {
        return 'require_more_authorization';
    }

    return 'deny';
}

function reasonCodesFromResult(result) {
    if (Array.isArray(result?.reason_codes)) {
        return result.reason_codes;
    }

    if (result?.rule) {
        return [`POLICY_RULE_${String(result.rule).toUpperCase()}_FAILED`];
    }

    if (result?.reason) {
        return [String(result.reason).toUpperCase().replace(/[^A-Z0-9]+/g, '_')];
    }

    return result?.ok === true ? ['POLICY_ALLOW'] : ['POLICY_DENY'];
}

function recordPolicyArtifacts(ledger, input, result, now = new Date()) {
    ensurePolicyStores(ledger);

    const intentType = String(input.intent_type || input.intentType || '');
    if (!intentType) {
        throw new Error('intent_type is required');
    }

    const facts = input.facts || {
        intent: input.intent || {},
        context: input.context || {},
    };
    const evaluatedAt = input.evaluated_at || now.toISOString();
    const evaluationBasis = {
        intent_type: intentType,
        facts_hash: hashObject(facts),
        policy_version: input.policy_version || 'runtime-policy-v1',
        evaluated_at: evaluatedAt,
    };
    const evaluation = {
        id: input.evaluation_id || artifactId('peval', evaluationBasis, 24),
        object_type: 'PolicyEvaluation',
        intent_type: intentType,
        facts,
        facts_hash: evaluationBasis.facts_hash,
        input_hash: hashObject({ intent_type: intentType, facts }),
        policy_version: evaluationBasis.policy_version,
        evaluated_at: evaluatedAt,
        rules_evaluated: result?.policies_evaluated || result?.rules_evaluated || 0,
    };

    const decision = normalizePolicyDecision(result);
    const decisionBasis = {
        policy_evaluation_id: evaluation.id,
        decision,
        reason_codes: reasonCodesFromResult(result),
    };
    const policyDecision = {
        id: input.decision_id || artifactId('pdec', decisionBasis, 24),
        object_type: 'PolicyDecision',
        policy_evaluation_id: evaluation.id,
        decision,
        reason_codes: decisionBasis.reason_codes,
        result: result || {},
        decided_at: input.decided_at || evaluatedAt,
    };

    upsertById(ledger.policy_evaluations, evaluation);
    upsertById(ledger.policy_decisions, policyDecision);

    return { evaluation, decision: policyDecision };
}

function evaluatePolicyToArtifacts(policyEngine, ledger, input, now = new Date()) {
    if (!policyEngine || typeof policyEngine.evaluate !== 'function') {
        throw new Error('policyEngine with evaluate() is required');
    }

    const result = policyEngine.evaluate(input.intent_type, input.intent || {}, input.context || {});

    return recordPolicyArtifacts(ledger, input, result, now);
}

module.exports = {
    ensurePolicyStores,
    evaluatePolicyToArtifacts,
    normalizePolicyDecision,
    recordPolicyArtifacts,
};
