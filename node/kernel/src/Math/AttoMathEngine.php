<?php
declare(strict_types=1);
namespace Meanly\Mdk\Kernel\Math;
class AttoMathEngine {
    private const SCALE = '1000000000000000000';
    public function multiply(string $a, string $b): string {
        $mul = gmp_mul($a, $b);
        $res = gmp_div($mul, self::SCALE);
        return gmp_strval($res);
    }
    public function divide(string $a, string $b): string {
        if ($b === '0') throw new \ArithmeticError("Division by zero.");
        $num = gmp_mul($a, self::SCALE);
        $res = gmp_div($num, $b);
        return gmp_strval($res);
    }
    public function add(string $a, string $b): string { return gmp_strval(gmp_add($a, $b)); }
    public function subtract(string $a, string $b): string { return gmp_strval(gmp_sub($a, $b)); }
}
