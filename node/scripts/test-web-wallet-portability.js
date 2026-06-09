#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const identityKernel = require('../identity-kernel');

const stableStringify = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const sha256Hex = (value) => `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;

const controllerBindingHash = (binding) => sha256Hex(stableStringify({
    object_type: binding.object_type,
    version: binding.version,
    entity_l1_address: binding.entity_l1_address,
    controller_key_l1: binding.controller_key_l1,
    credential_id: binding.credential_id,
    credential_public_key: binding.credential_public_key,
    rp_id: binding.rp_id,
    controller_type: binding.controller_type,
    created_at: binding.created_at,
    registration_transcript_hash: binding.registration_transcript_hash,
}));

const identityCapsuleEvidenceHash = (capsule) => sha256Hex(stableStringify({
    protocol: capsule.protocol,
    object_type: capsule.object_type,
    version: capsule.version,
    genesis: capsule.genesis,
    controller_bindings: capsule.controller_bindings,
}));

const entityAddress = 'sl1e_0123456789abcdef0123456789abcdef0123456';
const webPublicKey = '-----BEGIN PUBLIC KEY-----web-passkey-controller-----END PUBLIC KEY-----';
const nativePublicKey = '-----BEGIN PUBLIC KEY-----native-macos-controller-----END PUBLIC KEY-----';
const webKeyAddress = identityKernel.keyAddressFromPublicKey(webPublicKey);
const nativeKeyAddress = identityKernel.keyAddressFromPublicKey(nativePublicKey);

const webBinding = {
    object_type: 'ControllerBinding',
    version: 'identity-controller-binding-v1',
    entity_l1_address: entityAddress,
    controller_key_l1: webKeyAddress,
    key_l1_address: webKeyAddress,
    credential_id: 'cred_web_passkey_001',
    credential_public_key: webPublicKey,
    rp_id: 'localhost',
    controller_type: 'webauthn_passkey',
    transports: ['internal'],
    status: 'active',
    created_at: '2026-06-08T14:55:00.000Z',
    registration_transcript_hash: sha256Hex('web-wallet-genesis-registration'),
};
webBinding.binding_hash = controllerBindingHash(webBinding);

const capsule = {
    protocol: 'simple-l1',
    object_type: 'IdentityCapsule',
    version: 'identity-capsule-v1',
    evidence_role: 'immutable_provenance',
    genesis: {
        entity_l1_address: entityAddress,
        alias: 'alice.sl1.one',
        display_alias: 'alice',
        genesis_timestamp: webBinding.created_at,
        first_controller_key_l1: webKeyAddress,
        genesis_transcript_hash: sha256Hex('web-wallet-genesis-registration'),
    },
    controller_bindings: [webBinding],
};
capsule.evidence_hash = identityCapsuleEvidenceHash(capsule);

const portabilityContract = {
    version: 'meanly-one.identity-portability.v1',
    identity_l1_address: entityAddress,
    invariant: 'identity_address_must_never_change',
    create_identity_semantics: 'add_first_controller',
    native_link_semantics: 'approve_additional_controller',
};

assert.equal(identityKernel.normalizeEntityAddress(capsule.genesis.entity_l1_address), entityAddress);
assert.equal(capsule.controller_bindings[0].entity_l1_address, entityAddress);
assert.equal(capsule.controller_bindings[0].binding_hash, controllerBindingHash(capsule.controller_bindings[0]));
assert.equal(capsule.evidence_hash, identityCapsuleEvidenceHash(capsule));
assert.equal(portabilityContract.identity_l1_address, capsule.genesis.entity_l1_address);
assert.equal(portabilityContract.invariant, 'identity_address_must_never_change');
assert.equal(portabilityContract.create_identity_semantics, 'add_first_controller');

const nativeControllerProposal = {
    proposal_id: 'cbp_native_macos_link_001',
    entity_l1_address: capsule.genesis.entity_l1_address,
    proposed_controller_key_l1_address: nativeKeyAddress,
    controller_type: 'native_macos_p256',
    controller_public_key: nativePublicKey,
    status: 'pending',
    proposal_hash: sha256Hex(stableStringify({
        entity_l1_address: capsule.genesis.entity_l1_address,
        proposed_controller_key_l1_address: nativeKeyAddress,
        controller_type: 'native_macos_p256',
    })),
};

assert.equal(nativeControllerProposal.entity_l1_address, entityAddress);
assert.notEqual(nativeControllerProposal.proposed_controller_key_l1_address, webKeyAddress);

const rejectNativeRootBootstrap = ({ ledgerAccounts, requestedEntityAddress, allowRootBootstrap = false }) => {
    const accountExists = Boolean(ledgerAccounts[requestedEntityAddress]);
    if (!accountExists && !allowRootBootstrap) {
        return {
            ok: false,
            error: 'native_root_identity_bootstrap_disabled',
            invariant: 'identity_address_must_never_change',
            required_flow: 'link_native_controller_to_existing_identity',
        };
    }

    return { ok: true };
};

assert.deepStrictEqual(rejectNativeRootBootstrap({
    ledgerAccounts: {},
    requestedEntityAddress: entityAddress,
}), {
    ok: false,
    error: 'native_root_identity_bootstrap_disabled',
    invariant: 'identity_address_must_never_change',
    required_flow: 'link_native_controller_to_existing_identity',
});

assert.deepStrictEqual(rejectNativeRootBootstrap({
    ledgerAccounts: {
        [entityAddress]: { entity_l1_address: entityAddress },
    },
    requestedEntityAddress: entityAddress,
}), { ok: true });

const approvedControllerBindings = [
    capsule.controller_bindings[0],
    {
        object_type: 'ControllerBinding',
        version: 'identity-controller-binding-v1',
        entity_l1_address: nativeControllerProposal.entity_l1_address,
        controller_key_l1: nativeControllerProposal.proposed_controller_key_l1_address,
        key_l1_address: nativeControllerProposal.proposed_controller_key_l1_address,
        controller_type: nativeControllerProposal.controller_type,
        controller_public_key: nativeControllerProposal.controller_public_key,
        source: 'CONTROLLER_BINDING_APPROVED',
        proposal_id: nativeControllerProposal.proposal_id,
        status: 'active',
        created_at: '2026-06-08T15:00:00.000Z',
    },
];

assert.deepStrictEqual(
    Array.from(new Set(approvedControllerBindings.map((binding) => binding.entity_l1_address))),
    [entityAddress],
);
assert.deepStrictEqual(
    approvedControllerBindings.map((binding) => binding.controller_key_l1 || binding.key_l1_address),
    [webKeyAddress, nativeKeyAddress],
);

console.log('PASS web wallet identity capsule links native controller without rotating sl1e address');
