<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Core;

use Meanly\Mdk\Kernel\Contracts\StateInterface;
use Meanly\Mdk\Kernel\Contracts\EventInterface;
use Meanly\Mdk\Kernel\Identity\CanonicalJsonEncoder;
use Meanly\Mdk\Kernel\Errors\InstructionException;

/**
 * Axiom: InstructionCycle (δ function) v1.1.
 * Operation: (State, Event) -> (State', Trace)
 */
class InstructionCycle
{
    private CanonicalJsonEncoder $encoder;

    public function __construct()
    {
        $this->encoder = new CanonicalJsonEncoder();
    }

    /**
     * Executes a deterministic transition and returns the trace.
     */
    public function execute(
        StateInterface $currentState,
        EventInterface $event,
        callable $reducer
    ): array { // [StateInterface, ExecutionTrace]
        
        $oldRoot = $currentState->getStateRoot();
        
        // 1. Chain Validation
        if ($event->getPreviousHash() !== $oldRoot) {
            throw new InstructionException("Chain Divergence: Event is orphaned.");
        }

        // 2. State Transition (δ)
        /** @var StateInterface $newState */
        $newState = $reducer($currentState, $event);

        if ($newState === $currentState) {
            throw new InstructionException("Mutation Invariant Violation: State remains same.");
        }

        $newRoot = $newState->getStateRoot();

        // 3. Trace Emission (Pure Projection)
        $trace = new ExecutionTrace(
            parentRoot: $oldRoot,
            newRoot: $newRoot,
            receipts: [
                new Receipt(
                    instructionId: $event->getEventId(),
                    status: 'SUCCESS',
                    delta: $event->getPayload(), // Simplified for v1.1
                    nonce: (string)$event->getTimestamp(),
                    seal: $event->getHash()
                )
            ],
            signals: [
                'event_type' => $event->getType(),
                'timestamp'  => $event->getTimestamp()
            ],
            computeCost: 1 // Deterministic gas/cycle cost
        );

        return [$newState, $trace];
    }
}
