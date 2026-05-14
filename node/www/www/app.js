/* -------------------------------------------------------------------------
   NETWORK STATUS POLLING
-------------------------------------------------------------------------- */
async function updateNetworkStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) return;
        const data = await response.json();
        
        const elNetwork = document.getElementById('stat-network');
        const elAccounts = document.getElementById('stat-accounts');
        const elUptime = document.getElementById('stat-uptime');

        if (elNetwork) elNetwork.textContent = data.network;
        if (elAccounts) elAccounts.textContent = data.total_accounts;
        
        if (elUptime) {
            const minutes = Math.floor(data.uptime / 60);
            const seconds = Math.floor(data.uptime % 60);
            elUptime.textContent = `${minutes}m ${seconds}s`;
        }
        
    } catch (err) {
        console.warn('Failed to fetch network status:', err);
    }
}

// Poll every 5 seconds
setInterval(updateNetworkStatus, 5000);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   I18N HANDLING
-------------------------------------------------------------------------- */
const translations = {
    ru: i18n_ru,
    en: i18n_en,
    es: i18n_es,
    "es-ar": i18n_es_ar,
    tr: i18n_tr,
    tk: i18n_tk,
    kk: i18n_kk,
    zh: i18n_zh,
    ja: i18n_ja,
    ko: i18n_ko,
    de: i18n_de,
    fr: i18n_fr,
    pt: i18n_pt,
    it: i18n_it,
    nl: i18n_nl,
    pl: i18n_pl,
    uk: i18n_uk,
    hi: i18n_hi,
    ar: i18n_ar
};

let currentLang = 'ru';

function setLanguage(lang) {
    if (!translations[lang]) lang = 'en';
    currentLang = lang;
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[lang][key]) {
            el.placeholder = translations[lang][key];
        }
    });

    document.documentElement.lang = lang;
    localStorage.setItem('preferred-lang', lang);
}

// Initial language setup
document.addEventListener('DOMContentLoaded', () => {
    const savedLang = localStorage.getItem('preferred-lang') || 'ru';
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.value = savedLang;
        langSelect.addEventListener('change', (e) => setLanguage(e.target.value));
    }
    setLanguage(savedLang);
});

/* -------------------------------------------------------------------------
   TERMINAL EMULATOR LOGIC (HUMANIZED)
-------------------------------------------------------------------------- */
const consoleOutput = document.getElementById('console-output');
const btnConsensus = document.getElementById('btn-trigger-consensus');
const usernameInput = document.getElementById('username-input');

// AUTO-PREFIX @ Logic
if (usernameInput) {
    usernameInput.addEventListener('input', (e) => {
        let val = e.target.value;
        if (val && !val.startsWith('@')) {
            e.target.value = '@' + val;
        }
    });
}

function appendLine(text, className = '') {
    const line = document.createElement('div');
    line.className = 'terminal-line ' + className;
    line.innerHTML = text;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    return line;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility to convert Base64 to ArrayBuffer
function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }
    return buffer.buffer;
}

// Utility to convert ArrayBuffer to Hex
function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function runRealConsensus() {
    let handle = usernameInput.value || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    
    consoleOutput.innerHTML = '';
    btnConsensus.disabled = true;
    
    appendLine(`[SYSTEM] Подготовка вашего суверенного паспорта для ${handle}...`, 'text-highlight');
    await sleep(500);
    
    try {
        appendLine(`>>> [1/5] СОЗДАНИЕ ЛИЧНОСТИ: Обращение к защищенному чипу...`);
        
        // 1. Get options from node
        const optionsRes = await fetch(`/api/register/options?handle=${encodeURIComponent(handle)}`);
        const options = await optionsRes.json();
        
        // Prepare options for navigator.credentials.create
        options.challenge = base64ToBuffer(options.challenge);
        options.user.id = base64ToBuffer(options.user.id);
        
        appendLine(`[ACTION] ШАГ #1: Используйте TouchID/FaceID для подписи вашей личности...`, 'text-yellow');
        
        // 2. REAL WEBAUTHN CALL
        const credential = await navigator.credentials.create({ publicKey: options });
        
        appendLine(`[OK] Аппаратное подтверждение получено!`, 'text-green');
        await sleep(400);
        
        const credId = bufferToHex(credential.rawId);
        const pubKeyHex = credId.substring(0, 64); 
        const address = `sl1_${pubKeyHex.substring(0, 40)}`;
        
        appendLine(`[IDENTITY] Ваш уникальный адрес: <span style="color:var(--card-yellow);">${address}</span>`);
        await sleep(600);
        
        appendLine(`[NETWORK] Синхронизация с облачной нодой Wildflow...`);
        
        // 3. SYNC WITH NODE
        const syncRes = await fetch('/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                address,
                publicKey: pubKeyHex,
                credentialId: credId,
                handle
            })
        });
        
        const syncData = await syncRes.json();
        
        if (syncData.success) {
            appendLine(`[SUCCESS] Поздравляем! Ваша суверенная личность активирована.`, 'text-green');
            appendLine(`[GIFT] Вам зачислено: 1000 SL1 (приветственный бонус)`, 'text-yellow');
            
            // Trigger stats update
            updateNetworkStatus();
        } else {
            throw new Error(syncData.error || 'Ошибка синхронизации');
        }
        
    } catch (err) {
        appendLine(`[!] ОШИБКА: АКТИВАЦИЯ ПРЕРВАНА`, 'text-red');
        appendLine(`-> Причина: <span style="font-size:0.8rem;">${err.message}</span>`);
    }
    
    btnConsensus.disabled = false;
}

if (btnConsensus) {
    btnConsensus.addEventListener('click', runRealConsensus);
}
