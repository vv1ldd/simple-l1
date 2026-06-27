'use strict';

const LIFECYCLE_STATES = Object.freeze({
    BOOTSTRAPPING: 'BOOTSTRAPPING',
    DEGRADED: 'DEGRADED',
    RECOVERING: 'RECOVERING',
    SUSPENDED: 'SUSPENDED',
    VERIFIED: 'VERIFIED',
});

const OPERATIONS = Object.freeze({
    ACCEPT_AUTHORITY_MUTATION: 'ACCEPT_AUTHORITY_MUTATION',
    ACCEPT_COMMAND: 'ACCEPT_COMMAND',
    ACCEPT_TRANSPORT_EVENT: 'ACCEPT_TRANSPORT_EVENT',
    COLLECT_RECOVERY_EVIDENCE: 'COLLECT_RECOVERY_EVIDENCE',
    RUN_DIAGNOSTICS: 'RUN_DIAGNOSTICS',
});

function lifecycleEvidence(integrityReport = {}) {
    return {
        realm_valid: integrityReport.realm_valid === true,
        failures: Array.isArray(integrityReport.failures) ? [...integrityReport.failures] : [],
        warnings: Array.isArray(integrityReport.warnings) ? [...integrityReport.warnings] : [],
        canonical: integrityReport.canonical || {},
        derived: integrityReport.derived || {},
        operational: integrityReport.operational || {},
    };
}

function hasCanonicalFailure(evidence) {
    return evidence.realm_valid !== true
        || evidence.canonical.history === 'fail'
        || evidence.canonical.projection_replay === 'fail';
}

function hasDerivedOrOperationalWarning(evidence) {
    return evidence.warnings.length > 0
        || Object.values(evidence.derived || {}).includes('warning')
        || Object.values(evidence.operational || {}).includes('warning');
}

function lifecycleExplanation(state, evidence = {}) {
    switch (state) {
    case LIFECYCLE_STATES.BOOTSTRAPPING:
        return 'Realm has no integrity report yet; only loading, replay, and diagnostics are allowed.';
    case LIFECYCLE_STATES.VERIFIED:
        return 'Realm integrity is valid and no operational warnings are present.';
    case LIFECYCLE_STATES.DEGRADED:
        return 'Realm canonical integrity is valid, but derived or operational warnings are present.';
    case LIFECYCLE_STATES.SUSPENDED:
        return `Realm cannot prove canonical integrity: ${(evidence.failures || []).join(', ') || 'unknown failure'}.`;
    case LIFECYCLE_STATES.RECOVERING:
        return 'Realm is operating under validated recovery evidence; recovery transitions still require the normal validator path.';
    default:
        return 'Realm lifecycle state is unknown.';
    }
}

function deriveRealmLifecycleState(integrityReport = null, options = {}) {
    if (!integrityReport) {
        const evidence = lifecycleEvidence({});
        return {
            state: LIFECYCLE_STATES.BOOTSTRAPPING,
            can_accept_commands: false,
            can_accept_authority_mutations: false,
            can_run_diagnostics: true,
            derived_from: evidence,
            explanation: lifecycleExplanation(LIFECYCLE_STATES.BOOTSTRAPPING, evidence),
        };
    }

    const evidence = lifecycleEvidence(integrityReport);
    const recoveryValidated = options.recoveryAuthorityValidated === true
        || options.recovery_authority_validated === true;

    let state;
    if (hasCanonicalFailure(evidence)) {
        state = recoveryValidated ? LIFECYCLE_STATES.RECOVERING : LIFECYCLE_STATES.SUSPENDED;
    } else if (hasDerivedOrOperationalWarning(evidence)) {
        state = LIFECYCLE_STATES.DEGRADED;
    } else {
        state = LIFECYCLE_STATES.VERIFIED;
    }

    return {
        state,
        can_accept_commands: canAcceptCommands(state),
        can_accept_authority_mutations: canAcceptAuthorityMutations(state),
        can_run_diagnostics: canRunDiagnostics(state),
        derived_from: evidence,
        explanation: lifecycleExplanation(state, evidence),
    };
}

function canAcceptCommands(lifecycleState) {
    const state = typeof lifecycleState === 'string' ? lifecycleState : lifecycleState?.state;
    return state === LIFECYCLE_STATES.VERIFIED
        || state === LIFECYCLE_STATES.DEGRADED
        || state === LIFECYCLE_STATES.RECOVERING;
}

function canAcceptAuthorityMutations(lifecycleState) {
    const state = typeof lifecycleState === 'string' ? lifecycleState : lifecycleState?.state;
    return state === LIFECYCLE_STATES.VERIFIED
        || state === LIFECYCLE_STATES.DEGRADED
        || state === LIFECYCLE_STATES.RECOVERING;
}

function canRunDiagnostics(lifecycleState) {
    const state = typeof lifecycleState === 'string' ? lifecycleState : lifecycleState?.state;
    return Boolean(state && Object.values(LIFECYCLE_STATES).includes(state));
}

function canOperate(lifecycleState, operation) {
    const state = typeof lifecycleState === 'string' ? lifecycleState : lifecycleState?.state;
    switch (operation) {
    case OPERATIONS.ACCEPT_COMMAND:
        return canAcceptCommands(state);
    case OPERATIONS.ACCEPT_AUTHORITY_MUTATION:
    case OPERATIONS.ACCEPT_TRANSPORT_EVENT:
        return canAcceptAuthorityMutations(state);
    case OPERATIONS.COLLECT_RECOVERY_EVIDENCE:
    case OPERATIONS.RUN_DIAGNOSTICS:
        return canRunDiagnostics(state);
    default:
        return false;
    }
}

function getLifecycleExplanation(lifecycleState, integrityReport = null) {
    const state = typeof lifecycleState === 'string' ? lifecycleState : lifecycleState?.state;
    const evidence = integrityReport ? lifecycleEvidence(integrityReport) : (lifecycleState?.derived_from || {});
    return {
        state,
        explanation: lifecycleExplanation(state, evidence),
        derived_from: evidence,
    };
}

function explainLifecycleTransition(previous, current, evidence = {}) {
    const previousState = typeof previous === 'string' ? previous : previous?.state || null;
    const currentState = typeof current === 'string' ? current : current?.state || null;
    return {
        previous_state: previousState,
        current_state: currentState,
        derived_from: evidence,
        explanation: previousState === currentState
            ? `Realm lifecycle remains ${currentState}.`
            : `Realm lifecycle transitioned from ${previousState || 'UNKNOWN'} to ${currentState || 'UNKNOWN'}.`,
    };
}

module.exports = {
    LIFECYCLE_STATES,
    OPERATIONS,
    canAcceptAuthorityMutations,
    canAcceptCommands,
    canOperate,
    canRunDiagnostics,
    deriveRealmLifecycleState,
    explainLifecycleTransition,
    getLifecycleExplanation,
};
