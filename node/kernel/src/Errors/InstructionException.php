<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Errors;

/**
 * Axiom: InstructionException is the base class for deterministic VM failures.
 * Used to signal "Math Divergence" or "Constitutional Violations".
 */
class InstructionException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode = 'VM_EXECUTION_FAILURE',
        public readonly array $context = []
    ) {
        parent::__construct($message);
    }
}
