console.log('🚀 SIMPLE-L1 APP v2.1.2 BOOTSTRAP...');

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
    console.log('[QUORUM] Starting network check...');
    
    const origin = window.location.origin.replace(/\/$/, '');
    const endpoints = [origin, ...window.known_peers].filter(Boolean);
    const uniqueEndpoints = [...new Set(endpoints.map(e => e.replace(/\/$/, '')))];
    
    let lastError = '';

    const results = await Promise.allSettled(uniqueEndpoints.map(async (url) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        try {
            // Use relative path for same-origin to avoid CORS complexity
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

    console.log(`[QUORUM] Success: ${successful.length} / ${uniqueEndpoints.length}`);

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
        const days = Math.floor(avgUptime / 86400);
        const hours = Math.floor((avgUptime % 86400) / 3600);
        const minutes = Math.floor((avgUptime % 3600) / 60);
        const seconds = Math.floor(avgUptime % 60);
        
        let uptimeStr = '';
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

setInterval(() => { updateNetworkStatus().catch(e => console.error('[POLL ERROR]', e)); }, 3000);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   UI LOGIC
-------------------------------------------------------------------------- */
window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.textContent.toLowerCase() === tabName.toLowerCase()) btn.classList.add('active');
    });
};

window.showSendForm = () => { const f = document.getElementById('send-form'); if (f) f.style.display = 'flex'; };
window.hideSendForm = () => { const f = document.getElementById('send-form'); if (f) f.style.display = 'none'; };

/* -------------------------------------------------------------------------
   IDENTITY ENGINE
-------------------------------------------------------------------------- */
const consoleOutput = document.getElementById('console-output');
const btnConsensus = document.getElementById('btn-trigger-consensus');
const usernameInput = document.getElementById('username-input');

function appendLine(text, className = '') {
    if (!consoleOutput) return;
    const line = document.createElement('div');
    line.className = 'terminal-line ' + className;
    line.innerHTML = text;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

async function runRealConsensus() {
    let handle = (usernameInput ? usernameInput.value : '') || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    if (consoleOutput) consoleOutput.innerHTML = '';
    if (btnConsensus) btnConsensus.disabled = true;
    appendLine(`[AUTHORITY] Инициализация канонического корня для ${handle}...`, 'text-highlight');
    try {
        const address = `sl1_${Math.random().toString(16).substring(2, 42)}`;
        window.currentAddress = address;
        const endpoints = [window.location.origin, ...window.known_peers].filter(Boolean);
        let successCount = 0;
        for (const url of endpoints) {
            try {
                const fetchUrl = url.replace(/\/$/, '') === window.location.origin.replace(/\/$/, '') ? '/accounts' : `${url.replace(/\/$/, '')}/accounts`;
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
if (btnConsensus) btnConsensus.addEventListener('click', runRealConsensus);

window.executeSend = async function() {
    const to = document.getElementById('send-to').value;
    const amt = parseFloat(document.getElementById('send-amount')?.value || '0');
    if (!to || isNaN(amt)) return alert('Укажите получателя и сумму');
    const btn = event.currentTarget; btn.disabled = true;
    try {
        const res = await fetch('/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: window.currentAddress, to_handle: to, amount: amt, asset: 'SL1' })
        });
        if ((await res.json()).success) { window.hideSendForm(); updateNetworkStatus(); }
    } catch (err) { alert(`Ошибка: ${err.message}`); }
    btn.disabled = false;
};
