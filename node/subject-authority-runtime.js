'use strict';

const crypto = require('crypto');

const AUTHORITY_EVENT_SCHEMA_VERSION = 'simple-l1.subject_authority.authority_event.v1';
const AUTHORITY_EVENT_TYPE = 'authority_event';

const AUTHORITY_DOMAINS = Object.freeze([
    'identity',
    'device',
    'finance',
    'organization',
    'application',
]);

const DOMAIN_ACTIONS = Object.freeze({
    identity: new Set([
        'genesis',
        'bind_controller',
        'revoke_controller',
        'rotate_key',
        'accept_claim',
        'bind_relationship',
    ]),
    device: new Set([
        'bind_device',
        'transfer_device',
        'bind_relationship',
    ]),
    finance: new Set([
        'grant_capability',
        'revoke_capability',
    ]),
    organization: new Set([
        'grant_capability',
        'revoke_capability',
    ]),
    application: new Set([
        'grant_capability',
        'revoke_capability',
    ]),
});

const SUBJECT_ADDRESS_PATTERN = /^sl1:(id|device|agent|org):[a-z0-9][a-z0-9._:-]{1,127}$/;
const LEGACY_ENTITY_PATTERN = /^sl1e_[a-f0-9]{39,64}$/i;
const LEGACY_KEY_PATTERN = /^sl1_[a-f0-9]{32,64}$/i;

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sha256Ref(value) {
    return `sha256:${sha256Hex(value)}`;
}

function authorityEventId(value) {
    return `ae_${sha256Hex(stableStringify(value)).slice(0, 32)}`;
}

function normalizeSubjectAddress(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return SUBJECT_ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

function subjectFromLegacyEntity(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!LEGACY_ENTITY_PATTERN.test(normalized)) return null;
    return `sl1:id:${normalized}`;
}

function agentFromLegacyKey(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!LEGACY_KEY_PATTERN.test(normalized)) return null;
    return `sl1:agent:${normalized}`;
}

function normalizeNullableString(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}

function normalizeAuthorityEvent(input = {}) {
    const proof = input.proof && typeof input.proof === 'object' ? input.proof : {};
    const basis = {
        schema_version: input.schema_version || AUTHORITY_EVENT_SCHEMA_VERSION,
        type: input.type || AUTHORITY_EVENT_TYPE,
        subject: normalizeSubjectAddress(input.subject) || String(input.subject || '').trim().toLowerCase(),
        authority_domain: String(input.authority_domain || '').trim().toLowerCase(),
        action: String(input.action || '').trim().toLowerCase(),
        target: String(input.target || '').trim().toLowerCase(),
        recipient: input.recipient === undefined ? null : normalizeSubjectAddress(input.recipient),
        capability: normalizeNullableString(input.capability),
        scope: normalizeNullableString(input.scope),
        expires_at: normalizeNullableString(input.expires_at),
        proof: {
            type: String(proof.type || '').trim().toLowerCase(),
            controller: normalizeSubjectAddress(proof.controller) || String(proof.controller || '').trim().toLowerCase(),
            signature: proof.signature === undefined ? null : normalizeNullableString(proof.signature),
            legacy_event_id: proof.legacy_event_id === undefined ? null : normalizeNullableString(proof.legacy_event_id),
            evidence_hash: proof.evidence_hash === undefined ? null : normalizeNullableString(proof.evidence_hash),
        },
        timestamp: normalizeNullableString(input.timestamp),
        previous_state_reference: input.previous_state_reference === undefined ? null : normalizeNullableString(input.previous_state_reference),
        causal_parents: Array.isArray(input.causal_parents) ? input.causal_parents.map(String).sort() : [],
        metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {},
    };

    return {
        event_id: input.event_id || authorityEventId(basis),
        ...basis,
    };
}

function validateAuthorityEvent(event, { knownEventIds = null, expectedPreviousStateReference = undefined } = {}) {
    const normalized = normalizeAuthorityEvent(event);
    const reasonCodes = [];

    if (normalized.schema_version !== AUTHORITY_EVENT_SCHEMA_VERSION || normalized.type !== AUTHORITY_EVENT_TYPE) {
        reasonCodes.push('SEMANTIC_CLASS_INVALID');
    }
    if (!normalizeSubjectAddress(normalized.subject)) {
        reasonCodes.push('SUBJECT_INVALID');
    }
    if (!AUTHORITY_DOMAINS.includes(normalized.authority_domain)) {
        reasonCodes.push('UNKNOWN_AUTHORITY_DOMAIN');
    } else if (!DOMAIN_ACTIONS[normalized.authority_domain].has(normalized.action)) {
        reasonCodes.push('ACTION_DOMAIN_MISMATCH');
    }
    if (!normalized.target) {
        reasonCodes.push('TARGET_REQUIRED');
    }
    if (!normalized.timestamp || Number.isNaN(Date.parse(normalized.timestamp))) {
        reasonCodes.push('TIMESTAMP_INVALID');
    }
    if (!normalized.proof.type || !['signed_intent', 'legacy_event_bridge', 'genesis_authority'].includes(normalized.proof.type)) {
        reasonCodes.push('PROOF_INVALID');
    }
    if (!normalizeSubjectAddress(normalized.proof.controller)) {
        reasonCodes.push('PROOF_CONTROLLER_INVALID');
    }
    if (normalized.action === 'transfer_device' && !normalizeSubjectAddress(normalized.recipient)) {
        reasonCodes.push('RECIPIENT_REQUIRED');
    }
    if (normalized.action === 'grant_capability' && (!normalized.capability || !normalized.scope)) {
        reasonCodes.push('CAPABILITY_SCOPE_REQUIRED');
    }

    if (knownEventIds) {
        for (const parentId of normalized.causal_parents || []) {
            if (!knownEventIds.has(parentId)) {
                reasonCodes.push('AUTHORITY_HISTORY_NOT_ORDERED');
                break;
            }
        }
    }

    if (
        expectedPreviousStateReference !== undefined
        && normalized.previous_state_reference !== null
        && normalized.previous_state_reference !== expectedPreviousStateReference
    ) {
        reasonCodes.push('CAUSAL_REFERENCE_MISMATCH');
    }

    return {
        ok: reasonCodes.length === 0,
        event: normalized,
        reason_codes: [...new Set(reasonCodes)],
    };
}

function emptySubjectState(subject) {
    return {
        subject,
        identity_continuity: {
            subject,
            status: 'unknown',
            controllers: [],
        },
        effective_authority: {
            identity: [],
            device: [],
            finance: [],
            organization: [],
            application: [],
        },
        relationships: [],
        delegations: [],
        transfers: [],
        applied_events: [],
    };
}

function sortedUnique(values) {
    return [...new Set(values.filter(Boolean))].sort();
}

function delegationKey({ target, capability, scope }) {
    return `${target}:${capability}:${scope}`;
}

function canonicalSubjectState(state) {
    const canonical = {
        subject: state.subject,
        identity_continuity: {
            subject: state.subject,
            status: state.identity_continuity.status,
            controllers: sortedUnique(state.identity_continuity.controllers),
        },
        effective_authority: {
            identity: sortedUnique(state.effective_authority.identity),
            device: sortedUnique(state.effective_authority.device),
            finance: sortedUnique(state.effective_authority.finance),
            organization: sortedUnique(state.effective_authority.organization),
            application: sortedUnique(state.effective_authority.application),
        },
        relationships: [...state.relationships].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
        delegations: [...state.delegations].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
        transfers: [...state.transfers].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
        applied_events: sortedUnique(state.applied_events),
    };

    return canonical;
}

function hashCanonicalSubjectState(state) {
    return sha256Ref(stableStringify(canonicalSubjectState(state)));
}

function applyAuthorityEvent(state, event) {
    const next = {
        ...state,
        identity_continuity: {
            ...state.identity_continuity,
            controllers: [...state.identity_continuity.controllers],
        },
        effective_authority: Object.fromEntries(
            Object.entries(state.effective_authority).map(([domain, values]) => [domain, [...values]])
        ),
        relationships: [...state.relationships],
        delegations: [...state.delegations],
        transfers: [...state.transfers],
        applied_events: [...state.applied_events, event.event_id],
    };

    switch (event.action) {
        case 'genesis':
            next.identity_continuity.status = 'continuous';
            break;
        case 'bind_controller':
            next.identity_continuity.status = 'continuous';
            next.identity_continuity.controllers.push(event.target);
            next.effective_authority.identity.push(event.target);
            break;
        case 'rotate_key':
            next.identity_continuity.status = 'continuous';
            next.identity_continuity.controllers = [event.target];
            next.effective_authority.identity = [event.target];
            break;
        case 'revoke_controller':
            next.identity_continuity.controllers = next.identity_continuity.controllers.filter((controller) => controller !== event.target);
            next.effective_authority.identity = next.effective_authority.identity.filter((controller) => controller !== event.target);
            break;
        case 'bind_device':
            next.effective_authority.device.push(event.target);
            next.relationships.push({
                domain: 'device',
                subject: event.subject,
                counterparty: event.target,
                relation: 'owner',
                derived_from: event.event_id,
            });
            break;
        case 'transfer_device':
            next.effective_authority.device = next.effective_authority.device.filter((device) => device !== event.target);
            next.relationships = next.relationships.filter((relationship) => !(
                relationship.domain === 'device'
                && relationship.counterparty === event.target
                && relationship.relation === 'owner'
            ));
            next.transfers.push({
                domain: 'device',
                target: event.target,
                from: event.subject,
                to: event.recipient,
            });
            break;
        case 'grant_capability': {
            const grant = {
                domain: event.authority_domain,
                target: event.target,
                capability: event.capability,
                scope: event.scope,
            };
            next.delegations.push(grant);
            next.effective_authority[event.authority_domain].push(delegationKey(grant));
            break;
        }
        case 'revoke_capability':
            next.delegations = next.delegations.filter((delegation) => !(
                delegation.domain === event.authority_domain
                && delegation.target === event.target
                && delegation.capability === event.capability
                && delegation.scope === event.scope
            ));
            next.effective_authority[event.authority_domain] = next.effective_authority[event.authority_domain]
                .filter((value) => value !== delegationKey(event));
            break;
        case 'bind_relationship':
            next.relationships.push({
                domain: event.authority_domain,
                subject: event.subject,
                counterparty: event.target,
                relation: event.metadata?.relation || 'related',
                derived_from: event.event_id,
            });
            break;
        case 'accept_claim':
            next.relationships.push({
                domain: event.authority_domain,
                subject: event.subject,
                counterparty: event.target,
                relation: 'accepted_claim',
                derived_from: event.event_id,
            });
            break;
        default:
            break;
    }

    return canonicalSubjectState(next);
}

function evaluateAuthorityHistory(events = [], { subject = null } = {}) {
    if (!Array.isArray(events)) {
        return {
            ok: false,
            reason_codes: ['PROJECTION_INPUT_REJECTED'],
            canonical_subject_state: null,
        };
    }

    const normalizedEvents = events.map(normalizeAuthorityEvent);
    const selectedSubject = subject || normalizedEvents[0]?.subject || null;
    const state = emptySubjectState(selectedSubject);
    const knownEventIds = new Set();
    let currentState = canonicalSubjectState(state);
    let currentStateHash = hashCanonicalSubjectState(currentState);
    const reasonCodes = [];

    for (const event of normalizedEvents) {
        const validation = validateAuthorityEvent(event, {
            knownEventIds,
            expectedPreviousStateReference: currentStateHash,
        });
        if (!validation.ok) {
            reasonCodes.push(...validation.reason_codes);
            continue;
        }
        currentState = applyAuthorityEvent(currentState, validation.event);
        currentStateHash = hashCanonicalSubjectState(currentState);
        knownEventIds.add(validation.event.event_id);
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: [...new Set(reasonCodes)],
        canonical_subject_state: currentState,
        state_hash: currentStateHash,
    };
}

function deriveCanonicalSubjectState(events = [], options = {}) {
    return evaluateAuthorityHistory(events, options).canonical_subject_state;
}

function legacyEventToAuthorityEvent(legacyEvent = {}) {
    const payload = legacyEvent.payload || {};
    const timestamp = legacyEvent.timestamp || new Date(0).toISOString();
    const legacyId = String(legacyEvent.id || authorityEventId(legacyEvent));
    const legacyType = String(legacyEvent.type || '');
    const subject = subjectFromLegacyEntity(payload.entity_l1_address || payload.address);
    const keyAgent = agentFromLegacyKey(payload.key_l1_address) || (payload.credentialId || payload.credential_id
        ? `sl1:agent:legacy-credential:${sha256Hex(payload.credentialId || payload.credential_id).slice(0, 24)}`
        : null);

    if (!subject) {
        return {
            ok: false,
            reason_codes: ['BRIDGE_FACT_INVENTION'],
            authority_event: null,
        };
    }

    let authorityEvent = null;
    if (legacyType === 'GENESIS') {
        authorityEvent = {
            schema_version: AUTHORITY_EVENT_SCHEMA_VERSION,
            type: AUTHORITY_EVENT_TYPE,
            subject,
            authority_domain: 'identity',
            action: 'genesis',
            target: subject,
            proof: {
                type: 'legacy_event_bridge',
                controller: subject,
                signature: null,
                legacy_event_id: legacyId,
                evidence_hash: sha256Ref(stableStringify(legacyEvent)),
            },
            timestamp,
            previous_state_reference: null,
            causal_parents: [],
            metadata: {
                legacy_event_type: legacyType,
            },
        };
    } else if (legacyType === 'PASSKEY_ADDED' || legacyType === 'NATIVE_CONTROLLER_BOOTSTRAPPED') {
        if (!keyAgent) {
            return {
                ok: false,
                reason_codes: ['BRIDGE_FACT_INVENTION'],
                authority_event: null,
            };
        }
        authorityEvent = {
            schema_version: AUTHORITY_EVENT_SCHEMA_VERSION,
            type: AUTHORITY_EVENT_TYPE,
            subject,
            authority_domain: 'identity',
            action: 'bind_controller',
            target: keyAgent,
            proof: {
                type: 'legacy_event_bridge',
                controller: subject,
                signature: null,
                legacy_event_id: legacyId,
                evidence_hash: sha256Ref(stableStringify(legacyEvent)),
            },
            timestamp,
            previous_state_reference: null,
            causal_parents: [],
            metadata: {
                legacy_event_type: legacyType,
            },
        };
    } else if (legacyType === 'PASSKEY_REVOKED') {
        if (!keyAgent) {
            return {
                ok: false,
                reason_codes: ['BRIDGE_FACT_INVENTION'],
                authority_event: null,
            };
        }
        authorityEvent = {
            schema_version: AUTHORITY_EVENT_SCHEMA_VERSION,
            type: AUTHORITY_EVENT_TYPE,
            subject,
            authority_domain: 'identity',
            action: 'revoke_controller',
            target: keyAgent,
            proof: {
                type: 'legacy_event_bridge',
                controller: subject,
                signature: null,
                legacy_event_id: legacyId,
                evidence_hash: sha256Ref(stableStringify(legacyEvent)),
            },
            timestamp,
            previous_state_reference: null,
            causal_parents: [],
            metadata: {
                legacy_event_type: legacyType,
                reason: payload.reason || null,
            },
        };
    } else if (legacyType === 'CONTROL_GRANT_CREATED' || legacyType === 'CAPABILITY_GRANT_CREATED') {
        authorityEvent = {
            schema_version: AUTHORITY_EVENT_SCHEMA_VERSION,
            type: AUTHORITY_EVENT_TYPE,
            subject,
            authority_domain: 'application',
            action: 'grant_capability',
            target: payload.key_l1_address ? agentFromLegacyKey(payload.key_l1_address) || subject : subject,
            capability: payload.capability || null,
            scope: payload.scope || null,
            expires_at: payload.expires_at || null,
            proof: {
                type: 'legacy_event_bridge',
                controller: subject,
                signature: null,
                legacy_event_id: legacyId,
                evidence_hash: sha256Ref(stableStringify(legacyEvent)),
            },
            timestamp,
            previous_state_reference: null,
            causal_parents: [],
            metadata: {
                legacy_event_type: legacyType,
                policy: payload.policy || null,
            },
        };
    } else {
        return {
            ok: false,
            reason_codes: ['UNSUPPORTED_LEGACY_EVENT_TYPE'],
            authority_event: null,
        };
    }

    const normalized = normalizeAuthorityEvent(authorityEvent);
    return {
        ok: true,
        reason_codes: [],
        authority_event: normalized,
    };
}

module.exports = {
    AUTHORITY_DOMAINS,
    AUTHORITY_EVENT_SCHEMA_VERSION,
    AUTHORITY_EVENT_TYPE,
    canonicalSubjectState,
    deriveCanonicalSubjectState,
    evaluateAuthorityHistory,
    hashCanonicalSubjectState,
    legacyEventToAuthorityEvent,
    normalizeAuthorityEvent,
    stableStringify,
    validateAuthorityEvent,
};
