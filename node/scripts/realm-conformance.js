#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function usage() {
    return [
        'Usage:',
        '  realm-conformance --profile core --vectors <path> --interpreter <builtin-dual|path-to-binary>',
        '',
        'Current implementation supports:',
        '  --profile core',
        '  --interpreter builtin-dual',
        '  --interpreter <path-to-realm-interpreter-binary>',
        '',
        'The CLI shape is intentionally stable for future external interpreters.',
    ].join('\n');
}

function parseArgs(argv) {
    const args = {
        profile: 'core',
        vectors: path.join(__dirname, '..', '..', 'docs', 'protocol', 'v1', 'vectors'),
        interpreter: 'builtin-dual',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            args.help = true;
            continue;
        }
        if (arg === '--profile') {
            args.profile = argv[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--vectors') {
            args.vectors = path.resolve(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--interpreter') {
            args.interpreter = argv[index + 1];
            index += 1;
            continue;
        }
        throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
    }

    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(usage());
        return;
    }

    if (args.profile !== 'core') {
        throw new Error(`UNSUPPORTED_CONFORMANCE_PROFILE:${args.profile}`);
    }

    if (args.interpreter === 'builtin-dual') {
        execFileSync(process.execPath, [path.join(__dirname, 'test-independent-interpreter-conformance.js')], {
            stdio: 'inherit',
            env: {
                ...process.env,
                REALM_CONFORMANCE_VECTORS: args.vectors,
            },
        });
        return;
    }

    const interpreterPath = path.resolve(args.interpreter);
    execFileSync(interpreterPath, ['--profile', args.profile, '--vectors', args.vectors], {
        stdio: 'inherit',
    });
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    console.error(usage());
    process.exit(1);
}
