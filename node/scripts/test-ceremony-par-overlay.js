'use strict';

const assert = require('assert');
const { MemoryConnectRuntimeStore } = require('../connect-runtime-store');
const { pushAuthorizeRequest } = require('../sl1e-authorize-requests');
const {
    ceremonyInteractiveOverlay,
    stripCeremonyInteractiveParams,
} = require('../sl1e-ceremony-params');

process.env.SL1_CONNECT_CLIENT_ID = 'meanly.ops';
process.env.SL1_CONNECT_SECRET = 'test-connect-secret';

const store = new MemoryConnectRuntimeStore({ now: () => Date.now() });
const pushed = pushAuthorizeRequest(store, {
    headers: { authorization: 'Bearer test-connect-secret' },
    body: {
        client_id: 'meanly.ops',
        redirect_uri: 'https://ops.meanly.one/auth/sl1/callback',
        state: 'state-par',
        nonce: 'nonce-par',
        flow: 'connect',
        identity_hint: 'sl1e_bound_account_should_not_freeze',
    },
});

assert.strictEqual(pushed.statusCode, 201);

const stored = store.get('authorizeRequests', pushed.payload.request_ref);
assert.strictEqual(stored.query.identity_hint, undefined, 'PAR must not freeze identity_hint');

const resolvedQuery = { ...stored.query };
const liveQuery = {
    request_ref: pushed.payload.request_ref,
    identity_hint: 'sl1e_user_selected_account',
    sl1e_switch: '1',
};

const frozenParQuery = {
    ...resolvedQuery,
    identity_hint: 'sl1e_bound_account_should_not_freeze',
};
const wrongMergeWithFrozen = {
    ...ceremonyInteractiveOverlay(liveQuery),
    ...frozenParQuery,
};
assert.strictEqual(
    wrongMergeWithFrozen.identity_hint,
    'sl1e_bound_account_should_not_freeze',
    'wrong merge lets frozen PAR identity_hint override live choice',
);

const correctMerge = {
    ...frozenParQuery,
    ...ceremonyInteractiveOverlay(liveQuery),
    request_ref: pushed.payload.request_ref,
};
assert.strictEqual(
    correctMerge.identity_hint,
    'sl1e_user_selected_account',
    'interactive overlay must win over stored PAR fields',
);
assert.strictEqual(correctMerge.client_id, 'meanly.ops');
assert.strictEqual(correctMerge.state, 'state-par');

assert.deepStrictEqual(
    stripCeremonyInteractiveParams({
        client_id: 'coolify.sovereign',
        identity_hint: 'x',
        sl1e_switch: '1',
        state: 's',
    }),
    { client_id: 'coolify.sovereign', state: 's' },
);

console.log('PASS ceremony PAR interactive overlay');
