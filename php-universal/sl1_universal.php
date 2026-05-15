<?php
/**
 * Simple-L1 Universal PHP Node Connector
 * Works for: 1C-Bitrix, NetCat, and any Custom PHP CMS
 * "The Sovereignty of Every Server"
 */

class SL1_Universal_Node {
    private static $seeds = [
        'https://l1.wildflow.dev',
        'https://l1-beta.wildflow.dev',
        'https://l1-gamma.wildflow.dev'
    ];

    public static function init() {
        // Авто-определение эндпоинта (например, site.com/?sl1_api=status)
        if (isset($_GET['sl1_api'])) {
            self::handleRequest($_GET['sl1_api']);
            exit;
        }
    }

    private static function handleRequest($action) {
        header('Content-Type: application/json');
        header('Access-Control-Allow-Origin: *');

        switch ($action) {
            case 'status':
                echo json_encode([
                    'network' => 'Simple-L1 Alpha (Enterprise Fabric)',
                    'node_name' => 'php-node-' . $_SERVER['HTTP_HOST'],
                    'version' => '0.1.0',
                    'engine' => 'Universal PHP Connector',
                    'peers' => self::getPeers(),
                    'uptime' => time() % 86400 // Simulated for PoC
                ]);
                break;
            
            case 'announce':
                $input = json_decode(file_get_contents('php://input'), true);
                if (isset($input['url'])) {
                    self::addPeer($input['url']);
                }
                echo json_encode(['success' => true]);
                break;
        }
    }

    private static function getPeers() {
        // В Битриксе можно использовать COption::GetOptionString
        // Здесь используем временный файл для универсальности
        $path = sys_get_temp_dir() . '/sl1_peers.json';
        if (!file_exists($path)) return self::$seeds;
        return json_decode(file_get_contents($path), true) ?: self::$seeds;
    }

    private static function addPeer($url) {
        $peers = self::getPeers();
        if (!in_array($url, $peers)) {
            $peers[] = $url;
            file_put_contents(sys_get_temp_dir() . '/sl1_peers.json', json_encode(array_slice($peers, -50)));
        }
    }
}

// Запуск (можно просто инклюдить в init.php Битрикса)
SL1_Universal_Node::init();
