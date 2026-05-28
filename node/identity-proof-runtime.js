'use strict';

const crypto = require('crypto');

const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const signingPayload = (proof) => {
    const { signature, ...payload } = proof || {};
    return payload;
};

const signIdentityProof = (proof, secret) => {
    return crypto
        .createHmac('sha256', String(secret || 'sl1-connect-development-secret'))
        .update(stableStringify(signingPayload(proof)))
        .digest('base64url');
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
    createIdentityProof,
    signIdentityProof,
    verifyIdentityProof,
    stableStringify,
};
