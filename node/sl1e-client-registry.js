'use strict';

const crypto = require('crypto');

const BUILTIN_CLIENTS = {
    'meanly.ops': {
        display_name: 'Sovereign Coolify',
        redirect_uris: ['https://ops.meanly.one/auth/sl1/callback'],
        default_mode: 'connect',
        default_flow: 'connect',
        default_scope: 'openid sl1e email',
        secret_env: 'SL1E_CLIENT_SECRET_MEANLY_OPS',
        first_party: true,
    },
    'meanly.one': {
        display_name: 'Meanly One',
        redirect_uris: ['https://meanly.one/simple-l1/callback'],
        default_mode: 'login',
        default_scope: 'openid sl1e marketplace email',
        brand: 'MEANLY ONE',
        accent: '#7c3aed',
        ui_locale: 'en',
        first_party: true,
    },
    'meanly.ru': {
        display_name: 'Meanly',
        redirect_uris: ['https://meanly.ru/simple-l1/callback'],
        default_mode: 'login',
        default_scope: 'openid sl1e marketplace email',
        brand: 'СЕЙФ MEANLY',
        accent: '#7c3aed',
        ui_locale: 'ru',
        first_party: true,
    },
    'meanly.reference': {
        display_name: 'Meanly',
        redirect_uris: [],
        default_mode: 'connect',
        first_party: true,
    },
    'simplelayer.one': {
        display_name: 'Simple Layer One',
        redirect_uris: ['https://simplelayer.one/'],
        default_mode: 'connect',
        first_party: true,
    },
};

const redirectPathname = (redirectUri) => {
    try {
        const url = new URL(String(redirectUri || ''));
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch (error) {
        return null;
    }
};

const redirectUriMatches = (candidate, allowed) => {
    const candidateBase = redirectPathname(candidate);
    const allowedBase = redirectPathname(allowed);
    return Boolean(candidateBase && allowedBase && candidateBase === allowedBase);
};

const loadRegistry = () => {
    const registry = { ...BUILTIN_CLIENTS };

    const raw = String(process.env.SL1E_CLIENT_REGISTRY_JSON || '').trim();
    if (!raw) return registry;

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            for (const [clientId, entry] of Object.entries(parsed)) {
                registry[String(clientId)] = {
                    ...(registry[String(clientId)] || {}),
                    ...entry,
                };
            }
        }
    } catch (error) {
        // Ignore malformed env override; built-ins still apply.
    }

    return registry;
};

let registryCache = loadRegistry();

const reloadClientRegistry = () => {
    registryCache = loadRegistry();
    return registryCache;
};

const getClient = (clientId) => {
    const id = String(clientId || '').trim();
    if (!id) return null;
    return registryCache[id] || null;
};

const isRegisteredClient = (clientId) => Boolean(getClient(clientId));

const clientSecret = (clientId) => {
    const client = getClient(clientId);
    if (!client) return null;

    const envKey = String(client.secret_env || '').trim();
    if (envKey && process.env[envKey]) {
        return String(process.env[envKey]);
    }

    const connectClientId = String(process.env.SL1_CONNECT_CLIENT_ID || '').trim();
    const connectSecret = String(process.env.SL1_CONNECT_SECRET || '').trim();
    if (connectClientId && connectSecret && connectClientId === String(clientId)) {
        return connectSecret;
    }

    return client.client_secret ? String(client.client_secret) : null;
};

const verifyClientSecret = (clientId, providedSecret) => {
    const expected = clientSecret(clientId);
    if (!expected || !providedSecret) return false;

    const left = Buffer.from(String(providedSecret));
    const right = Buffer.from(expected);
    if (left.length !== right.length) return false;

    return crypto.timingSafeEqual(left, right);
};

const resolveRedirectUri = (clientId, redirectUri) => {
    const client = getClient(clientId);
    const candidate = String(redirectUri || '').trim();

    if (!client) {
        if (!candidate) {
            return { ok: false, error: 'missing_redirect_uri', missing: ['redirect_uri'] };
        }
        return { ok: true, redirect_uri: candidate };
    }

    const allowed = Array.isArray(client.redirect_uris) ? client.redirect_uris.filter(Boolean) : [];
    if (!candidate) {
        if (allowed.length === 0) {
            return { ok: false, error: 'missing_redirect_uri', missing: ['redirect_uri'] };
        }
        return { ok: true, redirect_uri: allowed[0] };
    }

    if (allowed.length === 0) {
        return { ok: true, redirect_uri: candidate };
    }

    const matched = allowed.some((entry) => redirectUriMatches(candidate, entry));
    if (!matched) {
        return { ok: false, error: 'invalid_redirect_uri' };
    }

    return { ok: true, redirect_uri: candidate };
};

const isAllowedSl1eRedirectUri = (redirectUri, clientId = '') => {
    const client = getClient(clientId);
    const value = String(redirectUri || '');

    if (client) {
        const allowed = Array.isArray(client.redirect_uris) ? client.redirect_uris : [];
        if (allowed.length === 0) {
            return value.startsWith('http') || (
                String(clientId) === 'meanly.one.native' && value === 'simplel1://identity-selected'
            );
        }
        return allowed.some((entry) => redirectUriMatches(value, entry));
    }

    if (value.startsWith('http')) return true;
    return String(clientId) === 'meanly.one.native' && value === 'simplel1://identity-selected';
};

const normalizeAuthorizeQuery = (rawQuery = {}, { clientIdFromPath = null } = {}) => {
    const query = { ...rawQuery };
    if (query.s && !query.state) query.state = query.s;
    if (query.n && !query.nonce) query.nonce = query.n;

    const clientId = String(clientIdFromPath || query.client_id || '').trim();
    if (!clientId) {
        return { ok: false, error: 'missing_client_id', missing: ['client_id'] };
    }

    if (clientIdFromPath && query.client_id && String(query.client_id) !== clientId) {
        return { ok: false, error: 'client_id_mismatch' };
    }

    query.client_id = clientId;

    const client = getClient(clientId);
    if (client) {
        delete query.client_name;
        query.client_name = client.display_name;
        if (client.logo_url) query.client_logo_url = client.logo_url;
        if (client.brand) query.client_brand = client.brand;
        if (client.accent) query.client_accent = client.accent;
        if (client.ui_locale && !query.ui_locale) query.ui_locale = client.ui_locale;
        if (!query.mode && client.default_mode) query.mode = client.default_mode;
        if (!query.flow && client.default_flow) query.flow = client.default_flow;
        if (!query.scope && client.default_scope) query.scope = client.default_scope;
    } else if (!query.client_name) {
        query.client_name = clientId;
    }

    const redirectResult = resolveRedirectUri(clientId, query.redirect_uri);
    if (!redirectResult.ok) return redirectResult;
    query.redirect_uri = redirectResult.redirect_uri;

    const required = ['client_id', 'redirect_uri', 'state', 'nonce'];
    const missing = required.filter((key) => !String(query[key] || '').trim());
    if (missing.length > 0) {
        return { ok: false, error: 'invalid_authorization_request', missing };
    }

    if (!isAllowedSl1eRedirectUri(query.redirect_uri, clientId)) {
        return { ok: false, error: 'invalid_redirect_uri' };
    }

    return { ok: true, query, client };
};

module.exports = {
    BUILTIN_CLIENTS,
    reloadClientRegistry,
    getClient,
    isRegisteredClient,
    clientSecret,
    verifyClientSecret,
    resolveRedirectUri,
    isAllowedSl1eRedirectUri,
    normalizeAuthorizeQuery,
    redirectUriMatches,
};
