#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { canonicalEncode } = require('../realm-event-history');

const repoRoot = path.join(__dirname, '..', '..');
const protocolRoot = path.join(repoRoot, 'docs', 'protocol', 'v1');
const manifestPath = path.join(protocolRoot, 'manifest.json');
const vectorsDir = path.join(protocolRoot, 'vectors');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const rustBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');

const SUPPORTED_PROTOCOL = '1.0';
const IMPLEMENTATIONS = Object.freeze(['node', 'rust']);
const PROFILES = Object.freeze(['core', 'evidence', 'operational']);

function usage() {
    return [
        'Usage:',
        '  realm-certify --implementation <node|rust> --profile <core|evidence|operational> --protocol 1.0',
        '',
        'Prints a machine-readable Realm Protocol certification report as JSON.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {
        implementation: null,
        profile: 'core',
        protocol: SUPPORTED_PROTOCOL,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }
        if (arg === '--implementation') {
            args.implementation = argv[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--profile') {
            args.profile = argv[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--protocol') {
            args.protocol = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
    }

    if (args.help) return args;
    if (!args.implementation) throw new Error('IMPLEMENTATION_REQUIRED');
    if (!IMPLEMENTATIONS.includes(args.implementation)) {
        throw new Error(`UNSUPPORTED_IMPLEMENTATION:${args.implementation}`);
    }
    if (!PROFILES.includes(args.profile)) {
        throw new Error(`UNSUPPORTED_PROFILE:${args.profile}`);
    }
    if (args.protocol !== SUPPORTED_PROTOCOL) {
        throw new Error(`UNSUPPORTED_PROTOCOL_VERSION:${args.protocol}`);
    }

    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function readPackageVersion() {
    const packagePath = path.join(repoRoot, 'node', 'package.json');
    return readJson(packagePath).version || 'unknown';
}

function readRustVersion() {
    const cargoToml = fs.readFileSync(path.join(rustDir, 'Cargo.toml'), 'utf8');
    const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    return match ? match[1] : 'unknown';
}

function implementationVersion(implementation) {
    return implementation === 'node' ? readPackageVersion() : readRustVersion();
}

function countVectors() {
    const manifest = readJson(manifestPath);
    return Object.values(manifest.vectors || {})
        .reduce((sum, value) => sum + Number(value || 0), 0);
}

function ensureRustBinary() {
    if (fs.existsSync(rustBinary)) return;
    execFileSync('cargo', ['build', '--release'], {
        cwd: rustDir,
        stdio: 'pipe',
    });
}

function runProof(name, command, options = {}) {
    try {
        execFileSync(command[0], command.slice(1), {
            cwd: repoRoot,
            stdio: 'pipe',
            ...options,
        });
        return {
            name,
            status: 'PASS',
        };
    } catch (error) {
        return {
            name,
            status: 'FAIL',
            error: String(error?.stderr || error?.message || error),
        };
    }
}

function coreProofs(implementation) {
    if (implementation === 'rust') ensureRustBinary();
    const interpreter = implementation === 'node' ? 'builtin-dual' : rustBinary;
    return [
        runProof('core_conformance', [
            process.execPath,
            path.join(__dirname, 'realm-conformance.js'),
            '--profile',
            'core',
            '--vectors',
            vectorsDir,
            '--interpreter',
            interpreter,
        ]),
    ];
}

function evidenceProofs() {
    ensureRustBinary();
    return [
        runProof('cross_language_replay_equality', [
            process.execPath,
            path.join(__dirname, 'test-cross-language-replay-equality.js'),
        ]),
        runProof('cross_language_history_exchange', [
            process.execPath,
            path.join(__dirname, 'test-cross-language-history-exchange.js'),
        ]),
        runProof('cross_language_evidence_interoperability', [
            process.execPath,
            path.join(__dirname, 'test-cross-language-evidence-interoperability.js'),
        ]),
    ];
}

function operationalProofs(implementation) {
    if (implementation !== 'node') {
        return [{
            name: 'operational_profile',
            status: 'PENDING',
            reason: 'Operational profile is not implemented for Rust yet.',
        }];
    }

    return [
        'test-realm-integrity-check-runtime.js',
        'test-realm-deployment-runtime.js',
        'test-runtime-release-governance.js',
        'test-artifact-provenance.js',
        'test-realm-backup-restore-runtime.js',
        'test-disaster-recovery-runbook.js',
    ].map((script) => runProof(script.replace(/\.js$/, ''), [
        process.execPath,
        path.join(__dirname, script),
    ]));
}

function compatibilityLevel(profile) {
    if (profile === 'core') return 'Semantic';
    if (profile === 'evidence') return 'Evidence';
    return 'Operational';
}

function statusFor(proofs) {
    if (proofs.some((proof) => proof.status === 'FAIL')) return 'FAIL';
    if (proofs.some((proof) => proof.status === 'PENDING')) return 'PENDING';
    return 'PASS';
}

function buildEvidenceSummary(profile, proofs) {
    const byName = Object.fromEntries(proofs.map((proof) => [proof.name, proof.status]));
    return {
        core_conformance: byName.core_conformance || 'N/A',
        replay_equality: byName.cross_language_replay_equality || (profile === 'core' ? 'N/A' : 'PENDING'),
        history_exchange: byName.cross_language_history_exchange || (profile === 'core' ? 'N/A' : 'PENDING'),
        evidence_interoperability: byName.cross_language_evidence_interoperability || (profile === 'core' ? 'N/A' : 'PENDING'),
        operational_profile: byName.operational_profile || 'N/A',
    };
}

function fingerprintReport(report) {
    const stable = {
        implementation: report.implementation,
        implementation_version: report.implementation_version,
        protocol_release: report.protocol_release,
        package_fingerprint: report.package_fingerprint,
        distribution_digest: report.distribution_digest,
        manifest_hash: report.manifest_hash,
        protocol_version: report.protocol_version,
        profile: report.profile,
        compatibility_level: report.compatibility_level,
        status: report.status,
        vectors: report.vectors,
        evidence: report.evidence,
        proofs: report.proofs.map((proof) => ({
            name: proof.name,
            status: proof.status,
            reason: proof.reason || null,
        })),
        manifest: report.manifest,
    };
    return crypto
        .createHash('sha256')
        .update(canonicalEncode(stable))
        .digest('hex');
}

function buildReport(args, options = {}) {
    const manifest = readJson(manifestPath);
    const vectorCount = countVectors();
    const proofs = [
        ...coreProofs(args.implementation),
    ];

    if (args.profile === 'evidence' || args.profile === 'operational') {
        proofs.push(...evidenceProofs());
    }
    if (args.profile === 'operational') {
        proofs.push(...operationalProofs(args.implementation));
    }

    const passed = proofs.filter((proof) => proof.status === 'PASS').length;
    const failed = proofs.filter((proof) => proof.status === 'FAIL').length;
    const pending = proofs.filter((proof) => proof.status === 'PENDING').length;

    const report = {
        report_schema: 1,
        implementation: args.implementation,
        implementation_version: implementationVersion(args.implementation),
        protocol: manifest.protocol,
        protocol_release: options.protocolRelease || `realm-protocol-v${args.protocol}`,
        package_fingerprint: options.packageFingerprint || null,
        distribution_digest: options.distributionDigest || null,
        manifest_hash: options.manifestHash || sha256File(manifestPath),
        protocol_version: args.protocol,
        profile: args.profile,
        compatibility_level: compatibilityLevel(args.profile),
        status: statusFor(proofs),
        vectors: {
            total: vectorCount,
            passed: failed === 0 ? vectorCount : 0,
            failed: failed === 0 ? 0 : vectorCount,
        },
        proofs,
        proof_summary: {
            passed,
            failed,
            pending,
        },
        evidence: buildEvidenceSummary(args.profile, proofs),
        generated_at: options.generatedAt || new Date().toISOString(),
        manifest: path.relative(repoRoot, manifestPath),
    };
    report.fingerprint = fingerprintReport(report);
    return report;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }
    const report = buildReport(args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status === 'FAIL') process.exit(1);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        console.error(usage());
        process.exit(1);
    }
}

module.exports = {
    buildReport,
    fingerprintReport,
    parseArgs,
};
