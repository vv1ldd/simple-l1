<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Core;
readonly class EngineConfig {
    public function __construct(
        public string $constitutionId,
        public int $precision = 18,
        public string $mathMode = 'int64',
        public int $memoryLimitMb = 64,
        public bool $strictIdentity = true
    ) {}
    public function getHash(): string {
        return hash('sha256', json_encode([$this->constitutionId, $this->precision, $this->mathMode, $this->memoryLimitMb, $this->strictIdentity]));
    }
}
