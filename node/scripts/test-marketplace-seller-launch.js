#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
    activateSeller,
    ensureSellerStores,
    normalizeListing,
    normalizeSeller,
    refreshSellerActivation,
    upsertByKey,
} = require('../marketplace-seller-runtime');

const ledger = {};
const now = new Date('2026-06-06T23:20:00.000Z');

ensureSellerStores(ledger);
const seller = normalizeSeller({
    display_name: 'Launch Seller',
    entity_l1_address: 'sl1e_51c73d5f1e070dc8153eec313c0834599e6e7b3',
    payout_hint: 'manual-payout-ready',
}, now);
upsertByKey(ledger.marketplace_sellers, 'seller_id', seller);

let checked = refreshSellerActivation(ledger, seller.seller_id, now);
assert.strictEqual(checked.activation.state, 'needs_setup');
assert.strictEqual(checked.activation.checklist.identity_ready, true);
assert.strictEqual(checked.activation.checklist.listing_ready, false);

assert.throws(() => activateSeller(ledger, seller.seller_id, now), /seller_not_ready/);

const listing = normalizeListing({
    seller_id: seller.seller_id,
    title: 'Digital product launch item',
    price: '25.00',
    currency: 'USD',
}, now);
upsertByKey(ledger.marketplace_listings, 'listing_id', listing);

checked = refreshSellerActivation(ledger, seller.seller_id, now);
assert.strictEqual(checked.activation.state, 'ready_to_launch');

const activated = activateSeller(ledger, seller.seller_id, now);
assert.strictEqual(activated.status, 'active');
assert.ok(activated.activated_at);

console.log('PASS marketplace seller launch runtime activates ready sellers and blocks incomplete sellers');
