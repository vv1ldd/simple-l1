<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Security\Economic;

/**
 * Axiom: EWMACalculator implements deterministic time-decayed stress accumulation.
 * Formula: S(t) = S(t-1) * exp(-λ * dt) + BurnAmount
 */
class EWMACalculator
{
    /**
     * Standard Time-Decay Coefficients (Per Protocol Spec v1.0)
     */
    private const LAMBDA_CONFIG = [
        'panic'      => 0.1,  // High volatility, fast decay (minutes)
        'micro'      => 0.01, // Medium volatility
        'structural' => 0.001 // Long-term systemic stress
    ];

    /**
     * Calculates the new stress vector based on time delta and new event intensity.
     */
    public function calculate(array $currentState, float $burnAmount, int $currentTimestamp): array
    {
        $lastUpdate = (int) ($currentState['last_update'] ?? $currentTimestamp);
        $dt = max(0, $currentTimestamp - $lastUpdate);

        $results = ['last_update' => $currentTimestamp];

        foreach (self::LAMBDA_CONFIG as $layer => $lambdaMultiplier) {
            $lambda = $lambdaMultiplier / 60; 
            $prevLevel = (float) ($currentState[$layer] ?? 0);

            // S_decayed = S_old * e^(-λ * dt)
            $decayed = $prevLevel * exp(-$lambda * $dt);

            // S_new = S_decayed + Intensity
            $results[$layer] = $decayed + $burnAmount;
        }

        return $results;
    }
}
