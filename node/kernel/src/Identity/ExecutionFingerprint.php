<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Identity;
use Meanly\Mdk\Kernel\Core\EngineConfig;
readonly class ExecutionFingerprint {
    private string $hash;
    public function __construct(
        public string $constitutionId,
        public EngineConfig $config,
        public string $phpVersion = PHP_VERSION,
        public string $osFamily = PHP_OS_FAMILY,
        public string $arch = PHP_INT_SIZE === 8 ? '64bit' : '32bit'
    ) {
        $this->hash = $this->calculateHash();
    }
    private function calculateHash(): string {
        $data = ['constitution_id' => $this->constitutionId, 'config_hash' => $this->config->getHash(), 'php_version' => $this->phpVersion, 'os_family' => $this->osFamily, 'arch' => $this->arch, 'math_engine' => $this->config->mathMode];
        ksort($data);
        return hash('sha256', json_encode($data));
    }
    public function getHash(): string { return $this->hash; }
}
