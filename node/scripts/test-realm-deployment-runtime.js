'use strict';

const assert = require('assert');

const {
    buildCurrentAuthorityState,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
} = require('../current-authority-state');
const {
    acceptAndApplyRealmEvent,
    applyCanonicalAuthorityProjection,
} = require('../realm-event-pipeline');
const { canonicalEncode } = require('../realm-event-history');
const { activateRuntimeDeployment } = require('../realm-deployment-runtime');

const ROOT_REF = 'deployment_root_ref';
const TIMESTAMP = '2026-06-27T00:00:00.000Z';

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
            root_id: 'deployment_root',
            public_key: 'pk_deployment_root',
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
            device_id: 'deployment_device',
            public_key: 'pk_deployment_device',
            authority_ref: 'device:deployment_device',
        },
    };
}

function buildValidLedger() {
    const ledger = createTestLedger();
    const applyEvent = createApplyEvent(ledger);
    const accept = acceptRealmEventFor(ledger, applyEvent);
    assert.strictEqual(accept(rootProposal(1)).ok, true);
    assert.strictEqual(accept(deviceIssueProposal(2)).ok, true);
    return ledger;
}

// 1. compatible runtime activates only after migration, conformance, integrity, lifecycle gates
{
    const ledger = buildValidLedger();
    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-compatible',
        migrationCheck() {
            return { ok: true, checked: true };
        },
    }, {
        currentRuntime: { version: 'runtime-1.0' },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.runtime_activated, true);
    assert.strictEqual(result.conformance.ok, true);
    assert.strictEqual(result.integrity.realm_valid, true);
    assert.strictEqual(result.lifecycle.can_accept_commands, true);
}

// 2. declared migrations require explicit migration evidence
{
    const ledger = buildValidLedger();
    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-missing-migration-check',
        migrations: ['registry-rule-v2'],
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_MIGRATION_CHECK_REQUIRED'));
    assert.strictEqual(ledger.event_log.length, 2);
}

// 3. same events and hashes with different meaning cannot activate
{
    const ledger = buildValidLedger();
    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-reinterprets-history',
        migrationCheck() {
            return { ok: true };
        },
        interpret(history) {
            const projection = buildCurrentAuthorityState(history);
            projection.devices = projection.devices.map((device) => ({
                ...device,
                status: 'revoked',
            }));
            return projection;
        },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_PROTOCOL_CONFORMANCE_FAILED'));
    assert.ok(result.conformance.reason_codes.includes('PROTOCOL_CONFORMANCE_FAILED'));
}

// 4. invalid current integrity blocks activation even if candidate is compatible
{
    const ledger = buildValidLedger();
    ledger.current_authority_state.devices[0].status = 'revoked';

    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-compatible',
        migrationCheck() {
            return { ok: true };
        },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_INTEGRITY_VERIFICATION_FAILED'));
    assert.strictEqual(result.lifecycle.state, 'SUSPENDED');
}

// 5. migration check may not mutate accepted history
{
    const ledger = buildValidLedger();
    const bytesBefore = canonicalEncode(ledger.event_log);
    const beforeState = clone(ledger.current_authority_state);

    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-mutating-migration',
        migrationCheck(candidateLedger) {
            candidateLedger.event_log[1].payload.device_id = 'mutated_by_migration';
            return { ok: true };
        },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_HISTORY_MUTATION_FORBIDDEN'));
    assert.strictEqual(canonicalEncode(ledger.event_log), bytesBefore);
    // The deployment gate isolates migration checks; it does not repair or rewrite projection.
    assert.deepStrictEqual(ledger.current_authority_state, beforeState);
}

// 6. corrupted hash chain fails as protocol conformance, not as runtime startup
{
    const ledger = buildValidLedger();
    ledger.event_log[1].previous_event_hash = 'fake_previous_hash';

    const result = activateRuntimeDeployment(ledger, {
        version: 'runtime-1.1-compatible',
        migrationCheck() {
            return { ok: true };
        },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason_codes.includes('DEPLOYMENT_PROTOCOL_CONFORMANCE_FAILED'));
    assert.ok(result.conformance.reason_codes.includes('PROTOCOL_HISTORY_VERIFICATION_FAILED'));
}

console.log('test-realm-deployment-runtime: all tests passed');
