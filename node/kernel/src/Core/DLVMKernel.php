<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Core;
use Meanly\Mdk\Kernel\Contracts\StateInterface;
use Meanly\Mdk\Kernel\Identity\ExecutionFingerprint;
class DLVMKernel {
    private StateInterface $state;
    private ExecutionFingerprint $fingerprint;
    private function __construct(private readonly EngineConfig $config, private readonly string $constitutionId) {}
    public static function boot(string $constitutionId, EngineConfig $config, StateInterface $genesisState): KernelResultDescriptor {
        $kernel = new self($config, $constitutionId);
        $kernel->state = $genesisState;
        $kernel->fingerprint = new ExecutionFingerprint($constitutionId, $config);
        
        return new KernelResultDescriptor(
            true, 
            $genesisState->getStateRoot(), 
            $kernel->fingerprint->getHash(), 
            $constitutionId, 
            hash('sha256', 'genesis:' . $genesisState->getStateRoot())
        );
    }

    /**
     * Entry Point: Execute an instruction and return the deterministic result.
     */
    public function execute(
        \Meanly\Mdk\Kernel\Contracts\EventInterface $event,
        callable $reducer
    ): array { // [StateInterface, ExecutionTrace]
        $cycle = new InstructionCycle();
        
        return $cycle->execute($this->state, $event, $reducer);
    }

    public function getState(): StateInterface { return $this->state; }
}
