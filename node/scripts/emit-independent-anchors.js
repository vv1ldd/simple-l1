#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
    latestRealmEventHash,
    verifyRealmEventHistory,
} = require('../realm-event-history');
const { calculateProjectionHash } = require('../realm-observability');

function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function emptyProjection() {
    return {
        rootAuthority: null,
        recoveryAuthorities: [],
        devices: [],
        sessions: [],
        federationTrusts: [],
        lastSequence: 0,
    };
}

function envelope(event) {
    return event.envelope && typeof event.envelope === 'object' ? event.envelope : event;
}

function payload(event) {
    return event.payload && typeof event.payload === 'object' ? event.payload : {};
}

function buildIndependentAuthorityState(eventLog = []) {
    verifyRealmEventHistory(eventLog);
    let projection = emptyProjection();

    for (const event of eventLog) {
        const env = envelope(event);
        const body = payload(event);
        if (event.realm_event !== true) continue;

        const version = Number(event.version ?? env.version ?? 1);
        if (version !== 1) {
            throw new Error(`INDEPENDENT_INTERPRETER_UNSUPPORTED_EVENT_VERSION:${env.type}:version_${version}`);
        }

        switch (env.type || event.type) {
        case 'ROOT_AUTHORITY_CREATED':
            projection = {
                ...projection,
                rootAuthority: {
                    id: String(body.root_id || env.authority_reference || env.signer),
                    authorityRef: String(env.authority_reference || env.signer),
                    status: 'active',
                    issuedAt: env.timestamp || event.timestamp || null,
                    issuedEvent: event.id || event.event_id || null,
                },
                lastSequence: Number(env.sequence),
            };
            break;
        case 'DEVICE_KEY_ISSUED': {
            const deviceId = String(body.device_id || body.device || body.authority_ref || body.device_authority);
            const authorityRef = String(body.authority_ref || body.device_authority || `device:${deviceId}`);
            const nextDevices = (projection.devices || [])
                .filter((device) => device.id !== deviceId && device.authorityRef !== authorityRef);
            nextDevices.push({
                id: deviceId,
                authority: authorityRef,
                authorityRef,
                status: 'active',
                publicKey: body.public_key || body.publicKey || null,
                issuedAt: env.timestamp || event.timestamp || null,
                issuedEvent: event.id || event.event_id || null,
                revokedAt: null,
                revokedEvent: null,
            });
            projection = {
                ...projection,
                devices: nextDevices,
                lastSequence: Number(env.sequence),
            };
            break;
        }
        default:
            throw new Error(`INDEPENDENT_INTERPRETER_UNKNOWN_EVENT_TYPE:${env.type || event.type}`);
        }
    }

    return projection;
}

function semanticAnchors(eventLog, projection) {
    const authoritySubjects = [];
    if (projection.rootAuthority) {
        authoritySubjects.push({
            kind: 'root',
            ref: projection.rootAuthority.authorityRef || projection.rootAuthority.id,
            status: projection.rootAuthority.status,
        });
    }
    for (const device of projection.devices || []) {
        authoritySubjects.push({
            kind: 'device',
            ref: device.authorityRef || device.authority || device.id,
            status: device.status,
        });
    }

    return {
        anchor_schema: 1,
        history_head: latestRealmEventHash(eventLog),
        projection_hash: calculateProjectionHash(projection),
        current_authority: projection.rootAuthority?.authorityRef || projection.rootAuthority?.id || null,
        last_sequence: projection.lastSequence || 0,
        canonical_event_count: eventLog.filter((event) => event.realm_event === true).length,
        authority_subjects: authoritySubjects,
    };
}

const historyPath = process.argv[2];
if (!historyPath) {
    console.error('Usage: emit-independent-anchors.js <history.jsonl>');
    process.exit(1);
}

const eventLog = readJsonl(path.resolve(historyPath));
const projection = buildIndependentAuthorityState(eventLog);
const anchors = semanticAnchors(eventLog, projection);
process.stdout.write(`${JSON.stringify(anchors, null, 2)}\n`);
