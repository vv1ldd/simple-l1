<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Contracts;
interface EventInterface {
    public function getEventId(): string;
    public function getTimestamp(): int;
    public function getPreviousHash(): string;
    public function getType(): string;
    public function getPayload(): array;
    public function getHash(): string;
}
