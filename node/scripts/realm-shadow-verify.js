#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const rustDir = path.join(repoRoot, 'implementations', 'rust', 'realm-interpreter-v1');
const defaultRustBinary = path.join(rustDir, 'target', 'release', 'realm-interpreter');
const emitAnchorsScript = path.join(__dirname, 'emit-independent-anchors.js');

const COMPARED_FIELDS = Object.freeze([
    'history_head',
    'projection_hash',
    'current_authority',
    'last_sequence',
    'canonical_event_count',
    'authority_subjects',
]);

function usage() {
    return [
        'Usage:',
        '  realm-shadow-verify --history <history.jsonl> [--rust-binary <path>] [--json]',
        '',
        'Compares Node and Rust semantic anchors for the same accepted history.',
        'Exits 0 when meaning matches; non-zero on divergence or replay failure.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {
        history: null,
        rustBinary: null,
        json: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }
        if (arg === '--history') {
            args.history = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--rust-binary') {
            args.rustBinary = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--json') {
            args.json = true;
            continue;
        }
        throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
    }

    if (args.help) return args;
    if (!args.history) throw new Error('HISTORY_REQUIRED');
    if (!fs.existsSync(args.history)) throw new Error(`HISTORY_NOT_FOUND:${args.history}`);
    return args;
}

function ensureRustBinary(rustBinary, options = {}) {
    const resolved = rustBinary || defaultRustBinary;
    if (fs.existsSync(resolved)) {
        return resolved;
    }
    if (options.build === false) {
        throw new Error(`RUST_BINARY_NOT_FOUND:${resolved}`);
    }
    execFileSync('cargo', ['build', '--release'], {
        cwd: rustDir,
        stdio: 'inherit',
    });
    if (!fs.existsSync(resolved)) {
        throw new Error(`RUST_BINARY_BUILD_FAILED:${resolved}`);
    }
    return resolved;
}

function runCaptured(command, args) {
    try {
        const stdout = execFileSync(command, args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { stdout, stderr: '', ok: true };
    } catch (caught) {
        const stdout = caught.stdout ? String(caught.stdout) : '';
        const stderr = caught.stderr ? String(caught.stderr) : '';
        const message = (stderr.trim() || stdout.trim() || caught.message || String(caught)).split('\n')[0];
        return { stdout, stderr, ok: false, message };
    }
}

function emitNodeAnchors(historyPath) {
    const result = runCaptured(process.execPath, [emitAnchorsScript, historyPath]);
    if (!result.ok) {
        throw new Error(result.message || 'NODE_REPLAY_FAILED');
    }
    return JSON.parse(result.stdout);
}

function emitRustAnchors(historyPath, rustBinary) {
    const result = runCaptured(rustBinary, ['--replay', historyPath]);
    if (!result.ok) {
        throw new Error(result.message || 'RUST_REPLAY_FAILED');
    }
    return JSON.parse(result.stdout);
}

function compareValue(pathKey, nodeValue, rustValue) {
    const nodeJson = JSON.stringify(nodeValue);
    const rustJson = JSON.stringify(rustValue);
    if (nodeJson === rustJson) return null;
    return {
        path: pathKey,
        node: nodeValue,
        rust: rustValue,
    };
}

function compareAnchors(nodeAnchors, rustAnchors) {
    const differences = [];
    for (const field of COMPARED_FIELDS) {
        const diff = compareValue(field, nodeAnchors[field], rustAnchors[field]);
        if (diff) differences.push(diff);
    }
    return differences;
}

function buildShadowReport({ historyPath, nodeAnchors, rustAnchors, differences, error = null }) {
    const diverged = differences.length > 0;
    const failed = Boolean(error) || diverged;
    return {
        report_schema: 1,
        status: failed ? (error ? 'ERROR' : 'DIVERGED') : 'OK',
        semantic_health: failed ? 'FAIL' : 'OK',
        history: path.relative(repoRoot, historyPath),
        node: nodeAnchors,
        rust: rustAnchors,
        differences,
        error,
    };
}

function verifyShadowHistory(historyPath, options = {}) {
    const rustBinary = ensureRustBinary(options.rustBinary, options);
    let nodeAnchors = null;
    let rustAnchors = null;

    try {
        nodeAnchors = emitNodeAnchors(historyPath);
        rustAnchors = emitRustAnchors(historyPath, rustBinary);
    } catch (caught) {
        const message = caught?.message || String(caught);
        return buildShadowReport({
            historyPath,
            nodeAnchors,
            rustAnchors,
            differences: [],
            error: message,
        });
    }

    const differences = compareAnchors(nodeAnchors, rustAnchors);
    return buildShadowReport({
        historyPath,
        nodeAnchors,
        rustAnchors,
        differences,
    });
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }

    const report = verifyShadowHistory(args.history, {
        rustBinary: args.rustBinary,
    });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.json || process.stdout.isTTY === false) {
        process.stdout.write(output);
    } else {
        process.stdout.write(output);
    }

    if (report.semantic_health !== 'OK') {
        process.exit(1);
    }
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
    COMPARED_FIELDS,
    buildShadowReport,
    compareAnchors,
    defaultRustBinary,
    ensureRustBinary,
    verifyShadowHistory,
};
