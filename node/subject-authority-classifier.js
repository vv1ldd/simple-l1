'use strict';

// Slice 2a: Semantic admissibility oracle for subject authority.
//
// This module answers exactly one question per runtime event:
//   "Is this event allowed to participate in identity reasoning?"
//
// It NEVER answers "should the system act on this?". It is:
//   - non-authoritative   (does not decide subject state)
//   - non-operational     (does not touch runtime, storage, or HTTP)
//   - observational only  (read-only classification of existing events)
//
// Core invariants (frozen for v1):
//   authority_history = f(event_log, semantic_classification)
//   authority_history != event_log
//   classification does not mutate event_log
//   same event_log + same ruleset -> same classification
//   legacy_unknown = epistemic uncertainty ("we do not know what this is")
//   reject         = semantic prohibition ("this may not enter subject ontology")

const CLASSIFIER_RULESET_VERSION = 'subject-authority-classification-v1';
const CLASSIFIER_RULESET_STATUS = 'frozen';

// The five admissibility classes.
const CLASSIFICATION_CLASSES = Object.freeze([
    'authority_event_candidate', // may be considered for authority_history
    'system_event', // operational/evidence fact, not subject mutation
    'projection_update', // derived/materialized state, never authority input
    'legacy_unknown', // epistemic uncertainty, must be observed not assumed
    'reject', // semantic prohibition, must never become identity truth
]);

// Only this class is eligible to enter the authority_history candidate subset.
const AUTHORITY_ELIGIBLE_CLASS = 'authority_event_candidate';

// Frozen rule table grounded in node/server.js applyEvent() switch types.
// A classification is a non-binding admissibility decision, not an authority decision.
const EVENT_TYPE_CLASSIFICATION = Object.freeze({
    GENESIS: 'authority_event_candidate',
    PASSKEY_ADDED: 'authority_event_candidate',
    PASSKEY_REVOKED: 'authority_event_candidate',
    NATIVE_CONTROLLER_BOOTSTRAPPED: 'authority_event_candidate',
    CONTROLLER_BINDING_PROPOSED: 'authority_event_candidate',
    CONTROLLER_BINDING_APPROVED: 'authority_event_candidate',
    CAPABILITY_GRANT_CREATED: 'authority_event_candidate',
    CONTROL_GRANT_CREATED: 'authority_event_candidate',
    CONTROL_GRANT_REVOKED: 'authority_event_candidate',

    POLICY_ARTIFACT_RECORDED: 'system_event',
    EXTERNAL_PROOF_RECORDED: 'system_event',

    MARKETPLACE_SETTLEMENT_RECORDED: 'projection_update',
    MARKETPLACE_SELLER_UPSERTED: 'projection_update',
    MARKETPLACE_LISTING_UPSERTED: 'projection_update',
    MARKETPLACE_SELLER_ACTIVATED: 'projection_update',

    // Authority semantics depend on a domain decision not yet accepted.
    AUTHORIZATION_CREATED: 'legacy_unknown',

    // Retired legacy mutation path: must never re-enter subject ontology.
    TRANSFER: 'reject',
});

// Human-meaningful reason codes for the admissibility decision.
// These describe WHY a class was assigned; they are not failure codes.
const CLASSIFICATION_REASON = Object.freeze({
    authority_event_candidate: 'ADMISSIBLE_AUTHORITY_CANDIDATE',
    system_event: 'OPERATIONAL_OR_EVIDENCE_FACT',
    projection_update: 'DERIVED_PROJECTION_STATE',
    legacy_unknown: 'SEMANTIC_UNCERTAINTY',
    reject: 'SEMANTIC_PROHIBITION',
});

function normalizeEventType(event) {
    if (!event || typeof event !== 'object') return null;
    if (typeof event.type !== 'string') return null;
    const trimmed = event.type.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// classifyRuntimeEvent: pure, deterministic admissibility decision for one event.
// Unknown or malformed types collapse to legacy_unknown (epistemic uncertainty),
// never silently to authority_event_candidate.
function classifyRuntimeEvent(event) {
    const eventType = normalizeEventType(event);
    const classification = (eventType && EVENT_TYPE_CLASSIFICATION[eventType]) || 'legacy_unknown';
    const eligibleForAuthorityHistory = classification === AUTHORITY_ELIGIBLE_CLASS;

    return {
        event_id: event && typeof event === 'object' && event.id !== undefined ? event.id : null,
        event_type: eventType,
        classification,
        eligible_for_authority_history: eligibleForAuthorityHistory,
        reason: CLASSIFICATION_REASON[classification],
        ruleset_version: CLASSIFIER_RULESET_VERSION,
    };
}

// classifyEventLog: classify a full event_log without mutating it.
// Returns a parallel labeled stream; the input array and its entries are untouched.
function classifyEventLog(eventLog = []) {
    if (!Array.isArray(eventLog)) {
        return [];
    }
    return eventLog.map((event) => classifyRuntimeEvent(event));
}

// authorityHistoryCandidatesFromClassifiedEvents: select only the admissible subset.
// This is the bridge formula in code: authority_history candidates = filter(classified).
// It returns indices into the original log so the caller can resolve source events
// without this module ever holding or mutating event payloads as authority.
function authorityHistoryCandidatesFromClassifiedEvents(classifiedEvents = []) {
    if (!Array.isArray(classifiedEvents)) {
        return [];
    }
    return classifiedEvents
        .map((classified, index) => ({ classified, index }))
        .filter(({ classified }) => classified && classified.eligible_for_authority_history === true)
        .map(({ classified, index }) => ({
            source_index: index,
            event_id: classified.event_id,
            event_type: classified.event_type,
        }));
}

// classificationSummary: deterministic counts per class for drift/audit tooling.
function classificationSummary(classifiedEvents = []) {
    const summary = Object.fromEntries(CLASSIFICATION_CLASSES.map((cls) => [cls, 0]));
    if (!Array.isArray(classifiedEvents)) {
        return summary;
    }
    for (const classified of classifiedEvents) {
        if (classified && Object.prototype.hasOwnProperty.call(summary, classified.classification)) {
            summary[classified.classification] += 1;
        }
    }
    return summary;
}

module.exports = {
    CLASSIFIER_RULESET_VERSION,
    CLASSIFIER_RULESET_STATUS,
    CLASSIFICATION_CLASSES,
    AUTHORITY_ELIGIBLE_CLASS,
    EVENT_TYPE_CLASSIFICATION,
    CLASSIFICATION_REASON,
    classifyRuntimeEvent,
    classifyEventLog,
    authorityHistoryCandidatesFromClassifiedEvents,
    classificationSummary,
};
