'use strict';

const assert = require('assert');
const { MemoryConnectRuntimeStore } = require('../connect-runtime-store');
const {
    normalizeAuthorizeQuery,
    verifyClientSecret,
    isAllowedSl1eRedirectUri,
} = require('../sl1e-client-registry');
const {
    pushAuthorizeRequest,
    resolveAuthorizeRequestRef,
} = require('../sl1e-authorize-requests');

process.env.SL1_CONNECT_CLIENT_ID = 'meanly.ops';
process.env.SL1_CONNECT_SECRET = 'test-connect-secret';

const store = new MemoryConnectRuntimeStore({ now: () => Date.now() });

const spoofed = normalizeAuthorizeQuery({
    client_id: 'meanly.ops',
    client_name: 'Evil Panel',
    redirect_uri: 'https://ops.meanly.one/auth/sl1/callback',
    state: 'state-1',
    nonce: 'nonce-1',
});
assert.strictEqual(spoofed.ok, true);
assert.strictEqual(spoofed.query.client_name, 'Sovereign Coolify');
assert.notStrictEqual(spoofed.query.client_name, 'Evil Panel');

const pathStyle = normalizeAuthorizeQuery(
    { state: 'state-2', nonce: 'nonce-2' },
    { clientIdFromPath: 'meanly.ops' },
);
assert.strictEqual(pathStyle.ok, true);
assert.strictEqual(pathStyle.query.redirect_uri, 'https://ops.meanly.one/auth/sl1/callback');
assert.strictEqual(pathStyle.query.mode, 'connect');

const shortParams = normalizeAuthorizeQuery(
    { s: 'state-3', n: 'nonce-3' },
    { clientIdFromPath: 'meanly.one' },
);
assert.strictEqual(shortParams.ok, true);
assert.strictEqual(shortParams.query.state, 'state-3');
assert.strictEqual(shortParams.query.redirect_uri, 'https://meanly.one/simple-l1/callback');

const badRedirect = normalizeAuthorizeQuery({
    client_id: 'meanly.ops',
    redirect_uri: 'https://evil.example/callback',
    state: 'state-4',
    nonce: 'nonce-4',
});
assert.strictEqual(badRedirect.ok, false);
assert.strictEqual(badRedirect.error, 'invalid_redirect_uri');

assert.strictEqual(
    isAllowedSl1eRedirectUri('https://meanly.one/simple-l1/callback?popup=1', 'meanly.one'),
    true,
);

const fakeRequest = {
    headers: {},
    body: {
        client_id: 'meanly.ops',
        state: 'state-par',
        nonce: 'nonce-par',
        client_secret: 'wrong-secret',
    },
};
assert.strictEqual(pushAuthorizeRequest(store, fakeRequest).statusCode, 401);

fakeRequest.body.client_secret = 'test-connect-secret';
const pushed = pushAuthorizeRequest(store, fakeRequest);
assert.strictEqual(pushed.statusCode, 201);
assert.match(pushed.payload.request_ref, /^sl1rq_/);

const resolved = resolveAuthorizeRequestRef(store, pushed.payload.request_ref);
assert.strictEqual(resolved.ok, true);
assert.strictEqual(resolved.query.client_id, 'meanly.ops');
assert.strictEqual(resolved.query.client_name, 'Sovereign Coolify');
assert.strictEqual(verifyClientSecret('meanly.ops', 'test-connect-secret'), true);

console.log('PASS sl1e authorize registry + PAR');
