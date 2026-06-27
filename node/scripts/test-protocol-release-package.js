#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { canonicalEncode } = require('../realm-event-history');
const {
    buildReleasePackage,
    computeDistributionDigest,
    distributionDigestEntries,
    releaseRoot,
} = require('./build-protocol-release-package');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function sha256Canonical(value) {
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(value))
        .digest('hex');
}

function listFiles(dirPath) {
    const files = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(absolute);
            } else if (entry.isFile()) {
                files.push(path.relative(dirPath, absolute).split(path.sep).join('/'));
            }
        }
    }
    walk(dirPath);
    return files.sort();
}

const manifest = buildReleasePackage();
const manifestPath = path.join(releaseRoot, 'MANIFEST.json');
const persistedManifest = readJson(manifestPath);

assert.deepStrictEqual(persistedManifest, manifest);
assert.strictEqual(manifest.protocol, 'realm');
assert.strictEqual(manifest.version, '1.0');
assert.strictEqual(manifest.status, 'stable-standard-candidate');
assert.strictEqual(manifest.protocol_release, 'realm-protocol-v1.0');
assert.ok(manifest.package_fingerprint);
assert.ok(manifest.distribution_digest);
assert.ok(manifest.source_manifest_hash);
assert.deepStrictEqual(manifest.digest_material, {
    type: 'distribution_sha256_list',
    excludes: ['SHA256SUMS'],
    self_reference_fields: ['distribution_digest'],
    manifest_derived_fields: ['certification', 'files'],
    certification_derived_fields: ['fingerprint'],
});

const standardPayloadFiles = listFiles(releaseRoot)
    .filter((file) => !['MANIFEST.json', 'RELEASE.md', 'SHA256SUMS'].includes(file))
    .filter((file) => !file.startsWith('CERTIFICATION/'))
    .map((file) => ({
        path: file,
        sha256: sha256File(path.join(releaseRoot, file)),
    }));
assert.deepStrictEqual(manifest.standard_payload_files, standardPayloadFiles);
assert.strictEqual(manifest.package_fingerprint, sha256Canonical(standardPayloadFiles));

const digestEntries = distributionDigestEntries();
assert.strictEqual(manifest.distribution_digest, sha256Canonical(digestEntries));
assert.strictEqual(manifest.distribution_digest, computeDistributionDigest());

const packageFiles = listFiles(releaseRoot)
    .filter((file) => !['MANIFEST.json', 'RELEASE.md', 'SHA256SUMS'].includes(file))
    .map((file) => ({
        path: file,
        sha256: sha256File(path.join(releaseRoot, file)),
    }));
assert.deepStrictEqual(manifest.files, packageFiles);

const expectedShaSums = listFiles(releaseRoot)
    .filter((file) => file !== 'SHA256SUMS')
    .map((file) => `${sha256File(path.join(releaseRoot, file))}  ${file}`)
    .join('\n');
assert.strictEqual(
    fs.readFileSync(path.join(releaseRoot, 'SHA256SUMS'), 'utf8').trim(),
    expectedShaSums,
);

for (const certification of manifest.certification) {
    const report = readJson(path.join(releaseRoot, certification.file));
    assert.strictEqual(report.status, certification.status);
    assert.strictEqual(report.fingerprint, certification.fingerprint);
    assert.strictEqual(report.protocol_release, manifest.protocol_release);
    assert.strictEqual(report.package_fingerprint, manifest.package_fingerprint);
    assert.strictEqual(report.distribution_digest, manifest.distribution_digest);
    assert.strictEqual(report.manifest_hash, manifest.source_manifest_hash);
}

{
    const baselinePackageFingerprint = manifest.package_fingerprint;
    const baselineDistributionDigest = manifest.distribution_digest;
    const certPath = path.join(releaseRoot, 'CERTIFICATION', 'rust-core.json');
    const originalCert = readJson(certPath);
    const mutatedCert = { ...originalCert, mutation_probe: 'release-test' };
    fs.writeFileSync(certPath, `${JSON.stringify(mutatedCert, null, 2)}\n`);
    assert.notStrictEqual(computeDistributionDigest(), baselineDistributionDigest);
    assert.strictEqual(
        sha256Canonical(manifest.standard_payload_files),
        baselinePackageFingerprint,
    );
    fs.writeFileSync(certPath, `${JSON.stringify(originalCert, null, 2)}\n`);
    assert.strictEqual(computeDistributionDigest(), baselineDistributionDigest);
}

assert.strictEqual(readJson(path.join(releaseRoot, 'CERTIFICATION', 'node-core.json')).status, 'PASS');
assert.strictEqual(readJson(path.join(releaseRoot, 'CERTIFICATION', 'rust-core.json')).status, 'PASS');
assert.strictEqual(readJson(path.join(releaseRoot, 'CERTIFICATION', 'rust-evidence.json')).status, 'PASS');

console.log('test-protocol-release-package: all tests passed');
