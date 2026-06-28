'use strict';

const assert = require('assert');
const { attachRealmEventHashChain, latestRealmEventHash } = require('../realm-event-history');
const { eventLogHead, runtimeCausalityEvidence } = require('../runtime-status');

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
assert.strictEqual(evidence.history_head_kind, 'realm_event_hash');
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
    history_head_kind: null,
    last_transition: null,
});

const legacyEvent = {
    id: 'provadm_legacy',
    type: 'ACCOUNT_PROVENANCE_ADMISSION',
    timestamp: '2026-06-27T00:02:00.000Z',
    payload: {
        account: 'entity:legacy-admin',
        account_state: { entity_l1_address: 'entity:legacy-admin' },
    },
};
const legacyEvidence = runtimeCausalityEvidence([legacyEvent]);
assert.strictEqual(legacyEvidence.history_head, eventLogHead([legacyEvent]));
assert.strictEqual(legacyEvidence.history_head_kind, 'event_log_hash');
assert.deepStrictEqual(legacyEvidence.last_transition, {
    type: 'ACCOUNT_PROVENANCE_ADMISSION',
    id: 'provadm_legacy',
    timestamp: '2026-06-27T00:02:00.000Z',
    sequence: null,
    current_event_hash: null,
});

console.log('PASS runtime status exposes causality without verifier claims');
