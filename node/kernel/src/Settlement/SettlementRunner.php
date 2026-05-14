<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Settlement;

use Meanly\Mdk\Kernel\Identity\CanonicalJsonEncoder;
use Meanly\Mdk\Kernel\Persistence\Database;
use PDO;
use PDOException;
use Throwable;

/**
 * Applies a signed SSP settlement to ssp_* MySQL tables (Bagisto industrial schema).
 * Balance convention matches SspLedgerManager: DEBIT increases current_balance, CREDIT decreases it.
 */
final class SettlementRunner
{
    private const DECIMALS = 8;

    private CanonicalJsonEncoder $encoder;

    private Ed25519SignatureVerifier $signatureVerifier;

    public function __construct(?CanonicalJsonEncoder $encoder = null, ?HmacQuorumVerifier $verifier = null)
    {
        $this->encoder = $encoder ?? new CanonicalJsonEncoder();
        // Backward compat: callers may still pass the old parameter.
        $this->signatureVerifier = new Ed25519SignatureVerifier();
    }

    /**
     * @param  array<string, mixed>  $packet  { payload: array, signatures: list<string>|array<string,string> }
     * @return array{settlement_id: string, tx_hash: string, status: string}
     */
    public function run(array $packet): array
    {
        if (! isset($packet['payload']) || ! is_array($packet['payload'])) {
            throw new SettlementException('INVALID_PACKET: missing payload');
        }
        $payload = $packet['payload'];
        $signatureRaw = $packet['signature'] ?? $packet['signatures'] ?? null;

        $allowUnsigned = getenv('MDK_ALLOW_UNSIGNED') === '1';

        $this->validatePayload($payload, $signatureRaw, $allowUnsigned);

        $canonical = $this->encoder->encode($payload);
        $settlementId = hash('sha256', $canonical);

        // mpo-operator sends exactly one Ed25519 signature:
        //   { payload: {..., key_id: 'mpo-dev-key-1', ...}, signature: '<base64>' }
        if (! $allowUnsigned) {
            $keyId = (string) ($payload['key_id'] ?? '');
            if ($keyId === '') {
                throw new SettlementException('SIGNATURE: payload.key_id required');
            }

            $signatures = $this->normalizeSignatures($signatureRaw);
            if ($signatures === []) {
                throw new SettlementException('SIGNATURE: no signatures provided');
            }

            $quorum = max(1, (int) (getenv('MDK_SETTLEMENT_SIGNATURE_QUORUM') ?: '1'));
            $domain = getenv('MDK_MPO_SETTLE_DOMAIN') ?: 'MPO_SETTLE_V1|';

            $pdo = Database::getConnection();
            $stmt = $pdo->prepare('SELECT public_key FROM mpo_keys WHERE key_id = ? AND status = \'active\' LIMIT 1');
            $stmt->execute([$keyId]);
            $pubKeyHex = $stmt->fetchColumn();

            if (!is_string($pubKeyHex) || $pubKeyHex === '') {
                throw new SettlementException('SIGNATURE: active mpo_keys.public_key not found for key_id=' . $keyId);
            }

            $verifier = new Ed25519SignatureVerifier($domain);
            $valid = 0;
            foreach ($signatures as $sig) {
                if ($verifier->verify($canonical, $sig, $pubKeyHex)) {
                    $valid++;
                }
            }

            if ($valid < $quorum) {
                throw new SettlementException('SIGNATURE: ed25519 verification failed (quorum not met)');
            }
        }

        $txHash = isset($payload['fiat_payment_id']) && is_string($payload['fiat_payment_id']) && $payload['fiat_payment_id'] !== ''
            ? $payload['fiat_payment_id']
            : $settlementId;

        $pdo = Database::getConnection();

        try {
            $pdo->beginTransaction();

            if ($this->journalExists($pdo, $txHash)) {
                $pdo->rollBack();

                return [
                    'settlement_id' => $settlementId,
                    'tx_hash' => $txHash,
                    'status' => 'ALREADY_SETTLED',
                ];
            }

            $intent = $payload['intent'];
            $amount = $this->toAmount8($intent['amount_fiat']);
            $currency = (string) $intent['currency'];
            $merchantKey = $this->ownerMerchant((string) $intent['merchant_id']);
            $customerKey = $this->ownerCustomer((string) $payload['user_id']);

            [$accCustomer, $accMerchant] = $this->lockAccountsPair($pdo, $customerKey, $merchantKey);

            $journalId = $this->insertJournal($pdo, $txHash, $settlementId, $merchantKey, $amount, $currency);

            $stmtPosting = $pdo->prepare(
                'INSERT INTO ssp_postings (journal_entry_id, account_id, amount, direction, currency, timestamp) VALUES (?, ?, ?, ?, ?, NOW())'
            );
            // Customer pays: CREDIT reduces customer balance; Merchant receives: DEBIT increases merchant balance.
            $stmtPosting->execute([$journalId, $accCustomer->id, $amount, 'CREDIT', $currency]);
            $stmtPosting->execute([$journalId, $accMerchant->id, $amount, 'DEBIT', $currency]);

            $this->applyBalanceDelta($pdo, (int) $accCustomer->id, $journalId, 'CREDIT', $amount);
            $this->applyBalanceDelta($pdo, (int) $accMerchant->id, $journalId, 'DEBIT', $amount);

            $pdo->commit();

            return [
                'settlement_id' => $settlementId,
                'tx_hash' => $txHash,
                'status' => 'SETTLED',
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e instanceof SettlementException ? $e : new SettlementException($e->getMessage(), 0, $e);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function validatePayload(array $payload, mixed $signatureRaw, bool $allowUnsigned): void
    {
        if (! $allowUnsigned && $signatureRaw === null) {
            throw new SettlementException('SIGNATURE: missing signature');
        }

        if (! isset($payload['key_id']) || ! is_string($payload['key_id']) || $payload['key_id'] === '') {
            throw new SettlementException('PAYLOAD: key_id required');
        }
        if (! isset($payload['fiat_payment_id']) || ! is_string($payload['fiat_payment_id']) || $payload['fiat_payment_id'] === '') {
            throw new SettlementException('PAYLOAD: fiat_payment_id required');
        }
        if (! isset($payload['nonce']) || ! is_string($payload['nonce']) || $payload['nonce'] === '') {
            throw new SettlementException('PAYLOAD: nonce required');
        }

        if (! isset($payload['intent']) || ! is_array($payload['intent'])) {
            throw new SettlementException('PAYLOAD: missing intent');
        }
        $intent = $payload['intent'];
        foreach (['merchant_id', 'amount_fiat', 'currency'] as $key) {
            if (! array_key_exists($key, $intent)) {
                throw new SettlementException("PAYLOAD: intent.{$key} required");
            }
        }
        $rawAmount = $intent['amount_fiat'];
        if (! is_int($rawAmount) && ! is_float($rawAmount) && ! is_string($rawAmount)) {
            throw new SettlementException('PAYLOAD: intent.amount_fiat must be numeric');
        }
        if (! is_numeric($rawAmount)) {
            throw new SettlementException('PAYLOAD: intent.amount_fiat must be numeric');
        }
        if ((float) $rawAmount <= 0.0) {
            throw new SettlementException('PAYLOAD: intent.amount_fiat must be > 0');
        }
        if (! is_string($intent['currency']) || strlen($intent['currency']) !== 3) {
            throw new SettlementException('PAYLOAD: intent.currency must be ISO 4217 length 3');
        }
        if (! isset($payload['user_id']) || ! is_string($payload['user_id']) || $payload['user_id'] === '') {
            throw new SettlementException('PAYLOAD: user_id required');
        }
        $this->assertSafeOwnerToken((string) $intent['merchant_id'], 'merchant_id');
        $this->assertSafeOwnerToken((string) $payload['user_id'], 'user_id');
    }

    private function assertSafeOwnerToken(string $value, string $field): void
    {
        if (strlen($value) > 128) {
            throw new SettlementException("PAYLOAD: {$field} too long");
        }
        if (preg_match('/^[a-zA-Z0-9._@-]+$/', $value) !== 1) {
            throw new SettlementException("PAYLOAD: {$field} has invalid characters");
        }
    }

    private function ownerMerchant(string $merchantId): string
    {
        return 'merchant-' . $merchantId;
    }

    private function ownerCustomer(string $userId): string
    {
        return $userId;
    }

    /**
     * Normalizes incoming amount_fiat (JS number/JSON number) to fixed 8-decimal string,
     * matching Bagisto's SspLedgerManager.safeToBcAmount() behavior.
     */
    private function toAmount8(mixed $val): string
    {
        if (! is_int($val) && ! is_float($val) && ! (is_string($val) && is_numeric($val))) {
            throw new SettlementException('INTENT: amount_fiat must be numeric');
        }

        $amount = number_format((float) $val, self::DECIMALS, '.', '');
        if (bccomp($amount, '0', self::DECIMALS) <= 0) {
            throw new SettlementException('INTENT: amount_fiat must be > 0');
        }

        return $amount;
    }

    /**
     * @return list<non-empty-string>
     */
    private function loadSecrets(): array
    {
        $raw = getenv('MDK_SETTLEMENT_HMAC_SECRETS');
        if ($raw === false || $raw === '') {
            return [];
        }
        $parts = array_map('trim', explode(',', $raw));

        return array_values(array_filter($parts, static fn (string $s): bool => $s !== ''));
    }

    /**
     * @param  mixed  $raw
     * @return list<string>
     */
    private function normalizeSignatures(mixed $raw): array
    {
        if (is_string($raw)) {
            return [$raw];
        }
        if (! is_array($raw)) {
            return [];
        }

        $out = [];
        foreach ($raw as $v) {
            if (is_string($v) && $v !== '') {
                $out[] = $v;
            }
        }

        return $out;
    }

    private function journalExists(PDO $pdo, string $txHash): bool
    {
        $stmt = $pdo->prepare('SELECT id FROM ssp_journal_entries WHERE tx_hash = ? LIMIT 1');
        $stmt->execute([$txHash]);

        return (bool) $stmt->fetch(PDO::FETCH_ASSOC);
    }

    /**
     * Locks both rows in deterministic id order to avoid deadlocks.
     *
     * @return array{0: object, 1: object}  [customerRow, merchantRow]
     */
    private function lockAccountsPair(PDO $pdo, string $customerKey, string $merchantKey): array
    {
        $stmt = $pdo->prepare(
            'SELECT id, owner_id, current_balance FROM ssp_ledger_accounts WHERE owner_id IN (?, ?) ORDER BY id ASC FOR UPDATE'
        );
        $stmt->execute([$customerKey, $merchantKey]);
        $rows = $stmt->fetchAll(PDO::FETCH_OBJ);
        if (count($rows) !== 2) {
            throw new SettlementException('LEDGER: missing customer or merchant account');
        }
        $byOwner = [];
        foreach ($rows as $r) {
            $byOwner[(string) $r->owner_id] = $r;
        }
        if (! isset($byOwner[$customerKey], $byOwner[$merchantKey])) {
            throw new SettlementException('LEDGER: missing customer or merchant account');
        }

        return [$byOwner[$customerKey], $byOwner[$merchantKey]];
    }

    private function insertJournal(PDO $pdo, string $txHash, string $settlementId, string $merchantKey, string $amount, string $currency): int
    {
        $desc = "SETTLEMENT {$merchantKey} {$amount} {$currency}";
        $stmt = $pdo->prepare(
            'INSERT INTO ssp_journal_entries (tx_hash, entry_hash, type, description, timestamp) VALUES (?, ?, ?, ?, NOW())'
        );
        $stmt->execute([$txHash, $settlementId, 'SETTLEMENT', $desc]);

        return (int) $pdo->lastInsertId();
    }

    private function applyBalanceDelta(PDO $pdo, int $accountId, int $journalId, string $direction, string $amount): void
    {
        $stmt = $pdo->prepare('SELECT current_balance FROM ssp_ledger_accounts WHERE id = ? FOR UPDATE');
        $stmt->execute([$accountId]);
        $row = $stmt->fetch(PDO::FETCH_OBJ);
        if (! $row) {
            throw new SettlementException("LEDGER: account {$accountId} missing");
        }
        $current = (string) $row->current_balance;
        $next = $direction === 'DEBIT'
            ? bcadd($current, $amount, self::DECIMALS)
            : bcsub($current, $amount, self::DECIMALS);
        if (str_starts_with($next, '-')) {
            throw new SettlementException('LEDGER: insufficient funds (negative balance not allowed)');
        }
        $upd = $pdo->prepare('UPDATE ssp_ledger_accounts SET current_balance = ?, last_journal_entry_id = ? WHERE id = ?');
        $upd->execute([$next, $journalId, $accountId]);
    }
}
