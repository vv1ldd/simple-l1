'use strict';

const crypto = require('crypto');

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }

    if (typeof value === 'string') {
        return value.normalize('NFC');
    }

    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key.normalize('NFC')] = canonicalize(value[key]);
            return acc;
        }, {});
    }

    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function hashObject(value) {
    return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function artifactId(prefix, value, length = 24) {
    return `${prefix}_${hashObject(value).slice(0, length)}`;
}

function ensureArrayStore(ledger, key) {
    if (!Array.isArray(ledger[key])) {
        ledger[key] = [];
    }

    return ledger[key];
}

function upsertById(collection, artifact) {
    const index = collection.findIndex((entry) => entry.id === artifact.id);
    if (index >= 0) {
        collection[index] = artifact;
    } else {
        collection.push(artifact);
    }

    return artifact;
}

module.exports = {
    artifactId,
    canonicalJson,
    ensureArrayStore,
    hashObject,
    upsertById,
};
