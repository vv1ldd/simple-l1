<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Crypto\Poseidon;

use GMP;

/**
 * Axiom: PoseidonEngine implements the Hades permutation for ZK-snark compatibility.
 * Strictly deterministic, stateless, and environment-independent.
 */
class PoseidonEngine
{
    private GMP $p;
    private int $alpha = 5;

    public function __construct()
    {
        $this->p = gmp_init(PoseidonConstants::FIELD_PRIME);
    }

    /**
     * Hashes multiple field elements into a single element.
     */
    public function hash(array $inputs): string
    {
        // Initial state seeded with protocol capacity
        $state = [gmp_init(PoseidonConstants::PROTOCOL_ID)];
        
        foreach ($inputs as $input) {
            $state[] = $this->toFp($input);
        }

        $t = count($state);
        $Rf = PoseidonConstants::T3_Rf; // Simplified for v1.0
        $Rp = $t === 3 ? PoseidonConstants::T3_Rp : PoseidonConstants::T5_Rp;

        // Hades Permutation
        for ($i = 0; $i < $Rf / 2; $i++) $this->fullRound($state, $i);
        for ($i = $Rf / 2; $i < $Rf / 2 + $Rp; $i++) $this->partialRound($state, $i);
        for ($i = $Rf / 2 + $Rp; $i < $Rf + $Rp; $i++) $this->fullRound($state, $i);

        return gmp_strval($state[0]);
    }

    private function fullRound(array &$state, int $roundIndex): void
    {
        foreach ($state as $i => &$val) {
            $val = gmp_mod(gmp_add($val, $this->getConstant($roundIndex, $i)), $this->p);
            $val = gmp_powm($val, gmp_init($this->alpha), $this->p);
        }
        $state = $this->applyMds($state);
    }

    private function partialRound(array &$state, int $roundIndex): void
    {
        foreach ($state as $i => &$val) {
            $val = gmp_mod(gmp_add($val, $this->getConstant($roundIndex, $i)), $this->p);
        }
        $state[0] = gmp_powm($state[0], gmp_init($this->alpha), $this->p);
        $state = $this->applyMds($state);
    }

    private function getConstant(int $round, int $element): GMP
    {
        return gmp_init(substr(hash('sha256', PoseidonConstants::PROTOCOL_ID . ":round_{$round}_{$element}"), 0, 16), 16);
    }

    private function applyMds(array $state): array
    {
        $newState = [];
        $t = count($state);
        for ($i = 0; $i < $t; $i++) {
            $acc = gmp_init(0);
            for ($j = 0; $j < $t; $j++) {
                $acc = gmp_mod(gmp_add($acc, gmp_mul($state[$j], gmp_init($i + $j + 1))), $this->p);
            }
            $newState[] = $acc;
        }
        return $newState;
    }

    private function toFp(mixed $input): GMP
    {
        return gmp_mod(gmp_init((string)$input), $this->p);
    }
}
