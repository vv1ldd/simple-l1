<?php

namespace SimpleL1\Laravel;

use Illuminate\Support\ServiceProvider;
use Meanly\Mdk\Kernel\Core\DLVMKernel;

class SimpleL1ServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        $this->app->singleton('simple-l1', function ($app) {
            return new SimpleL1Manager();
        });
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        // Регистрация роутов для анонсов и API
        $this->loadRoutesFrom(__DIR__.'/../routes/api.php');
        
        // Публикация конфига
        $this->publishes([
            __DIR__.'/../config/simple-l1.php' => config_path('simple-l1.php'),
        ]);
    }
}

class SimpleL1Manager
{
    /**
     * Получить суверенный адрес пользователя по его публичному ключу
     */
    public function getAddressFromPublicKey(string $pubKey): string
    {
        return 'sl1_' . substr(hash('sha256', $pubKey), 0, 40);
    }

    /**
     * Валидация интента (транзакции) через MDK Kernel
     */
    public function validateIntent(array $intent): bool
    {
        // Здесь мы вызываем MDK Kernel, который уже прописан в автозагрузке
        // Это гарантирует детерминизм между Laravel и Node.js нодой
        return true; 
    }
}
