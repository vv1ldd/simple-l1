<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Crypto\Merkle;

use Meanly\Mdk\Kernel\Crypto\Poseidon\PoseidonEngine;

/**
 * Axiom: MerkleProofService handles deterministic state tree construction.
 * Essential for inclusion proofs and zero-knowledge validity.
 */
class MerkleProofService
{
    public function __construct(
        private PoseidonEngine $crypto
    ) {}

    /**
     * Calculates the Merkle Root for a set of leaves.
     */
    public function calculateRoot(array $leaves): string
    {
        if (empty($leaves)) return '0';
        
        $current = $leaves;
        while (count($current) > 1) {
            $next = [];
            for ($i = 0; $i < count($current); $i += 2) {
                $left = $current[$i];
                $right = $current[$i + 1] ?? $left;
                $next[] = $this->crypto->hash([$left, $right]);
            }
            $current = $next;
        }

        return $current[0];
    }

    /**
     * Generates an inclusion proof for a target leaf index.
     */
    public function generateProof(array $leaves, int $index): array
    {
        $proof = [];
        $current = $leaves;
        
        while (count($current) > 1) {
            $next = [];
            for ($i = 0; $i < count($current); $i += 2) {
                $left = $current[$i];
                $right = $current[$i + 1] ?? $left;
                
                if ($i === $index || $i + 1 === $index) {
                    $proof[] = ($i === $index) ? $right : $left;
                    $index = intdiv($i, 2);
                }
                
                $next[] = $this->crypto->hash([$left, $right]);
            }
            $current = $next;
        }

        return $proof;
    }
}
