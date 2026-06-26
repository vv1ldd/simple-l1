'use strict';

// Pure email claim helpers for SL1E (ADR-0056).
// Email is a non-authoritative claim and notification hint, never identity authority.

const crypto = require('crypto');

const EMAIL_CLAIM_RULESET_VERSION = 'subject-authority-email-claim-v1';
const EMAIL_CLAIM_RULESET_STATUS = 'frozen';
const EMAIL_CLAIM_TYPE = 'controls_email';
const EMAIL_HASH_PREFIX = 'sha256:';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) return null;
    return normalized;
}

function hashEmail(value) {
    const normalized = normalizeEmail(value);
    if (!normalized) return null;
    const digest = crypto.createHash('sha256').update(normalized).digest('hex');
    return `${EMAIL_HASH_PREFIX}${digest}`;
}

function scopeIncludesEmail(scope) {
    if (scope === undefined || scope === null || scope === '') return false;
    const tokens = String(scope).trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.includes('email');
}

function buildEmailClaimProjection({ email, subject = null, issuer = null, evidenceRef = null } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) {
        return {
            ok: false,
            reason_codes: ['EMAIL_INVALID'],
            claim: null,
        };
    }

    return {
        ok: true,
        reason_codes: [],
        claim: {
            claim_type: EMAIL_CLAIM_TYPE,
            subject: subject || null,
            issuer: issuer || null,
            value_hash: hashEmail(normalized),
            evidence_ref: evidenceRef || null,
            ruleset_version: EMAIL_CLAIM_RULESET_VERSION,
        },
    };
}

function validateEmailDisclosure(disclosure = {}) {
    const reasonCodes = [];

    if (disclosure.email !== undefined && disclosure.email !== null && !normalizeEmail(disclosure.email)) {
        reasonCodes.push('EMAIL_INVALID');
    }

    if (disclosure.email_hash !== undefined && disclosure.email_hash !== null) {
        const hashPattern = /^sha256:[a-f0-9]{64}$/;
        if (!hashPattern.test(String(disclosure.email_hash))) {
            reasonCodes.push('EMAIL_HASH_INVALID');
        }
    }

    if (disclosure.email && disclosure.email_hash) {
        const expected = hashEmail(disclosure.email);
        if (expected !== disclosure.email_hash) {
            reasonCodes.push('EMAIL_HASH_MISMATCH');
        }
    }

    if (disclosure.is_controller === true || disclosure.is_recovery_path === true) {
        reasonCodes.push('EMAIL_AUTHORITY_ELEVATION_FORBIDDEN');
    }

    if (disclosure.is_subject_key === true) {
        reasonCodes.push('EMAIL_AS_SUBJECT_KEY_FORBIDDEN');
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: [...new Set(reasonCodes)],
    };
}

function buildConsentedEmailClaims({ email = null, scope = null, emailHash = null } = {}) {
    const base = {
        email: null,
        email_hash: null,
    };

    if (!scopeIncludesEmail(scope)) {
        if (email !== undefined && email !== null && email !== '') {
            return {
                ...base,
                _rejected: true,
                reason_codes: ['EMAIL_SCOPE_REQUIRED'],
            };
        }
        return base;
    }

    const normalized = normalizeEmail(email);
    if (email !== undefined && email !== null && email !== '' && !normalized) {
        return {
            ...base,
            _rejected: true,
            reason_codes: ['EMAIL_INVALID'],
        };
    }
    if (!normalized) {
        if (emailHash) {
            return {
                email: null,
                email_hash: String(emailHash),
            };
        }
        return base;
    }

    return {
        email: normalized,
        email_hash: hashEmail(normalized),
    };
}

function buildIdentityProofClaims({
    alias = null,
    displayAlias = null,
    display_alias: displayAliasSnake = null,
    email = null,
    scope = null,
} = {}) {
    const emailClaims = buildConsentedEmailClaims({ email, scope });
    if (emailClaims._rejected) {
        return {
            ok: false,
            reason_codes: emailClaims.reason_codes,
            claims: null,
        };
    }

    const claims = {
        alias: alias === undefined ? null : alias,
        display_alias: displayAlias ?? displayAliasSnake ?? null,
        email: emailClaims.email,
        email_hash: emailClaims.email_hash,
    };

    const validation = validateEmailDisclosure(claims);
    return {
        ok: validation.ok,
        reason_codes: validation.reason_codes,
        claims,
    };
}

function buildNotificationEmailHint(email) {
    const valueHash = hashEmail(email);
    if (!valueHash) {
        return {
            ok: false,
            reason_codes: ['EMAIL_INVALID'],
            recipient_hint: null,
        };
    }

    return {
        ok: true,
        reason_codes: [],
        recipient_hint: {
            type: 'email_hash',
            value: valueHash,
            authority_effect: 'none',
        },
    };
}

module.exports = {
    EMAIL_CLAIM_RULESET_VERSION,
    EMAIL_CLAIM_RULESET_STATUS,
    EMAIL_CLAIM_TYPE,
    EMAIL_HASH_PREFIX,
    normalizeEmail,
    hashEmail,
    scopeIncludesEmail,
    buildEmailClaimProjection,
    validateEmailDisclosure,
    buildConsentedEmailClaims,
    buildIdentityProofClaims,
    buildNotificationEmailHint,
};
