console.log('🚀 SIMPLE-L1 APP BOOTSTRAP...');

window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('[CRITICAL ERROR]', msg, 'at', lineNo, ':', columnNo);
    const el = document.getElementById('stat-network');
    if (el) el.textContent = 'ERR: ' + msg.substring(0, 15);
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
    
    // 1. Prepare endpoints
    const origin = window.location.origin.replace(/\/$/, '');
    const endpoints = [origin, ...window.known_peers].filter(Boolean);
    const uniqueEndpoints = [...new Set(endpoints.map(e => e.replace(/\/$/, '')))];
    
    // 2. Parallel Query
    const results = await Promise.allSettled(uniqueEndpoints.map(async (url) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch(`${url}/api/status`, { 
                mode: 'cors',
                signal: controller.signal 
            });
            clearTimeout(id);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return await response.json();
        } catch (e) {
            clearTimeout(id);
            throw e;
        }
    }));

    // 3. Process Results
    const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    console.log(`[QUORUM] Success: ${successful.length} / ${uniqueEndpoints.length}`);

    // UI Elements
    const elNet = document.getElementById('stat-network');
    const elNodes = document.getElementById('stat-nodes');
    const elAcc = document.getElementById('stat-accounts');
    const elUp = document.getElementById('stat-uptime');
    const elCon = document.getElementById('stat-consensus');

    if (successful.length === 0) {
        if (elNet) elNet.textContent = 'OFFLINE';
        if (elCon) elCon.textContent = '0%';
        return;
    }

    // 4. Aggregate
    const first = successful[0];
    const maxAccounts = Math.max(...successful.map(s => s.total_accounts || 0));
    const avgUptime = successful.reduce((acc, s) => acc + (s.uptime || 0), 0) / successful.length;
    
    // Discovery
    const discovered = successful.flatMap(s => s.peers || []);
    if (discovered.length > 0) {
        const newPeers = [...new Set([...window.known_peers, ...discovered])]
            .filter(p => p && p.replace(/\/$/, '') !== origin);
        if (newPeers.length !== window.known_peers.length) {
            window.known_peers = newPeers;
            localStorage.setItem('sl1_peers', JSON.stringify(newPeers));
        }
    }

    // 5. Update UI
    if (elNet) elNet.textContent = first.network || 'Simple-L1 Alpha';
    if (elNodes) elNodes.textContent = `${successful.length} / ${uniqueEndpoints.length} UP`;
    if (elAcc) elAcc.textContent = maxAccounts;
    
    if (elUp) {
        const min = Math.floor(avgUptime / 60);
        const sec = Math.floor(avgUptime % 60);
        elUp.textContent = `${min}m ${sec}s`;
    }

    if (elCon) {
        const pct = Math.round((successful.length / uniqueEndpoints.length) * 100);
        elCon.textContent = `${pct}%`;
        elCon.style.color = pct >= 100 ? '#00ff00' : '#ffcc00';
    }

    if (window.currentAddress) {
        refreshAccountData(uniqueEndpoints);
    }
}

async function refreshAccountData(endpoints) {
    if (!window.currentAddress) return;
    for (const url of endpoints) {
        try {
            const res = await fetch(`${url}/accounts/${window.currentAddress}`);
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

// Start polling
setInterval(() => {
    updateNetworkStatus().catch(e => console.error('[POLL ERROR]', e));
}, 3000);

document.addEventListener('DOMContentLoaded', () => {
    console.log('[BOOT] DOM Content Loaded');
    updateNetworkStatus();
});

/* -------------------------------------------------------------------------
   UI TABS & NAVIGATION
-------------------------------------------------------------------------- */
window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    
    const btns = document.querySelectorAll('.tab-btn');
    btns.forEach(btn => {
        if (btn.textContent.toLowerCase() === tabName.toLowerCase()) {
            btn.classList.add('active');
        }
    });
};

window.showSendForm = () => {
    const form = document.getElementById('send-form');
    if (form) form.style.display = 'flex';
};
window.hideSendForm = () => {
    const form = document.getElementById('send-form');
    if (form) form.style.display = 'none';
};

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
        
        const origin = window.location.origin.replace(/\/$/, '');
        const endpoints = [origin, ...window.known_peers].filter(Boolean);
        let successCount = 0;
        
        for (const url of endpoints) {
            try {
                const res = await fetch(`${url.replace(/\/$/, '')}/accounts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, publicKey: '0x...', credentialId: '...', handle })
                });
                if (res.ok) successCount++;
            } catch (e) {
                console.error(`[SYNC] Failed to announce to ${url}:`, e);
            }
        }

        if (successCount > 0) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован на ${successCount} узлах.`, 'text-green');
            setTimeout(() => {
                updateNetworkStatus();
                window.showTab('portfolio');
            }, 1500);
        } else {
            throw new Error('Could not reach any node for registration');
        }
    } catch (err) { 
        appendLine(`[!] ОШИБКА: ${err.message}`, 'text-red'); 
    }
    if (btnConsensus) btnConsensus.disabled = false;
}

if (btnConsensus) btnConsensus.addEventListener('click', runRealConsensus);

/* -------------------------------------------------------------------------
   TRANSACTIONS
-------------------------------------------------------------------------- */
window.executeSend = async function() {
    const to_handle = document.getElementById('send-to').value;
    const amount = parseFloat(document.getElementById('send-amount')?.value || '0');
    
    if (!to_handle || isNaN(amount)) return alert('Укажите получателя и сумму');
    
    const btn = event.currentTarget;
    btn.disabled = true;
    
    try {
        const res = await fetch('/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: window.currentAddress, to_handle, amount, asset: 'SL1' })
        });
        const data = await res.json();
        if (data.success) {
            window.hideSendForm();
            updateNetworkStatus();
        } else { throw new Error(data.error); }
    } catch (err) { alert(`Ошибка: ${err.message}`); }
    btn.disabled = false;
};
