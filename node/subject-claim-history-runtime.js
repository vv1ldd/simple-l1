'use strict';

const { buildConsentedEmailClaims, hashEmail, normalizeEmail } = require('./subject-email-claims');

const CLAIM_HISTORY_RULESET_VERSION = 'subject-claim-history-v1';
const CLAIM_HISTORY_RULESET_STATUS = 'frozen';

const CLAIM_EVENT_TYPES = Object.freeze({
    ISSUED: 'CLAIM_ISSUED',
    SUPERSEDED: 'CLAIM_SUPERSEDED',
    REVOKED: 'CLAIM_REVOKED',
});

const CLAIM_STATUS = Object.freeze({
    ACTIVE: 'active',
    SUPERSEDED: 'superseded',
    REVOKED: 'revoked',
});

const CLAIM_VALUE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CLAIM_TYPE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function validateClaimEvent(event = {}) {
    const reasonCodes = [];
    const eventType = normalizeString(event.event_type);
    const eventId = normalizeString(event.event_id);
    const subject = normalizeString(event.subject);
    const claimType = normalizeString(event.claim_type);
    const valueHash = normalizeString(event.value_hash);

    if (!Object.values(CLAIM_EVENT_TYPES).includes(eventType)) {
        reasonCodes.push('CLAIM_EVENT_TYPE_INVALID');
    }
    if (!eventId) {
        reasonCodes.push('CLAIM_EVENT_ID_REQUIRED');
    }
    if (!subject) {
        reasonCodes.push('CLAIM_SUBJECT_REQUIRED');
    }
    if (!CLAIM_TYPE_PATTERN.test(claimType)) {
        reasonCodes.push('CLAIM_TYPE_INVALID');
    }
    if ([CLAIM_EVENT_TYPES.ISSUED, CLAIM_EVENT_TYPES.SUPERSEDED].includes(eventType)
        && !CLAIM_VALUE_HASH_PATTERN.test(valueHash)) {
        reasonCodes.push('CLAIM_VALUE_HASH_INVALID');
    }
    if (eventType === CLAIM_EVENT_TYPES.SUPERSEDED && !normalizeString(event.supersedes)) {
        reasonCodes.push('CLAIM_SUPERSEDES_REQUIRED');
    }
    if (eventType === CLAIM_EVENT_TYPES.REVOKED && !normalizeString(event.revokes)) {
        reasonCodes.push('CLAIM_REVOKES_REQUIRED');
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: [...new Set(reasonCodes)],
    };
}

function createActiveClaimFromEvent(event, status = CLAIM_STATUS.ACTIVE) {
    return {
        claim_id: normalizeString(event.event_id),
        subject: normalizeString(event.subject),
        claim_type: normalizeString(event.claim_type),
        status,
        value_hash: normalizeString(event.value_hash),
        disclosure_value: event.disclosure_value === undefined ? null : event.disclosure_value,
        evidence_ref: event.evidence_ref === undefined ? null : event.evidence_ref,
        issued_at: normalizeString(event.occurred_at) || null,
        supersedes: normalizeString(event.supersedes) || null,
        superseded_by: null,
        revoked_by: null,
    };
}

function publicClaim(claim) {
    const result = {
        claim_id: claim.claim_id,
        subject: claim.subject,
        claim_type: claim.claim_type,
        status: claim.status,
        value_hash: claim.value_hash,
    };

    if (claim.evidence_ref) result.evidence_ref = claim.evidence_ref;
    if (claim.issued_at) result.issued_at = claim.issued_at;
    if (claim.supersedes) result.supersedes = claim.supersedes;
    if (claim.superseded_by) result.superseded_by = claim.superseded_by;
    if (claim.revoked_by) result.revoked_by = claim.revoked_by;
    if (claim.disclosure_value !== undefined && claim.disclosure_value !== null) {
        result.disclosure_value = claim.disclosure_value;
    }

    return result;
}

function deriveActiveClaimProjection(claimHistory = [], filters = {}) {
    const history = Array.isArray(claimHistory) ? clone(claimHistory) : [];
    const claims = new Map();
    const rejectedEvents = [];
    const seenEventIds = new Set();

    for (const event of history) {
        const validation = validateClaimEvent(event);
        const eventId = normalizeString(event?.event_id);
        if (eventId && seenEventIds.has(eventId)) {
            validation.ok = false;
            validation.reason_codes = [...new Set([...validation.reason_codes, 'CLAIM_EVENT_ID_DUPLICATE'])];
        }
        if (eventId) seenEventIds.add(eventId);

        if (!validation.ok) {
            rejectedEvents.push({
                event_id: eventId || null,
                reason_codes: validation.reason_codes,
            });
            continue;
        }

        if (event.event_type === CLAIM_EVENT_TYPES.ISSUED) {
            claims.set(eventId, createActiveClaimFromEvent(event));
            continue;
        }

        if (event.event_type === CLAIM_EVENT_TYPES.SUPERSEDED) {
            const targetId = normalizeString(event.supersedes);
            const target = claims.get(targetId);
            if (!target || target.subject !== normalizeString(event.subject) || target.claim_type !== normalizeString(event.claim_type)) {
                rejectedEvents.push({
                    event_id: eventId,
                    reason_codes: ['CLAIM_SUPERSESSION_TARGET_INVALID'],
                });
                continue;
            }
            target.status = CLAIM_STATUS.SUPERSEDED;
            target.superseded_by = eventId;
            claims.set(eventId, createActiveClaimFromEvent(event));
            continue;
        }

        if (event.event_type === CLAIM_EVENT_TYPES.REVOKED) {
            const targetId = normalizeString(event.revokes);
            const target = claims.get(targetId);
            if (!target || target.subject !== normalizeString(event.subject) || target.claim_type !== normalizeString(event.claim_type)) {
                rejectedEvents.push({
                    event_id: eventId,
                    reason_codes: ['CLAIM_REVOCATION_TARGET_INVALID'],
                });
                continue;
            }
            target.status = CLAIM_STATUS.REVOKED;
            target.revoked_by = eventId;
        }
    }

    const subjectFilter = normalizeString(filters.subject);
    const claimTypeFilter = normalizeString(filters.claim_type || filters.claimType);
    const claimList = [...claims.values()].filter((claim) => {
        if (subjectFilter && claim.subject !== subjectFilter) return false;
        if (claimTypeFilter && claim.claim_type !== claimTypeFilter) return false;
        return true;
    });

    const activeClaims = claimList
        .filter((claim) => claim.status === CLAIM_STATUS.ACTIVE)
        .map(publicClaim);
    const inactiveClaims = claimList
        .filter((claim) => claim.status !== CLAIM_STATUS.ACTIVE)
        .map(publicClaim);

    return {
        schema_version: 'simple-l1.active_claim_projection.v1',
        ruleset_version: CLAIM_HISTORY_RULESET_VERSION,
        ruleset_status: CLAIM_HISTORY_RULESET_STATUS,
        projection_type: 'active_claim_projection',
        authoritative_for_subject: false,
        subject: subjectFilter || null,
        active_claims: activeClaims,
        inactive_claims: inactiveClaims,
        rejected_events: rejectedEvents,
    };
}

function activeClaimForType(projection, claimType) {
    const wanted = normalizeString(claimType);
    return (projection?.active_claims || []).find((claim) => claim.claim_type === wanted) || null;
}

function emailDisclosureFromClaimHistory({ claimHistory = [], subject = null, scope = null } = {}) {
    const projection = deriveActiveClaimProjection(claimHistory, {
        subject,
        claim_type: 'controls_email',
    });
    const activeEmailClaim = activeClaimForType(projection, 'controls_email');
    if (!activeEmailClaim) {
        return {
            email: null,
            email_hash: null,
            active_claim_projection: projection,
        };
    }

    const disclosureValue = normalizeEmail(activeEmailClaim.disclosure_value);
    const emailHash = activeEmailClaim.value_hash || (disclosureValue ? hashEmail(disclosureValue) : null);
    const disclosure = buildConsentedEmailClaims({
        email: disclosureValue,
        emailHash,
        scope,
    });

    return {
        email: disclosure.email,
        email_hash: disclosure.email_hash,
        active_claim_projection: projection,
    };
}

module.exports = {
    CLAIM_EVENT_TYPES,
    CLAIM_HISTORY_RULESET_STATUS,
    CLAIM_HISTORY_RULESET_VERSION,
    CLAIM_STATUS,
    activeClaimForType,
    deriveActiveClaimProjection,
    emailDisclosureFromClaimHistory,
    validateClaimEvent,
};
