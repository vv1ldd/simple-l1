'use strict';

function recoveryAuthorityRef(recoveryAuthority) {
    return String(recoveryAuthority.authorityRef || recoveryAuthority.authority_ref || recoveryAuthority.id || recoveryAuthority);
}

function deviceId(device) {
    return String(device.id || device.device_id || device);
}

function deviceAuthorityRef(device) {
    return String(device.authorityRef || device.authority_ref || device.authority || `device:${deviceId(device)}`);
}

function createRecoveryCeremonyProposals({
    recoveryAuthority,
    oldDevice,
    newDevice,
    recoveryRef,
    startSequence,
    timestamp = new Date().toISOString(),
    reason = 'recovery_ceremony',
}) {
    const signer = recoveryAuthorityRef(recoveryAuthority);
    const oldDeviceIdentifier = deviceId(oldDevice);
    const oldDeviceRef = deviceAuthorityRef(oldDevice);
    const newDeviceIdentifier = deviceId(newDevice);
    const newDeviceRef = deviceAuthorityRef(newDevice);
    const sequence = Number(startSequence);

    if (!Number.isInteger(sequence) || sequence < 1) {
        throw new Error('RECOVERY_START_SEQUENCE_INVALID');
    }

    return [
        {
            envelope: {
                type: 'RECOVERY_EXECUTED',
                signer,
                authority_reference: signer,
                sequence,
                timestamp,
            },
            payload: {
                recovery_ref: recoveryRef,
                old_device_id: oldDeviceIdentifier,
                old_device_ref: oldDeviceRef,
                new_device_id: newDeviceIdentifier,
                new_device_authority_ref: newDeviceRef,
                reason,
            },
        },
        {
            envelope: {
                type: 'DEVICE_KEY_ISSUED',
                signer,
                authority_reference: signer,
                sequence: sequence + 1,
                timestamp,
            },
            payload: {
                recovery_ref: recoveryRef,
                device_id: newDeviceIdentifier,
                public_key: newDevice.public_key || newDevice.publicKey,
                authority_ref: newDeviceRef,
                capabilities: Array.isArray(newDevice.capabilities) ? newDevice.capabilities : [],
            },
        },
        {
            envelope: {
                type: 'DEVICE_KEY_REVOKED',
                signer,
                authority_reference: signer,
                sequence: sequence + 2,
                timestamp,
            },
            payload: {
                recovery_ref: recoveryRef,
                device_id: oldDeviceIdentifier,
                authority_ref: oldDeviceRef,
                reason,
            },
        },
    ];
}

function executeRecoveryCeremony(input, { acceptRealmEvent } = {}) {
    if (typeof acceptRealmEvent !== 'function') {
        throw new Error('acceptRealmEvent callback is required');
    }

    const proposals = createRecoveryCeremonyProposals(input);
    const acceptedEvents = [];

    for (const proposal of proposals) {
        const result = acceptRealmEvent(proposal);
        if (!result.ok) {
            return {
                ok: false,
                failedProposal: proposal,
                reason_codes: result.reason_codes || [],
                acceptedEvents,
                proposals,
            };
        }
        acceptedEvents.push(result.event);
    }

    return {
        ok: true,
        acceptedEvents,
        proposals,
    };
}

module.exports = {
    createRecoveryCeremonyProposals,
    executeRecoveryCeremony,
};
