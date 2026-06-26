#!/usr/bin/env node
'use strict';

// Slice 2a causality-eligibility oracle.
// Verifies the semantic admissibility layer is deterministic, observational only,
// and never lets a non-admissible event enter the authority_history candidate subset.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    CLASSIFIER_RULESET_VERSION,
    CLASSIFICATION_CLASSES,
    AUTHORITY_ELIGIBLE_CLASS,
    classifyRuntimeEvent,
    classifyEventLog,
    authorityHistoryCandidatesFromClassifiedEvents,
    classificationSummary,
} = require('../subject-authority-classifier');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'subject-authority',
    'fixtures',
    'event-log-classification-v1.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const fixture = readJson(fixturePath);

assert.equal(fixture.ruleset_version, CLASSIFIER_RULESET_VERSION);
assert.equal(fixture.ruleset_status, 'frozen');
assert.deepStrictEqual(fixture.classification_classes, CLASSIFICATION_CLASSES);

// 1. Each known event_log entry is classified exactly as the frozen fixture expects.
const classified = classifyEventLog(fixture.event_log);
assert.equal(classified.length, fixture.event_log.length);
for (const item of classified) {
    const expected = fixture.expected_classifications[item.event_id];
    assert.equal(
        item.classification,
        expected,
        `classification mismatch for ${item.event_id}: got ${item.classification}, expected ${expected}`,
    );
    assert(CLASSIFICATION_CLASSES.includes(item.classification), `unknown class ${item.classification}`);
}

// 2. Determinism: same event_log + same ruleset -> same classification.
const classifiedAgain = classifyEventLog(JSON.parse(JSON.stringify(fixture.event_log)));
assert.deepStrictEqual(
    classified.map((c) => [c.event_id, c.classification, c.eligible_for_authority_history]),
    classifiedAgain.map((c) => [c.event_id, c.classification, c.eligible_for_authority_history]),
);

// 3. Classification does not mutate event_log (observational only).
const before = JSON.stringify(fixture.event_log);
classifyEventLog(fixture.event_log);
const after = JSON.stringify(fixture.event_log);
assert.equal(before, after, 'classifier must not mutate event_log');

// 4. Summary counts match the frozen fixture.
const summary = classificationSummary(classified);
assert.deepStrictEqual(summary, fixture.expected_summary);

// 5. authority_history != event_log: candidates are a strict, smaller subset.
const candidates = authorityHistoryCandidatesFromClassifiedEvents(classified);
assert.equal(candidates.length, fixture.expected_authority_candidate_ids.length);
assert(candidates.length < fixture.event_log.length, 'authority candidates must be a strict subset of event_log');
assert.deepStrictEqual(
    candidates.map((c) => c.event_id),
    fixture.expected_authority_candidate_ids,
);

// 6. Every candidate is, and only is, the authority-eligible class.
for (const candidate of candidates) {
    const source = classified[candidate.source_index];
    assert.equal(source.classification, AUTHORITY_ELIGIBLE_CLASS);
    assert.equal(source.eligible_for_authority_history, true);
}

// 7. reject and legacy_unknown never enter authority candidates (prohibition + uncertainty).
const candidateIds = new Set(candidates.map((c) => c.event_id));
for (const item of classified) {
    if (item.classification === 'reject' || item.classification === 'legacy_unknown') {
        assert.equal(candidateIds.has(item.event_id), false, `${item.classification} leaked into candidates`);
        assert.equal(item.eligible_for_authority_history, false);
    }
    if (item.classification === 'projection_update' || item.classification === 'system_event') {
        assert.equal(item.eligible_for_authority_history, false);
    }
}

// 8. Negative cases: explicit distinction between epistemic uncertainty and prohibition.
for (const negative of fixture.negative_cases) {
    const result = classifyRuntimeEvent(negative.event);
    assert.equal(
        result.classification,
        negative.expected_classification,
        `negative case ${negative.name}: got ${result.classification}`,
    );
    assert.equal(
        result.eligible_for_authority_history,
        negative.expected_eligible_for_authority_history,
        `negative case ${negative.name}: eligibility mismatch`,
    );
}

// 9. Unknown type collapses to legacy_unknown, never silently to authority candidate.
const unknown = classifyRuntimeEvent({ id: 'x', type: 'NEVER_SEEN_BEFORE' });
assert.equal(unknown.classification, 'legacy_unknown');
assert.equal(unknown.eligible_for_authority_history, false);

// 10. Malformed input is handled without throwing and is not authority-eligible.
for (const malformed of [null, undefined, {}, { type: '' }, { type: '   ' }, 42, 'string']) {
    const result = classifyRuntimeEvent(malformed);
    assert.equal(result.classification, 'legacy_unknown');
    assert.equal(result.eligible_for_authority_history, false);
}
assert.deepStrictEqual(classifyEventLog(null), []);
assert.deepStrictEqual(authorityHistoryCandidatesFromClassifiedEvents(null), []);

console.log('PASS subject authority classifier is a deterministic, non-binding admissibility oracle');
