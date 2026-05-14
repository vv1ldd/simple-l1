<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Identity;
class CanonicalJsonEncoder {
    public function encode(mixed $data): string {
        if (is_array($data)) {
            if ($this->isAssociative($data)) {
                ksort($data, SORT_STRING);
                $parts = [];
                foreach ($data as $key => $value) {
                    $parts[] = $this->encode((string)$key) . ':' . $this->encode($value);
                }
                return '{' . implode(',', $parts) . '}';
            } else {
                $parts = array_map([$this, 'encode'], $data);
                return '[' . implode(',', $parts) . ']';
            }
        }
        if (is_string($data)) return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (is_int($data)) return (string)$data;
        if (is_float($data)) {
            // Keep numeric literal token (no quotes) so it matches JSON number tokens
            // produced by mpo-operator (JS JSON.stringify of numbers).
            return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }
        if (is_bool($data)) return $data ? 'true' : 'false';
        if (is_null($data)) return 'null';
        throw new \InvalidArgumentException("Unsupported type for canonical encoding: " . gettype($data));
    }
    private function isAssociative(array $arr): bool {
        if ([] === $arr) return false;
        return array_keys($arr) !== range(0, count($arr) - 1);
    }
}
