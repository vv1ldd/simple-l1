<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Contracts;
interface StateInterface {
    public function getStateRoot(): string;
    public function toCanonicalArray(): array;
}
