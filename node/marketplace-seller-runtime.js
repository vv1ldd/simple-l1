'use strict';

const crypto = require('crypto');

function ensureSellerStores(ledger) {
    ledger.marketplace_sellers = Array.isArray(ledger.marketplace_sellers) ? ledger.marketplace_sellers : [];
    ledger.marketplace_listings = Array.isArray(ledger.marketplace_listings) ? ledger.marketplace_listings : [];
    return ledger;
}

function slugify(value, fallback = 'seller') {
    const slug = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || fallback;
}

function stableId(prefix, parts, length = 16) {
    return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, length)}`;
}

function normalizeSeller(input = {}, now = new Date()) {
    const displayName = String(input.display_name || input.name || input.store_name || '').trim();
    if (!displayName) {
        const error = new Error('seller display_name is required');
        error.statusCode = 422;
        throw error;
    }

    const identity = String(input.entity_l1_address || input.identity || '').trim() || null;
    const slug = slugify(input.slug || displayName);
    return {
        seller_id: input.seller_id || stableId('seller', { slug, identity }),
        object_type: 'MarketplaceSeller',
        display_name: displayName,
        slug,
        entity_l1_address: identity,
        contact: String(input.contact || '').trim() || null,
        payout_hint: String(input.payout_hint || '').trim() || null,
        categories: Array.isArray(input.categories) ? input.categories.map(String).slice(0, 8) : [],
        status: String(input.status || 'draft').toLowerCase(),
        created_at: input.created_at || now.toISOString(),
        updated_at: now.toISOString(),
        activation: {
            state: 'not_ready',
            checklist: {
                identity_ready: Boolean(identity),
                profile_ready: true,
                listing_ready: false,
                payout_ready: Boolean(input.payout_hint),
            },
        },
    };
}

function normalizeListing(input = {}, now = new Date()) {
    const sellerId = String(input.seller_id || '').trim();
    const title = String(input.title || input.name || '').trim();
    if (!sellerId || !title) {
        const error = new Error('seller_id and title are required');
        error.statusCode = 422;
        throw error;
    }

    const price = String(input.price || '').trim();
    const currency = String(input.currency || 'USD').trim().toUpperCase();
    return {
        listing_id: input.listing_id || stableId('listing', { sellerId, title, price, currency }),
        object_type: 'MarketplaceListing',
        seller_id: sellerId,
        title,
        description: String(input.description || '').trim(),
        category: String(input.category || 'digital').trim(),
        price,
        currency,
        delivery_mode: String(input.delivery_mode || 'manual').trim(),
        status: String(input.status || 'draft').toLowerCase(),
        created_at: input.created_at || now.toISOString(),
        updated_at: now.toISOString(),
    };
}

function upsertByKey(items, key, item) {
    const index = items.findIndex((candidate) => candidate[key] === item[key]);
    if (index === -1) {
        items.push(item);
    } else {
        items[index] = { ...items[index], ...item };
    }
    return item;
}

function refreshSellerActivation(ledger, sellerId, now = new Date()) {
    ensureSellerStores(ledger);
    const seller = ledger.marketplace_sellers.find((candidate) => candidate.seller_id === sellerId);
    if (!seller) return null;

    const listings = ledger.marketplace_listings.filter((listing) => listing.seller_id === sellerId);
    const checklist = {
        identity_ready: Boolean(seller.entity_l1_address),
        profile_ready: Boolean(seller.display_name && seller.slug),
        listing_ready: listings.some((listing) => listing.status === 'active' || listing.status === 'draft'),
        payout_ready: Boolean(seller.payout_hint),
    };
    const ready = Object.values(checklist).every(Boolean);
    seller.activation = {
        state: ready ? 'ready_to_launch' : 'needs_setup',
        checklist,
        checked_at: now.toISOString(),
    };
    seller.status = ready && seller.status === 'draft' ? 'ready' : seller.status;
    seller.updated_at = now.toISOString();
    return seller;
}

function activateSeller(ledger, sellerId, now = new Date()) {
    const seller = refreshSellerActivation(ledger, sellerId, now);
    if (!seller) {
        const error = new Error('seller_not_found');
        error.statusCode = 404;
        throw error;
    }
    if (seller.activation.state !== 'ready_to_launch') {
        const error = new Error('seller_not_ready');
        error.statusCode = 422;
        error.activation = seller.activation;
        throw error;
    }
    seller.status = 'active';
    seller.activated_at = now.toISOString();
    seller.updated_at = now.toISOString();
    return seller;
}

function sellerSummary(ledger) {
    ensureSellerStores(ledger);
    const listingsBySeller = ledger.marketplace_listings.reduce((acc, listing) => {
        acc[listing.seller_id] = (acc[listing.seller_id] || 0) + 1;
        return acc;
    }, {});
    return ledger.marketplace_sellers
        .slice()
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .map((seller) => ({
            ...seller,
            listing_count: listingsBySeller[seller.seller_id] || 0,
        }));
}

module.exports = {
    activateSeller,
    ensureSellerStores,
    normalizeListing,
    normalizeSeller,
    refreshSellerActivation,
    sellerSummary,
    upsertByKey,
};
