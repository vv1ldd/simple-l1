<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Core;
use Meanly\Mdk\Kernel\Contracts\StateInterface;
use Meanly\Mdk\Kernel\Identity\CanonicalJsonEncoder;
readonly class BaseState implements StateInterface {
    private string $stateRoot;
    public function __construct(public array $data = []) { $this->stateRoot = $this->calculateStateRoot(); }
    private function calculateStateRoot(): string {
        $encoder = new CanonicalJsonEncoder();
        return hash('sha256', $encoder->encode($this->data));
    }
    public function getStateRoot(): string { return $this->stateRoot; }
    public function toCanonicalArray(): array { return $this->data; }
}
