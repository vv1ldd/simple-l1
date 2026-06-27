#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'docs', 'protocol', 'v1', 'vectors');
const fixtureHistoryPath = path.join(vectorsDir, 'canonical', 'authority-basic', 'history.jsonl');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const rustBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');

function nodeEvidence(historyPath) {
    return JSON.parse(execFileSync(process.execPath, [
        path.join(__dirname, 'emit-evidence-material.js'),
        historyPath,
    ], { encoding: 'utf8' }));
}

function rustEvidence(historyPath) {
    return JSON.parse(execFileSync(rustBinary, ['--evidence', historyPath], { encoding: 'utf8' }));
}

function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`);
}

if (!fs.existsSync(rustBinary)) {
    execFileSync('cargo', ['build', '--release'], {
        cwd: rustDir,
        stdio: 'inherit',
    });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-evidence-interop-'));
const rustHistoryPath = path.join(tmpDir, 'rust-history.jsonl');
writeFile(rustHistoryPath, execFileSync(rustBinary, ['--export-authority-basic'], { encoding: 'utf8' }));

for (const historyPath of [fixtureHistoryPath, rustHistoryPath]) {
    const node = nodeEvidence(historyPath);
    const rust = rustEvidence(historyPath);

    assert.deepStrictEqual(rust.history_head, node.history_head);
    assert.deepStrictEqual(rust.projection_hash, node.projection_hash);
    assert.deepStrictEqual(rust.integrity_report_hash, node.integrity_report_hash);
    assert.deepStrictEqual(rust.lifecycle_state, node.lifecycle_state);
    assert.deepStrictEqual(rust.explanation_anchors, node.explanation_anchors);
    assert.deepStrictEqual(rust.attestation_payload, node.attestation_payload);
    assert.deepStrictEqual(rust.attestation_payload_hash, node.attestation_payload_hash);
    assert.deepStrictEqual(rust.evidence_package, node.evidence_package);
    assert.deepStrictEqual(rust.evidence_package_hash, node.evidence_package_hash);
}

console.log('test-cross-language-evidence-interoperability: all tests passed');
