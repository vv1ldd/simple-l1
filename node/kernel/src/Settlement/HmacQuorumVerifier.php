<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Settlement;

/**
 * Verifies K-of-N HMAC-SHA256 signatures over a canonical UTF-8 string.
 */
final class HmacQuorumVerifier
{
    /**
     * @param  list<string>  $signatureHexList  Each element:64-char hex (SHA-256)
     * @param  list<non-empty-string>  $secrets
     */
    public function verify(string $canonicalUtf8, array $signatureHexList, array $secrets, int $quorum): bool
    {
        if ($quorum < 1) {
            return false;
        }
        if ($quorum > count($secrets)) {
            return false;
        }
        if ($secrets === []) {
            return false;
        }

        $matchedSecretIdx = [];
        foreach ($signatureHexList as $sigHex) {
            if (! is_string($sigHex) || $sigHex === '') {
                continue;
            }
            $sigBin = self::hexToBin($sigHex);
            if ($sigBin === null) {
                continue;
            }
            foreach ($secrets as $idx => $secret) {
                if (isset($matchedSecretIdx[$idx])) {
                    continue;
                }
                $expected = hash_hmac('sha256', $canonicalUtf8, $secret, true);
                if (hash_equals($expected, $sigBin)) {
                    $matchedSecretIdx[$idx] = true;
                    break;
                }
            }
        }

        return count($matchedSecretIdx) >= $quorum;
    }

    private static function hexToBin(string $hex): ?string
    {
        $hex = strtolower($hex);
        if ($hex === '' || strlen($hex) % 2 !== 0) {
            return null;
        }
        if (preg_match('/^[0-9a-f]+$/', $hex) !== 1) {
            return null;
        }
        $bin = hex2bin($hex);

        return $bin === false ? null : $bin;
    }
}
