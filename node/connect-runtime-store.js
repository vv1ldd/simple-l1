'use strict';

class MemoryConnectRuntimeStore {
    constructor({ now = () => Date.now() } = {}) {
        this.now = now;
        this.collections = {
            authorizationCodes: new Map(),
            proofTokens: new Map(),
            authChallenges: new Map(),
            registrationChallenges: new Map(),
            deviceHandoffs: new Map(),
            devicePairings: new Map(),
            aliasReservations: new Map(),
            rateLimits: new Map(),
            consumedProofs: new Map(),
        };
    }

    collection(name) {
        const collection = this.collections[name];
        if (!collection) throw new Error(`UNKNOWN_CONNECT_STORE_COLLECTION:${name}`);
        return collection;
    }

    set(name, key, record) {
        this.collection(name).set(String(key), record);
        return record;
    }

    get(name, key) {
        const normalizedKey = String(key || '');
        if (!normalizedKey) return null;
        const collection = this.collection(name);
        const record = collection.get(normalizedKey);
        if (!record) return null;
        if (this.isExpired(record)) {
            collection.delete(normalizedKey);
            return null;
        }
        return record;
    }

    delete(name, key) {
        return this.collection(name).delete(String(key || ''));
    }

    consume(name, key) {
        const normalizedKey = String(key || '');
        const record = this.get(name, normalizedKey);
        if (record) this.delete(name, normalizedKey);
        return record;
    }

    entries(name) {
        const collection = this.collection(name);
        return [...collection.entries()].filter(([key, record]) => {
            if (!this.isExpired(record)) return true;
            collection.delete(key);
            return false;
        });
    }

    isExpired(record) {
        return Boolean(record?.expiresAtMs && record.expiresAtMs <= this.now());
    }

    cleanup(onExpire = {}) {
        for (const [name, collection] of Object.entries(this.collections)) {
            for (const [key, record] of collection.entries()) {
                if (!this.isExpired(record)) continue;
                if (typeof onExpire[name] === 'function') onExpire[name](key, record);
                collection.delete(key);
            }
        }
    }

    incrementRateLimit(bucket, { limit, windowMs }) {
        const key = String(bucket || '');
        const now = this.now();
        const current = this.get('rateLimits', key);
        const record = current || { count: 0, expiresAtMs: now + windowMs };
        record.count += 1;
        this.set('rateLimits', key, record);
        return {
            allowed: record.count <= limit,
            remaining: Math.max(0, limit - record.count),
            resetAtMs: record.expiresAtMs,
        };
    }

    markProofConsumed(proofId, expiresAtMs) {
        if (!proofId) return false;
        if (this.get('consumedProofs', proofId)) return false;
        this.set('consumedProofs', proofId, { expiresAtMs });
        return true;
    }
}

module.exports = {
    MemoryConnectRuntimeStore,
};
