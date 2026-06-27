'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    createIdentityLedgerStore,
    parseIdentityRealmConfig,
    LedgerWriteForbiddenError,
    LedgerSnapshotVerificationError,
    FileIdentityLedgerStore,
    ReplicatedIdentityLedgerStore,
} = require('../identity-ledger-store');

function tempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleEvent(id, entityAddress) {
    return {
        id,
        type: 'GENESIS',
        payload: {
            entity_l1_address: entityAddress,
            address: entityAddress,
            handle: 'tester',
            publicKey: '3059301306072a8648ce03020706052b8104000a03420004ad8b3f6de867afb6e3dd3f84dded0f35e4fc168a85969b9ffae29eab60bf1dd17',
            credentialId: `cred_${id}`,
            credentialPublicKey: '3059301306072a8648ce03020706052b8104000a03420004ad8b3f6de867afb6e3dd3f84dded0f35e4fc168a85969b9ffae29eab60bf1dd17',
            counter: 0,
            transports: ['internal'],
            rp_id: 'pass.meanly.one',
        },
        timestamp: new Date().toISOString(),
    };
}

function sampleLedger(eventLog, stateRoot = 'state-root-abc') {
    return {
        event_log: eventLog,
        claim_history: [],
        accounts: {
            [eventLog[0]?.payload?.entity_l1_address || 'sl1e_test']: {
                entity_l1_address: eventLog[0]?.payload?.entity_l1_address || 'sl1e_test',
                handle: 'tester',
            },
        },
        state_root: stateRoot,
    };
}

// parseIdentityRealmConfig defaults
{
    const config = parseIdentityRealmConfig({
        SL1_DATA_DIR: '/tmp/realm-test',
    });
    assert.strictEqual(config.realmId, 'default');
    assert.strictEqual(config.role, 'primary');
    assert.strictEqual(config.backend, 'file');
}

// File adapter roundtrip
{
    const dataDir = tempDir('sl1-file-ledger-');
    const store = createIdentityLedgerStore({
        realmId: 'meanly.one',
        role: 'primary',
        backend: 'file',
        dataDir,
    });
    const entity = 'sl1e_aabbccddeeff00112233445566778899001';
    const event = sampleEvent('evt_file_1', entity);
    const ledger = sampleLedger([event], 'root-file-1');

    store.saveSnapshot(ledger);
    const loaded = store.loadBootstrap();
    assert.strictEqual(loaded.event_log.length, 1);
    assert.strictEqual(loaded.event_log[0].id, 'evt_file_1');
    assert.strictEqual(loaded.state_root, 'root-file-1');
    assert.strictEqual(loaded.realm_id, 'meanly.one');
}

// Replicated primary writes event log + snapshot
{
    const dataDir = tempDir('sl1-replicated-primary-');
    const store = new ReplicatedIdentityLedgerStore({
        dataDir,
        realmId: 'meanly.ru',
        role: 'primary',
    });
    const entity = 'sl1e_bbccddeeff0011223344556677889900112';
    const event = sampleEvent('evt_rep_1', entity);
    const ledger = sampleLedger([event], 'root-rep-1');

    store.recordEvent(event);
    store.saveSnapshot(ledger);

    const eventLogPath = path.join(dataDir, 'realm_event_log.jsonl');
    const snapshotPath = path.join(dataDir, 'realm_snapshot.json');
    assert.ok(fs.existsSync(eventLogPath));
    assert.ok(fs.existsSync(snapshotPath));

    const loaded = store.loadBootstrap();
    assert.strictEqual(loaded.event_log.length, 1);
    assert.strictEqual(loaded.state_root, 'root-rep-1');
    assert.strictEqual(loaded.backend, 'replicated');
}

// Restore from event log after deleting snapshot
{
    const dataDir = tempDir('sl1-replicated-restore-');
    const store = new ReplicatedIdentityLedgerStore({
        dataDir,
        realmId: 'meanly.one',
        role: 'primary',
    });
    const entity = 'sl1e_ccddeeff001122334455667788990011223';
    const event = sampleEvent('evt_restore_1', entity);
    const ledger = sampleLedger([event], 'root-restore-1');

    store.recordEvent(event);
    store.saveSnapshot(ledger);
    fs.unlinkSync(path.join(dataDir, 'realm_snapshot.json'));

    const loaded = store.loadBootstrap();
    assert.strictEqual(loaded.event_log.length, 1);
    assert.strictEqual(loaded.event_log[0].id, 'evt_restore_1');
    assert.strictEqual(loaded.state_root, null);
}

// Standby rejects writes
{
    const dataDir = tempDir('sl1-replicated-standby-');
    const primaryDir = tempDir('sl1-replicated-primary-src-');
    const primary = new ReplicatedIdentityLedgerStore({
        dataDir: primaryDir,
        realmId: 'meanly.one',
        role: 'primary',
    });
    const entity = 'sl1e_ddeeff001122334455667788990011223344';
    const event = sampleEvent('evt_standby_1', entity);
    const ledger = sampleLedger([event], 'root-standby-1');
    primary.recordEvent(event);
    primary.saveSnapshot(ledger);

    const standby = new ReplicatedIdentityLedgerStore({
        dataDir,
        realmId: 'meanly.one',
        role: 'standby',
        replicaSource: primaryDir,
    });

    const loaded = standby.loadBootstrap();
    assert.strictEqual(loaded.event_log.length, 1);
    assert.throws(() => standby.recordEvent(event), LedgerWriteForbiddenError);
    assert.throws(() => standby.saveSnapshot(ledger), LedgerWriteForbiddenError);
}

// Corrupted snapshot verification fails closed
{
    const dataDir = tempDir('sl1-replicated-corrupt-');
    const store = new ReplicatedIdentityLedgerStore({
        dataDir,
        realmId: 'meanly.ru',
        role: 'primary',
    });
    const entity = 'sl1e_eeff00112233445566778899001122334455';
    const event = sampleEvent('evt_corrupt_1', entity);
    const ledger = sampleLedger([event], 'root-corrupt-1');

    assert.throws(
        () => store.saveSnapshot(ledger, {
            verifyStateRoot: () => 'different-root',
        }),
        LedgerSnapshotVerificationError,
    );
}

// Identity continuity after simulated node loss: primary writes, standby reloads same event log
{
    const primaryDir = tempDir('sl1-primary-loss-');
    const standbyDir = tempDir('sl1-standby-loss-');

    const primary = new ReplicatedIdentityLedgerStore({
        dataDir: primaryDir,
        realmId: 'meanly.one',
        role: 'primary',
    });
    const entity = 'sl1e_ff0011223344556677889900112233445566';
    const event = sampleEvent('evt_continuity_1', entity);
    const ledger = sampleLedger([event], 'root-continuity-1');
    primary.recordEvent(event);
    primary.saveSnapshot(ledger);

    const standby = new ReplicatedIdentityLedgerStore({
        dataDir: standbyDir,
        realmId: 'meanly.one',
        role: 'standby',
        replicaSource: primaryDir,
    });
    const restored = standby.loadBootstrap();
    assert.strictEqual(restored.event_log[0].payload.entity_l1_address, entity);
    assert.strictEqual(restored.state_root, 'root-continuity-1');
}

// Legacy ledger migration into replicated event log
{
    const dataDir = tempDir('sl1-legacy-migrate-');
    const legacyFile = path.join(dataDir, 'ledger_db.json');
    const entity = 'sl1e_001122334455667788990011223344556677';
    const event = sampleEvent('evt_legacy_1', entity);
    fs.writeFileSync(legacyFile, JSON.stringify({
        event_log: [event],
        claim_history: [],
        accounts: {},
        state_root: 'root-legacy-1',
    }, null, 2));

    const store = new ReplicatedIdentityLedgerStore({
        dataDir,
        realmId: 'meanly.ru',
        role: 'primary',
    });
    const bootstrap = store.loadBootstrap();
    assert.strictEqual(bootstrap.migrated_from_legacy, true);
    assert.strictEqual(bootstrap.event_log.length, 1);
    const migrated = store.migrateLegacyEventLogIfNeeded(bootstrap.event_log);
    assert.strictEqual(migrated, true);
    const reloaded = store.loadBootstrap();
    assert.strictEqual(reloaded.event_log.length, 1);
    assert.strictEqual(reloaded.event_log[0].id, 'evt_legacy_1');
}

console.log('PASS identity realm ledger store');
