'use strict';

const FPL_VERDICT = Object.freeze({
    CANDIDATE: 'candidate',
    CHALLENGED: 'challenged',
    FINALIZED: 'finalized',
    INVALIDATED: 'invalidated',
    REJECTED: 'rejected',
});

function evaluateFpl(graph, context = {}) {
    const txFact = findTxFact(graph);
    if (!txFact) {
        return verdict(FPL_VERDICT.REJECTED, ['EVM_TX_FACT_MISSING'], null, context);
    }

    if (context.receipt_exists === false) {
        return verdict(FPL_VERDICT.REJECTED, ['RECEIPT_MISSING'], txFact, context);
    }

    if (graph.observation?.evidence_completeness === 'partial' || context.required_evidence_present === false) {
        return verdict(FPL_VERDICT.CHALLENGED, ['REQUIRED_EVIDENCE_MISSING'], txFact, context);
    }

    if (context.known_reorg_contradiction === true) {
        return verdict(FPL_VERDICT.INVALIDATED, ['KNOWN_REORG_CONTRADICTION'], txFact, context);
    }

    if (context.observed_block_hash && normalize(context.observed_block_hash) !== txFact.block_hash) {
        return verdict(FPL_VERDICT.INVALIDATED, ['BLOCK_HASH_MISMATCH'], txFact, context);
    }

    const requiredConfirmations = Number(context.required_confirmations ?? 0);
    const currentBlock = Number(context.current_block ?? txFact.block_number);
    const blockNumber = Number(txFact.block_number);
    const confirmations = Math.max(0, currentBlock - blockNumber);

    if (confirmations < requiredConfirmations) {
        return verdict(FPL_VERDICT.CANDIDATE, ['INSUFFICIENT_CONFIRMATIONS'], txFact, context, confirmations, requiredConfirmations);
    }

    return verdict(FPL_VERDICT.FINALIZED, ['FPL_ELIGIBILITY_SATISFIED'], txFact, context, confirmations, requiredConfirmations);
}

function findTxFact(graph) {
    return (graph?.facts || []).find((fact) => fact.fact_type === 'EVM_TX') || null;
}

function normalize(value) {
    return String(value || '').toLowerCase();
}

function verdict(result, reasonCodes, txFact, context, confirmations = null, requiredConfirmations = null) {
    return {
        object_type: 'FPLVerdict',
        fpl_version: 'FPL_v0',
        verdict: result,
        reason_codes: reasonCodes,
        fact_id: txFact?.fact_id || null,
        chain_id: txFact?.chain_id || null,
        tx_hash: txFact?.tx_hash || null,
        confirmations,
        required_confirmations: requiredConfirmations,
        semantic_interpretation_allowed: false,
        ownership_verdict: null,
        reconciliation_output: null,
        context_id: context.context_id || null,
    };
}

module.exports = {
    evaluateFpl,
    FPL_VERDICT,
};
