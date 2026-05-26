'use strict';

/**
 * SIMPLE-L1 Settlement Event Bus
 *
 * Transforms Simple L1 from a request/response node
 * into an event-driven constitutional machine.
 *
 * Every settlement event is:
 *   1. Emitted to all local subscribers (in-process)
 *   2. Stored in a persistent event stream (ledger.settlement_events)
 *   3. Broadcast to network peers (gossip)
 *   4. Available for polling via API
 *
 * Event types:
 *   INTENT_CREATED           — New deposit/withdrawal intent registered
 *   INTENT_OBSERVED          — External tx seen, awaiting confirmations
 *   INTENT_FULFILLED         — Constitutional acceptance, ledger mutated
 *   INTENT_REJECTED          — Proof failed, intent discarded
 *   INTENT_EXPIRED           — TTL exceeded
 *   SETTLEMENT_SEEN          — Raw external tx observed (no intent binding)
 *   SETTLEMENT_CONFIRMED     — Confirmation threshold reached
 *   SETTLEMENT_FINALIZED     — Canonical finality reached for this network
 */

const EventEmitter = require('events');
const crypto       = require('crypto');

class SettlementEventBus extends EventEmitter {
    /**
     * @param {object} ledger     - Reference to the live ledger
     * @param {Function} broadcast - Async broadcast(path, payload) helper from server.js
     */
    constructor(ledger, broadcast = null) {
        super();
        this.ledger    = ledger;
        this.broadcast = broadcast;

        if (!this.ledger.settlement_events) {
            this.ledger.settlement_events = [];
        }

        // Wire internal event types to structured handlers
        this._wireInternalHandlers();
    }

    // -----------------------------------------------------------------------
    // Core emit — all events flow through here
    // -----------------------------------------------------------------------

    /**
     * Emit a structured settlement event.
     *
     * @param {object} payload
     * @param {string} payload.type        - Event type constant
     * @param {string} [payload.intent_id] - Related intent (if any)
     * @param {string} [payload.network]   - External network
     * @param {string} [payload.tx_hash]   - External tx hash
     * @param {*}      [payload.*]         - Additional type-specific fields
     */
    emit(payload) {
        const event = {
            event_id:   crypto.randomBytes(6).toString('hex'),
            type:       payload.type,
            timestamp:  new Date().toISOString(),
            ...payload,
        };

        // 1. Persist to ledger stream (bounded ring buffer — keep last 1000)
        this.ledger.settlement_events.push(event);
        if (this.ledger.settlement_events.length > 1000) {
            this.ledger.settlement_events.shift();
        }

        // 2. Emit on Node.js EventEmitter for local subscribers
        super.emit(event.type, event);
        super.emit('*', event);  // Wildcard channel

        // 3. Broadcast critical events to network peers
        if (this._shouldBroadcast(event.type) && this.broadcast) {
            this.broadcast('/api/network/settlement-event', { event }).catch(() => {});
        }

        return event;
    }

    // -----------------------------------------------------------------------
    // Convenience emitters for each event type
    // -----------------------------------------------------------------------

    settlementSeen({ network, tx_hash, from, to, amount, asset }) {
        return this.emit({
            type: 'SETTLEMENT_SEEN',
            network, tx_hash, from, to, amount, asset,
        });
    }

    settlementConfirmed({ network, tx_hash, intent_id, amount, asset, confirmations }) {
        return this.emit({
            type: 'SETTLEMENT_CONFIRMED',
            network, tx_hash, intent_id, amount, asset, confirmations,
        });
    }

    settlementFinalized({ network, tx_hash, intent_id, amount, asset, block_number }) {
        return this.emit({
            type: 'SETTLEMENT_FINALIZED',
            network, tx_hash, intent_id, amount, asset, block_number,
        });
    }

    // -----------------------------------------------------------------------
    // Subscription helpers (typed)
    // -----------------------------------------------------------------------

    /**
     * Subscribe to all events of a specific type.
     *
     * @param {string} type
     * @param {Function} handler
     */
    on(type, handler) {
        return super.on(type, handler);
    }

    /**
     * Subscribe to all settlement events (wildcard).
     *
     * @param {Function} handler
     */
    onAny(handler) {
        return super.on('*', handler);
    }

    // -----------------------------------------------------------------------
    // Polling API helpers
    // -----------------------------------------------------------------------

    /**
     * Get recent settlement events, optionally filtered.
     *
     * @param {object} filters
     * @param {string}   [filters.type]      - Filter by event type
     * @param {string}   [filters.network]   - Filter by network
     * @param {string}   [filters.intent_id] - Filter by intent
     * @param {number}   [filters.limit=50]  - Max results
     * @returns {object[]}
     */
    getRecentEvents({ type, network, intent_id, limit = 50 } = {}) {
        let events = [...this.ledger.settlement_events].reverse();

        if (type)      events = events.filter(e => e.type === type);
        if (network)   events = events.filter(e => e.network === network);
        if (intent_id) events = events.filter(e => e.intent_id === intent_id);

        return events.slice(0, limit);
    }

    /**
     * Get all events for a specific intent_id in chronological order.
     *
     * @param {string} intent_id
     * @returns {object[]}
     */
    getIntentTimeline(intent_id) {
        return this.ledger.settlement_events
            .filter(e => e.intent_id === intent_id)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    /**
     * Get event stream statistics.
     *
     * @returns {object}
     */
    getStats() {
        const events = this.ledger.settlement_events;
        const byType = events.reduce((acc, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
        }, {});

        return {
            total_events:    events.length,
            by_type:         byType,
            oldest_event:    events[0]?.timestamp || null,
            newest_event:    events[events.length - 1]?.timestamp || null,
            subscriber_count: this.listenerCount('*'),
        };
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _wireInternalHandlers() {
        // Log all events at startup
        this.onAny(event => {
            const icon = this._icon(event.type);
            const intentPart = event.intent_id ? ` intent=${event.intent_id.slice(0, 8)}…` : '';
            const networkPart = event.network ? ` net=${event.network}` : '';
            console.log(`[EVENT BUS] ${icon} ${event.type}${intentPart}${networkPart} @ ${event.event_id}`);
        });

        // Auto-upgrade SETTLEMENT_CONFIRMED → SETTLEMENT_FINALIZED
        // when a network's finality threshold is reached (placeholder for network-specific logic)
        this.on('SETTLEMENT_CONFIRMED', event => {
            // EVM finality thresholds (simplified)
            const FINALITY = { ethereum: 12, base: 6, arbitrum: 1, polygon: 30, bsc: 15, optimism: 1 };
            const threshold = FINALITY[event.network];
            if (threshold && event.confirmations >= threshold) {
                // Small delay to allow CONFIRMED event handlers to complete first
                setImmediate(() => {
                    this.settlementFinalized({
                        network:      event.network,
                        tx_hash:      event.tx_hash,
                        intent_id:    event.intent_id,
                        amount:       event.amount,
                        asset:        event.asset,
                        block_number: event.block_number,
                    });
                });
            }
        });
    }

    _shouldBroadcast(type) {
        // Only broadcast high-value events to peers
        return ['INTENT_FULFILLED', 'INTENT_REJECTED', 'SETTLEMENT_FINALIZED'].includes(type);
    }

    _icon(type) {
        const icons = {
            INTENT_CREATED:          '📋',
            INTENT_OBSERVED:         '👁️',
            INTENT_FULFILLED:        '✅',
            INTENT_REJECTED:         '❌',
            INTENT_EXPIRED:          '⏰',
            SETTLEMENT_SEEN:         '🔍',
            SETTLEMENT_CONFIRMED:    '🔒',
            SETTLEMENT_FINALIZED:    '⚖️',
        };
        return icons[type] || '📡';
    }
}

module.exports = { SettlementEventBus };
