#!/usr/bin/env node
'use strict';

// Provenance admission for orphan operational subjects.
//
// An orphan subject is an account that exists in ledger.accounts but has no
// accepted transition that created it: it entered state outside the causal
// event path (e.g. dev admin onboarding injection, ADR-0054) and the boot
// backfill cannot reconstruct it because it lacks full passkey credential
// material. Such a subject breaks the invariant state = projection(history)
// and is surfaced by the snapshot-verification guard.
//
// This tool legalizes provenance without mutating meaning: for each orphan it
// appends an ACCOUNT_PROVENANCE_ADMISSION event carrying the subject's exact
// current account state, so replay reproduces it byte-for-byte. Because the
// reconstruction is exact, the stored state_root is preserved (reconstruct-exact
// strategy) and the existing snapshot stays valid.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMISSION_EVENT_TYPE = 'ACCOUNT_PROVENANCE_ADMISSION';

function nativeBalance(account) {
    return Number(account?.balances?.SL ?? account?.balances?.SL1 ?? 0);
}

// Mirrors calculateStateRoot() in server.js so the tool can verify, before
// writing, that the reconstruct-exact admission preserves the stored root.
function calculateStateRoot(ledger) {
    const accounts = ledger.accounts || {};
    const sortedAddresses = Object.keys(accounts).sort();
    let stateString = '';
    for (const addr of sortedAddresses) {
        const acc = accounts[addr];
        stateString += addr + ':' + nativeBalance(acc) + ':' + (acc.nonce || 0) + '|';
    }
    const constitutionRoot = ledger.governance?.constitution_root || 'genesis';
    const epoch = ledger.governance?.current_epoch ?? 0;
    stateString += `|constitution:${constitutionRoot}:epoch:${epoch}`;
    return crypto.createHash('sha256').update(stateString).digest('hex');
}

// Mirrors the boot backfill eligibility in server.js (legacyAccountGenesisEvent):
// an account is reconstructable by backfill only with full credential material.
function isBackfillEligible(account) {
    const credentialId = account?.credentialId || account?.credential_id;
    const credentialPublicKey = account?.credentialPublicKey || account?.credential_public_key;
    const entityAddress = account?.entity_l1_address || account?.address;
    const publicKey = account?.publicKey || credentialPublicKey;
    return Boolean(entityAddress && publicKey && credentialId && credentialPublicKey);
}

function knownCredentialIds(eventLog) {
    return new Set(
        (eventLog || [])
            .map((event) => event?.payload?.credentialId || event?.payload?.credential_id)
            .filter(Boolean)
            .map(String)
    );
}

function admittedAddresses(eventLog) {
    return new Set(
        (eventLog || [])
            .filter((event) => event?.type === ADMISSION_EVENT_TYPE)
            .map((event) => String(event?.payload?.account || event?.payload?.entity_l1_address || ''))
            .filter(Boolean)
    );
}

// An orphan is in accounts, has no creation event (credentialId unknown to the
// log) and cannot be reconstructed by backfill.
function detectOrphanAccounts(ledger) {
    const accounts = ledger.accounts || {};
    const known = knownCredentialIds(ledger.event_log);
    const orphans = [];
    for (const addr of Object.keys(accounts).sort()) {
        const account = accounts[addr];
        const credentialId = String(account?.credentialId || account?.credential_id || '');
        const hasCreationEvent = credentialId && known.has(credentialId);
        if (hasCreationEvent) continue;
        if (isBackfillEligible(account)) continue;
        orphans.push({ address: addr, account });
    }
    return orphans;
}

function buildAdmissionEvent(address, account, { reason, timestamp } = {}) {
    const accountState = JSON.parse(JSON.stringify(account));
    accountState.entity_l1_address = address;
    const ts = timestamp || account?.keys?.[0]?.registered_at || new Date().toISOString();
    const fingerprint = crypto
        .createHash('sha256')
        .update(`${ADMISSION_EVENT_TYPE}:${address}:${JSON.stringify(accountState)}`)
        .digest('hex')
        .slice(0, 16);
    return {
        id: `provadm_${fingerprint}`,
        type: ADMISSION_EVENT_TYPE,
        realm_event: false,
        timestamp: ts,
        payload: {
            account: address,
            entity_l1_address: address,
            subject: account?.handle || account?.alias || address,
            reason: reason || 'historical bootstrap subject reconciliation (ADR-0054)',
            account_state: accountState,
        },
    };
}

// Returns a new plan describing the admission events to append. Idempotent:
// subjects already admitted (admission event present) are reported as skipped.
function planAdmissions(ledger, options = {}) {
    const orphans = detectOrphanAccounts(ledger);
    const alreadyAdmitted = admittedAddresses(ledger.event_log);
    const toAdmit = [];
    const skipped = [];
    for (const orphan of orphans) {
        if (alreadyAdmitted.has(orphan.address)) {
            skipped.push(orphan.address);
            continue;
        }
        toAdmit.push({
            address: orphan.address,
            event: buildAdmissionEvent(orphan.address, orphan.account, options),
        });
    }
    return { orphans: orphans.map((o) => o.address), toAdmit, skipped };
}

// Applies the plan to a deep copy of the ledger and verifies the reconstruct-exact
// invariant: the stored state_root must be unchanged by the admission.
function admitOrphanAccounts(ledger, options = {}) {
    const plan = planAdmissions(ledger, options);
    const next = JSON.parse(JSON.stringify(ledger));
    next.event_log = Array.isArray(next.event_log) ? next.event_log : [];
    for (const item of plan.toAdmit) {
        next.event_log.push(item.event);
    }

    const storedRoot = ledger.state_root || null;
    const recomputedRoot = calculateStateRoot(next);
    const rootPreserved = storedRoot ? storedRoot === recomputedRoot : true;

    return {
        ledger: next,
        admitted: plan.toAdmit.map((item) => item.address),
        skipped: plan.skipped,
        orphans: plan.orphans,
        storedRoot,
        recomputedRoot,
        rootPreserved,
    };
}

function usage() {
    return [
        'Usage:',
        '  realm-admit-orphan-accounts <ledger_db.json> [--write] [--reason "..."]',
        '',
        'Appends ACCOUNT_PROVENANCE_ADMISSION events for orphan operational subjects',
        '(accounts with no creation event and not backfill-eligible) so replay can',
        'reconstruct them. Dry-run by default; pass --write to persist.',
        '',
        'The tool refuses to write if the reconstruct-exact invariant is violated',
        '(i.e. the admission would change the stored state_root).',
    ].join('\n');
}

function main(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        process.stdout.write(usage() + '\n');
        return 0;
    }

    let ledgerPath = null;
    let write = false;
    let reason;
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--write') write = true;
        else if (arg === '--reason') reason = args[++i];
        else if (!ledgerPath) ledgerPath = arg;
    }

    if (!ledgerPath) {
        process.stderr.write('error: ledger path is required\n\n' + usage() + '\n');
        return 2;
    }

    const resolved = path.resolve(ledgerPath);
    const ledger = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const result = admitOrphanAccounts(ledger, { reason });

    const report = {
        ledger: resolved,
        orphans: result.orphans,
        admitted: result.admitted,
        skipped: result.skipped,
        stored_state_root: result.storedRoot,
        recomputed_state_root: result.recomputedRoot,
        root_preserved: result.rootPreserved,
        write,
    };

    if (result.admitted.length > 0 && !result.rootPreserved) {
        report.error = 'ROOT_NOT_PRESERVED: reconstruct-exact invariant violated; refusing to write';
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return 1;
    }

    if (write && result.admitted.length > 0) {
        fs.writeFileSync(resolved, JSON.stringify(result.ledger, null, 2));
        report.written = true;
    }

    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return 0;
}

if (require.main === module) {
    process.exit(main(process.argv));
}

module.exports = {
    ADMISSION_EVENT_TYPE,
    calculateStateRoot,
    isBackfillEligible,
    detectOrphanAccounts,
    buildAdmissionEvent,
    planAdmissions,
    admitOrphanAccounts,
};
