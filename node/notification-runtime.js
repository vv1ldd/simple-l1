'use strict';

const identity = require('./identity-kernel');
const { artifactId, ensureArrayStore, hashObject, upsertById } = require('./protocol-artifacts');

const NOTIFICATION_VERSION = 'sl1.notification.v1';

const NOTIFICATION_STATUS = Object.freeze({
    PENDING: 'pending',
    READ: 'read',
    DISMISSED: 'dismissed',
    EXPIRED: 'expired',
});

const RECIPIENT_HINT_TYPES = new Set(['entity', 'alias', 'email_hash', 'external']);

function ensureNotificationStores(ledger) {
    ensureArrayStore(ledger, 'notification_envelopes');
    ensureArrayStore(ledger, 'notification_replay_keys');

    return ledger;
}

function normalizeRecipientHint(input) {
    const hint = input || {};
    const type = String(hint.type || hint.hint_type || '').toLowerCase();
    const value = String(hint.value || hint.hint_value || '').trim();

    if (!RECIPIENT_HINT_TYPES.has(type) || !value) {
        throw new Error('recipient_hint.type and recipient_hint.value are required');
    }

    return {
        type,
        value: type === 'entity' ? identity.assertEntityAddress(value) : value,
    };
}

function normalizeArtifactRef(input) {
    const ref = input || {};
    const artifactType = String(ref.object_type || ref.artifact_type || '').trim();
    const artifactIdValue = String(ref.id || ref.artifact_id || '').trim();
    const version = String(ref.version || ref.artifact_version || '').trim();

    if (!artifactType || !artifactIdValue) {
        throw new Error('artifact_ref.object_type and artifact_ref.id are required');
    }

    return {
        object_type: artifactType,
        id: artifactIdValue,
        version: version || null,
        hash: ref.hash || ref.artifact_hash || null,
    };
}

function assertNonAuthoritativeInput(input) {
    if (input.authority_effect && input.authority_effect !== 'none') {
        throw new Error('NotificationEnvelope cannot carry authority effects');
    }

    if (input.consumes_artifact === true || input.mutates_authority === true) {
        throw new Error('NotificationEnvelope cannot consume artifacts or mutate authority');
    }

    if (Array.isArray(input.capabilities_granted) && input.capabilities_granted.length > 0) {
        throw new Error('NotificationEnvelope cannot grant capabilities');
    }
}

function createNotificationEnvelope(ledger, input, now = new Date()) {
    ensureNotificationStores(ledger);
    assertNonAuthoritativeInput(input);

    const notificationType = String(input.notification_type || input.type || '').trim();
    if (!notificationType) {
        throw new Error('notification_type is required');
    }

    const recipientHint = normalizeRecipientHint(input.recipient_hint);
    const artifactRef = normalizeArtifactRef(input.artifact_ref);
    const issuedAt = input.issued_at || now.toISOString();
    const issuerEntityAddress = input.issuer_entity_l1_address
        ? identity.assertEntityAddress(input.issuer_entity_l1_address)
        : null;
    const replayKey = hashObject({
        notification_type: notificationType,
        recipient_hint: recipientHint,
        artifact_ref: artifactRef,
        issuer_entity_l1_address: issuerEntityAddress,
        idempotency_key: input.idempotency_key || null,
    });

    if (ledger.notification_replay_keys.includes(replayKey) && input.allow_duplicate !== true) {
        throw new Error('NotificationEnvelope replay detected');
    }

    const envelope = {
        id: input.id || artifactId('notify', { replay_key: replayKey }, 24),
        object_type: 'NotificationEnvelope',
        version: NOTIFICATION_VERSION,
        notification_type: notificationType,
        recipient_hint: recipientHint,
        artifact_ref: artifactRef,
        issuer_entity_l1_address: issuerEntityAddress,
        subject: input.subject || null,
        body: input.body || null,
        delivery_channels: Array.isArray(input.delivery_channels) ? input.delivery_channels : [],
        status: input.status || NOTIFICATION_STATUS.PENDING,
        issued_at: issuedAt,
        expires_at: input.expires_at || null,
        read_at: null,
        dismissed_at: null,
        authority_effect: 'none',
        non_authoritative: true,
        consumes_artifact: false,
        mutates_authority: false,
        capabilities_granted: [],
        replay_key: replayKey,
        metadata: input.metadata || {},
    };

    upsertById(ledger.notification_envelopes, envelope);
    ledger.notification_replay_keys.push(replayKey);

    return envelope;
}

function resolveNotification(ledger, envelopeOrId) {
    ensureNotificationStores(ledger);

    return typeof envelopeOrId === 'string'
        ? ledger.notification_envelopes.find((candidate) => candidate.id === envelopeOrId)
        : envelopeOrId;
}

function verifyNotificationEnvelope(ledger, envelopeOrId, now = new Date()) {
    const envelope = resolveNotification(ledger, envelopeOrId);
    if (!envelope) {
        return { ok: false, reason_codes: ['NOTIFICATION_NOT_FOUND'] };
    }

    const reasonCodes = [];
    if (envelope.object_type !== 'NotificationEnvelope') reasonCodes.push('NOTIFICATION_OBJECT_TYPE_MISMATCH');
    if (envelope.version !== NOTIFICATION_VERSION) reasonCodes.push('NOTIFICATION_VERSION_MISMATCH');
    if (envelope.authority_effect !== 'none') reasonCodes.push('NOTIFICATION_AUTHORITY_EFFECT_FORBIDDEN');
    if (envelope.non_authoritative !== true) reasonCodes.push('NOTIFICATION_MUST_BE_NON_AUTHORITATIVE');
    if (envelope.consumes_artifact !== false) reasonCodes.push('NOTIFICATION_ARTIFACT_CONSUMPTION_FORBIDDEN');
    if (envelope.mutates_authority !== false) reasonCodes.push('NOTIFICATION_AUTHORITY_MUTATION_FORBIDDEN');
    if (Array.isArray(envelope.capabilities_granted) && envelope.capabilities_granted.length > 0) {
        reasonCodes.push('NOTIFICATION_CAPABILITY_GRANT_FORBIDDEN');
    }
    if (envelope.expires_at && new Date(envelope.expires_at).getTime() <= now.getTime()) {
        reasonCodes.push('NOTIFICATION_EXPIRED');
    }

    return {
        ok: reasonCodes.length === 0,
        envelope,
        reason_codes: reasonCodes.length ? reasonCodes : ['NOTIFICATION_VALID_NON_AUTHORITATIVE'],
    };
}

function markNotificationRead(ledger, envelopeId, now = new Date()) {
    const verification = verifyNotificationEnvelope(ledger, envelopeId, now);
    if (!verification.ok) {
        return verification;
    }

    verification.envelope.status = NOTIFICATION_STATUS.READ;
    verification.envelope.read_at = now.toISOString();

    return {
        ok: true,
        envelope: verification.envelope,
        reason_codes: ['NOTIFICATION_READ_MARKED_NON_AUTHORITATIVE'],
    };
}

function dismissNotification(ledger, envelopeId, now = new Date()) {
    const verification = verifyNotificationEnvelope(ledger, envelopeId, now);
    if (!verification.ok) {
        return verification;
    }

    verification.envelope.status = NOTIFICATION_STATUS.DISMISSED;
    verification.envelope.dismissed_at = now.toISOString();

    return {
        ok: true,
        envelope: verification.envelope,
        reason_codes: ['NOTIFICATION_DISMISSED_NON_AUTHORITATIVE'],
    };
}

module.exports = {
    NOTIFICATION_STATUS,
    NOTIFICATION_VERSION,
    createNotificationEnvelope,
    dismissNotification,
    ensureNotificationStores,
    markNotificationRead,
    verifyNotificationEnvelope,
};
