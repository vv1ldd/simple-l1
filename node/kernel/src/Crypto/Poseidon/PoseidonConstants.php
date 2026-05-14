<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Crypto\Poseidon;

/**
 * Axiom: PoseidonConstants v1.0 - Protocol Lock-in.
 * Static frozen parameters for the BN254 Scalar Field permutation.
 */
readonly class PoseidonConstants
{
    public const PROTOCOL_VERSION = 'v1.0-hades-bn254';
    
    // Derived from circomlib standard
    public const FIELD_PRIME = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
    
    // Poseidon t=3 (2 inputs + 1 capacity)
    public const T3_Rf = 8;
    public const T3_Rp = 57;
    
    // Poseidon t=5 (4 inputs + 1 capacity)
    public const T5_Rf = 8;
    public const T5_Rp = 60;

    public const PROTOCOL_ID = '0x1000ead0beef8421c0de00000000000000000000000000000000000000001337';
}
