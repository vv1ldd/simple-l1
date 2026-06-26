'use strict';

const CLAIM_ISSUANCE_POLICY_RULESET_VERSION = 'subject-claim-issuance-policy-v1';
const CLAIM_ISSUANCE_POLICY_RULESET_STATUS = 'frozen';

const CLAIM_POLICY_DECISIONS = Object.freeze({
    ADMITTED: 'admitted',
    REJECTED: 'rejected',
    PENDING_EVIDENCE: 'pending_evidence',
    UNKNOWN: 'unknown',
});

const ISSUER_CLASSES = Object.freeze([
    'self_asserted',
    'delegated_assertion',
    'provider_assertion',
    'organization_assertion',
    'public_institution_assertion',
]);

const CLAIM_TYPE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const CLAIM_VALUE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function baseDecision(candidate, decision, reasonCodes = []) {
    return {
        schema_version: 'simple-l1.subject_claim_issuance_policy_decision.v1',
        ruleset_version: CLAIM_ISSUANCE_POLICY_RULESET_VERSION,
        ruleset_status: CLAIM_ISSUANCE_POLICY_RULESET_STATUS,
        decision,
        reason_codes: unique(reasonCodes),
        authority_effect: 'none',
        writes: [],
        candidate_id: normalizeString(candidate?.candidate_id) || null,
        subject: normalizeString(candidate?.subject) || null,
        claim_type: normalizeString(candidate?.claim_type) || null,
        issuer: {
            issuer_id: normalizeString(candidate?.issuer?.issuer_id) || null,
            issuer_class: normalizeString(candidate?.issuer?.issuer_class) || null,
        },
        emits_claim_event: false,
        emits_authority_event: false,
        disclosure_performed: false,
    };
}

function validateClaimEventCandidate(candidate = {}) {
    const reasonCodes = [];
    const candidateId = normalizeString(candidate.candidate_id);
    const subject = normalizeString(candidate.subject);
    const claimType = normalizeString(candidate.claim_type);
    const issuerId = normalizeString(candidate.issuer?.issuer_id);
    const issuerClass = normalizeString(candidate.issuer?.issuer_class);
    const valueHash = normalizeString(candidate.value_hash);

    if (!candidateId) reasonCodes.push('CLAIM_CANDIDATE_ID_REQUIRED');
    if (!subject) reasonCodes.push('CLAIM_SUBJECT_REQUIRED');
    if (!CLAIM_TYPE_PATTERN.test(claimType)) reasonCodes.push('CLAIM_TYPE_INVALID');
    if (!issuerId) reasonCodes.push('CLAIM_ISSUER_ID_REQUIRED');
    if (!ISSUER_CLASSES.includes(issuerClass)) reasonCodes.push('CLAIM_ISSUER_CLASS_INVALID');
    if (!CLAIM_VALUE_HASH_PATTERN.test(valueHash)) reasonCodes.push('CLAIM_VALUE_HASH_INVALID');
    if (!Array.isArray(candidate.evidence_refs)) reasonCodes.push('CLAIM_EVIDENCE_REFS_INVALID');

    return {
        ok: reasonCodes.length === 0,
        reason_codes: unique(reasonCodes),
    };
}

function evidenceMeetsRequirement(evidenceRefs, requirement) {
    const required = normalizeString(requirement);
    if (!required) return true;
    return evidenceRefs.some((ref) => normalizeString(ref).startsWith(`${required}:`) || normalizeString(ref) === required);
}

function evaluateClaimIssuancePolicy(candidateInput = {}, policyInput = {}) {
    const candidate = clone(candidateInput) || {};
    const policy = clone(policyInput) || {};
    const structural = validateClaimEventCandidate(candidate);
    if (!structural.ok) {
        return baseDecision(candidate, CLAIM_POLICY_DECISIONS.REJECTED, structural.reason_codes);
    }

    const claimType = normalizeString(candidate.claim_type);
    const issuerClass = normalizeString(candidate.issuer?.issuer_class);
    const rule = policy[claimType];
    if (!rule) {
        return baseDecision(candidate, CLAIM_POLICY_DECISIONS.UNKNOWN, ['CLAIM_POLICY_UNKNOWN']);
    }

    const allowedIssuerClasses = Array.isArray(rule.allowed_issuer_classes)
        ? rule.allowed_issuer_classes.map(normalizeString)
        : [];
    if (!allowedIssuerClasses.includes(issuerClass)) {
        return baseDecision(candidate, CLAIM_POLICY_DECISIONS.REJECTED, ['CLAIM_ISSUER_CLASS_NOT_ALLOWED']);
    }

    const requiredEvidence = Array.isArray(rule.required_evidence)
        ? rule.required_evidence.map(normalizeString).filter(Boolean)
        : [];
    const evidenceRefs = candidate.evidence_refs.map(normalizeString).filter(Boolean);
    const missingEvidence = requiredEvidence.filter((requirement) => !evidenceMeetsRequirement(evidenceRefs, requirement));
    if (missingEvidence.length > 0) {
        return {
            ...baseDecision(candidate, CLAIM_POLICY_DECISIONS.PENDING_EVIDENCE, ['CLAIM_REQUIRED_EVIDENCE_MISSING']),
            missing_evidence: missingEvidence,
        };
    }

    return baseDecision(candidate, CLAIM_POLICY_DECISIONS.ADMITTED, []);
}

module.exports = {
    CLAIM_ISSUANCE_POLICY_RULESET_STATUS,
    CLAIM_ISSUANCE_POLICY_RULESET_VERSION,
    CLAIM_POLICY_DECISIONS,
    ISSUER_CLASSES,
    evaluateClaimIssuancePolicy,
    validateClaimEventCandidate,
};
