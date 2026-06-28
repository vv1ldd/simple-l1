'use strict';

const assert = require('assert');
const { attachRealmEventHashChain, latestRealmEventHash } = require('../realm-event-history');
const { runtimeCausalityEvidence } = require('../runtime-status');

const first = attachRealmEventHashChain({
    realm_event: true,
    type: 'ROOT_AUTHORITY_CREATED',
    sequence: 1,
    signer: 'root',
    authority_reference: 'root',
    timestamp: '2026-06-27T00:00:00.000Z',
    payload: { root_id: 'root', public_key: 'pk-root' },
});

const second = attachRealmEventHashChain({
    realm_event: true,
    type: 'ACCOUNT_PROVENANCE_ADMISSION',
    sequence: 2,
    signer: 'root',
    authority_reference: 'root',
    timestamp: '2026-06-27T00:01:00.000Z',
    payload: {
        account: 'entity:admin',
        account_state: { entity_l1_address: 'entity:admin' },
    },
}, first.current_event_hash);

const evidence = runtimeCausalityEvidence([first, second]);

assert.strictEqual(evidence.history_head, latestRealmEventHash([first, second]));
assert.deepStrictEqual(evidence.last_transition, {
    type: 'ACCOUNT_PROVENANCE_ADMISSION',
    id: second.event_id,
    timestamp: '2026-06-27T00:01:00.000Z',
    sequence: 2,
    current_event_hash: second.current_event_hash,
});

assert.ok(!Object.prototype.hasOwnProperty.call(evidence, 'semantic_health'));
assert.ok(!Object.prototype.hasOwnProperty.call(evidence, 'shadow_verify'));
assert.ok(!Object.prototype.hasOwnProperty.call(evidence, 'conformance'));

const empty = runtimeCausalityEvidence([]);
assert.deepStrictEqual(empty, {
    history_head: null,
    last_transition: null,
});

console.log('PASS runtime status exposes causality without verifier claims');
