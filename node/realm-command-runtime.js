'use strict';

const { submitDeviceEvent } = require('./device-event-submission-runtime');
const { recognizeRemoteRealm } = require('./federation-trust-runtime');
const { executeRecoveryCeremony } = require('./recovery-ceremony-runtime');

const COMMAND_TYPES = Object.freeze({
    EXECUTE_RECOVERY_CEREMONY: 'EXECUTE_RECOVERY_CEREMONY',
    RECOGNIZE_REMOTE_REALM: 'RECOGNIZE_REMOTE_REALM',
    SUBMIT_DEVICE_EVENT: 'SUBMIT_DEVICE_EVENT',
    SUBMIT_REALM_EVENT: 'SUBMIT_REALM_EVENT',
});

function normalizeRealmCommand(command = {}) {
    if (!command || typeof command !== 'object') {
        throw new Error('REALM_COMMAND_INVALID');
    }

    const type = String(command.type || '').trim();
    if (!type) {
        throw new Error('REALM_COMMAND_TYPE_REQUIRED');
    }

    return {
        type,
        payload: command.payload && typeof command.payload === 'object' ? command.payload : {},
        actor: command.actor || null,
        evidence: command.evidence && typeof command.evidence === 'object' ? command.evidence : {},
    };
}

function requireAcceptRealmEvent(context = {}) {
    if (typeof context.acceptRealmEvent !== 'function') {
        throw new Error('acceptRealmEvent callback is required');
    }
    return context.acceptRealmEvent;
}

function requireLedger(context = {}) {
    if (!context.ledger || typeof context.ledger !== 'object') {
        throw new Error('ledger context is required');
    }
    return context.ledger;
}

function signedDeviceSubmission(command) {
    if (command.payload.signedProposal) return command.payload.signedProposal;
    if (command.evidence.signedProposal) return command.evidence.signedProposal;

    return {
        proposal: command.payload.proposal || command.payload,
        signature: command.evidence.signature || command.payload.signature,
    };
}

function submittedRealmProposal(command) {
    return command.payload.proposal || command.payload;
}

function executeRealmCommand(command, context = {}) {
    const normalized = normalizeRealmCommand(command);
    requireAcceptRealmEvent(context);

    switch (normalized.type) {
    case COMMAND_TYPES.EXECUTE_RECOVERY_CEREMONY:
        return executeRecoveryCeremony(normalized.payload, context);

    case COMMAND_TYPES.SUBMIT_DEVICE_EVENT:
        return submitDeviceEvent(requireLedger(context), signedDeviceSubmission(normalized), context);

    case COMMAND_TYPES.RECOGNIZE_REMOTE_REALM:
        return recognizeRemoteRealm(normalized.payload, context);

    case COMMAND_TYPES.SUBMIT_REALM_EVENT:
        return context.acceptRealmEvent(submittedRealmProposal(normalized));

    default:
        return {
            ok: false,
            reason_codes: ['REALM_COMMAND_TYPE_UNSUPPORTED'],
            command: normalized,
        };
    }
}

module.exports = {
    COMMAND_TYPES,
    executeRealmCommand,
    normalizeRealmCommand,
};
