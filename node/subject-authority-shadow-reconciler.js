'use strict';

// Slice 2b: Shadow Reconciliation Observer.
//
// A deterministic, pure, side-effect-free divergence oracle. It measures the
// distance between three realities and produces a drift_report:
//
//   runtime_projection  = observed system belief
//   classified_events   = semantic admissibility map (Slice 2a)
//   canonical_state     = causal truth (Slice 1 kernel)
//
// Constitutional law of this layer:
//   It computes divergence, never direction.
//   It does not interpret, correct, influence, or enforce.
//   drift_report MUST NOT contain recommendations, fixes, prioritization,
//   severity mapping, enforcement flags, or correction targets.
//   drift_report MUST NOT be consumed by any system layer.
//
// Properties (verified by the oracle test):
//   deterministic, pure, referentially transparent, causally inert,
//   execution-context independent, non-enforcing, non-prescriptive.

const {
    classifyEventLog,
    authorityHistoryCandidatesFromClassifiedEvents,
} = require('./subject-authority-classifier');

const RECONCILER_RULESET_VERSION = 'subject-authority-shadow-reconciliation-v1';
const RECONCILER_RULESET_STATUS = 'frozen';
const DRIFT_REPORT_SCHEMA_VERSION = 'simple-l1.subject_authority.drift_report.v1';

// The five measured divergence types. These are measurements, not errors.
const DRIFT_TYPES = Object.freeze([
    'execution_drift', // runtime represents an event admissibility prohibits (reject)
    'semantic_drift', // runtime-believed class differs from classifier output
    'authority_drift', // admissible authority subset size != canonical applied events
    'projection_drift', // runtime projection fields != derived canonical fields
    'unknown_drift', // accumulation of legacy_unknown without resolution
]);

function sortedStrings(values) {
    if (!Array.isArray(values)) return [];
    return [...values].filter((v) => typeof v === 'string').sort();
}

function setDifference(a, b) {
    const bset = new Set(b);
    return a.filter((value) => !bset.has(value));
}

function emptySummary() {
    return Object.fromEntries(DRIFT_TYPES.map((type) => [type, 0]));
}

// projection_drift: runtime belief about controllers/device authority diverges
// from the derived canonical subject state. Factual difference only.
function compareWithCanonicalSubjectState(runtimeProjection, canonicalState) {
    const drifts = [];
    const runtime = runtimeProjection && typeof runtimeProjection === 'object' ? runtimeProjection : {};
    const canonical = canonicalState && typeof canonicalState === 'object' ? canonicalState : {};

    const runtimeControllers = sortedStrings(runtime.controllers);
    const canonicalControllers = sortedStrings(canonical.identity_continuity && canonical.identity_continuity.controllers);
    if (JSON.stringify(runtimeControllers) !== JSON.stringify(canonicalControllers)) {
        drifts.push({
            drift_type: 'projection_drift',
            layer_pair: 'runtime|canonical',
            field: 'controllers',
            only_in_runtime: setDifference(runtimeControllers, canonicalControllers),
            only_in_canonical: setDifference(canonicalControllers, runtimeControllers),
        });
    }

    const runtimeDevice = sortedStrings(runtime.device_authority);
    const canonicalDevice = sortedStrings(canonical.effective_authority && canonical.effective_authority.device);
    if (JSON.stringify(runtimeDevice) !== JSON.stringify(canonicalDevice)) {
        drifts.push({
            drift_type: 'projection_drift',
            layer_pair: 'runtime|canonical',
            field: 'device_authority',
            only_in_runtime: setDifference(runtimeDevice, canonicalDevice),
            only_in_canonical: setDifference(canonicalDevice, runtimeDevice),
        });
    }

    return drifts;
}

// execution_drift + semantic_drift + authority_drift:
// compares runtime belief against the admissibility map and its canonical result.
function compareWithClassifiedAuthoritySubset(runtimeProjection, classifiedEvents, canonicalState) {
    const drifts = [];
    const runtime = runtimeProjection && typeof runtimeProjection === 'object' ? runtimeProjection : {};
    const classified = Array.isArray(classifiedEvents) ? classifiedEvents : [];

    const classByEventId = new Map();
    for (const item of classified) {
        if (item && item.event_id !== undefined && item.event_id !== null) {
            classByEventId.set(item.event_id, item.classification);
        }
    }

    // execution_drift: runtime represents an event classified as reject.
    const representedIds = Array.isArray(runtime.represented_event_ids) ? runtime.represented_event_ids : [];
    for (const eventId of representedIds) {
        if (classByEventId.get(eventId) === 'reject') {
            drifts.push({
                drift_type: 'execution_drift',
                layer_pair: 'runtime|classifier',
                event_id: eventId,
                runtime_state: 'represented',
                classification: 'reject',
            });
        }
    }

    // semantic_drift: runtime-believed class differs from classifier output.
    const believed = runtime.believed_classifications && typeof runtime.believed_classifications === 'object'
        ? runtime.believed_classifications
        : {};
    for (const eventId of Object.keys(believed).sort()) {
        const computed = classByEventId.get(eventId);
        if (computed !== undefined && believed[eventId] !== computed) {
            drifts.push({
                drift_type: 'semantic_drift',
                layer_pair: 'runtime|classifier',
                event_id: eventId,
                runtime_believed_classification: believed[eventId],
                classifier_classification: computed,
            });
        }
    }

    // authority_drift: admissible authority subset size != canonical applied events.
    const candidates = authorityHistoryCandidatesFromClassifiedEvents(classified);
    const canonical = canonicalState && typeof canonicalState === 'object' ? canonicalState : {};
    const appliedCount = Array.isArray(canonical.applied_events) ? canonical.applied_events.length : 0;
    if (candidates.length !== appliedCount) {
        drifts.push({
            drift_type: 'authority_drift',
            layer_pair: 'classifier|canonical',
            admissible_authority_candidates: candidates.length,
            canonical_applied_events: appliedCount,
        });
    }

    return drifts;
}

// unknown_drift: legacy_unknown accumulation without a resolution path.
function computeUnknownDrift(classifiedEvents) {
    const classified = Array.isArray(classifiedEvents) ? classifiedEvents : [];
    const unknownIds = classified
        .filter((item) => item && item.classification === 'legacy_unknown')
        .map((item) => item.event_id);
    if (unknownIds.length === 0) {
        return [];
    }
    return [{
        drift_type: 'unknown_drift',
        layer_pair: 'classifier|self',
        count: unknownIds.length,
        event_ids: [...unknownIds].sort(),
    }];
}

// computeDriftReport: orchestrates the measurement. Pure function of inputs only.
// Accepts either classified_events (preferred) or a raw event_log it classifies.
function computeDriftReport(inputs = {}) {
    const runtimeProjection = inputs.runtime_projection || null;
    const canonicalState = inputs.canonical_state || null;
    const classifiedEvents = Array.isArray(inputs.classified_events)
        ? inputs.classified_events
        : classifyEventLog(inputs.event_log || []);

    const drifts = [
        ...compareWithCanonicalSubjectState(runtimeProjection, canonicalState),
        ...compareWithClassifiedAuthoritySubset(runtimeProjection, classifiedEvents, canonicalState),
        ...computeUnknownDrift(classifiedEvents),
    ];

    const summary = emptySummary();
    for (const drift of drifts) {
        if (Object.prototype.hasOwnProperty.call(summary, drift.drift_type)) {
            summary[drift.drift_type] += 1;
        }
    }

    const driftTypesPresent = DRIFT_TYPES.filter((type) => summary[type] > 0);

    return {
        schema_version: DRIFT_REPORT_SCHEMA_VERSION,
        ruleset_version: RECONCILER_RULESET_VERSION,
        subject: (runtimeProjection && runtimeProjection.subject)
            || (canonicalState && canonicalState.subject)
            || null,
        has_drift: drifts.length > 0,
        drift_types_present: driftTypesPresent,
        summary,
        drifts,
    };
}

// reconcileRuntimeProjection: ergonomic alias matching the Slice 2b API surface.
function reconcileRuntimeProjection(runtimeProjection, classifiedEvents, canonicalState) {
    return computeDriftReport({
        runtime_projection: runtimeProjection,
        classified_events: classifiedEvents,
        canonical_state: canonicalState,
    });
}

module.exports = {
    RECONCILER_RULESET_VERSION,
    RECONCILER_RULESET_STATUS,
    DRIFT_REPORT_SCHEMA_VERSION,
    DRIFT_TYPES,
    compareWithCanonicalSubjectState,
    compareWithClassifiedAuthoritySubset,
    computeUnknownDrift,
    computeDriftReport,
    reconcileRuntimeProjection,
};
