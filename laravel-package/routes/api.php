<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;

Route::prefix('api/simple-l1')->group(function () {
    
    // Статус Laravel-ноды
    Route::get('/status', function () {
        return response()->json([
            'network' => 'Simple-L1 Alpha (Laravel Fabric)',
            'node_name' => config('simple-l1.node_name', 'laravel-node-' . config('app.name')),
            'version' => '0.2.0',
            'capabilities' => ['IDENTITY', 'GATEWAY', 'MDK_EXECUTION'],
            'state_root' => 'pending-sync',
            'uptime' => now()->diffInSeconds(app()->getStartTime()), // Если есть замер старта
        ]);
    });

    // Прием анонсов
    Route::post('/announce', function (Request $request) {
        $url = $request->input('url');
        // Логика сохранения пиров в кэш или БД Laravel
        return response()->json(['success' => true]);
    });

});
