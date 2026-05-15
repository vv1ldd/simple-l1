<?php
/**
 * Plugin Name: Simple-L1 Sovereign Node
 * Description: Turns your WordPress site into a decentralized validator node for the Simple-L1 network.
 * Version: 0.1.0
 * Author: Simple Network
 */

if (!defined('ABSOLUTE_PATH')) {
    define('SL1_PATH', plugin_dir_path(__FILE__));
}

// 1. Инициализация эндпоинтов REST API
add_action('rest_api_init', function () {
    register_rest_route('simple-l1/v1', '/status', [
        'methods' => 'GET',
        'callback' => 'sl1_get_status',
        'permission_callback' => '__return_true',
    ]);

    register_rest_route('simple-l1/v1', '/announce', [
        'methods' => 'POST',
        'callback' => 'sl1_receive_announce',
        'permission_callback' => '__return_true',
    ]);
});

// 2. Логика статуса ноды
function sl1_get_status() {
    $peers = get_option('sl1_peers', []);
    return [
        'network' => 'Simple-L1 Alpha (WP Fabric)',
        'node_name' => 'wp-node-' . get_bloginfo('name'),
        'version' => '0.1.0',
        'peers' => $peers,
        'is_wordpress' => true,
        'uptime' => time() - get_option('sl1_start_time', time())
    ];
}

// 3. Прием анонсов от других нод
function sl1_receive_announce($request) {
    $params = $request->get_json_params();
    $url = $params['url'] ?? '';
    
    if ($url) {
        $peers = get_option('sl1_peers', []);
        if (!in_array($url, $peers)) {
            $peers[] = $url;
            update_option('sl1_peers', array_slice($peers, -50)); // Храним последние 50
        }
    }
    
    return ['success' => true, 'known_peers' => get_option('sl1_peers', [])];
}

// 4. Виджет в админку (Proof of Sovereignty)
add_action('wp_dashboard_setup', function() {
    wp_add_dashboard_widget('sl1_node_status', 'Simple-L1 Node Status', function() {
        $status = sl1_get_status();
        echo '<div style="background:#000; color:#0f0; padding:15px; font-family:monospace;">';
        echo '<strong>[ NODE ACTIVE ]</strong><br>';
        echo 'Name: ' . esc_html($status['node_name']) . '<br>';
        echo 'Network: ' . esc_html($status['network']) . '<br>';
        echo 'Peers: ' . count($status['peers']) . '<br>';
        echo '<hr style="border:1px solid #333;">';
        echo '<span style="color:#fff;">Status: Validating Intent...</span>';
        echo '</div>';
    });
});

// Установка времени старта при активации
register_activation_hook(__FILE__, function() {
    add_option('sl1_start_time', time());
    add_option('sl1_peers', [
        'https://l1.wildflow.dev',
        'https://l1-beta.wildflow.dev',
        'https://l1-gamma.wildflow.dev'
    ]);
});
