#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'docs', 'protocol', 'v1', 'vectors');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const releaseBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');
const debugBinary = path.join(rustDir, 'target', 'debug', 'realm-interpreter');

function cargoBinary() {
    if (fs.existsSync(releaseBinary)) return releaseBinary;
    return debugBinary;
}

execFileSync('cargo', ['build', '--release'], {
    cwd: rustDir,
    stdio: 'inherit',
});

const interpreter = cargoBinary();
assert.ok(fs.existsSync(interpreter), `rust interpreter binary missing: ${interpreter}`);

execFileSync(interpreter, ['--profile', 'core', '--vectors', vectorsDir], {
    stdio: 'inherit',
});

execFileSync(process.execPath, [
    path.join(__dirname, 'realm-conformance.js'),
    '--profile',
    'core',
    '--vectors',
    vectorsDir,
    '--interpreter',
    interpreter,
], {
    stdio: 'inherit',
    env: {
        ...process.env,
        REALM_CONFORMANCE_VECTORS: vectorsDir,
    },
});

console.log('test-rust-interpreter-conformance: all tests passed');
