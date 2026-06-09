'use strict';

const RECONCILIATION_RESULT = Object.freeze({
    MATCHED: 'MATCHED',
    NOT_MATCHED: 'NOT_MATCHED',
    AMBIGUOUS: 'AMBIGUOUS',
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',
});

function reconcile(finalizedGraph, fplVerdict, intent) {
    if (!fplVerdict || fplVerdict.verdict !== 'finalized') {
        return result(RECONCILIATION_RESULT.NOT_ELIGIBLE, ['FPL_VERDICT_NOT_FINALIZED'], null);
    }

    if (Array.isArray(intent)) {
        return reconcileIntentSet(finalizedGraph, intent);
    }

    if (!intent || !['ERC20_TRANSFER', 'EVM_NATIVE_TRANSFER'].includes(intent.intent_type)) {
        return result(RECONCILIATION_RESULT.NOT_MATCHED, ['UNSUPPORTED_OR_MISSING_INTENT'], null);
    }

    if (intent.duplicate_intent_count && Number(intent.duplicate_intent_count) > 1) {
        return result(RECONCILIATION_RESULT.AMBIGUOUS, ['DUPLICATE_INTENT_CANDIDATES'], null);
    }

    if (intent.intent_type === 'EVM_NATIVE_TRANSFER') {
        return reconcileNativeTransfer(finalizedGraph, intent);
    }

    const candidates = erc20TransferNodes(finalizedGraph).filter((node) => (
        same(node.inputs.chain_id, intent.chain_id) &&
        same(node.inputs.token_contract, intent.token_contract) &&
        (!intent.sender || same(node.inputs.topic_from, intent.sender)) &&
        same(node.inputs.topic_to, intent.recipient) &&
        BigInt(node.inputs.raw_amount) >= BigInt(intent.amount_raw)
    ));

    if (candidates.length === 0) {
        return result(RECONCILIATION_RESULT.NOT_MATCHED, ['ERC20_TRANSFER_INTENT_NOT_MATCHED'], null);
    }
    if (candidates.length > 1) {
        return result(RECONCILIATION_RESULT.AMBIGUOUS, ['MULTIPLE_MATCHING_ERC20_TRANSFERS'], null);
    }
    if (isCompositeTransaction(finalizedGraph, candidates[0])) {
        return result(RECONCILIATION_RESULT.AMBIGUOUS, ['COMPOSITE_TRANSACTION_REQUIRES_FACT_SELECTOR'], null);
    }

    return result(RECONCILIATION_RESULT.MATCHED, ['ERC20_TRANSFER_INTENT_MATCHED'], candidates[0].fact_id);
}

function reconcileNativeTransfer(finalizedGraph, intent) {
    const candidates = txFacts(finalizedGraph).filter((fact) => (
        fact.receipt_status === '1' &&
        same(fact.chain_id, intent.chain_id) &&
        (!intent.sender || same(fact.raw_data.from, intent.sender)) &&
        same(fact.raw_data.to, intent.recipient) &&
        BigInt(fact.raw_data.value) >= BigInt(intent.amount_raw)
    ));

    if (candidates.length === 0) {
        return result(RECONCILIATION_RESULT.NOT_MATCHED, ['EVM_NATIVE_TRANSFER_INTENT_NOT_MATCHED'], null);
    }
    if (candidates.length > 1) {
        return result(RECONCILIATION_RESULT.AMBIGUOUS, ['MULTIPLE_MATCHING_EVM_NATIVE_TRANSFERS'], null);
    }

    return result(RECONCILIATION_RESULT.MATCHED, ['EVM_NATIVE_TRANSFER_INTENT_MATCHED'], candidates[0].fact_id);
}

function reconcileIntentSet(finalizedGraph, intents) {
    const matches = intents
        .map((candidate) => ({ intent: candidate, result: reconcile(finalizedGraph, { verdict: 'finalized' }, candidate) }))
        .filter((entry) => entry.result.status === RECONCILIATION_RESULT.MATCHED);

    if (matches.length === 0) {
        return result(RECONCILIATION_RESULT.NOT_MATCHED, ['NO_INTENT_CANDIDATE_MATCHED'], null);
    }
    if (matches.length > 1) {
        return result(RECONCILIATION_RESULT.AMBIGUOUS, ['MULTIPLE_INTENT_CANDIDATES_MATCHED'], null);
    }

    return matches[0].result;
}

function erc20TransferNodes(graph) {
    return (graph?.sdga_projection?.nodes || []).filter((node) => node.node_type === 'ERC20_TRANSFER_NODE');
}

function txFacts(graph) {
    return (graph?.facts || []).filter((fact) => fact.fact_type === 'EVM_TX');
}

function logNodes(graph) {
    return (graph?.sdga_projection?.nodes || []).filter((node) => node.node_type === 'EVM_LOG_NODE');
}

function isCompositeTransaction(graph, candidate) {
    return logNodes(graph).filter((node) => (
        same(node.inputs.chain_id, candidate.inputs.chain_id) &&
        same(node.inputs.tx_hash, candidate.inputs.tx_hash)
    )).length > 1;
}

function same(left, right) {
    return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function result(status, reasonCodes, matchedFactId) {
    return {
        object_type: 'ReconciliationResult',
        reconciliation_version: 'RECONCILIATION_v0',
        status,
        reason_codes: reasonCodes,
        matched_fact_id: matchedFactId,
        ownership_verdict: null,
        state_mutation: null,
    };
}

module.exports = {
    reconcile,
    RECONCILIATION_RESULT,
};
