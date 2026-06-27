'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildCurrentAuthorityState } = require('../current-authority-state');
const {
    canonicalEncode,
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('../realm-event-history');
const { calculateProjectionHash } = require('../realm-observability');
const { validateRealmEventProposal } = require('../realm-event-validator');
const { verifyDeviceSignature } = require('../device-event-submission-runtime');

const corpusDir = process.env.REALM_CONFORMANCE_VECTORS
    || path.join(__dirname, '..', '..', 'docs', 'protocol', 'v1', 'vectors');
const authorityBasicDir = path.join(corpusDir, 'canonical', 'authority-basic');
const historyPath = path.join(authorityBasicDir, 'history.jsonl');
const expectedStatePath = path.join(authorityBasicDir, 'expected-state.json');
const expectedAnchorsPath = path.join(authorityBasicDir, 'expected-anchors.json');
const protocolVersionPath = path.join(authorityBasicDir, 'protocol-version.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function emptyIndependentProjection() {
    return {
        rootAuthority: null,
        recoveryAuthorities: [],
        devices: [],
        sessions: [],
        federationTrusts: [],
        lastSequence: 0,
    };
}

function independentEnvelope(event) {
    return event.envelope && typeof event.envelope === 'object'
        ? event.envelope
        : event;
}

function independentPayload(event) {
    return event.payload && typeof event.payload === 'object'
        ? event.payload
        : {};
}

function independentEventVersion(event, envelope) {
    return Number(event.version ?? envelope.version ?? 1);
}

function requireIndependentV1(event, envelope) {
    const version = independentEventVersion(event, envelope);
    if (version !== 1) {
        throw new Error(`INDEPENDENT_INTERPRETER_UNSUPPORTED_EVENT_VERSION:${envelope.type}:version_${version}`);
    }
}

function applyRootAuthorityCreated(projection, event, envelope, payload) {
    return {
        ...projection,
        rootAuthority: {
            id: String(payload.root_id || envelope.authority_reference || envelope.signer),
            authorityRef: String(envelope.authority_reference || envelope.signer),
            status: 'active',
            issuedAt: envelope.timestamp || event.timestamp || null,
            issuedEvent: event.id || event.event_id || null,
        },
        lastSequence: Number(envelope.sequence),
    };
}

function applyDeviceKeyIssued(projection, event, envelope, payload) {
    const deviceId = String(payload.device_id || payload.device || payload.authority_ref || payload.device_authority);
    const authorityRef = String(payload.authority_ref || payload.device_authority || `device:${deviceId}`);
    const nextDevices = (projection.devices || [])
        .filter((device) => device.id !== deviceId && device.authorityRef !== authorityRef);

    nextDevices.push({
        id: deviceId,
        authority: authorityRef,
        authorityRef,
        status: 'active',
        publicKey: payload.public_key || payload.publicKey || null,
        issuedAt: envelope.timestamp || event.timestamp || null,
        issuedEvent: event.id || event.event_id || null,
        revokedAt: null,
        revokedEvent: null,
    });

    return {
        ...projection,
        devices: nextDevices,
        lastSequence: Number(envelope.sequence),
    };
}

function buildIndependentAuthorityState(eventLog = []) {
    verifyRealmEventHistory(eventLog);
    let projection = emptyIndependentProjection();

    for (const event of eventLog) {
        const envelope = independentEnvelope(event);
        const payload = independentPayload(event);
        if (event.realm_event !== true) continue;

        switch (envelope.type || event.type) {
        case 'ROOT_AUTHORITY_CREATED':
            requireIndependentV1(event, envelope);
            projection = applyRootAuthorityCreated(projection, event, envelope, payload);
            break;
        case 'DEVICE_KEY_ISSUED':
            requireIndependentV1(event, envelope);
            projection = applyDeviceKeyIssued(projection, event, envelope, payload);
            break;
        default:
            throw new Error(`INDEPENDENT_INTERPRETER_UNKNOWN_EVENT_TYPE:${envelope.type || event.type}`);
        }
    }

    return projection;
}

function authoritySubjects(projection) {
    const subjects = [];
    if (projection.rootAuthority) {
        subjects.push({
            kind: 'root',
            ref: projection.rootAuthority.authorityRef || projection.rootAuthority.id,
            status: projection.rootAuthority.status,
        });
    }
    for (const device of projection.devices || []) {
        subjects.push({
            kind: 'device',
            ref: device.authorityRef || device.authority || device.id,
            status: device.status,
        });
    }
    return subjects;
}

function semanticAnchors(eventLog, projection) {
    return {
        anchor_schema: 1,
        history_head: latestRealmEventHash(eventLog),
        projection_hash: calculateProjectionHash(projection),
        current_authority: projection.rootAuthority?.authorityRef || projection.rootAuthority?.id || null,
        last_sequence: projection.lastSequence || 0,
        canonical_event_count: eventLog.filter((event) => event.realm_event === true).length,
        authority_subjects: authoritySubjects(projection),
    };
}

function negativeFixture(name) {
    const fixtureDir = path.join(corpusDir, 'negative', name);
    return {
        history: fs.existsSync(path.join(fixtureDir, 'history.jsonl'))
            ? readJsonl(path.join(fixtureDir, 'history.jsonl'))
            : null,
        expected: readJson(path.join(fixtureDir, 'expected-result.json')),
        proposal: fs.existsSync(path.join(fixtureDir, 'proposal.json'))
            ? readJson(path.join(fixtureDir, 'proposal.json'))
            : null,
        signedProposal: fs.existsSync(path.join(fixtureDir, 'signed-proposal.json'))
            ? readJson(path.join(fixtureDir, 'signed-proposal.json'))
            : null,
    };
}

function assertThrowsReason(fn, expected) {
    assert.throws(fn, (error) => {
        const message = String(error?.message || error);
        if (message.includes(expected.reason)) return true;
        return (expected.runtime_reason_aliases || []).some((alias) => message.includes(alias));
    });
}

function assertResultReason(result, expected) {
    assert.strictEqual(result.ok, false);
    assert.ok(
        (result.reason_codes || []).some((code) => code.includes(expected.reason))
        || (expected.runtime_reason_aliases || []).some((alias) =>
            (result.reason_codes || []).some((code) => code.includes(alias))
        ),
    );
}

function ledgerFromHistory(eventLog) {
    return {
        event_log: eventLog,
        current_authority_state: buildCurrentAuthorityState(eventLog),
    };
}

// 1. Independent Interpreter B matches registry-backed Interpreter A on normative v1 fixture semantics.
{
    const eventLog = readJsonl(historyPath);
    const expectedState = readJson(expectedStatePath);
    const expectedAnchors = readJson(expectedAnchorsPath);
    const protocolVersion = readJson(protocolVersionPath);

    const interpreterA = buildCurrentAuthorityState(eventLog);
    const interpreterB = buildIndependentAuthorityState(eventLog);
    const anchorsA = semanticAnchors(eventLog, interpreterA);
    const anchorsB = semanticAnchors(eventLog, interpreterB);

    assert.deepStrictEqual(interpreterA, expectedState);
    assert.deepStrictEqual(interpreterB, expectedState);
    assert.deepStrictEqual(anchorsB, anchorsA);
    assert.deepStrictEqual(anchorsB, expectedAnchors);
    assert.strictEqual(protocolVersion.anchor_schema, expectedAnchors.anchor_schema);
    assert.strictEqual(protocolVersion.normative, true);
}

// 2. Unsupported event versions fail explicitly instead of falling back silently.
{
    const { history, expected } = negativeFixture('unsupported-version');
    assert.strictEqual(expected.accepted, false);
    assertThrowsReason(() => buildCurrentAuthorityState(history), expected);
    assertThrowsReason(() => buildIndependentAuthorityState(history), expected);
}

// 3. Broken hash chains fail before semantic interpretation.
{
    const { history, expected } = negativeFixture('hash-chain-broken');
    assert.strictEqual(expected.accepted, false);
    assertThrowsReason(() => buildCurrentAuthorityState(history), expected);
    assertThrowsReason(() => buildIndependentAuthorityState(history), expected);
}

// 4. Proposal-level negative vectors define normative rejection semantics.
{
    const eventLog = readJsonl(historyPath);
    const ledger = ledgerFromHistory(eventLog);

    const unknownEvent = negativeFixture('unknown-event');
    assert.strictEqual(unknownEvent.expected.accepted, false);
    assertResultReason(validateRealmEventProposal(ledger, unknownEvent.proposal), unknownEvent.expected);

    const scopeViolation = negativeFixture('authority-scope-violation');
    assert.strictEqual(scopeViolation.expected.accepted, false);
    assertResultReason(validateRealmEventProposal(ledger, scopeViolation.proposal), scopeViolation.expected);

    const invalidSignature = negativeFixture('invalid-signature');
    assert.strictEqual(invalidSignature.expected.accepted, false);
    assertResultReason(verifyDeviceSignature(ledger, invalidSignature.signedProposal), invalidSignature.expected);
}

// 5. A bad independent implementation that changes semantics is detected by anchors.
{
    const eventLog = readJsonl(historyPath);
    const correct = buildIndependentAuthorityState(eventLog);
    const incorrect = {
        ...correct,
        devices: correct.devices.map((device) => ({
            ...device,
            status: 'revoked',
        })),
    };

    const correctAnchors = semanticAnchors(eventLog, correct);
    const incorrectAnchors = semanticAnchors(eventLog, incorrect);

    assert.notStrictEqual(correctAnchors.projection_hash, incorrectAnchors.projection_hash);
    assert.notStrictEqual(
        canonicalEncode(correctAnchors.authority_subjects),
        canonicalEncode(incorrectAnchors.authority_subjects),
    );
}

// 6. Event bytes remain immutable while implementations compare semantic output.
{
    const eventLog = readJsonl(historyPath);
    const bytesBefore = canonicalEncode(eventLog);
    buildCurrentAuthorityState(eventLog);
    buildIndependentAuthorityState(eventLog);
    assert.strictEqual(canonicalEncode(eventLog), bytesBefore);
}

console.log('test-independent-interpreter-conformance: all tests passed');
