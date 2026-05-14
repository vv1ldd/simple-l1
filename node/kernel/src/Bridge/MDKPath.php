<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Bridge;

/**
 * Axiom: MDKPath is a stateless deterministic path resolver.
 * All external filesystem access MUST be resolved through this layer.
 */
class MDKPath
{
    /**
     * Resolves the physical path for a logical MDK component.
     * Axiom: The Kernel is the anchor for path resolution.
     */
    public static function resolve(string $logicalPath): string
    {
        // 1. Determine MDK Root relative to this file
        // Current file: MDK/kernel/src/Bridge/MDKPath.php
        // Root should be: MDK/
        $mdkRoot = realpath(__DIR__ . '/../../..');
        
        if (!$mdkRoot) {
            // Fallback for extreme cases or unmounted volumes
            $mdkRoot = base_path('MDK');
        }

        $mapping = [
            'commitment.contracts' => 'commitment/contracts',
            'commitment.scripts'   => 'commitment/scripts',
            'kernel.src'           => 'kernel/src',
            'bridge.core'          => 'bridge/core',
        ];

        $physicalSubPath = $mapping[$logicalPath] ?? $logicalPath;

        return rtrim($mdkRoot . DIRECTORY_SEPARATOR . $physicalSubPath, DIRECTORY_SEPARATOR);
    }

    /**
     * Specialized resolver for Gasless Relayer script.
     */
    public static function getGaslessRelayerPath(): string
    {
        return self::resolve('commitment.scripts') . DIRECTORY_SEPARATOR . 'gasless_relayer.js';
    }
}
