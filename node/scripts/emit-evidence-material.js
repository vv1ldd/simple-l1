#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildCurrentAuthorityState } = require('../current-authority-state');
const { canonicalEncode, latestRealmEventHash, verifyRealmEventHistory } = require('../realm-event-history');
const { calculateProjectionHash, explainCurrentAuthorityState } = require('../realm-observability');
const { deriveRealmLifecycleState } = require('../realm-lifecycle');

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function sha256Canonical(value) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(value))
        .digest('hex');
}

function portableIntegrityReport(eventLog, projection) {
    return {
        realm_valid: true,
        history_head: latestRealmEventHash(eventLog),
        projection_hash: calculateProjectionHash(projection),
        canonical: {
            history: 'ok',
            projection_replay: 'ok',
        },
        derived: {
            snapshot: 'skip',
        },
        operational: {
            federation_references: 'ok',
            command_lineage: 'warning',
        },
        failures: [],
        warnings: ['COMMAND_EXECUTION_RECORD_MISSING'],
    };
}

function evidenceMaterial(eventLog) {
    verifyRealmEventHistory(eventLog);
    const projection = buildCurrentAuthorityState(eventLog);
    const ledger = {
        event_log: eventLog,
        current_authority_state: projection,
    };
    const integrityReport = portableIntegrityReport(eventLog, projection);
    const lifecycle = deriveRealmLifecycleState(integrityReport);
    const explanation = explainCurrentAuthorityState(ledger);
    const integrityReportHash = sha256Canonical(integrityReport);
    const explanationAnchors = {
        current_authority: explanation.current_authority,
        status: explanation.status,
        history_head: explanation.history_head,
        projection_hash: explanation.projection_hash,
    };

    const attestationPayload = {
        protocol: 'realm',
        protocol_version: '1.0',
        anchor_schema: 1,
        evidence_schema: 1,
        history_head: integrityReport.history_head,
        projection_hash: integrityReport.projection_hash,
        integrity_report_hash: integrityReportHash,
        lifecycle_state: lifecycle.state,
        explanation_anchors: explanationAnchors,
    };
    const attestationPayloadHash = sha256Canonical(attestationPayload);
    const evidencePackage = {
        protocol: 'realm',
        protocol_version: '1.0',
        anchor_schema: 1,
        evidence_schema: 1,
        history_head: integrityReport.history_head,
        projection_hash: integrityReport.projection_hash,
        integrity_report_hash: integrityReportHash,
        lifecycle_state: lifecycle.state,
        attestation_payload_hash: attestationPayloadHash,
    };
    const evidencePackageHash = sha256Canonical(evidencePackage);

    return {
        evidence_schema: 1,
        history_head: integrityReport.history_head,
        projection_hash: integrityReport.projection_hash,
        integrity_report_hash: integrityReportHash,
        lifecycle_state: lifecycle.state,
        integrity_report: integrityReport,
        explanation_anchors: explanationAnchors,
        attestation_payload: attestationPayload,
        attestation_payload_hash: attestationPayloadHash,
        evidence_package: evidencePackage,
        evidence_package_hash: evidencePackageHash,
    };
}

const historyPath = process.argv[2];
if (!historyPath) {
    console.error('Usage: emit-evidence-material.js <history.jsonl>');
    process.exit(1);
}

process.stdout.write(`${JSON.stringify(evidenceMaterial(readJsonl(path.resolve(historyPath))), null, 2)}\n`);
