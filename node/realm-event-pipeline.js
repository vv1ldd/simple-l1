'use strict';

const {
    applyAuthorityEvent,
    ensureAuthorityStateStores,
    isCanonicalRealmEvent,
    rebuildAuthorityStateOnLedger,
} = require('./current-authority-state');
const { acceptRealmEventProposal } = require('./realm-event-validator');

function applyCanonicalAuthorityProjection(ledger, event) {
    ensureAuthorityStateStores(ledger);
    if (!isCanonicalRealmEvent(event)) return ledger.current_authority_state;
    ledger.current_authority_state = applyAuthorityEvent(ledger.current_authority_state, event);
    ledger.realm_canonical_sequence = ledger.current_authority_state.lastSequence || ledger.realm_canonical_sequence;
    return ledger.current_authority_state;
}

function acceptAndApplyRealmEvent(ledger, proposal, { applyEvent, skipSequenceCheck = false } = {}) {
    if (typeof applyEvent !== 'function') {
        throw new Error('applyEvent callback is required');
    }

    const accepted = acceptRealmEventProposal(ledger, proposal, { skipSequenceCheck });
    if (!accepted.ok) {
        return accepted;
    }

    applyEvent(accepted.event, false);
    return accepted;
}

module.exports = {
    applyCanonicalAuthorityProjection,
    acceptAndApplyRealmEvent,
    rebuildAuthorityStateOnLedger,
};
