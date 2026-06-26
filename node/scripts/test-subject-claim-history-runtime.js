#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    CLAIM_HISTORY_RULESET_VERSION,
    deriveActiveClaimProjection,
    emailDisclosureFromClaimHistory,
    validateClaimEvent,
} = require('../subject-claim-history-runtime');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'subject-authority',
    'fixtures',
    'claim-history-v1.json',
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function eventsById(fixture) {
    return Object.fromEntries(fixture.claim_history.map((event) => [event.event_id, event]));
}

function selectHistory(fixture, ids) {
    const byId = eventsById(fixture);
    return ids.map((id) => {
        assert(byId[id], `missing fixture event ${id}`);
        return byId[id];
    });
}

function idsOf(claims) {
    return claims.map((claim) => claim.claim_id).sort();
}

const fixture = readJson(fixturePath);
assert.equal(fixture.ruleset_version, CLAIM_HISTORY_RULESET_VERSION);
assert.equal(fixture.ruleset_status, 'frozen');

for (const event of fixture.claim_history) {
    assert.equal(validateClaimEvent(event).ok, true, event.event_id);
}

for (const positive of fixture.positive_cases) {
    const projection = deriveActiveClaimProjection(selectHistory(fixture, positive.history_event_ids), {
        subject: fixture.subjects.alice,
    });

    assert.equal(projection.projection_type, 'active_claim_projection');
    assert.equal(projection.authoritative_for_subject, false);
    assert.deepStrictEqual(projection.rejected_events, [], positive.name);

    if (positive.expected.active_claims) {
        for (const expected of positive.expected.active_claims) {
            const actual = projection.active_claims.find((claim) => claim.claim_id === expected.claim_id);
            assert(actual, `${positive.name}: expected active claim ${expected.claim_id}`);
            for (const [key, value] of Object.entries(expected)) {
                assert.equal(actual[key], value, `${positive.name}: ${expected.claim_id}.${key}`);
            }
        }
    }

    if (positive.expected.inactive_claims) {
        for (const expected of positive.expected.inactive_claims) {
            const actual = projection.inactive_claims.find((claim) => claim.claim_id === expected.claim_id);
            assert(actual, `${positive.name}: expected inactive claim ${expected.claim_id}`);
            for (const [key, value] of Object.entries(expected)) {
                assert.equal(actual[key], value, `${positive.name}: ${expected.claim_id}.${key}`);
            }
        }
    }

    if (positive.expected.active_claim_types) {
        assert.deepStrictEqual(
            projection.active_claims.map((claim) => claim.claim_type).sort(),
            positive.expected.active_claim_types.sort(),
            positive.name,
        );
    }
}

for (const disclosureCase of fixture.disclosure_cases) {
    const disclosure = emailDisclosureFromClaimHistory({
        claimHistory: selectHistory(fixture, disclosureCase.history_event_ids),
        subject: disclosureCase.input.subject,
        scope: disclosureCase.input.scope,
    });
    assert.equal(disclosure.email, disclosureCase.expected.email, disclosureCase.name);
    assert.equal(disclosure.email_hash, disclosureCase.expected.email_hash, disclosureCase.name);
    assert.equal(disclosure.active_claim_projection.authoritative_for_subject, false);
}

const fullProjection = deriveActiveClaimProjection(fixture.claim_history, { subject: fixture.subjects.alice });
assert.deepStrictEqual(idsOf(fullProjection.active_claims), ['claim_evt_matrix_001']);
assert(fullProjection.inactive_claims.some((claim) => claim.claim_id === 'claim_evt_email_002' && claim.status === 'revoked'));

const invalidSupersession = deriveActiveClaimProjection([
    {
        event_id: 'claim_evt_invalid_supersession',
        event_type: 'CLAIM_SUPERSEDED',
        subject: fixture.subjects.alice,
        claim_type: 'controls_email',
        supersedes: 'missing_claim',
        value_hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    },
]);
assert.deepStrictEqual(invalidSupersession.rejected_events[0].reason_codes, ['CLAIM_SUPERSESSION_TARGET_INVALID']);

const before = JSON.stringify(fixture.claim_history);
deriveActiveClaimProjection(fixture.claim_history, { subject: fixture.subjects.alice });
const after = JSON.stringify(fixture.claim_history);
assert.equal(before, after, 'claim history evaluator must not mutate inputs');

const firstRun = deriveActiveClaimProjection(fixture.claim_history, { subject: fixture.subjects.alice });
const secondRun = deriveActiveClaimProjection(fixture.claim_history, { subject: fixture.subjects.alice });
assert.deepStrictEqual(firstRun, secondRun, 'same claim_history must produce same active_claim_projection');

for (const negative of fixture.negative_cases) {
    assert(!JSON.stringify(negative).includes('"state_mutation"'), `${negative.name}: no mutation language`);
    assert(!JSON.stringify(negative).includes('"account_state"'), `${negative.name}: no account state language`);
}

console.log('PASS subject claim history preserves ADR-0057 versionable claim boundaries');
