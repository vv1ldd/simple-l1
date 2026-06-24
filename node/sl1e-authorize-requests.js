'use strict';

const crypto = require('crypto');
const {
    normalizeAuthorizeQuery,
    verifyClientSecret,
} = require('./sl1e-client-registry');

const REQUEST_REF_PREFIX = 'sl1rq_';
const DEFAULT_TTL_MS = 2 * 60 * 1000;

const createRequestRef = () => `${REQUEST_REF_PREFIX}${crypto.randomBytes(12).toString('base64url')}`;

const extractClientSecret = (request) => {
    const header = String(request.headers?.authorization || '');
    if (header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }

    const bodySecret = request.body?.client_secret;
    if (bodySecret) return String(bodySecret);

    const headerSecret = request.headers?.['x-sl1e-client-secret'];
    if (headerSecret) return String(headerSecret);

    return '';
};

const pushAuthorizeRequest = (store, request, { ttlMs = DEFAULT_TTL_MS } = {}) => {
    const body = request.body || {};
    const clientId = String(body.client_id || '').trim();
    if (!clientId) {
        return { statusCode: 422, payload: { error: 'missing_client_id' } };
    }

    const secret = extractClientSecret(request);
    if (!verifyClientSecret(clientId, secret)) {
        return { statusCode: 401, payload: { error: 'invalid_client_credentials' } };
    }

    const normalized = normalizeAuthorizeQuery({
        client_id: clientId,
        redirect_uri: body.redirect_uri,
        state: body.state,
        nonce: body.nonce,
        mode: body.mode,
        flow: body.flow,
        scope: body.scope,
        response_mode: body.response_mode,
        intent_type: body.intent_type,
        intent_title: body.intent_title,
        intent_description: body.intent_description,
        intent_cta: body.intent_cta,
        intent_nonce: body.intent_nonce,
        intent_resource: body.intent_resource,
        identity_hint: body.identity_hint,
        ui_locale: body.ui_locale,
    });

    if (!normalized.ok) {
        return {
            statusCode: normalized.error === 'invalid_redirect_uri' ? 422 : 422,
            payload: {
                error: normalized.error || 'invalid_authorization_request',
                missing: normalized.missing,
            },
        };
    }

    const requestRef = createRequestRef();
    const expiresAtMs = Date.now() + ttlMs;
    store.set('authorizeRequests', requestRef, {
        query: normalized.query,
        client_id: clientId,
        expiresAtMs,
        createdAtMs: Date.now(),
    });

    return {
        statusCode: 201,
        payload: {
            protocol: 'simple-l1',
            request_ref: requestRef,
            request_uri: `/r/${requestRef}`,
            expires_in: Math.max(1, Math.floor(ttlMs / 1000)),
        },
    };
};

const resolveAuthorizeRequestRef = (store, requestRef) => {
    const ref = String(requestRef || '').trim();
    if (!ref.startsWith(REQUEST_REF_PREFIX)) {
        return { ok: false, error: 'invalid_request_ref' };
    }

    const record = store.get('authorizeRequests', ref);
    if (!record) {
        return { ok: false, error: 'authorization_request_not_found' };
    }

    return { ok: true, query: { ...record.query }, client_id: record.client_id };
};

module.exports = {
    REQUEST_REF_PREFIX,
    DEFAULT_TTL_MS,
    createRequestRef,
    extractClientSecret,
    pushAuthorizeRequest,
    resolveAuthorizeRequestRef,
};
