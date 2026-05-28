'use strict';

const { artifactId, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');

function ensureExternalProofStores(ledger) {
    ensureArrayStore(ledger, 'external_proofs');
    ensureArrayStore(ledger, 'normalized_facts');
    ensureArrayStore(ledger, 'verification_paths');
    ensureArrayStore(ledger, 'finality_claims');
    ensureArrayStore(ledger, 'external_proof_replay_keys');

    return ledger;
}

function assertExternalProofInput(input) {
    const sourceDomain = String(input.source_domain || '');
    const proofType = String(input.proof_type || '');
    const externalReference = input.external_reference || {};
    const referenceId = String(externalReference.id || input.external_reference_id || '');

    if (!sourceDomain || !proofType || !referenceId) {
        throw new Error('source_domain, proof_type and external_reference.id are required');
    }

    return { sourceDomain, proofType, externalReference: { ...externalReference, id: referenceId } };
}

function createExternalProof(ledger, input, now = new Date()) {
    ensureExternalProofStores(ledger);

    const { sourceDomain, proofType, externalReference } = assertExternalProofInput(input);
    const observedAt = input.observed_at || now.toISOString();
    const replayKey = hashObject({ source_domain: sourceDomain, proof_type: proofType, external_reference_id: externalReference.id });

    if (ledger.external_proof_replay_keys.includes(replayKey) && input.allow_duplicate !== true) {
        throw new Error('ExternalProof replay detected');
    }

    const verificationPath = {
        id: input.verification_path_id || artifactId('vpath', { sourceDomain, proofType, externalReference, observedAt }, 20),
        object_type: 'VerificationPath',
        source_domain: sourceDomain,
        proof_type: proofType,
        verifier: input.verifier || 'dev-adapter',
        steps: input.verification_steps || [],
        verified_at: input.verified_at || observedAt,
    };

    const finalityClaim = {
        id: input.finality_claim_id || artifactId('finality', { sourceDomain, externalReference, observedAt }, 20),
        object_type: 'FinalityClaim',
        source_domain: sourceDomain,
        external_reference_id: externalReference.id,
        finality: input.finality || 'accepted',
        confirmations: Number(input.confirmations ?? 0),
        challenge_window_ends_at: input.challenge_window_ends_at || null,
        claimed_at: input.claimed_at || observedAt,
    };

    const normalizedFact = {
        id: input.normalized_fact_id || artifactId('fact', { sourceDomain, proofType, externalReference, payload: input.normalized_payload || input.payload || {} }, 24),
        object_type: 'NormalizedFact',
        source_domain: sourceDomain,
        fact_type: input.fact_type || proofType,
        external_reference_id: externalReference.id,
        payload: input.normalized_payload || input.payload || {},
        observed_at: observedAt,
    };

    const externalProof = {
        id: input.id || artifactId('xproof', { sourceDomain, proofType, externalReference, replayKey }, 24),
        object_type: 'ExternalProof',
        source_domain: sourceDomain,
        proof_type: proofType,
        external_reference: externalReference,
        verification_path_id: verificationPath.id,
        finality_claim_id: finalityClaim.id,
        normalized_fact_id: normalizedFact.id,
        replay_key: replayKey,
        status: input.status || 'verified',
        observed_at: observedAt,
        proof_hash: hashObject(input.proof_payload || input.payload || externalReference),
    };

    upsertById(ledger.verification_paths, verificationPath);
    upsertById(ledger.finality_claims, finalityClaim);
    upsertById(ledger.normalized_facts, normalizedFact);
    upsertById(ledger.external_proofs, externalProof);
    ledger.external_proof_replay_keys.push(replayKey);

    return {
        externalProof,
        normalizedFact,
        verificationPath,
        finalityClaim,
    };
}

function verifyExternalProof(ledger, proofOrId) {
    ensureExternalProofStores(ledger);

    const proof = typeof proofOrId === 'string'
        ? ledger.external_proofs.find((candidate) => candidate.id === proofOrId)
        : proofOrId;

    if (!proof) {
        return { ok: false, reason_codes: ['EXTERNAL_PROOF_NOT_FOUND'] };
    }

    if (proof.status !== 'verified') {
        return { ok: false, proof, reason_codes: ['EXTERNAL_PROOF_NOT_VERIFIED'] };
    }

    const fact = ledger.normalized_facts.find((candidate) => candidate.id === proof.normalized_fact_id);
    const path = ledger.verification_paths.find((candidate) => candidate.id === proof.verification_path_id);
    const finality = ledger.finality_claims.find((candidate) => candidate.id === proof.finality_claim_id);

    if (!fact || !path || !finality) {
        return { ok: false, proof, reason_codes: ['EXTERNAL_PROOF_LINEAGE_INCOMPLETE'] };
    }

    return {
        ok: true,
        proof,
        normalizedFact: fact,
        verificationPath: path,
        finalityClaim: finality,
        reason_codes: ['EXTERNAL_PROOF_VALID'],
    };
}

module.exports = {
    createExternalProof,
    ensureExternalProofStores,
    verifyExternalProof,
};
