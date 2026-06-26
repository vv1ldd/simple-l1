#!/usr/bin/env node
'use strict';

// Slice 2b divergence oracle.
// Proves the shadow reconciler is a deterministic, pure, causally inert,
// non-prescriptive measurement of divergence between runtime, classifier, kernel.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    DRIFT_TYPES,
    computeDriftReport,
    reconcileRuntimeProjection,
} = require('../subject-authority-shadow-reconciler');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'subject-authority',
    'fixtures',
    'shadow-reconciliation-v1.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

// Fields that would turn measurement into control. They must never appear.
const PRESCRIPTIVE_FIELDS = [
    'actions',
    'recommendations',
    'recommendation',
    'fixes',
    'fix',
    'remediation',
    'prioritization',
    'priority',
    'severity',
    'enforcement',
    'enforce',
    'correction',
    'correction_targets',
    'decision',
    'suggested_action',
];

function assertNonPrescriptive(report) {
    for (const field of PRESCRIPTIVE_FIELDS) {
        assert.equal(
            Object.prototype.hasOwnProperty.call(report, field),
            false,
            `drift_report must not contain prescriptive field: ${field}`,
        );
    }
    for (const drift of report.drifts) {
        for (const field of PRESCRIPTIVE_FIELDS) {
            assert.equal(
                Object.prototype.hasOwnProperty.call(drift, field),
                false,
                `drift item must not contain prescriptive field: ${field}`,
            );
        }
    }
}

const fixture = readJson(fixturePath);
assert.equal(fixture.ruleset_status, 'frozen');
assert.deepStrictEqual(fixture.drift_types, DRIFT_TYPES);

// 1. Clean case: no divergence between layers.
const clean = computeDriftReport(fixture.clean_case.inputs);
assert.equal(clean.has_drift, fixture.clean_case.expected.has_drift);
assert.deepStrictEqual(clean.drift_types_present, fixture.clean_case.expected.drift_types_present);
assert.deepStrictEqual(clean.summary, fixture.clean_case.expected.summary);
assert.equal(clean.drifts.length, 0);
assertNonPrescriptive(clean);

// 2. Drift case: all five drift types present, with factual detail.
const drift = computeDriftReport(fixture.drift_case.inputs);
const expected = fixture.drift_case.expected;
assert.equal(drift.has_drift, true);
assert.deepStrictEqual([...drift.drift_types_present].sort(), [...expected.drift_types_present].sort());
assert.deepStrictEqual(drift.summary, expected.summary);
assertNonPrescriptive(drift);

const byType = (type) => drift.drifts.filter((d) => d.drift_type === type);

const execution = byType('execution_drift');
assert.equal(execution.length, 1);
assert.equal(execution[0].event_id, expected.expected_drift_details.execution_drift_event_id);
assert.equal(execution[0].classification, 'reject');

const semantic = byType('semantic_drift');
assert.equal(semantic.length, 1);
assert.equal(semantic[0].event_id, expected.expected_drift_details.semantic_drift_event_id);
assert.equal(semantic[0].runtime_believed_classification, expected.expected_drift_details.semantic_drift_runtime_believed);
assert.equal(semantic[0].classifier_classification, expected.expected_drift_details.semantic_drift_classifier);

const authority = byType('authority_drift');
assert.equal(authority.length, 1);
assert.equal(authority[0].admissible_authority_candidates, expected.expected_drift_details.authority_admissible_candidates);
assert.equal(authority[0].canonical_applied_events, expected.expected_drift_details.authority_canonical_applied);

const projection = byType('projection_drift');
assert.equal(projection.length, 1);
assert.deepStrictEqual(projection[0].only_in_runtime, expected.expected_drift_details.projection_only_in_runtime);
assert.deepStrictEqual(projection[0].only_in_canonical, expected.expected_drift_details.projection_only_in_canonical);

const unknown = byType('unknown_drift');
assert.equal(unknown.length, 1);
assert.equal(unknown[0].count, expected.expected_drift_details.unknown_drift_count);
assert.deepStrictEqual(unknown[0].event_ids, expected.expected_drift_details.unknown_drift_event_ids);

// 3. Determinism: same inputs -> identical report.
const driftAgain = computeDriftReport(deepClone(fixture.drift_case.inputs));
assert.deepStrictEqual(drift, driftAgain);
assert.equal(JSON.stringify(drift), JSON.stringify(driftAgain));

// 4. Purity / causal inertness: inputs are never mutated.
const before = JSON.stringify(fixture.drift_case.inputs);
computeDriftReport(fixture.drift_case.inputs);
computeDriftReport(fixture.drift_case.inputs);
const after = JSON.stringify(fixture.drift_case.inputs);
assert.equal(before, after, 'reconciler must not mutate inputs');

// 5. Execution-context independence: alias and orchestrator agree.
const viaAlias = reconcileRuntimeProjection(
    fixture.drift_case.inputs.runtime_projection,
    undefined,
    fixture.drift_case.inputs.canonical_state,
);
// alias without classified_events classifies internally from no event_log -> empty;
// so build the equivalent through computeDriftReport with explicit event_log.
const viaCompute = computeDriftReport({
    runtime_projection: fixture.drift_case.inputs.runtime_projection,
    canonical_state: fixture.drift_case.inputs.canonical_state,
    event_log: [],
});
assert.deepStrictEqual(viaAlias, viaCompute);

// 6. Empty / malformed inputs do not throw and produce a measurement, not a decision.
const emptyReport = computeDriftReport({});
assert.equal(emptyReport.has_drift, false);
assert.deepStrictEqual(emptyReport.drift_types_present, []);
assertNonPrescriptive(emptyReport);

console.log('PASS subject authority shadow reconciler measures divergence without enforcing or prescribing');
