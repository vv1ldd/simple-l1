'use strict';

const crypto = require('crypto');
const { buildIdentityProofClaims } = require('./subject-email-claims');

const IDENTITY_PROOF_ENVELOPE_VERSION = 'simple-l1.identity_proof_envelope.v1';
const IDENTITY_PROOF_TYPE = 'identity_proof';
const DEFAULT_ISSUER = {
    issuer_id: 'simplel1.local',
    issuer_url: 'https://simplel1.local',
    key_id: 'sl1-connect-hmac-v1',
};

const forbiddenCredentialFields = new Set([
    'credential_id',
    'credentialId',
    'authenticator_data',
    'authenticatorData',
    'client_data_json',
    'clientDataJSON',
    'webauthn_sign_count',
    'signCount',
    'attestation_object',
    'attestationObject',
    'transports',
    'raw_assertion_signature',
    'rawAssertionSignature',
    'assertion',
    'authenticator',
]);

const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const signingPayload = (proof) => {
    const { signature, ...payload } = proof || {};
    return payload;
};

const sha256Hex = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const signIdentityProof = (proof, secret) => {
    return crypto
        .createHmac('sha256', String(secret || 'sl1-connect-development-secret'))
        .update(stableStringify(signingPayload(proof)))
        .digest('base64url');
};

const normalizeIntent = (intent, mode = 'login') => {
    if (typeof intent === 'string' && intent.trim()) {
        return { type: intent.trim(), resource: null, nonce: null };
    }

    const input = intent && typeof intent === 'object' ? intent : {};
    return {
        type: String(input.type || `sl1e.${mode || 'login'}`).trim(),
        resource: input.resource === undefined || input.resource === '' ? null : String(input.resource),
        nonce: input.nonce === undefined || input.nonce === '' ? null : String(input.nonce),
    };
};

const envelopePayload = (envelope) => signingPayload(envelope);

const identityProofEnvelopeId = (payload) => `ipe_${sha256Hex(stableStringify(payload)).slice(0, 40)}`;

const signIdentityProofEnvelope = (envelope, {
    secret,
    keyId = envelope?.issuer?.key_id || DEFAULT_ISSUER.key_id,
} = {}) => crypto
    .createHmac('sha256', String(secret || 'sl1-connect-development-secret'))
    .update(stableStringify(envelopePayload(envelope)))
    .digest('base64url');

const createIdentityProofEnvelope = ({
    proof = null,
    issuer = DEFAULT_ISSUER,
    subject = null,
    clientId = null,
    redirectUri = null,
    intent = null,
    state = null,
    nonce = null,
    issuedAt = null,
    expiresAt = null,
    assuranceLevel = 'AL2',
    claims = null,
    scope = null,
    secret,
} = {}) => {
    const mode = proof?.mode || 'login';
    const normalizedIssuer = {
        issuer_id: String(issuer?.issuer_id || DEFAULT_ISSUER.issuer_id),
        issuer_url: String(issuer?.issuer_url || DEFAULT_ISSUER.issuer_url),
        key_id: String(issuer?.key_id || DEFAULT_ISSUER.key_id),
    };
    const normalizedSubject = {
        entity_l1_address: String(subject?.entity_l1_address || proof?.entity_l1_address || proof?.entityAddress || ''),
        key_l1_address: subject?.key_l1_address ?? proof?.controller_l1_address ?? proof?.keyAddress ?? null,
    };
    const normalizedIntent = normalizeIntent(intent || proof?.intent, mode);
    const resolvedScope = scope ?? claims?.scope ?? proof?.scope ?? null;
    const emailFromClaims = claims?.email ?? proof?.email ?? null;
    const builtClaims = buildIdentityProofClaims({
        alias: claims?.alias ?? proof?.alias ?? null,
        displayAlias: claims?.display_alias ?? proof?.display_alias ?? proof?.displayAlias ?? null,
        email: emailFromClaims,
        scope: resolvedScope,
    });
    if (!builtClaims.ok) {
        const error = new Error(`IdentityProof claims rejected: ${builtClaims.reason_codes.join(',')}`);
        error.reason_codes = builtClaims.reason_codes;
        throw error;
    }
    const payload = {
        schema_version: IDENTITY_PROOF_ENVELOPE_VERSION,
        proof_type: IDENTITY_PROOF_TYPE,
        issuer: normalizedIssuer,
        subject: normalizedSubject,
        client_id: String(clientId || proof?.audience || proof?.clientId || ''),
        redirect_uri: String(redirectUri || proof?.redirect_uri || proof?.redirectUri || ''),
        intent: normalizedIntent,
        state: String(state ?? proof?.state ?? ''),
        nonce: String(nonce ?? proof?.nonce ?? ''),
        issued_at: new Date(issuedAt || proof?.issued_at || proof?.issuedAt || Date.now()).toISOString(),
        expires_at: new Date(expiresAt || proof?.expires_at || proof?.expiresAt || Date.now() + 10 * 60 * 1000).toISOString(),
        assurance_level: String(assuranceLevel || 'AL2'),
        claims: builtClaims.claims,
    };

    const envelope = {
        ...payload,
        envelope_id: identityProofEnvelopeId(payload),
        signature: {
            algorithm: 'hmac-sha256',
            key_id: normalizedIssuer.key_id,
            value: '',
        },
    };

    envelope.signature.value = signIdentityProofEnvelope(envelope, {
        secret,
        keyId: normalizedIssuer.key_id,
    });

    return envelope;
};

const assertNoCredentialLeak = (value) => {
    const paths = [];

    function visit(current, parts = []) {
        if (!current || typeof current !== 'object') return;
        if (Array.isArray(current)) {
            current.forEach((item, index) => visit(item, [...parts, String(index)]));
            return;
        }
        for (const [key, child] of Object.entries(current)) {
            const next = [...parts, key];
            if (forbiddenCredentialFields.has(key)) paths.push(next.join('.'));
            visit(child, next);
        }
    }

    visit(value);

    return {
        ok: paths.length === 0,
        reason_codes: paths.length ? ['NO_RAW_CREDENTIAL_LEAK'] : [],
        paths,
    };
};

const trustedIssuerSecret = (envelope, issuerTrust = {}) => {
    const issuerId = envelope?.issuer?.issuer_id;
    const keyId = envelope?.signature?.key_id || envelope?.issuer?.key_id;
    const issuer = issuerTrust?.[issuerId];
    if (!issuer) return null;
    if (issuer.key_id && String(issuer.key_id) !== String(keyId)) return null;
    return issuer.secret || null;
};

const intentMatches = (actual, expected) => {
    if (!expected) return true;
    return stableStringify(normalizeIntent(actual)) === stableStringify(normalizeIntent(expected));
};

const verifyIdentityProofEnvelope = (envelope, {
    validateEnvelope = null,
    expectedClientId = null,
    expectedRedirectUri = null,
    expectedIntent = null,
    now = new Date(),
    issuerTrust = {},
} = {}) => {
    const reasonCodes = [];
    const boundary = assertNoCredentialLeak(envelope);
    if (!boundary.ok) reasonCodes.push(...boundary.reason_codes);

    if (!envelope || envelope.schema_version !== IDENTITY_PROOF_ENVELOPE_VERSION) {
        reasonCodes.push('SCHEMA_ERROR');
    }

    if (typeof validateEnvelope !== 'function') {
        reasonCodes.push('SCHEMA_ERROR');
    } else if (!validateEnvelope(envelope)) {
        reasonCodes.push('SCHEMA_ERROR');
    }

    if (expectedClientId && envelope?.client_id !== String(expectedClientId)) {
        reasonCodes.push('CLIENT_MISMATCH');
    }

    if (expectedRedirectUri && envelope?.redirect_uri !== String(expectedRedirectUri)) {
        reasonCodes.push('REDIRECT_URI_MISMATCH');
    }

    if (!intentMatches(envelope?.intent, expectedIntent)) {
        reasonCodes.push('INTENT_MISMATCH');
    }

    const checkedAt = now instanceof Date ? now : new Date(now);
    const expiresAtMs = Date.parse(envelope?.expires_at || '');
    if (!expiresAtMs || expiresAtMs <= checkedAt.getTime()) {
        reasonCodes.push('PROOF_EXPIRED');
    }

    const secret = trustedIssuerSecret(envelope, issuerTrust);
    if (!secret) {
        reasonCodes.push('UNTRUSTED_ISSUER');
    } else {
        const expectedSignature = signIdentityProofEnvelope(envelope, { secret });
        if (!envelope?.signature?.value || envelope.signature.value !== expectedSignature) {
            reasonCodes.push('PROOF_VERIFICATION_FAILED');
        }
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: [...new Set(reasonCodes)],
        envelope_id: envelope?.envelope_id || null,
        subject: envelope?.subject || null,
    };
};

const createIdentityProof = ({
    account,
    query,
    challenge,
    controllerCredential,
    intent = null,
    mode = 'login',
    now = new Date(),
    ttlMs = 10 * 60 * 1000,
    secret,
    publicAlias = null,
    displayAlias = null,
}) => {
    const issuedAt = now instanceof Date ? now : new Date(now);
    const expiresAt = new Date(issuedAt.getTime() + ttlMs);
    const proofId = `idp_${crypto.randomBytes(16).toString('hex')}`;
    const entityAddress = account?.entity_l1_address || account?.address || null;
    const controllerAddress = controllerCredential?.key_l1_address || account?.key_l1_address || account?.keys?.[0]?.key_l1_address || null;
    const audience = String(query?.client_id || '');
    const redirectUri = String(query?.redirect_uri || '');
    const nonce = String(query?.nonce || '');

    const proof = {
        object_type: 'IdentityProof',
        type: intent ? 'sl1e.intent.proof.v1' : (mode === 'register' ? 'sl1e.register.proof.v1' : 'sl1e.login.proof.v1'),
        proof_id: proofId,
        proofId,
        entity_l1_address: entityAddress,
        entityAddress,
        controller_l1_address: controllerAddress,
        keyAddress: controllerAddress,
        challenge: String(challenge || nonce || ''),
        audience,
        clientId: audience,
        redirect_uri: redirectUri,
        redirectUri,
        state: String(query?.state || ''),
        nonce,
        mode,
        alias: publicAlias,
        display_alias: displayAlias,
        displayAlias,
        username: displayAlias || publicAlias || entityAddress,
        displayName: displayAlias || publicAlias || entityAddress,
        issued_at: issuedAt.toISOString(),
        issuedAt: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        addressDerivation: {
            entity: 'sl1e_random_entity_v1',
            controller: 'sl1_ + sha256(credentialPublicKey).slice(0, 40)',
            invariant: 'passkey private key remains in authenticator; SL1 stores only public credential material',
        },
    };

    if (intent) {
        proof.intent = Object.fromEntries(Object.entries(intent).filter(([, value]) => value !== undefined && value !== ''));
    }

    proof.signature = signIdentityProof(proof, secret);
    return proof;
};

const verifyIdentityProof = (proof, {
    audience,
    challenge,
    now = new Date(),
    secret,
    consumeProof = null,
    isControllerRevoked = null,
} = {}) => {
    const reasonCodes = [];
    const checkedAt = now instanceof Date ? now : new Date(now);

    if (!proof || proof.object_type !== 'IdentityProof') reasonCodes.push('IDENTITY_PROOF_TYPE_INVALID');
    if (audience && proof?.audience !== String(audience)) reasonCodes.push('IDENTITY_PROOF_AUDIENCE_MISMATCH');
    if (challenge && proof?.challenge !== String(challenge)) reasonCodes.push('IDENTITY_PROOF_CHALLENGE_MISMATCH');

    const expiresAtMs = Date.parse(proof?.expires_at || proof?.expiresAt || '');
    if (!expiresAtMs || expiresAtMs <= checkedAt.getTime()) reasonCodes.push('IDENTITY_PROOF_EXPIRED');

    const expectedSignature = signIdentityProof(proof, secret);
    if (!proof?.signature || proof.signature !== expectedSignature) reasonCodes.push('IDENTITY_PROOF_SIGNATURE_INVALID');

    if (typeof isControllerRevoked === 'function' && isControllerRevoked(proof?.controller_l1_address || proof?.keyAddress)) {
        reasonCodes.push('IDENTITY_PROOF_CONTROLLER_REVOKED');
    }

    if (reasonCodes.length === 0 && typeof consumeProof === 'function') {
        const consumed = consumeProof(proof.proof_id || proof.proofId, expiresAtMs);
        if (!consumed) reasonCodes.push('IDENTITY_PROOF_REPLAY_DETECTED');
    }

    return {
        ok: reasonCodes.length === 0,
        reason_codes: reasonCodes,
        proof_id: proof?.proof_id || proof?.proofId || null,
    };
};

module.exports = {
    DEFAULT_ISSUER,
    IDENTITY_PROOF_ENVELOPE_VERSION,
    assertNoCredentialLeak,
    createIdentityProofEnvelope,
    createIdentityProof,
    signIdentityProofEnvelope,
    signIdentityProof,
    verifyIdentityProofEnvelope,
    verifyIdentityProof,
    stableStringify,
};
