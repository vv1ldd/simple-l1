'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const {
    attachRealmEventHashChain,
    calculateRealmEventHash,
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('../realm-event-history');
const { calculateProjectionHash } = require('../realm-observability');
const { validateRealmEventProposal } = require('../realm-event-validator');
const {
    COMMAND_TYPES,
    executeRealmCommand,
} = require('../realm-command-runtime');
const { signDeviceProposal } = require('../device-event-submission-runtime');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'realm-history', 'v1');
const historyPath = path.join(fixtureDir, 'authority-basic.jsonl');
const expectedStatePath = path.join(fixtureDir, 'expected-state.json');

const ROOT_REF = 'protocol_root_ref';
const DEVICE_ID = 'protocol_device';
const DEVICE_REF = `device:${DEVICE_ID}`;
const DEVICE_KEY = 'pk_protocol_device';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createTestLedger() {
    const ledger = {
        event_log: [],
        claim_history: [],
        accounts: {},
        state_root: 'test-root',
    };
    ensureAuthorityStateStores(ledger);
    return ledger;
}

function createApplyEvent(ledger) {
    return function applyEvent(event, isInitialReplay = false) {
        if (isCanonicalRealmEvent(event)) {
            applyCanonicalAuthorityProjection(ledger, event);
        }
        if (!isInitialReplay) {
            ledger.event_log.push(event);
        }
    };
}

function acceptRealmEventFor(ledger, applyEvent) {
    return (proposal) => acceptAndApplyRealmEvent(ledger, proposal, { applyEvent });
}

function rootProposal(sequence = 1) {
    return {
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            root_id: 'protocol_root',
            public_key: 'pk_protocol_root',
        },
    };
}

function deviceIssueProposal(sequence = 2) {
    return {
        envelope: {
            type: 'DEVICE_KEY_ISSUED',
            signer: ROOT_REF,
            authority_reference: ROOT_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            device_id: DEVICE_ID,
            public_key: DEVICE_KEY,
            authority_ref: DEVICE_REF,
        },
    };
}

function sessionIssueProposal(sequence = 3, sessionId = 'protocol_session') {
    return {
        envelope: {
            type: 'SESSION_AUTHORITY_ISSUED',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            session_id: sessionId,
            device_ref: DEVICE_ID,
            authority_ref: `session:${sessionId}`,
        },
    };
}

function recoveryAuthorityIssueProposal(sequence = 3) {
    return {
        envelope: {
            type: 'RECOVERY_AUTHORITY_ISSUED',
            signer: DEVICE_REF,
            authority_reference: DEVICE_REF,
            sequence,
            timestamp: TIMESTAMP,
        },
        payload: {
            recovery_authority_id: 'protocol_recovery',
            public_key: 'pk_protocol_recovery',
            authority_ref: 'recovery:protocol_recovery',
        },
    };
}

function signedProposal(proposal, publicKey = DEVICE_KEY) {
    return {
        proposal,
        signature: signDeviceProposal(proposal, publicKey),
    };
}

function setupRootAndDevice(ledger, applyEvent) {
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(rootProposal(1)).ok, true);
    assert.strictEqual(acceptRealmEventFor(ledger, applyEvent)(deviceIssueProposal(2)).ok, true);
}

function replayUnderProtocol(eventLog, runtime = {}) {
    verifyRealmEventHistory(eventLog);
    if (!runtime.supportsMissingMigrationAdapter) {
        for (const event of eventLog) {
            if (Number(event.version ?? event.envelope?.version ?? 1) !== 1) {
                return {
                    ok: false,
                    reason_codes: ['PROTOCOL_VERSION_NEGOTIATION_FAILED'],
                };
            }
        }
    }

    const projection = runtime.interpret
        ? runtime.interpret(eventLog)
        : buildCurrentAuthorityState(eventLog);

    return {
        ok: true,
        projection,
        projection_hash: calculateProjectionHash(projection),
        history_head: latestRealmEventHash(eventLog),
        authority_interpretation: projection.rootAuthority?.authorityRef || null,
    };
}

function assertCompatibleRuntime(eventLog, oldRuntime, newRuntime) {
    const oldResult = replayUnderProtocol(eventLog, oldRuntime);
    const newResult = replayUnderProtocol(eventLog, newRuntime);

    if (!oldResult.ok) return oldResult;
    if (!newResult.ok) return newResult;

    if (oldResult.projection_hash !== newResult.projection_hash
        || oldResult.history_head !== newResult.history_head
        || oldResult.authority_interpretation !== newResult.authority_interpretation) {
        return {
            ok: false,
            reason_codes: ['PROTOCOL_COMPATIBILITY_FAILED'],
            old_result: oldResult,
            new_result: newResult,
        };
    }

    return {
        ok: true,
        projection_hash: oldResult.projection_hash,
        history_head: oldResult.history_head,
        authority_interpretation: oldResult.authority_interpretation,
    };
}

function evaluateRegistryRuleUpgrade(ledger, proposal, { upgradeEvidence = null } = {}) {
    const oldValidation = validateRealmEventProposal(ledger, proposal);
    const newRegistryWouldAccept = oldValidation.reason_codes?.includes('AUTHORITY_TRANSITION_DENIED');

    if (newRegistryWouldAccept && !upgradeEvidence) {
        return {
            ok: false,
            reason_codes: ['REGISTRY_RULE_UPGRADE_EVIDENCE_REQUIRED'],
            old_reason_codes: oldValidation.reason_codes,
        };
    }

    return {
        ok: true,
        compatibility: newRegistryWouldAccept ? 'breaking_with_explicit_evidence' : 'compatible',
        evidence: upgradeEvidence,
    };
}

function executeSdkAlias(command, context) {
    if (command.type !== 'ISSUE_SESSION_ALIAS') {
        return executeRealmCommand(command, context);
    }

    const proposal = sessionIssueProposal(
        command.payload.sequence,
        command.payload.session_id,
    );
    return executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            signedProposal: signedProposal(proposal),
        },
        actor: command.actor,
    }, context);
}

function unsupportedVersionEvent() {
    return attachRealmEventHashChain({
        type: 'ROOT_AUTHORITY_CREATED',
        realm_event: true,
        version: 99,
        projection_version: 1,
        envelope: {
            type: 'ROOT_AUTHORITY_CREATED',
            signer: 'unsupported_protocol_root',
            authority_reference: 'unsupported_protocol_root',
            sequence: 1,
            timestamp: TIMESTAMP,
            previous_event_hash: null,
        },
        payload: {
            root_id: 'unsupported_protocol_root',
            public_key: 'pk_unsupported_protocol_root',
        },
        signer: 'unsupported_protocol_root',
        authority_reference: 'unsupported_protocol_root',
        sequence: 1,
        timestamp: TIMESTAMP,
        accepted_at: TIMESTAMP,
    }, null);
}

// 1. event schema v1 -> current adapter -> same projection
{
    const originalBytes = fs.readFileSync(historyPath, 'utf8');
    const eventLog = readJsonl(historyPath);
    const expectedState = JSON.parse(fs.readFileSync(expectedStatePath, 'utf8'));
    const compatibility = assertCompatibleRuntime(eventLog, { version: 'fixture-v1' }, { version: 'current-compatible' });

    assert.strictEqual(compatibility.ok, true);
    assert.deepStrictEqual(buildCurrentAuthorityState(eventLog), expectedState);
    assert.strictEqual(fs.readFileSync(historyPath, 'utf8'), originalBytes);
}

// 2. registry rule version change requires explicit compatibility evidence
{
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    setupRootAndDevice(ledger, applyEvent);

    const proposal = recoveryAuthorityIssueProposal(3);
    const missingEvidence = evaluateRegistryRuleUpgrade(ledger, proposal);
    assert.strictEqual(missingEvidence.ok, false);
    assert.ok(missingEvidence.reason_codes.includes('REGISTRY_RULE_UPGRADE_EVIDENCE_REQUIRED'));
    assert.ok(missingEvidence.old_reason_codes.includes('AUTHORITY_TRANSITION_DENIED'));

    const withEvidence = evaluateRegistryRuleUpgrade(ledger, proposal, {
        upgradeEvidence: {
            change: 'allow_device_recovery_authority_issue',
            beforeAfterReplay: 'recorded',
            approval: 'protocol-governance-test',
        },
    });
    assert.strictEqual(withEvidence.ok, true);
    assert.strictEqual(withEvidence.compatibility, 'breaking_with_explicit_evidence');
}

// 3. unsupported version fails hard without silent fallback
{
    const eventLog = [unsupportedVersionEvent()];
    assert.strictEqual(verifyRealmEventHistory(eventLog), true);

    const result = replayUnderProtocol(eventLog, { version: 'current-compatible' });
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROTOCOL_VERSION_NEGOTIATION_FAILED'));
}

// 4. crypto algorithm metadata migration preserves history meaning
{
    const eventLog = readJsonl(historyPath);
    const hashesBefore = eventLog.map((event, index) => {
        const previousHash = index === 0 ? null : eventLog[index - 1].current_event_hash;
        return calculateRealmEventHash(event, previousHash);
    });

    const mixedAlgorithmHistory = clone(eventLog);
    mixedAlgorithmHistory[0].signature_algorithm = 'v1';
    mixedAlgorithmHistory[1].signature_algorithm = 'v2';

    const hashesAfter = mixedAlgorithmHistory.map((event, index) => {
        const previousHash = index === 0 ? null : mixedAlgorithmHistory[index - 1].current_event_hash;
        return calculateRealmEventHash(event, previousHash);
    });

    assert.deepStrictEqual(hashesAfter, hashesBefore);
    assert.strictEqual(assertCompatibleRuntime(eventLog, {}, { interpret: () => buildCurrentAuthorityState(mixedAlgorithmHistory) }).ok, true);
}

// 5. SDK command alias resolves to the same accepted event path
{
    const directLedger = createTestLedger();
    const directApplyEvent = createApplyEvent(directLedger);
    setupRootAndDevice(directLedger, directApplyEvent);

    const aliasLedger = createTestLedger();
    const aliasApplyEvent = createApplyEvent(aliasLedger);
    setupRootAndDevice(aliasLedger, aliasApplyEvent);

    const directProposal = sessionIssueProposal(3, 'sdk_alias_session');
    const directResult = executeRealmCommand({
        type: COMMAND_TYPES.SUBMIT_DEVICE_EVENT,
        payload: {
            signedProposal: signedProposal(directProposal),
        },
        actor: { sdk: 'direct' },
    }, {
        ledger: directLedger,
        acceptRealmEvent: acceptRealmEventFor(directLedger, directApplyEvent),
    });

    const aliasResult = executeSdkAlias({
        type: 'ISSUE_SESSION_ALIAS',
        payload: {
            sequence: 3,
            session_id: 'sdk_alias_session',
        },
        actor: { sdk: 'alias' },
    }, {
        ledger: aliasLedger,
        acceptRealmEvent: acceptRealmEventFor(aliasLedger, aliasApplyEvent),
    });

    assert.strictEqual(directResult.ok, true);
    assert.strictEqual(aliasResult.ok, true);
    assert.strictEqual(directLedger.event_log[2].current_event_hash, aliasLedger.event_log[2].current_event_hash);
    assert.deepStrictEqual(directLedger.current_authority_state, aliasLedger.current_authority_state);
}

// 6. migration adapter missing means no silent fallback and no event synthesis
{
    const beforeLog = readJsonl(historyPath);
    const eventLog = [unsupportedVersionEvent()];
    const result = replayUnderProtocol(eventLog);

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROTOCOL_VERSION_NEGOTIATION_FAILED'));
    assert.deepStrictEqual(readJsonl(historyPath), beforeLog);
}

// 7. compatible-looking runtime that reinterprets accepted history is rejected
{
    const eventLog = readJsonl(historyPath);
    const maliciousRuntime = {
        version: 'claims-compatible-but-reinterprets',
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    };

    const result = assertCompatibleRuntime(eventLog, { version: 'fixture-v1' }, maliciousRuntime);
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('PROTOCOL_COMPATIBILITY_FAILED'));
}

console.log('test-protocol-evolution-governance: all tests passed');
