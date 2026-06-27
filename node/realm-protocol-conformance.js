'use strict';

// Realm Protocol Conformance Suite (ADR-0093 gate)
//
// A protocol upgrade is not proven by "the new runtime started successfully".
// It is proven by "the new runtime still understands the same Realm".
//
//   pre-upgrade   -> derive conformance anchors from accepted history
//   upgrade       -> load a new compatible interpreter
//   post-upgrade  -> derive anchors again and prove they are equal
//
// Rollback at this layer is not a data rollback. It is returning to the prior
// interpreter (ADR-0083: deployment changes runtime, not history).

const {
    buildCurrentAuthorityState,
} = require('./current-authority-state');
const {
    canonicalEncode,
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('./realm-event-history');
const {
    calculateProjectionHash,
    explainCurrentAuthorityState,
} = require('./realm-observability');
const { verifyRealmIntegrity } = require('./realm-integrity-check');
const { deriveRealmLifecycleState } = require('./realm-lifecycle');

const CONFORMANCE_ANCHOR_KEYS = Object.freeze([
    'history_head',
    'projection_hash',
    'realm_valid',
    'lifecycle_state',
    'lifecycle_can_accept_commands',
    'lifecycle_can_accept_authority_mutations',
    'explanation_current_authority',
    'explanation_status',
    'explanation_history_head',
    'explanation_projection_hash',
    'attestation_anchor_fingerprint',
]);

function defaultInterpret(eventLog) {
    return buildCurrentAuthorityState(eventLog);
}

function ledgerForInterpreter(eventLog, interpret) {
    const interpreter = typeof interpret === 'function' ? interpret : defaultInterpret;
    const projection = interpreter(eventLog);
    return {
        event_log: eventLog,
        current_authority_state: projection,
    };
}

function attestationAnchorFingerprint(integrityReport, explanation) {
    return canonicalEncode({
        history_head: integrityReport.history_head,
        projection_hash: integrityReport.projection_hash,
        realm_valid: integrityReport.realm_valid === true,
        canonical: integrityReport.canonical || {},
        explanation_history_head: explanation.history_head,
        explanation_projection_hash: explanation.projection_hash,
    });
}

function deriveConformanceAnchors(eventLog, interpret) {
    verifyRealmEventHistory(eventLog);
    const ledger = ledgerForInterpreter(eventLog, interpret);
    const integrityReport = verifyRealmIntegrity(ledger);
    const lifecycle = deriveRealmLifecycleState(integrityReport);
    const explanation = explainCurrentAuthorityState(ledger);

    return {
        history_head: integrityReport.history_head,
        projection_hash: integrityReport.projection_hash,
        realm_valid: integrityReport.realm_valid === true,
        lifecycle_state: lifecycle.state,
        lifecycle_can_accept_commands: lifecycle.can_accept_commands === true,
        lifecycle_can_accept_authority_mutations: lifecycle.can_accept_authority_mutations === true,
        explanation_current_authority: explanation.current_authority,
        explanation_status: explanation.status,
        explanation_history_head: explanation.history_head,
        explanation_projection_hash: explanation.projection_hash,
        attestation_anchor_fingerprint: attestationAnchorFingerprint(integrityReport, explanation),
    };
}

function diffAnchors(pre, post) {
    const mismatches = [];
    for (const key of CONFORMANCE_ANCHOR_KEYS) {
        if (canonicalEncode(pre[key]) !== canonicalEncode(post[key])) {
            mismatches.push({ anchor: key, pre: pre[key], post: post[key] });
        }
    }
    return mismatches;
}

function runProtocolConformanceGate(eventLog, options = {}) {
    const preRuntime = options.preRuntime || {};
    const postRuntime = options.postRuntime || {};

    const bytesBefore = canonicalEncode(eventLog);

    let preAnchors;
    let postAnchors;
    try {
        preAnchors = deriveConformanceAnchors(eventLog, preRuntime.interpret);
        postAnchors = deriveConformanceAnchors(eventLog, postRuntime.interpret);
    } catch (error) {
        return {
            ok: false,
            reason_codes: ['PROTOCOL_HISTORY_VERIFICATION_FAILED'],
            error: String(error?.message || error),
        };
    }

    const bytesAfter = canonicalEncode(eventLog);
    if (bytesBefore !== bytesAfter) {
        return {
            ok: false,
            reason_codes: ['PROTOCOL_HISTORY_MUTATED'],
            pre_runtime: preRuntime.version || 'pre',
            post_runtime: postRuntime.version || 'post',
        };
    }

    const mismatches = diffAnchors(preAnchors, postAnchors);
    if (mismatches.length > 0) {
        return {
            ok: false,
            reason_codes: ['PROTOCOL_CONFORMANCE_FAILED'],
            pre_runtime: preRuntime.version || 'pre',
            post_runtime: postRuntime.version || 'post',
            mismatches,
            pre_anchors: preAnchors,
            post_anchors: postAnchors,
        };
    }

    return {
        ok: true,
        pre_runtime: preRuntime.version || 'pre',
        post_runtime: postRuntime.version || 'post',
        anchors: preAnchors,
    };
}

module.exports = {
    CONFORMANCE_ANCHOR_KEYS,
    deriveConformanceAnchors,
    diffAnchors,
    runProtocolConformanceGate,
};
