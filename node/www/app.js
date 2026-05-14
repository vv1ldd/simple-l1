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
   TERMINAL EMULATOR LOGIC
-------------------------------------------------------------------------- */
const consoleOutput = document.getElementById('console-output');
const btnConsensus = document.getElementById('btn-trigger-consensus');
const usernameInput = document.getElementById('username-input');

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

async function runSimulation() {
    const handle = usernameInput.value || '@anonymous';
    
    consoleOutput.innerHTML = '';
    btnConsensus.disabled = true;
    
    appendLine(`[SYSTEM] Initializing Simple-L1 Deterministic Engine...`, 'text-highlight');
    await sleep(800);
    
    appendLine(`[AUTH] Fetching Hardware Attestation from Secure Enclave...`);
    await sleep(1200);
    
    // Simulate WebAuthn/Passkey registration
    appendLine(`[WEBAUTHN] Requesting Assertion for RP: l1.wildflow.dev`);
    appendLine(`[WEBAUTHN] Biometric Challenge Issued. Waiting for user...`, 'text-yellow');
    
    try {
        // Here we simulate the process
        await sleep(2000);
        appendLine(`[WEBAUTHN] Authentication Success!`, 'text-green');
        
        const pubKeyHex = "04" + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const address = `sl1_${pubKeyHex.substring(0, 40)}`;
        
        appendLine(`[IDENTITY] Derived Address: <span style="color:var(--card-yellow);">${address}</span>`);
        await sleep(500);
        
        appendLine(`[BORSH] Serializing Intent: { action: "REGISTER", handle: "${handle}" }`);
        await sleep(600);
        
        appendLine(`[CONSENSUS] Proposing Block #1 [Hash: 0x${Math.random().toString(16).slice(2, 10)}...]`);
        await sleep(1000);
        
        appendLine(`[NETWORK] Broadcasting to Validators...`);
        await sleep(800);
        
        appendLine(`[DONE] Identity Registered Successfully on Cloud Node!`, 'text-green');
        
    } catch (err) {
        appendLine(`[ERROR] Consensus Failed: ${err.message}`, 'text-red');
    }
    
    btnConsensus.disabled = false;
}

if (btnConsensus) {
    btnConsensus.addEventListener('click', runSimulation);
}
