'use strict';

// Live ceremony parameters (account switch, alias entry, browser hints).
// Must not be frozen into pushed authorization requests (PAR).
const CEREMONY_INTERACTIVE_PARAMS = [
    'alias',
    'display_alias',
    'alias_locale',
    'ui_locale',
    'alias_reservation_owner',
    'identity_hint',
    'login_hint',
    'entity_l1_address',
    'browser_identity_hint',
    'remembered_identity_hint',
    'identity_capsule',
    'sl1e_switch',
];

const ceremonyInteractiveOverlay = (liveQuery = {}) => {
    const overlay = {};
    for (const key of CEREMONY_INTERACTIVE_PARAMS) {
        const value = liveQuery[key];
        if (value !== undefined && value !== null && String(value) !== '') {
            overlay[key] = value;
        }
    }
    return overlay;
};

const stripCeremonyInteractiveParams = (query = {}) => {
    const stored = { ...query };
    for (const key of CEREMONY_INTERACTIVE_PARAMS) {
        delete stored[key];
    }
    return stored;
};

module.exports = {
    CEREMONY_INTERACTIVE_PARAMS,
    ceremonyInteractiveOverlay,
    stripCeremonyInteractiveParams,
};
