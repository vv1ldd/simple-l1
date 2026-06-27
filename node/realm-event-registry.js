'use strict';

const AUTHORITY_POLICY = Object.freeze({
    ANY_INITIAL_ROOT: 'any_initial_root',
    ROOT: 'root',
    RECOVERY: 'recovery',
    ROOT_OR_RECOVERY: 'root_or_recovery',
    ROOT_OR_DEVICE: 'root_or_device',
    ROOT_OR_DEVICE_OR_RECOVERY: 'root_or_device_or_recovery',
});

function findDevice(state, refOrId) {
    const key = String(refOrId || '');
    return (state.devices || []).find((device) =>
        device.id === key
        || device.authority === key
        || device.authorityRef === key
    ) || null;
}

function isActiveRoot(state, signerRef) {
    const root = state.rootAuthority;
    if (!root || root.status !== 'active') return false;
    const ref = String(signerRef || '');
    return root.id === ref || root.authorityRef === ref;
}

function isActiveDevice(state, signerRef) {
    const device = findDevice(state, signerRef);
    return Boolean(device && device.status === 'active');
}

function findRecoveryAuthority(state, refOrId) {
    const key = String(refOrId || '');
    return (state.recoveryAuthorities || []).find((authority) =>
        authority.id === key
        || authority.authorityRef === key
    ) || null;
}

function isActiveRecoveryAuthority(state, signerRef) {
    const authority = findRecoveryAuthority(state, signerRef);
    return Boolean(authority && authority.status === 'active');
}

function canSignerSatisfyAuthorityPolicy(state, signerRef, policy) {
    const signer = String(signerRef || '');
    switch (policy) {
        case AUTHORITY_POLICY.ANY_INITIAL_ROOT:
            return !state.rootAuthority && signer !== '';
        case AUTHORITY_POLICY.ROOT:
            return isActiveRoot(state, signer);
        case AUTHORITY_POLICY.RECOVERY:
            return isActiveRecoveryAuthority(state, signer);
        case AUTHORITY_POLICY.ROOT_OR_RECOVERY:
            return isActiveRoot(state, signer) || isActiveRecoveryAuthority(state, signer);
        case AUTHORITY_POLICY.ROOT_OR_DEVICE:
            return isActiveRoot(state, signer) || isActiveDevice(state, signer);
        case AUTHORITY_POLICY.ROOT_OR_DEVICE_OR_RECOVERY:
            return isActiveRoot(state, signer) || isActiveDevice(state, signer) || isActiveRecoveryAuthority(state, signer);
        default:
            return false;
    }
}

function targetDeviceRef(envelope, payload) {
    return payload.device_id
        || payload.authority_ref
        || payload.device_authority
        || envelope.authority_reference;
}

function targetRecoveryAuthorityRef(envelope, payload) {
    return payload.recovery_authority_id
        || payload.authority_ref
        || payload.recovery_authority_ref
        || envelope.authority_reference;
}

function cloneProjection(projection) {
    return {
        rootAuthority: projection.rootAuthority ? { ...projection.rootAuthority } : null,
        recoveryAuthorities: [...(projection.recoveryAuthorities || [])],
        devices: [...(projection.devices || [])],
        sessions: [...(projection.sessions || [])],
        federationTrusts: [...(projection.federationTrusts || [])],
        lastSequence: projection.lastSequence || 0,
        ...(projection.lastRecovery ? { lastRecovery: { ...projection.lastRecovery } } : {}),
    };
}

function withSequence(projection, envelope) {
    const next = cloneProjection(projection);
    const sequence = Number(envelope.sequence);
    if (Number.isFinite(sequence)) {
        next.lastSequence = sequence;
    }
    return next;
}

function noAdditionalTransitionValidation() {
    return [];
}

function unsupportedEventVersion(type, version) {
    throw new Error(`REPLAY_UNSUPPORTED_EVENT_VERSION:${type}:version_${version}`);
}

function identityMigrationAdapter(payload) {
    return { ...payload };
}

function deviceKeyIssuedMigrationAdapter(payload) {
    const next = { ...payload };
    if (!next.device_id && next.device) next.device_id = next.device;
    if (!next.public_key && next.publicKey) next.public_key = next.publicKey;
    if (!next.authority_ref && next.device_authority) next.authority_ref = next.device_authority;
    if (!Array.isArray(next.capabilities)) next.capabilities = [];
    return next;
}

function deviceKeyRevokedMigrationAdapter(payload) {
    const next = { ...payload };
    if (!next.device_id && next.device) next.device_id = next.device;
    if (!next.authority_ref && next.device_authority) next.authority_ref = next.device_authority;
    return next;
}

function migrationAdapterFor(contract, version) {
    if (contract.migrationAdapters && typeof contract.migrationAdapters[version] === 'function') {
        return contract.migrationAdapters[version];
    }
    if (version === contract.version && typeof contract.migrationAdapter === 'function') {
        return contract.migrationAdapter;
    }
    if (version === contract.version) {
        return identityMigrationAdapter;
    }
    return null;
}

function eventVersion(event, envelope = {}) {
    return Number(event?.version ?? envelope.version ?? 1);
}

function interpretRealmEvent(contract, event, envelope, payload) {
    const version = eventVersion(event, envelope);
    const adapter = migrationAdapterFor(contract, version);
    if (!adapter) unsupportedEventVersion(contract.canonicalName, version);
    return adapter(payload, event, envelope);
}

const SHARED_ENVELOPE_CONTRACT = Object.freeze({
    required: ['type', 'signer', 'authority_reference', 'sequence', 'timestamp'],
});

const REALM_EVENT_REGISTRY = Object.freeze({
    ROOT_AUTHORITY_CREATED: {
        canonicalName: 'ROOT_AUTHORITY_CREATED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['root_id'],
            optional: ['public_key', 'label'],
            fields: {
                root_id: 'string',
                public_key: 'string',
                label: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ANY_INITIAL_ROOT,
        migrationAdapters: {
            1: identityMigrationAdapter,
        },
        validateTransition(currentState) {
            return currentState.rootAuthority ? ['ROOT_AUTHORITY_ALREADY_EXISTS'] : [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const authorityRef = String(envelope.authority_reference || envelope.signer || payload.authority_id || 'root');
            next.rootAuthority = {
                id: String(payload.root_id || authorityRef),
                authorityRef,
                status: 'active',
                issuedAt: envelope.timestamp || event.timestamp || null,
                issuedEvent: event.id || null,
            };
            return next;
        },
        projectionVersion: 1,
    },

    DEVICE_KEY_ISSUED: {
        canonicalName: 'DEVICE_KEY_ISSUED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['device_id', 'public_key'],
            optional: ['authority_ref', 'capabilities'],
            fields: {
                device_id: 'string',
                public_key: 'string',
                authority_ref: 'string',
                capabilities: 'array',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT_OR_RECOVERY,
        migrationAdapters: {
            1: deviceKeyIssuedMigrationAdapter,
        },
        validateTransition(currentState, envelope, payload) {
            if (isActiveRoot(currentState, envelope.signer)) return [];

            const recovery = currentState.lastRecovery;
            if (!recovery || recovery.status !== 'executed') return ['RECOVERY_CONTEXT_REQUIRED'];
            if (recovery.recoveryRef !== payload.recovery_ref) return ['RECOVERY_CONTEXT_MISMATCH'];
            if (recovery.newDeviceId !== payload.device_id) return ['RECOVERY_REPLACEMENT_DEVICE_MISMATCH'];
            return [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const authorityRef = String(payload.authority_ref || payload.device_authority || `device:${payload.device_id}`);
            const deviceId = String(payload.device_id || authorityRef);
            next.devices = next.devices.filter((device) => device.id !== deviceId && device.authorityRef !== authorityRef);
            next.devices.push({
                id: deviceId,
                authority: authorityRef,
                authorityRef,
                status: 'active',
                publicKey: payload.public_key || null,
                issuedAt: envelope.timestamp || event.timestamp || null,
                issuedEvent: event.id || null,
                revokedAt: null,
                revokedEvent: null,
            });
            return next;
        },
        projectionVersion: 1,
    },

    DEVICE_KEY_REVOKED: {
        canonicalName: 'DEVICE_KEY_REVOKED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: [],
            optional: ['device_id', 'authority_ref', 'device_authority', 'reason'],
            requireOneOf: ['device_id', 'authority_ref', 'device_authority'],
            fields: {
                device_id: 'string',
                authority_ref: 'string',
                device_authority: 'string',
                reason: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT_OR_DEVICE_OR_RECOVERY,
        migrationAdapters: {
            1: deviceKeyRevokedMigrationAdapter,
        },
        validateTransition(currentState, envelope, payload) {
            const target = targetDeviceRef(envelope, payload);
            const device = findDevice(currentState, target);
            if (!device) return ['DEVICE_AUTHORITY_NOT_FOUND'];
            if (device.status === 'revoked') return ['DEVICE_AUTHORITY_ALREADY_REVOKED'];
            if (isActiveDevice(currentState, envelope.signer)
                && !isActiveRoot(currentState, envelope.signer)
                && !isActiveRecoveryAuthority(currentState, envelope.signer)) {
                const signerDevice = findDevice(currentState, envelope.signer);
                const selfTarget = signerDevice
                    && (signerDevice.id === target
                        || signerDevice.authorityRef === target
                        || signerDevice.authority === target
                        || envelope.signer === target);
                if (!selfTarget) return ['DEVICE_REVOKE_TARGET_NOT_SELF'];
            }
            if (isActiveRecoveryAuthority(currentState, envelope.signer)) {
                const recovery = currentState.lastRecovery;
                if (!recovery || recovery.status !== 'executed') return ['RECOVERY_CONTEXT_REQUIRED'];
                if (recovery.recoveryRef !== payload.recovery_ref) return ['RECOVERY_CONTEXT_MISMATCH'];
                if (recovery.oldDeviceId !== device.id && recovery.oldDeviceRef !== device.authorityRef) {
                    return ['RECOVERY_REVOKE_TARGET_MISMATCH'];
                }
            }
            return [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const target = String(targetDeviceRef(envelope, payload) || '');
            next.devices = next.devices.map((device) => {
                if (device.id !== target && device.authorityRef !== target && device.authority !== target) {
                    return device;
                }
                return {
                    ...device,
                    status: 'revoked',
                    revokedAt: envelope.timestamp || event.timestamp || null,
                    revokedEvent: event.id || null,
                };
            });
            return next;
        },
        projectionVersion: 1,
    },

    SESSION_AUTHORITY_ISSUED: {
        canonicalName: 'SESSION_AUTHORITY_ISSUED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['session_id'],
            optional: ['device_ref', 'authority_ref', 'expires_at'],
            fields: {
                session_id: 'string',
                device_ref: 'string',
                authority_ref: 'string',
                expires_at: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT_OR_DEVICE,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const sessionId = String(payload.session_id || `session_${next.sessions.length + 1}`);
            const authorityRef = String(payload.authority_ref || payload.session_authority || sessionId);
            next.sessions = next.sessions.filter((session) => session.id !== sessionId);
            next.sessions.push({
                id: sessionId,
                authorityRef,
                deviceRef: payload.device_ref || null,
                status: 'active',
                issuedAt: envelope.timestamp || event.timestamp || null,
                issuedEvent: event.id || null,
                expiresAt: payload.expires_at || null,
            });
            return next;
        },
        projectionVersion: 1,
    },

    SESSION_AUTHORITY_EXPIRED: {
        canonicalName: 'SESSION_AUTHORITY_EXPIRED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: [],
            optional: ['session_id', 'authority_ref'],
            requireOneOf: ['session_id', 'authority_ref'],
            fields: {
                session_id: 'string',
                authority_ref: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT_OR_DEVICE,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const target = String(payload.session_id || payload.authority_ref || '');
            next.sessions = next.sessions.map((session) => {
                if (session.id !== target && session.authorityRef !== target) return session;
                return {
                    ...session,
                    status: 'expired',
                    expiredAt: envelope.timestamp || event.timestamp || null,
                    expiredEvent: event.id || null,
                };
            });
            return next;
        },
        projectionVersion: 1,
    },

    AUTHORITY_ROTATED: {
        canonicalName: 'AUTHORITY_ROTATED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['new_authority_ref'],
            optional: ['new_root_id', 'previous_authority_ref'],
            fields: {
                new_authority_ref: 'string',
                new_root_id: 'string',
                previous_authority_ref: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            if (next.rootAuthority) {
                next.rootAuthority = {
                    ...next.rootAuthority,
                    status: 'rotated',
                    rotatedAt: envelope.timestamp || event.timestamp || null,
                    rotatedEvent: event.id || null,
                };
            }
            const newAuthorityRef = String(payload.new_authority_ref || envelope.authority_reference || '');
            next.rootAuthority = {
                id: String(payload.new_root_id || newAuthorityRef),
                authorityRef: newAuthorityRef,
                status: 'active',
                issuedAt: envelope.timestamp || event.timestamp || null,
                issuedEvent: event.id || null,
            };
            return next;
        },
        projectionVersion: 1,
    },

    RECOVERY_AUTHORITY_ISSUED: {
        canonicalName: 'RECOVERY_AUTHORITY_ISSUED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['recovery_authority_id', 'public_key'],
            optional: ['authority_ref', 'label'],
            fields: {
                recovery_authority_id: 'string',
                public_key: 'string',
                authority_ref: 'string',
                label: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition(currentState, envelope, payload) {
            const target = targetRecoveryAuthorityRef(envelope, payload);
            const existing = findRecoveryAuthority(currentState, target);
            if (existing && existing.status === 'active') return ['RECOVERY_AUTHORITY_ALREADY_ACTIVE'];
            return [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const authorityRef = String(payload.authority_ref || payload.recovery_authority_ref || `recovery:${payload.recovery_authority_id}`);
            const recoveryAuthorityId = String(payload.recovery_authority_id || authorityRef);
            next.recoveryAuthorities = next.recoveryAuthorities.filter((authority) =>
                authority.id !== recoveryAuthorityId && authority.authorityRef !== authorityRef
            );
            next.recoveryAuthorities.push({
                id: recoveryAuthorityId,
                authorityRef,
                status: 'active',
                publicKey: payload.public_key || null,
                issuedBy: envelope.signer || null,
                issuedAt: envelope.timestamp || event.timestamp || null,
                issuedEvent: event.id || null,
                revokedEvent: null,
            });
            return next;
        },
        projectionVersion: 1,
    },

    RECOVERY_AUTHORITY_REVOKED: {
        canonicalName: 'RECOVERY_AUTHORITY_REVOKED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: [],
            optional: ['recovery_authority_id', 'authority_ref', 'recovery_authority_ref', 'reason'],
            requireOneOf: ['recovery_authority_id', 'authority_ref', 'recovery_authority_ref'],
            fields: {
                recovery_authority_id: 'string',
                authority_ref: 'string',
                recovery_authority_ref: 'string',
                reason: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition(currentState, envelope, payload) {
            const target = targetRecoveryAuthorityRef(envelope, payload);
            const authority = findRecoveryAuthority(currentState, target);
            if (!authority) return ['RECOVERY_AUTHORITY_NOT_FOUND'];
            if (authority.status === 'revoked') return ['RECOVERY_AUTHORITY_ALREADY_REVOKED'];
            return [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const target = String(targetRecoveryAuthorityRef(envelope, payload) || '');
            next.recoveryAuthorities = next.recoveryAuthorities.map((authority) => {
                if (authority.id !== target && authority.authorityRef !== target) return authority;
                return {
                    ...authority,
                    status: 'revoked',
                    revokedAt: envelope.timestamp || event.timestamp || null,
                    revokedEvent: event.id || null,
                };
            });
            return next;
        },
        projectionVersion: 1,
    },

    RECOVERY_EXECUTED: {
        canonicalName: 'RECOVERY_EXECUTED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['recovery_ref', 'old_device_id', 'new_device_id'],
            optional: ['old_device_ref', 'new_device_authority_ref', 'reason'],
            fields: {
                recovery_ref: 'string',
                old_device_id: 'string',
                old_device_ref: 'string',
                new_device_id: 'string',
                new_device_authority_ref: 'string',
                reason: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.RECOVERY,
        validateTransition(currentState, envelope, payload) {
            const oldDevice = findDevice(currentState, payload.old_device_id || payload.old_device_ref);
            if (!oldDevice) return ['RECOVERY_OLD_DEVICE_NOT_FOUND'];
            if (oldDevice.status !== 'active') return ['RECOVERY_OLD_DEVICE_NOT_ACTIVE'];

            const replacement = findDevice(currentState, payload.new_device_id || payload.new_device_authority_ref);
            if (replacement && replacement.status === 'active') return ['RECOVERY_REPLACEMENT_ALREADY_ACTIVE'];
            return [];
        },
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            next.lastRecovery = {
                executedAt: envelope.timestamp || event.timestamp || null,
                executedEvent: event.id || null,
                recoveryRef: payload.recovery_ref || envelope.authority_reference || null,
                recoveryAuthority: envelope.signer || null,
                oldDeviceId: payload.old_device_id || null,
                oldDeviceRef: payload.old_device_ref || payload.old_device_id || null,
                newDeviceId: payload.new_device_id || null,
                newDeviceAuthorityRef: payload.new_device_authority_ref || null,
                status: 'executed',
            };
            return next;
        },
        projectionVersion: 1,
    },

    FEDERATION_TRUST_ESTABLISHED: {
        canonicalName: 'FEDERATION_TRUST_ESTABLISHED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['remote_realm_id'],
            optional: ['trusted_root_authority', 'allowed_claim_scopes', 'trust_scope', 'policy_id', 'remote_event_head'],
            fields: {
                remote_realm_id: 'string',
                trusted_root_authority: 'string',
                allowed_claim_scopes: 'array',
                trust_scope: 'string',
                policy_id: 'string',
                remote_event_head: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const realmId = String(payload.remote_realm_id || payload.realm_id || '');
            next.federationTrusts = next.federationTrusts.filter((trust) => trust.realmId !== realmId);
            next.federationTrusts.push({
                realmId,
                status: 'active',
                trustedRootAuthority: payload.trusted_root_authority || null,
                allowedClaimScopes: Array.isArray(payload.allowed_claim_scopes) ? payload.allowed_claim_scopes : [],
                trustScope: payload.trust_scope || 'claims',
                policyId: payload.policy_id || null,
                remoteEventHead: payload.remote_event_head || null,
                establishedAt: envelope.timestamp || event.timestamp || null,
                establishedEvent: event.id || null,
            });
            return next;
        },
        projectionVersion: 1,
    },

    FEDERATION_TRUST_UPDATED: {
        canonicalName: 'FEDERATION_TRUST_UPDATED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['remote_realm_id'],
            optional: ['trusted_root_authority', 'allowed_claim_scopes', 'trust_scope', 'policy_id', 'remote_event_head'],
            fields: {
                remote_realm_id: 'string',
                trusted_root_authority: 'string',
                allowed_claim_scopes: 'array',
                trust_scope: 'string',
                policy_id: 'string',
                remote_event_head: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            return REALM_EVENT_REGISTRY.FEDERATION_TRUST_ESTABLISHED.apply(projection, event, envelope, payload);
        },
        projectionVersion: 1,
    },

    FEDERATION_TRUST_REVOKED: {
        canonicalName: 'FEDERATION_TRUST_REVOKED',
        version: 1,
        envelope: SHARED_ENVELOPE_CONTRACT,
        payloadContract: {
            required: ['remote_realm_id'],
            optional: ['reason'],
            fields: {
                remote_realm_id: 'string',
                reason: 'string',
            },
        },
        requiredAuthority: AUTHORITY_POLICY.ROOT,
        validateTransition: noAdditionalTransitionValidation,
        apply(projection, event, envelope, payload) {
            const next = withSequence(projection, envelope);
            const realmId = String(payload.remote_realm_id || payload.realm_id || '');
            next.federationTrusts = next.federationTrusts.map((trust) => {
                if (trust.realmId !== realmId) return trust;
                return {
                    ...trust,
                    status: 'revoked',
                    revokedAt: envelope.timestamp || event.timestamp || null,
                    revokedEvent: event.id || null,
                };
            });
            return next;
        },
        projectionVersion: 1,
    },
});

const CANONICAL_REALM_EVENT_TYPES = Object.freeze(Object.keys(REALM_EVENT_REGISTRY));

function getRealmEventContract(type) {
    return REALM_EVENT_REGISTRY[String(type || '')] || null;
}

function hasRealmEventContract(type) {
    return Boolean(getRealmEventContract(type));
}

module.exports = {
    AUTHORITY_POLICY,
    CANONICAL_REALM_EVENT_TYPES,
    REALM_EVENT_REGISTRY,
    canSignerSatisfyAuthorityPolicy,
    findDevice,
    findRecoveryAuthority,
    getRealmEventContract,
    hasRealmEventContract,
    interpretRealmEvent,
};
