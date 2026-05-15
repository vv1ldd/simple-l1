// Simple-L1 Sovereign Authenticator Interceptor
// This script runs on every page and redirects WebAuthn requests to the extension

const injectScript = () => {
    const script = document.createElement('script');
    script.textContent = `
        const originalCreate = navigator.credentials.create.bind(navigator.credentials);
        const originalGet = navigator.credentials.get.bind(navigator.credentials);

        navigator.credentials.create = async (options) => {
            if (options.publicKey) {
                console.log('[SL1-AUTH] Intercepting Registration Request...');
                // Здесь мы можем отправить запрос в наше расширение вместо Windows Hello
                // return window.postMessage({ type: 'SL1_REGISTER', options }, '*');
            }
            return originalCreate(options);
        };

        navigator.credentials.get = async (options) => {
            if (options.publicKey) {
                console.log('[SL1-AUTH] Intercepting Authentication Request...');
                // Перенаправление в "Вакуум" Simple-L1
            }
            return originalGet(options);
        };
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
};

injectScript();
