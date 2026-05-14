<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Security\Economic;

/**
 * Axiom: RiskPolicyEngine transforms risk metrics into operational behavioral rules.
 * STRICTLY PURE: No side effects allowed. Part of the State Transition Function logic.
 */
class RiskPolicyEngine
{
    /**
     * Derives the effective policy based on analysis.
     */
    public function derive(array $analysis, array $config): array
    {
        $status = $analysis['status'] ?? 'CLEAN';
        
        return match ($status) {
            'FREEZE' => [
                'status'             => 'FREEZE',
                'limit_multiplier'   => 0.0,
                'throttle_delay_ms'  => 0,
                'allow_burn'         => false,
                'allow_transfer'     => false,
            ],

            'PROTECTIVE' => [
                'status'             => 'PROTECTIVE',
                'limit_multiplier'   => 0.5,
                'throttle_delay_ms'  => 5000,
                'allow_burn'         => true,
                'allow_transfer'     => true,
            ],

            'WARNING' => [
                'status'             => 'WARNING',
                'limit_multiplier'   => 1.0,
                'throttle_delay_ms'  => 0,
                'allow_burn'         => true,
                'allow_transfer'     => true,
            ],

            default => [
                'status'             => 'CLEAN',
                'limit_multiplier'   => 1.0,
                'throttle_delay_ms'  => 0,
                'allow_burn'         => true,
                'allow_transfer'     => true,
            ],
        };
    }
}
