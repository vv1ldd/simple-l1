'use strict';

/**
 * SIMPLE-L1 Intent State Machine
 *
 * Explicit constitutional lifecycle for every cross-chain intent.
 * All transitions are guarded — illegal transitions throw.
 *
 * States:
 *   CREATED   → Intent registered, deposit address derived
 *   BOUND     → External network activity mapped to this intent
 *   OBSERVED  → External tx seen, confirmations accumulating
 *   VERIFIED  → Confirmation threshold met, awaiting attestations
 *   ATTESTED  → Quorum of validators confirmed legitimacy
 *   FULFILLED → Ledger mutation committed (canonical state)
 *   FINALIZED → Receipt issued, intent permanently closed
 *   DISPUTED  → Constitutional challenge raised (any stage)
 *   EXPIRED   → TTL exceeded without fulfillment
 *   REVERTED  → Post-fulfillment settlement failure
 */

// ---------------------------------------------------------------------------
// State constants
// ---------------------------------------------------------------------------
const STATES = Object.freeze({
    CREATED:   'CREATED',
    BOUND:     'BOUND',
    OBSERVED:  'OBSERVED',
    VERIFIED:  'VERIFIED',
    ATTESTED:  'ATTESTED',
    FULFILLED: 'FULFILLED',
    FINALIZED: 'FINALIZED',
    DISPUTED:  'DISPUTED',
    EXPIRED:   'EXPIRED',
    REVERTED:  'REVERTED',
});

// ---------------------------------------------------------------------------
// Allowed transition graph
// ---------------------------------------------------------------------------
const TRANSITIONS = {
    CREATED:   ['BOUND', 'EXPIRED', 'DISPUTED'],
    BOUND:     ['OBSERVED', 'EXPIRED', 'DISPUTED'],
    OBSERVED:  ['VERIFIED', 'EXPIRED', 'DISPUTED'],
    VERIFIED:  ['ATTESTED', 'EXPIRED', 'DISPUTED'],
    ATTESTED:  ['FULFILLED', 'DISPUTED'],
    FULFILLED: ['FINALIZED', 'DISPUTED', 'REVERTED'],
    FINALIZED: ['DISPUTED'],          // Final — can only be disputed
    DISPUTED:  ['FULFILLED', 'EXPIRED', 'REVERTED'],  // Dispute can resolve either way
    EXPIRED:   [],                    // Terminal
    REVERTED:  [],                    // Terminal
};

// Terminal states — no further transitions possible (except DISPUTED from FINALIZED)
const TERMINAL_STATES = new Set(['EXPIRED', 'REVERTED']);

// States that allow ledger mutation
const MUTABLE_STATES = new Set(['ATTESTED']);

// ---------------------------------------------------------------------------
// IntentStateMachine
// ---------------------------------------------------------------------------
class IntentStateMachine {
    /**
     * Transition an intent to a new state.
     *
     * @param {object} intent       - The intent record (mutated in place)
     * @param {string} nextState    - Target state
     * @param {object} [metadata]  - Transition metadata (reason, actor, evidence)
     * @returns {object}            - The updated intent
     * @throws {Error}              - If the transition is illegal
     */
    static transition(intent, nextState, metadata = {}) {
        const current = intent.state;

        if (!STATES[nextState]) {
            throw new Error(`[StateMachine] Unknown state: "${nextState}"`);
        }

        const allowed = TRANSITIONS[current] || [];
        if (!allowed.includes(nextState)) {
            throw new Error(
                `[StateMachine] Illegal transition: ${current} → ${nextState} ` +
                `(allowed from ${current}: [${allowed.join(', ')}])`
            );
        }

        // Record transition in history
        if (!intent.state_history) intent.state_history = [];
        intent.state_history.push({
            from:        current,
            to:          nextState,
            at:          new Date().toISOString(),
            ...metadata,
        });

        intent.state         = nextState;
        intent.state_updated = new Date().toISOString();

        return intent;
    }

    /**
     * Check if a transition is allowed without mutating.
     */
    static canTransition(intent, nextState) {
        return (TRANSITIONS[intent.state] || []).includes(nextState);
    }

    /**
     * Check if the intent is in a terminal state.
     */
    static isTerminal(intent) {
        return TERMINAL_STATES.has(intent.state);
    }

    /**
     * Check if the intent is ready for ledger mutation.
     */
    static isReadyForMutation(intent) {
        return MUTABLE_STATES.has(intent.state);
    }

    /**
     * Get allowed next states for an intent.
     */
    static allowedTransitions(intent) {
        return TRANSITIONS[intent.state] || [];
    }

    /**
     * Get a human-readable description of the current state.
     */
    static describe(state) {
        const descriptions = {
            CREATED:   'Intent registered. Deterministic deposit address derived.',
            BOUND:     'External network activity mapped to this intent.',
            OBSERVED:  'External transaction detected. Confirmations accumulating.',
            VERIFIED:  'Confirmation threshold reached. Awaiting validator attestations.',
            ATTESTED:  'Quorum of validators confirmed legitimacy. Ready for fulfillment.',
            FULFILLED: 'Ledger mutation committed. Settlement accepted.',
            FINALIZED: 'Receipt issued. Intent permanently closed.',
            DISPUTED:  'Constitutional challenge raised. Under review.',
            EXPIRED:   'TTL exceeded without fulfillment.',
            REVERTED:  'Post-fulfillment settlement failure. Ledger corrected.',
        };
        return descriptions[state] || 'Unknown state';
    }

    /**
     * Get constitutional weight of a state (for UX display).
     */
    static weight(state) {
        const weights = {
            CREATED:   0,
            BOUND:     1,
            OBSERVED:  2,
            VERIFIED:  3,
            ATTESTED:  4,
            FULFILLED: 5,
            FINALIZED: 6,
            DISPUTED:  -1,
            EXPIRED:   -2,
            REVERTED:  -3,
        };
        return weights[state] ?? 0;
    }
}

module.exports = { IntentStateMachine, STATES, TRANSITIONS };
