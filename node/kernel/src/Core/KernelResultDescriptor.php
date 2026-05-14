<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Core;
readonly class KernelResultDescriptor {
    public function __construct(
        public bool $success,
        public string $stateRoot,
        public string $executionFingerprint,
        public string $constitutionId,
        public string $checkpointHash,
        public ?string $errorMessage = null,
        public array $metadata = []
    ) {}
}
