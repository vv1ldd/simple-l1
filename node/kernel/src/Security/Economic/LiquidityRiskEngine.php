<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Security\Economic;

/**
 * Axiom: LiquidityRiskEngine analyzes liquidity coverage and stress convergence patterns.
 * Core of the MCEP protocol economic defense layer.
 */
class LiquidityRiskEngine
{
    private const CONVERGENCE_THRESHOLDS = [
        'burst_masking' => 2.5,
        'stealth_drain' => 1.5,
    ];

    /**
     * Analyzes the current economic state and returns risk metrics.
     */
    public function analyze(array $state): array
    {
        $liquidity = (float) ($state['actual_liquidity'] ?? 0);
        $totalBalances = (float) ($state['total_supply'] ?? 0);
        $pendingPayouts = (float) ($state['pending_payouts'] ?? 0);

        // 1. Triple Ratio Calculation
        $t0Ratio = $pendingPayouts > 0 ? $liquidity / $pendingPayouts : 100.0;
        $globalRatio = $totalBalances > 0 ? $liquidity / $totalBalances : 100.0;

        // 2. Stress Convergence Analysis
        $panic  = (float) ($state['stress_panic'] ?? 0);
        $micro  = (float) ($state['stress_micro'] ?? 0);
        $struct = (float) ($state['stress_structural'] ?? 0);

        $anomalyScore = $this->calculateAnomalyScore($panic, $micro, $struct);

        return [
            'ratios' => [
                't0'     => $t0Ratio,
                'global' => $globalRatio,
            ],
            'stress' => [
                'panic'      => $panic,
                'micro'      => $micro,
                'structural' => $struct,
            ],
            'anomaly_score' => $anomalyScore,
            'status'        => $this->deriveStatus($t0Ratio, $anomalyScore),
        ];
    }

    private function calculateAnomalyScore(float $panic, float $micro, float $struct): float
    {
        $score = 0;
        $accel = $struct > 0 ? $panic / $struct : 0;
        
        if ($accel > self::CONVERGENCE_THRESHOLDS['burst_masking']) $score += 0.5;
        if ($micro > $panic && $micro > ($struct * 1.5)) $score += 0.4;

        return min(1.0, $score);
    }

    private function deriveStatus(float $t0Ratio, float $anomalyScore): string
    {
        if ($t0Ratio < 0.8 || $anomalyScore > 0.9) return 'FREEZE';
        if ($t0Ratio < 1.0 || $anomalyScore > 0.6) return 'PROTECTIVE';
        if ($t0Ratio < 1.2 || $anomalyScore > 0.3) return 'WARNING';

        return 'CLEAN';
    }
}
