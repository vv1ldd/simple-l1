'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEDGER_ROLES = new Set(['primary', 'standby']);
const LEDGER_BACKENDS = new Set(['file', 'replicated']);

class LedgerWriteForbiddenError extends Error {
    constructor(message = 'Ledger writes are forbidden on standby role.') {
        super(message);
        this.name = 'LedgerWriteForbiddenError';
        this.code = 'ledger_write_forbidden';
    }
}

class LedgerSnapshotVerificationError extends Error {
    constructor(message = 'Ledger snapshot failed verification.') {
        super(message);
        this.name = 'LedgerSnapshotVerificationError';
        this.code = 'ledger_snapshot_verification_failed';
    }
}

function parseIdentityRealmConfig(env = process.env) {
    const role = String(env.SL1_LEDGER_ROLE || 'primary').trim().toLowerCase();
    const backend = String(env.SL1_LEDGER_BACKEND || 'file').trim().toLowerCase();

    if (!LEDGER_ROLES.has(role)) {
        throw new Error(`SL1_LEDGER_ROLE must be one of: ${[...LEDGER_ROLES].join(', ')}`);
    }
    if (!LEDGER_BACKENDS.has(backend)) {
        throw new Error(`SL1_LEDGER_BACKEND must be one of: ${[...LEDGER_BACKENDS].join(', ')}`);
    }

    return {
        realmId: String(env.SL1_IDENTITY_REALM_ID || 'default').trim(),
        role,
        backend,
        replicaSource: String(env.SL1_LEDGER_REPLICA_SOURCE || '').trim(),
        dataDir: env.SL1_DATA_DIR || __dirname,
    };
}

function assertLedgerWritable(config) {
    if (config?.role === 'standby') {
        throw new LedgerWriteForbiddenError();
    }
}

function readJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJsonFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readEventLogLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function appendEventLogLine(filePath, event) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}

function copyReplicaArtifacts({ sourceDir, targetDir, files }) {
    if (!sourceDir) return;
    fs.mkdirSync(targetDir, { recursive: true });
    for (const fileName of files) {
        const sourcePath = path.join(sourceDir, fileName);
        if (!fs.existsSync(sourcePath)) continue;
        fs.copyFileSync(sourcePath, path.join(targetDir, fileName));
    }
}

class FileIdentityLedgerStore {
    constructor({ dataDir, realmId = 'default', role = 'primary' } = {}) {
        this.realmId = realmId;
        this.role = role;
        this.dataDir = dataDir;
        this.ledgerFile = path.join(dataDir, 'ledger_db.json');
    }

    get config() {
        return {
            realmId: this.realmId,
            role: this.role,
            backend: 'file',
        };
    }

    assertWritable() {
        assertLedgerWritable(this.config);
    }

    loadBootstrap() {
        const data = readJsonFile(this.ledgerFile, {});
        return {
            event_log: Array.isArray(data.event_log) ? data.event_log : [],
            claim_history: Array.isArray(data.claim_history) ? data.claim_history : [],
            accounts: data.accounts && typeof data.accounts === 'object' ? data.accounts : {},
            state_root: typeof data.state_root === 'string' ? data.state_root : null,
            realm_id: this.realmId,
            role: this.role,
            backend: 'file',
        };
    }

    recordEvent() {
        this.assertWritable();
    }

    saveSnapshot(ledger) {
        this.assertWritable();
        writeJsonFile(this.ledgerFile, ledger);
    }
}

class ReplicatedIdentityLedgerStore {
    constructor({
        dataDir,
        realmId = 'default',
        role = 'primary',
        replicaSource = '',
    } = {}) {
        this.realmId = realmId;
        this.role = role;
        this.replicaSource = replicaSource;
        this.dataDir = dataDir;
        this.eventLogFile = path.join(dataDir, 'realm_event_log.jsonl');
        this.snapshotFile = path.join(dataDir, 'realm_snapshot.json');
        this.legacyLedgerFile = path.join(dataDir, 'ledger_db.json');
    }

    get config() {
        return {
            realmId: this.realmId,
            role: this.role,
            backend: 'replicated',
            replicaSource: this.replicaSource,
        };
    }

    assertWritable() {
        assertLedgerWritable(this.config);
    }

    syncFromReplicaSource() {
        if (!this.replicaSource) return;
        copyReplicaArtifacts({
            sourceDir: this.replicaSource,
            targetDir: this.dataDir,
            files: ['realm_event_log.jsonl', 'realm_snapshot.json'],
        });
    }

    loadBootstrap() {
        if (this.role === 'standby') {
            this.syncFromReplicaSource();
        }

        const snapshot = readJsonFile(this.snapshotFile, null);
        const eventLog = readEventLogLines(this.eventLogFile);

        if (eventLog.length > 0) {
            return {
                event_log: eventLog,
                claim_history: Array.isArray(snapshot?.claim_history) ? snapshot.claim_history : [],
                accounts: snapshot?.accounts && typeof snapshot.accounts === 'object' ? snapshot.accounts : {},
                state_root: typeof snapshot?.state_root === 'string' ? snapshot.state_root : null,
                realm_id: snapshot?.realm_id || this.realmId,
                role: this.role,
                backend: 'replicated',
            };
        }

        const legacy = readJsonFile(this.legacyLedgerFile, {});
        if (Array.isArray(legacy.event_log) && legacy.event_log.length > 0) {
            return {
                event_log: legacy.event_log,
                claim_history: Array.isArray(legacy.claim_history) ? legacy.claim_history : [],
                accounts: legacy.accounts && typeof legacy.accounts === 'object' ? legacy.accounts : {},
                state_root: typeof legacy.state_root === 'string' ? legacy.state_root : null,
                realm_id: this.realmId,
                role: this.role,
                backend: 'replicated',
                migrated_from_legacy: true,
            };
        }

        return {
            event_log: [],
            claim_history: [],
            accounts: {},
            state_root: null,
            realm_id: this.realmId,
            role: this.role,
            backend: 'replicated',
        };
    }

    recordEvent(event) {
        this.assertWritable();
        appendEventLogLine(this.eventLogFile, event);
    }

    migrateLegacyEventLogIfNeeded(eventLog = []) {
        if (this.role !== 'primary') return false;
        if (!Array.isArray(eventLog) || eventLog.length === 0) return false;
        if (readEventLogLines(this.eventLogFile).length > 0) return false;
        for (const event of eventLog) {
            appendEventLogLine(this.eventLogFile, event);
        }
        return true;
    }

    saveSnapshot(ledger, { verifyStateRoot = null } = {}) {
        this.assertWritable();

        if (typeof verifyStateRoot === 'function' && ledger.state_root) {
            const replayedRoot = verifyStateRoot(ledger.event_log || []);
            if (replayedRoot !== ledger.state_root) {
                throw new LedgerSnapshotVerificationError(
                    `snapshot state_root mismatch: expected ${ledger.state_root}, replayed ${replayedRoot}`,
                );
            }
        }

        const snapshot = {
            schema_version: 'simple-l1.realm_snapshot.v1',
            realm_id: this.realmId,
            role: this.role,
            state_root: ledger.state_root || null,
            event_count: Array.isArray(ledger.event_log) ? ledger.event_log.length : 0,
            claim_history: Array.isArray(ledger.claim_history) ? ledger.claim_history : [],
            accounts: ledger.accounts && typeof ledger.accounts === 'object' ? ledger.accounts : {},
            saved_at: new Date().toISOString(),
            snapshot_hash: null,
        };
        snapshot.snapshot_hash = crypto
            .createHash('sha256')
            .update(JSON.stringify({
                realm_id: snapshot.realm_id,
                state_root: snapshot.state_root,
                event_count: snapshot.event_count,
            }))
            .digest('hex');

        writeJsonFile(this.snapshotFile, snapshot);
        writeJsonFile(this.legacyLedgerFile, ledger);
    }

    verifyLoadedState({ eventLog, stateRoot, verifyStateRoot }) {
        if (!stateRoot || typeof verifyStateRoot !== 'function') {
            return true;
        }
        const replayedRoot = verifyStateRoot(eventLog);
        if (replayedRoot !== stateRoot) {
            throw new LedgerSnapshotVerificationError(
                `loaded state_root mismatch: snapshot ${stateRoot}, replayed ${replayedRoot}`,
            );
        }
        return true;
    }
}

function createIdentityLedgerStore(config = parseIdentityRealmConfig()) {
    if (config.backend === 'replicated') {
        return new ReplicatedIdentityLedgerStore(config);
    }
    return new FileIdentityLedgerStore(config);
}

module.exports = {
    LEDGER_ROLES,
    LEDGER_BACKENDS,
    LedgerWriteForbiddenError,
    LedgerSnapshotVerificationError,
    parseIdentityRealmConfig,
    assertLedgerWritable,
    createIdentityLedgerStore,
    FileIdentityLedgerStore,
    ReplicatedIdentityLedgerStore,
};
