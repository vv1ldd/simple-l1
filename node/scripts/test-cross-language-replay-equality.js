#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const vectorsDir = path.join(repoRoot, 'docs', 'protocol', 'v1', 'vectors');
const historyPath = path.join(vectorsDir, 'canonical', 'authority-basic', 'history.jsonl');
const expectedAnchorsPath = path.join(vectorsDir, 'canonical', 'authority-basic', 'expected-anchors.json');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const releaseBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');

if (!fs.existsSync(releaseBinary)) {
    execFileSync('cargo', ['build', '--release'], {
        cwd: rustDir,
        stdio: 'inherit',
    });
}

const nodeStdout = execFileSync(process.execPath, [
    path.join(__dirname, 'emit-independent-anchors.js'),
    historyPath,
], { encoding: 'utf8' });
const nodeAnchors = JSON.parse(nodeStdout);

const rustStdout = execFileSync(releaseBinary, ['--replay', historyPath], {
    encoding: 'utf8',
});
const rustAnchors = JSON.parse(rustStdout);
const expectedAnchors = JSON.parse(fs.readFileSync(expectedAnchorsPath, 'utf8'));

assert.deepStrictEqual(nodeAnchors, expectedAnchors);
assert.deepStrictEqual(rustAnchors, nodeAnchors);
assert.deepStrictEqual(rustAnchors, expectedAnchors);

console.log('test-cross-language-replay-equality: all tests passed');
