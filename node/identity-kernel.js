const crypto = require('crypto');

const ENTITY_ADDRESS_VERSION = 'simple-l1:entity:v1';
const KEY_ADDRESS_VERSION = 'simple-l1:passkey-key:v1';

const ENTITY_ADDRESS_PATTERN = /^sl1e_[a-f0-9]{39}$/i;
const KEY_ADDRESS_PATTERN = /^sl1_[a-f0-9]{40}$/i;

function hashHex(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEntityAddress(address) {
    if (typeof address !== 'string') return null;

    const normalized = address.trim().toLowerCase();

    return ENTITY_ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

function normalizeKeyAddress(address) {
    if (typeof address !== 'string') return null;

    const normalized = address.trim().toLowerCase();

    return KEY_ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

function assertEntityAddress(address) {
    const normalized = normalizeEntityAddress(address);

    if (!normalized) {
        throw new Error('entity_l1_address must be an sl1e_ v1 entity address');
    }

    return normalized;
}

function assertKeyAddress(address) {
    const normalized = normalizeKeyAddress(address);

    if (!normalized) {
        throw new Error('proof_key_l1_address must be an sl1_ v1 key address');
    }

    return normalized;
}

function keyAddressFromPublicKey(publicKey) {
    if (!publicKey) throw new Error('publicKey is required to derive an SL1 key address');

    return `sl1_${hashHex(publicKey).slice(0, 40)}`;
}

function newEntityAddress() {
    return `sl1e_${crypto.randomBytes(20).toString('hex').slice(0, 39)}`;
}

function systemEntityAddress(seed) {
    if (!seed) throw new Error('seed is required for system entity address generation');

    return `sl1e_${hashHex(`${ENTITY_ADDRESS_VERSION}:${seed}`).slice(0, 39)}`;
}

function findAccountByKeyAddress(accounts, keyAddress) {
    const normalizedKeyAddress = normalizeKeyAddress(keyAddress);

    if (!normalizedKeyAddress) return null;

    return Object.entries(accounts || {}).find(([, account]) => {
        if (normalizeKeyAddress(account.key_l1_address) === normalizedKeyAddress) {
            return true;
        }

        return (account.keys || []).some((key) => normalizeKeyAddress(key.key_l1_address) === normalizedKeyAddress);
    }) || null;
}

module.exports = {
    ENTITY_ADDRESS_VERSION,
    KEY_ADDRESS_VERSION,
    ENTITY_ADDRESS_PATTERN,
    KEY_ADDRESS_PATTERN,
    normalizeEntityAddress,
    normalizeKeyAddress,
    assertEntityAddress,
    assertKeyAddress,
    keyAddressFromPublicKey,
    newEntityAddress,
    systemEntityAddress,
    findAccountByKeyAddress,
};
