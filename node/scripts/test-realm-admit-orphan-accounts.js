#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    ADMISSION_EVENT_TYPE,
    calculateStateRoot,
    detectOrphanAccounts,
    buildAdmissionEvent,
    planAdmissions,
    admitOrphanAccounts,
} = require('./realm-admit-orphan-accounts');

function baseLedger() {
    // Mirrors the lena incident shape: snapshot has an admin subject with no
    // creation event in the log and no full credential material to backfill.
    return {
        governance: {
            constitution_root: 'constitution-test-root',
            current_epoch: 0,
        },
        event_log: [
            { id: 'g0', type: 'SYSTEM_GENESIS', timestamp: 't0', payload: {} },
            {
                id: 'g1',
                type: 'GENESIS',
                timestamp: 't1',
                payload: { entity_l1_address: 'sl1e_user', credentialId: 'credUser' },
            },
        ],
        accounts: {
            sl1e_user: {
                entity_l1_address: 'sl1e_user',
                handle: 'user',
                credentialId: 'credUser',
                credentialPublicKey: 'pkUser',
                publicKey: 'pubUser',
                balances: { SL: 1000 },
                nonce: 0,
            },
            sl1e_admin: {
                entity_l1_address: 'sl1e_admin',
                handle: 'admin',
                credentialId: 'cred_admin_secure_anchor',
                publicKey: 'pubAdmin',
                // No credentialPublicKey -> not backfill-eligible -> orphan.
                balances: { SL: 5000 },
                nonce: 0,
            },
        },
    };
}

// The stored root reflects the full 2-account snapshot (including admin).
function withStoredRoot(ledger) {
    ledger.state_root = calculateStateRoot(ledger);
    return ledger;
}

// detectOrphanAccounts finds only the admin subject.
{
    const ledger = baseLedger();
    const orphans = detectOrphanAccounts(ledger);
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0].address, 'sl1e_admin');
}

// buildAdmissionEvent carries exact account state and is account-layer only.
{
    const ledger = baseLedger();
    const event = buildAdmissionEvent('sl1e_admin', ledger.accounts.sl1e_admin, {});
    assert.strictEqual(event.type, ADMISSION_EVENT_TYPE);
    assert.strictEqual(event.realm_event, false);
    assert.strictEqual(event.payload.account, 'sl1e_admin');
    assert.strictEqual(event.payload.account_state.balances.SL, 5000);
    assert.strictEqual(event.payload.account_state.entity_l1_address, 'sl1e_admin');
}

// admitOrphanAccounts preserves the stored state_root (reconstruct-exact).
{
    const ledger = withStoredRoot(baseLedger());
    const result = admitOrphanAccounts(ledger);
    assert.deepStrictEqual(result.admitted, ['sl1e_admin']);
    assert.strictEqual(result.rootPreserved, true);
    assert.strictEqual(result.storedRoot, result.recomputedRoot);
    const appended = result.ledger.event_log.filter((e) => e.type === ADMISSION_EVENT_TYPE);
    assert.strictEqual(appended.length, 1);
}

// Idempotency: running again on an already-admitted ledger admits nothing.
{
    const ledger = withStoredRoot(baseLedger());
    const first = admitOrphanAccounts(ledger);
    const second = admitOrphanAccounts(first.ledger);
    assert.deepStrictEqual(second.admitted, []);
    assert.deepStrictEqual(second.skipped, ['sl1e_admin']);
    const appended = second.ledger.event_log.filter((e) => e.type === ADMISSION_EVENT_TYPE);
    assert.strictEqual(appended.length, 1);
}

// planAdmissions reports orphans without mutating the input ledger.
{
    const ledger = baseLedger();
    const before = JSON.stringify(ledger.event_log);
    const plan = planAdmissions(ledger);
    assert.deepStrictEqual(plan.orphans, ['sl1e_admin']);
    assert.strictEqual(plan.toAdmit.length, 1);
    assert.strictEqual(JSON.stringify(ledger.event_log), before);
}

// A fully backfill-eligible orphan-looking account is NOT admitted (boot
// backfill would reconstruct it), proving detection mirrors server.js.
{
    const ledger = baseLedger();
    ledger.accounts.sl1e_admin.credentialPublicKey = 'pkAdmin';
    const orphans = detectOrphanAccounts(ledger);
    assert.strictEqual(orphans.length, 0);
}

process.stdout.write('realm-admit-orphan-accounts: all tests passed\n');
