<?php

declare(strict_types=1);

namespace Meanly\Mdk\Kernel\Persistence;

use PDO;
use Exception;

/**
 * MDK Sovereign Database Wrapper
 * Axiom: Direct, deterministic access to the ledger tables.
 */
class Database
{
    private static ?PDO $instance = null;

    public static function getConnection(): PDO
    {
        if (self::$instance !== null) {
            return self::$instance;
        }

        $host = getenv('MDK_DB_HOST') ?: '127.0.0.1';
        $db = getenv('MDK_DB_NAME') ?: 'bagisto_local';
        $user = getenv('MDK_DB_USER') ?: 'root';
        $passEnv = getenv('MDK_DB_PASSWORD');
        $pass = $passEnv !== false ? $passEnv : '';
        $charset = 'utf8mb4';

        $dsn = "mysql:host=$host;dbname=$db;charset=$charset";
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_OBJ,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        try {
            self::$instance = new PDO($dsn, $user, $pass, $options);
            return self::$instance;
        } catch (\PDOException $e) {
             throw new Exception("MDK DB Persistence Error: " . $e->getMessage());
        }
    }

    public static function beginTransaction(): bool
    {
        return self::getConnection()->beginTransaction();
    }

    public static function commit(): bool
    {
        return self::getConnection()->commit();
    }

    public static function rollBack(): bool
    {
        return self::getConnection()->rollBack();
    }
}
