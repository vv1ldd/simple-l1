<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Core;

/**
 * Axiom: Receipt is a deterministic proof of a single transition step.
 * It contains the balance shifts and the cryptographic seal.
 */
readonly class Receipt
{
    public function __construct(
        public string $instructionId,
        public string $status,
        public array $delta, // [path => amount]
        public string $nonce,
        public string $seal
    ) {}
}

/**
 * Axiom: ExecutionTrace is the deterministic projection of the VM execution path.
 * It is a pure output object, used as the substrate for proof generation.
 */
readonly class ExecutionTrace
{
    public function __construct(
        public string $parentRoot,
        public string $newRoot,
        public array $receipts, // array<Receipt>
        public array $signals,  // Public signals for ZK systems
        public int $computeCost
    ) {}
}
