'use strict';

const { artifactId, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');
const { verifyAuthorization } = require('./authority-runtime');
const { verifyExternalProof } = require('./external-proof-runtime');

function ensureMarketplaceStores(ledger) {
    ensureArrayStore(ledger, 'transactions');
    ensureArrayStore(ledger, 'settlement_operations');
    ensureArrayStore(ledger, 'settlement_proofs');
    ensureArrayStore(ledger, 'settlement_idempotency_keys');

    return ledger;
}

function getPolicyDecision(ledger, id) {
    return (ledger.policy_decisions || []).find((candidate) => candidate.id === id) || null;
}

function executeMarketplaceSettlement(ledger, input, now = new Date()) {
    ensureMarketplaceStores(ledger);

    const authorizationCheck = verifyAuthorization(ledger, input.authorization_id || input.authorization, now);
    if (!authorizationCheck.ok) {
        return { ok: false, reason_codes: authorizationCheck.reason_codes };
    }

    const externalProofCheck = verifyExternalProof(ledger, input.external_proof_id || input.externalProof);
    if (!externalProofCheck.ok) {
        return { ok: false, reason_codes: externalProofCheck.reason_codes };
    }

    const authorization = authorizationCheck.authorization;
    const policyDecision = getPolicyDecision(ledger, authorization.policy_decision_id);
    if (!policyDecision || policyDecision.decision !== 'allow') {
        return { ok: false, reason_codes: ['POLICY_DECISION_NOT_ALLOW'] };
    }

    const idempotencyKey = input.idempotency_key || hashObject({
        purchase_intent_id: input.purchase_intent_id,
        external_proof_id: externalProofCheck.proof.id,
        authorization_id: authorization.id,
    });

    if (ledger.settlement_idempotency_keys.includes(idempotencyKey)) {
        return { ok: false, reason_codes: ['SETTLEMENT_REPLAY_DETECTED'] };
    }

    const transaction = {
        id: input.transaction_id || artifactId('tx', { idempotencyKey, authorization_id: authorization.id }, 24),
        object_type: 'Transaction',
        transaction_type: input.transaction_type || 'marketplace.fulfill_order',
        authorization_id: authorization.id,
        external_proof_id: externalProofCheck.proof.id,
        policy_decision_id: policyDecision.id,
        payload: input.payload || {},
        executed_at: input.executed_at || now.toISOString(),
    };

    const settlementOperation = {
        id: input.settlement_operation_id || artifactId('settle', { idempotencyKey, transaction_id: transaction.id }, 24),
        object_type: 'SettlementOperation',
        transaction_id: transaction.id,
        operation_type: input.operation_type || 'marketplace.fulfillment_recorded',
        idempotency_key: idempotencyKey,
        applied_at: input.applied_at || now.toISOString(),
    };

    const lineage = {
        facts: [externalProofCheck.normalizedFact.id],
        policy_evaluation_id: policyDecision.policy_evaluation_id,
        policy_decision_id: policyDecision.id,
        capability_ids: [authorization.capability_id].filter(Boolean),
        control_grant_ids: authorization.matched_grants || [],
        authorization_id: authorization.id,
        transaction_id: transaction.id,
        settlement_operation_id: settlementOperation.id,
    };

    const settlementProof = {
        id: input.settlement_proof_id || artifactId('sproof', lineage, 24),
        object_type: 'SettlementProof',
        settlement_operation_id: settlementOperation.id,
        transaction_id: transaction.id,
        lineage,
        proof_hash: hashObject(lineage),
        issued_at: input.issued_at || now.toISOString(),
    };

    upsertById(ledger.transactions, transaction);
    upsertById(ledger.settlement_operations, settlementOperation);
    upsertById(ledger.settlement_proofs, settlementProof);
    ledger.settlement_idempotency_keys.push(idempotencyKey);

    return {
        ok: true,
        transaction,
        settlementOperation,
        settlementProof,
        reason_codes: ['SETTLEMENT_LINEAGE_COMPLETE'],
    };
}

function explainSettlement(ledger, settlementProofId) {
    const settlementProof = (ledger.settlement_proofs || []).find((candidate) => candidate.id === settlementProofId);
    if (!settlementProof) {
        return { ok: false, reason_codes: ['SETTLEMENT_PROOF_NOT_FOUND'] };
    }

    const lineage = settlementProof.lineage || {};
    const complete = !!(
        lineage.facts?.length
        && lineage.policy_evaluation_id
        && lineage.policy_decision_id
        && lineage.capability_ids?.length
        && lineage.control_grant_ids?.length
        && lineage.authorization_id
        && lineage.transaction_id
        && lineage.settlement_operation_id
    );

    return {
        ok: complete,
        settlementProof,
        lineage,
        reason_codes: complete ? ['LINEAGE_COMPLETE'] : ['LINEAGE_INCOMPLETE'],
    };
}

module.exports = {
    ensureMarketplaceStores,
    executeMarketplaceSettlement,
    explainSettlement,
};
