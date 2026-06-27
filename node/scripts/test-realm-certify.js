#!/usr/bin/env node
'use strict';

const assert = require('assert');

const {
    buildReport,
    fingerprintReport,
    parseArgs,
} = require('./realm-certify');

const GENERATED_AT = '2026-06-27T00:00:00.000Z';

function assertCoreReport(report, implementation) {
    assert.strictEqual(report.report_schema, 1);
    assert.strictEqual(report.implementation, implementation);
    assert.strictEqual(report.protocol, 'realm');
    assert.strictEqual(report.protocol_release, 'realm-protocol-v1.0');
    assert.strictEqual(report.package_fingerprint, null);
    assert.strictEqual(report.distribution_digest, null);
    assert.ok(report.manifest_hash);
    assert.strictEqual(report.protocol_version, '1.0');
    assert.strictEqual(report.profile, 'core');
    assert.strictEqual(report.compatibility_level, 'Semantic');
    assert.strictEqual(report.status, 'PASS');
    assert.strictEqual(report.vectors.failed, 0);
    assert.ok(report.vectors.passed > 0);
    assert.strictEqual(report.evidence.core_conformance, 'PASS');
    assert.ok(report.fingerprint);
    assert.strictEqual(report.fingerprint, fingerprintReport(report));
}

{
    const parsed = parseArgs([
        '--implementation',
        'node',
        '--profile',
        'core',
        '--protocol',
        '1.0',
    ]);
    assert.deepStrictEqual(parsed, {
        implementation: 'node',
        profile: 'core',
        protocol: '1.0',
    });
}

{
    const nodeReport = buildReport({
        implementation: 'node',
        profile: 'core',
        protocol: '1.0',
    }, { generatedAt: GENERATED_AT });
    assertCoreReport(nodeReport, 'node');
}

{
    const rustReport = buildReport({
        implementation: 'rust',
        profile: 'core',
        protocol: '1.0',
    }, { generatedAt: GENERATED_AT });
    assertCoreReport(rustReport, 'rust');
}

{
    assert.throws(() => parseArgs([
        '--implementation',
        'rust',
        '--profile',
        'core',
        '--protocol',
        '2.0',
    ]), /UNSUPPORTED_PROTOCOL_VERSION:2.0/);
}

console.log('test-realm-certify: all tests passed');
