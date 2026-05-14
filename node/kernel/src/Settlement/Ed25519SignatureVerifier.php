<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Settlement;

/**
 * Verifies Ed25519 detached signatures for mpo-operator settle packets.
 *
 * mpo-operator dist:
 *   signature = nacl.sign.detached(message, secretKey) -> base64
 *   message    = domain + canonicalize(payload)
 *   domain     = "MPO_SETTLE_V1|" (default in dist KeyManager)
 */
final class Ed25519SignatureVerifier
{
    public function __construct(
        private string $domain = 'MPO_SETTLE_V1|'
    ) {}

    public function verify(
        string $payloadCanonicalJson,
        string $signatureBase64,
        string $publicKeyHex
    ): bool {
        $sigBin = $this->decodeBase64($signatureBase64);
        if ($sigBin === null) {
            return false;
        }

        $pubBin = hex2bin($publicKeyHex);
        if ($pubBin === false) {
            return false;
        }

        $message = $this->domain . $payloadCanonicalJson;

        return sodium_crypto_sign_verify_detached($sigBin, $message, $pubBin);
    }

    private function decodeBase64(string $b64): ?string
    {
        $bin = base64_decode($b64, true);
        if ($bin !== false) {
            return $bin;
        }

        // Try base64url -> base64
        $b64url = strtr($b64, '-_', '+/');
        $pad = strlen($b64url) % 4;
        if ($pad > 0) {
            $b64url .= str_repeat('=', 4 - $pad);
        }

        $bin = base64_decode($b64url, true);
        return $bin !== false ? $bin : null;
    }
}

