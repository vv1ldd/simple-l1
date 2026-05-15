window.copyInstallCmd = function() {
    const cmd = document.getElementById('install-cmd').textContent;
    navigator.clipboard.writeText(cmd).then(() => {
        alert('Command copied to clipboard!');
    });
};

console.log('🚀 SIMPLE-L1 APP v2.1.5 BOOTSTRAP...');

window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('[CRITICAL ERROR]', msg, 'at', lineNo, ':', columnNo);
    const el = document.getElementById('stat-network');
    if (el) el.textContent = 'JS ERR: ' + msg.substring(0, 10);
    return false;
};

/* -------------------------------------------------------------------------
   HA NETWORK STATUS POLLING (Quorum & Parallel Discovery)
-------------------------------------------------------------------------- */
window.known_peers = [];
try {
    const saved = localStorage.getItem('sl1_peers');
    if (saved) window.known_peers = JSON.parse(saved);
} catch (e) { console.warn('[BOOT] LocalStorage access failed'); }

async function updateNetworkStatus() {
    const origin = window.location.origin.replace(/\/$/, '');
    
    // ПУЛ СЕМЯН (SEEDS): Глобальные точки входа для обнаружения сети
    const seeds = [
        'https://l1.wildflow.dev',
        'https://l1-beta.wildflow.dev',
        'https://l1-gamma.wildflow.dev'
    ];

    const endpoints = [origin, ...seeds, ...window.known_peers].filter(Boolean);
    const uniqueEndpoints = [...new Set(endpoints.map(e => e.replace(/\/$/, '')))];
    
    let lastError = '';

    const results = await Promise.allSettled(uniqueEndpoints.map(async (url) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        try {
            const fetchUrl = url === origin ? '/api/status' : `${url}/api/status`;
            const response = await fetch(fetchUrl, { 
                mode: url === origin ? 'same-origin' : 'cors',
                signal: controller.signal 
            });
            clearTimeout(id);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (e) {
            clearTimeout(id);
            lastError = e.message;
            throw e;
        }
    }));

    const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    const elNet = document.getElementById('stat-network');
    const elNodes = document.getElementById('stat-nodes');
    const elAcc = document.getElementById('stat-accounts');
    const elUp = document.getElementById('stat-uptime');
    const elCon = document.getElementById('stat-consensus');

    if (successful.length === 0) {
        if (elNet) elNet.textContent = `OFFLINE (${lastError || 'ERR'})`;
        if (elCon) elCon.textContent = '0%';
        return;
    }

    const first = successful[0];
    const maxAccounts = Math.max(...successful.map(s => s.total_accounts || 0));
    const avgUptime = successful.reduce((acc, s) => acc + (s.uptime || 0), 0) / successful.length;
    
    const discovered = successful.flatMap(s => s.peers || []);
    if (discovered.length > 0) {
        const newPeers = [...new Set([...window.known_peers, ...discovered])]
            .filter(p => p && p.replace(/\/$/, '') !== origin);
        if (newPeers.length !== window.known_peers.length) {
            window.known_peers = newPeers;
            localStorage.setItem('sl1_peers', JSON.stringify(newPeers));
        }
    }

    if (elNet) elNet.textContent = first.network || 'Simple-L1 Alpha';
    if (elNodes) elNodes.textContent = `${successful.length} / ${uniqueEndpoints.length} UP`;
    if (elAcc) elAcc.textContent = maxAccounts;
    
    if (elUp) {
        let totalSecs = Math.floor(avgUptime);
        const years = Math.floor(totalSecs / 31536000);
        totalSecs %= 31536000;
        const months = Math.floor(totalSecs / 2592000);
        totalSecs %= 2592000;
        const days = Math.floor(totalSecs / 86400);
        totalSecs %= 86400;
        const hours = Math.floor(totalSecs / 3600);
        totalSecs %= 3600;
        const minutes = Math.floor(totalSecs / 60);
        const seconds = totalSecs % 60;
        
        let uptimeStr = '';
        if (years > 0) uptimeStr += `${years}y `;
        if (months > 0) uptimeStr += `${months}mo `;
        if (days > 0) uptimeStr += `${days}d `;
        if (hours > 0 || days > 0) uptimeStr += `${hours}h `;
        uptimeStr += `${minutes}m ${seconds}s`;
        elUp.textContent = uptimeStr;
    }

    if (elCon) {
        const pct = Math.round((successful.length / uniqueEndpoints.length) * 100);
        elCon.textContent = `${pct}%`;
        elCon.style.color = pct >= 100 ? '#00ff00' : '#ffcc00';
    }

    if (window.currentAddress) refreshAccountData(uniqueEndpoints);
}

async function refreshAccountData(endpoints) {
    if (!window.currentAddress) return;
    for (const url of endpoints) {
        try {
            const fetchUrl = url.replace(/\/$/, '') === window.location.origin.replace(/\/$/, '') 
                ? `/accounts/${window.currentAddress}` 
                : `${url}/accounts/${window.currentAddress}`;
            const res = await fetch(fetchUrl);
            if (res.ok) {
                const account = await res.json();
                window.currentAccount = account;
                updateAccountUI(account);
                return;
            }
        } catch (e) {}
    }
}

function updateAccountUI(account) {
    const ids = {
        'balance-sl1': (account.balances.SL1 || 0).toLocaleString(),
        'balance-btc': (account.balances.BTC || 0).toFixed(8),
        'balance-eth': (account.balances.ETH || 0).toFixed(4),
        'addr-btc': (account.external_addresses || {}).BTC || 'REVOKED',
        'addr-eth': (account.external_addresses || {}).ETH || 'REVOKED'
    };
    for (const [id, val] of Object.entries(ids)) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }
    if (account.provenance_log) {
        const logContainer = document.getElementById('provenance-log');
        if (logContainer) {
            logContainer.innerHTML = account.provenance_log.map(entry => `
                <div class="log-entry">
                    <div class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                    <div><span class="log-type">${entry.type}</span> <span class="log-detail">${entry.detail}</span></div>
                </div>
            `).reverse().join('');
        }
    }
}

window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('onclick').includes(`'${tabName}'`)) {
            btn.classList.add('active');
        }
    });
};

window.showSendForm = () => { const f = document.getElementById('send-form'); if (f) f.style.display = 'flex'; };
window.hideSendForm = () => { const f = document.getElementById('send-form'); if (f) f.style.display = 'none'; };

async function runRealConsensus() {
    const usernameInput = document.getElementById('username-input');
    let handle = (usernameInput ? usernameInput.value : '') || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    const consoleOutput = document.getElementById('console-output');
    if (consoleOutput) consoleOutput.innerHTML = '';
    const btnConsensus = document.getElementById('btn-trigger-consensus');
    if (btnConsensus) btnConsensus.disabled = true;
    
    function appendLine(text, className = '') {
        if (!consoleOutput) return;
        const line = document.createElement('div');
        line.className = 'terminal-line ' + className;
        line.innerHTML = text;
        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    appendLine(`[AUTHORITY] Инициализация канонического корня для ${handle}...`, 'text-highlight');
    try {
        const address = `sl1_${Math.random().toString(16).substring(2, 42)}`;
        window.currentAddress = address;
        const origin = window.location.origin.replace(/\/$/, '');
        const endpoints = [origin, ...window.known_peers].filter(Boolean);
        let successCount = 0;
        for (const url of endpoints) {
            try {
                const fetchUrl = url === origin ? '/accounts' : `${url}/accounts`;
                const res = await fetch(fetchUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, publicKey: '0x...', credentialId: '...', handle })
                });
                if (res.ok) successCount++;
            } catch (e) {}
        }
        if (successCount > 0) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован на ${successCount} узлах.`, 'text-green');
            setTimeout(() => { updateNetworkStatus(); window.showTab('portfolio'); }, 1500);
        } else { throw new Error('Could not reach any node'); }
    } catch (err) { appendLine(`[!] ОШИБКА: ${err.message}`, 'text-red'); }
    if (btnConsensus) btnConsensus.disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
    updateNetworkStatus();
    setInterval(updateNetworkStatus, 5000);
    const btn = document.getElementById('btn-trigger-consensus');
    if (btn) btn.addEventListener('click', runRealConsensus);
});
