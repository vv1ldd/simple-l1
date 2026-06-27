#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { canonicalEncode } = require('../realm-event-history');
const { buildReport } = require('./realm-certify');

const repoRoot = path.join(__dirname, '..', '..');
const protocolRoot = path.join(repoRoot, 'docs', 'protocol', 'v1');
const releaseRoot = path.join(repoRoot, 'docs', 'protocol', 'releases', 'realm-protocol-v1.0');
const generatedAt = process.env.REALM_RELEASE_GENERATED_AT || '2026-06-27T00:00:00.000Z';

const CERTIFICATIONS = Object.freeze([
    { file: 'node-core.json', implementation: 'node', profile: 'core' },
    { file: 'node-evidence.json', implementation: 'node', profile: 'evidence' },
    { file: 'node-operational.json', implementation: 'node', profile: 'operational' },
    { file: 'rust-core.json', implementation: 'rust', profile: 'core' },
    { file: 'rust-evidence.json', implementation: 'rust', profile: 'evidence' },
]);

function usage() {
    return [
        'Usage:',
        '  build-protocol-release-package',
        '',
        'Builds docs/protocol/releases/realm-protocol-v1.0.',
    ].join('\n');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyFile(source, target) {
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
}

function copyDir(sourceDir, targetDir) {
    ensureDir(targetDir);
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const source = path.join(sourceDir, entry.name);
        const target = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDir(source, target);
        } else if (entry.isFile()) {
            copyFile(source, target);
        }
    }
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

function digestMaterialHash(relativePath) {
    const absolute = path.join(releaseRoot, relativePath);
    if (relativePath === 'MANIFEST.json') {
        const {
            distribution_digest: _distributionDigest,
            certification: _certification,
            files: _files,
            ...stableManifest
        } = readJson(absolute);
        return sha256Canonical(stableManifest);
    }
    if (relativePath.startsWith('CERTIFICATION/')) {
        const {
            distribution_digest: _distributionDigest,
            fingerprint: _fingerprint,
            ...stripped
        } = readJson(absolute);
        return sha256Canonical(stripped);
    }
    return sha256File(absolute);
}

function distributionDigestEntries() {
    return listFiles(releaseRoot)
        .filter((file) => file !== 'SHA256SUMS')
        .map((file) => ({
            path: file,
            sha256: digestMaterialHash(file),
        }));
}

function computeDistributionDigest() {
    return sha256Canonical(distributionDigestEntries());
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

function certificationReports(releaseIdentity) {
    return CERTIFICATIONS.map((certification) => {
        const report = buildReport({
            implementation: certification.implementation,
            profile: certification.profile,
            protocol: '1.0',
        }, {
            generatedAt,
            protocolRelease: releaseIdentity.protocol_release,
            packageFingerprint: releaseIdentity.package_fingerprint,
            distributionDigest: releaseIdentity.distribution_digest,
            manifestHash: releaseIdentity.manifest_hash,
        });
        return {
            ...certification,
            report,
        };
    });
}

function writeCertifications(releaseIdentity) {
    const certDir = path.join(releaseRoot, 'CERTIFICATION');
    ensureDir(certDir);
    const reports = certificationReports(releaseIdentity);
    for (const certification of reports) {
        writeJson(path.join(certDir, certification.file), certification.report);
    }
    return reports.map((certification) => ({
        file: `CERTIFICATION/${certification.file}`,
        implementation: certification.implementation,
        profile: certification.profile,
        status: certification.report.status,
        fingerprint: certification.report.fingerprint,
    }));
}

function standardPayloadChecksums() {
    return listFiles(releaseRoot)
        .filter((file) => ![
            'MANIFEST.json',
            'RELEASE.md',
            'SHA256SUMS',
        ].includes(file))
        .filter((file) => !file.startsWith('CERTIFICATION/'))
        .map((file) => ({
            path: file,
            sha256: sha256File(path.join(releaseRoot, file)),
        }));
}

function packageChecksums() {
    return listFiles(releaseRoot)
        .filter((file) => !['MANIFEST.json', 'RELEASE.md', 'SHA256SUMS'].includes(file))
        .map((file) => ({
            path: file,
            sha256: sha256File(path.join(releaseRoot, file)),
        }));
}

function writeSha256Sums() {
    const lines = listFiles(releaseRoot)
        .filter((file) => file !== 'SHA256SUMS')
        .map((file) => `${sha256File(path.join(releaseRoot, file))}  ${file}`);
    fs.writeFileSync(path.join(releaseRoot, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

function releaseReadme() {
    return `# Realm Protocol Standard v1.0

Status: Stable Standard Candidate

This package is the first versioned release artifact for Realm Protocol Standard v1.0. The source of truth is the package as a whole: specification, schemas, profiles, vectors, stability policy, compliance matrix, certification reports, and checksums.

## Identity

Canonical release identity fields are recorded in \`MANIFEST.json\`:

- \`package_fingerprint\` — normative standard payload identity
- \`distribution_digest\` — published release package identity

\`package_fingerprint\` is SHA-256 over the canonical checksum list for immutable standard payload files, excluding \`CERTIFICATION/\`, \`MANIFEST.json\`, \`RELEASE.md\`, and \`SHA256SUMS\`. A change to this value means the protocol standard changed.

\`distribution_digest\` is SHA-256 over the canonical checksum list for every published file except \`SHA256SUMS\` itself. For \`MANIFEST.json\` and \`CERTIFICATION/\` files, the digest material excludes the \`distribution_digest\` field to avoid self-reference cycles. A change to this value means the publication artifact changed.

## Contents

\`\`\`text
SPECIFICATION/
SCHEMAS/
VECTORS/
PROFILES/
STABILITY-POLICY.md
COMPLIANCE-MATRIX.md
CERTIFICATION/
MANIFEST.json
SHA256SUMS
\`\`\`

## Certification

Certification reports are machine-readable JSON files under \`CERTIFICATION/\`. They were generated by \`node/scripts/realm-certify.js\`.

## Immutability

After publication, this directory must not be edited in place. Any content change creates a new release package and a new fingerprint.

`;
}

function buildReleaseManifest(sourceManifest, releaseIdentity, standardPayload, certification) {
  const packageFiles = packageChecksums();
  return {
    package_schema: 1,
    protocol: 'realm',
    name: 'Realm Protocol Standard',
    version: sourceManifest.version,
    status: 'stable-standard-candidate',
    generated_at: generatedAt,
    protocol_release: releaseIdentity.protocol_release,
    anchor_schema: sourceManifest.anchor_schema,
    result_schema: sourceManifest.result_schema,
    profiles: sourceManifest.profiles,
    compatibility_levels: sourceManifest.compatibility_levels,
    protocol_versions: sourceManifest.protocol_versions,
    source_manifest: 'docs/protocol/v1/manifest.json',
    source_manifest_hash: releaseIdentity.manifest_hash,
    package_fingerprint: releaseIdentity.package_fingerprint,
    distribution_digest: releaseIdentity.distribution_digest,
    fingerprint_material: {
      type: 'standard_payload_sha256_list',
      excludes: ['CERTIFICATION/', 'MANIFEST.json', 'RELEASE.md', 'SHA256SUMS'],
    },
    digest_material: {
      type: 'distribution_sha256_list',
      excludes: ['SHA256SUMS'],
      self_reference_fields: ['distribution_digest'],
      manifest_derived_fields: ['certification', 'files'],
      certification_derived_fields: ['fingerprint'],
    },
    certification,
    standard_payload_files: standardPayload,
    files: packageFiles,
  };
}

function buildReleasePackage() {
    const sourceManifest = readJson(path.join(protocolRoot, 'manifest.json'));

    fs.rmSync(releaseRoot, { recursive: true, force: true });
    ensureDir(releaseRoot);

    copyDir(path.join(protocolRoot, 'specification'), path.join(releaseRoot, 'SPECIFICATION'));
    copyDir(path.join(protocolRoot, 'schemas'), path.join(releaseRoot, 'SCHEMAS'));
    copyDir(path.join(protocolRoot, 'vectors'), path.join(releaseRoot, 'VECTORS'));
    copyDir(path.join(protocolRoot, 'profiles'), path.join(releaseRoot, 'PROFILES'));
    copyFile(path.join(protocolRoot, 'stability-policy.md'), path.join(releaseRoot, 'STABILITY-POLICY.md'));
    copyFile(path.join(protocolRoot, 'compliance-matrix.md'), path.join(releaseRoot, 'COMPLIANCE-MATRIX.md'));

    const standardPayload = standardPayloadChecksums();
    const packageFingerprint = sha256Canonical(standardPayload);
    const releaseIdentity = {
        protocol_release: 'realm-protocol-v1.0',
        package_fingerprint: packageFingerprint,
        manifest_hash: sha256File(path.join(protocolRoot, 'manifest.json')),
        distribution_digest: null,
    };

    let certification = writeCertifications(releaseIdentity);
    let releaseManifest = buildReleaseManifest(
        sourceManifest,
        releaseIdentity,
        standardPayload,
        certification,
    );
    delete releaseManifest.distribution_digest;

    fs.writeFileSync(path.join(releaseRoot, 'RELEASE.md'), releaseReadme());
    writeJson(path.join(releaseRoot, 'MANIFEST.json'), releaseManifest);
    writeSha256Sums();

    const distributionDigest = computeDistributionDigest();
    releaseIdentity.distribution_digest = distributionDigest;
    certification = writeCertifications(releaseIdentity);
    releaseManifest = buildReleaseManifest(
        sourceManifest,
        releaseIdentity,
        standardPayload,
        certification,
    );

    writeJson(path.join(releaseRoot, 'MANIFEST.json'), releaseManifest);
    writeSha256Sums();

    if (computeDistributionDigest() !== distributionDigest) {
        throw new Error('DISTRIBUTION_DIGEST_NOT_STABLE');
    }

    return releaseManifest;
}

if (require.main === module) {
    try {
        if (process.argv.includes('--help') || process.argv.includes('-h')) {
            console.log(usage());
            process.exit(0);
        }
        const manifest = buildReleasePackage();
        console.log(`realm-protocol-v1.0 release package built: ${path.relative(repoRoot, releaseRoot)}`);
        console.log(`package_fingerprint: ${manifest.package_fingerprint}`);
        console.log(`distribution_digest: ${manifest.distribution_digest}`);
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

module.exports = {
    buildReleasePackage,
    computeDistributionDigest,
    distributionDigestEntries,
    releaseRoot,
};
