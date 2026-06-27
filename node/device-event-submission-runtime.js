'use strict';

const crypto = require('crypto');
const { findDevice } = require('./realm-event-registry');
const { buildCurrentAuthorityState } = require('./current-authority-state');
const { canonicalEncode } = require('./realm-event-history');
const { normalizeRealmEventProposal } = require('./realm-event-validator');

function currentAuthorityStateForLedger(ledger) {
    if (ledger?.current_authority_state && typeof ledger.current_authority_state === 'object') {
        return ledger.current_authority_state;
    }
    return buildCurrentAuthorityState(ledger?.event_log || []);
}

function deviceProposalSigningMaterial(proposal = {}) {
    const envelope = proposal.envelope && typeof proposal.envelope === 'object'
        ? proposal.envelope
        : proposal;
    const payload = proposal.payload && typeof proposal.payload === 'object'
        ? proposal.payload
        : {};

    return {
        authority_reference: String(envelope.authority_reference || '').trim(),
        payload,
        sequence: Number(envelope.sequence),
        signer: String(envelope.signer || '').trim(),
        type: String(envelope.type || '').trim(),
    };
}

function signDeviceProposal(proposal, publicKey) {
    return crypto
        .createHmac('sha256', String(publicKey || ''))
        .update(canonicalEncode(deviceProposalSigningMaterial(proposal)))
        .digest('hex');
}

function activeDeviceForSigner(state, signerRef) {
    const device = findDevice(state, signerRef);
    if (!device || device.status !== 'active') return null;
    return device;
}

function verifyDeviceSignature(ledger, signedProposal = {}) {
    const proposal = signedProposal.proposal || signedProposal;
    const signature = String(signedProposal.signature || '');
    const normalized = normalizeRealmEventProposal(proposal);
    const state = currentAuthorityStateForLedger(ledger);
    const device = activeDeviceForSigner(state, normalized.envelope.signer);

    if (!device) {
        return { ok: false, reason_codes: ['DEVICE_SIGNER_NOT_ACTIVE'], proposal: normalized };
    }
    if (!device.publicKey) {
        return { ok: false, reason_codes: ['DEVICE_PUBLIC_KEY_MISSING'], proposal: normalized };
    }
    if (!signature) {
        return { ok: false, reason_codes: ['DEVICE_SIGNATURE_REQUIRED'], proposal: normalized };
    }

    const expectedSignature = signDeviceProposal(normalized, device.publicKey);
    if (signature !== expectedSignature) {
        return { ok: false, reason_codes: ['DEVICE_SIGNATURE_INVALID'], proposal: normalized };
    }

    return {
        ok: true,
        proposal: normalized,
        device,
    };
}

function submitDeviceEvent(ledger, signedProposal, { acceptRealmEvent } = {}) {
    if (typeof acceptRealmEvent !== 'function') {
        throw new Error('acceptRealmEvent callback is required');
    }

    const verification = verifyDeviceSignature(ledger, signedProposal);
    if (!verification.ok) {
        return verification;
    }

    return acceptRealmEvent(verification.proposal);
}

module.exports = {
    deviceProposalSigningMaterial,
    signDeviceProposal,
    verifyDeviceSignature,
    submitDeviceEvent,
};
