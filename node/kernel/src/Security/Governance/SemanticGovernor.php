<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Security\Governance;

/**
 * Axiom: SemanticGovernor validates the "Financial Intent" behind system overrides.
 * Prevents non-deterministic or ambiguous human intervention.
 */
class SemanticGovernor
{
    private array $intentPatterns = [
        'LIQUIDITY_RECONCILIATION' => '/(liquidity|balance|fund|equity)\s+(reconciliation|sync|adjustment|update)/i',
        'ORACLE_CORRECTION'        => '/(oracle|provider|external|stripe)\s+(correction|lag|fix|error)/i',
        'EMERGENCY_ADJUSTMENT'     => '/(emergency|recovery|incident|panic)\s+(adjustment|intervention|manual)/i',
        'MAINTENANCE'              => '/(maintenance|migration|upgrade|testnet)\s+(cleanup|init)/i',
    ];

    /**
     * Classified Intent or null if rejected.
     */
    public function classify(string $reason): ?string
    {
        $reason = trim($reason);

        if (strlen($reason) < 10) return null;

        foreach ($this->intentPatterns as $intent => $pattern) {
            if (preg_match($pattern, $reason)) return $intent;
        }

        return null;
    }
}
