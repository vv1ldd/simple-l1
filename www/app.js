/* -------------------------------------------------------------------------
   HA NETWORK STATUS POLLING (Quorum & Parallel Discovery)
-------------------------------------------------------------------------- */
window.known_peers = JSON.parse(localStorage.getItem('sl1_peers') || '[]');

async function updateNetworkStatus() {
    // Current origin + known peers
    const endpoints = [window.location.origin, ...window.known_peers].filter(Boolean);
    const uniqueEndpoints = [...new Set(endpoints.map(e => e.replace(/\/$/, '')))];
    
    console.log('[QUORUM] Polling nodes:', uniqueEndpoints);

    const results = await Promise.allSettled(uniqueEndpoints.map(async (url) => {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${url}/api/status`, { 
                mode: 'cors',
                signal: controller.signal 
            });
            clearTimeout(id);
            if (!response.ok) throw new Error('Status not OK');
            return await response.json();
        } catch (e) {
            console.warn(`[QUORUM] Node ${url} failed:`, e.message);
            throw e;
        }
    }));

    const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    // UI Elements
    const elNetwork = document.getElementById('stat-network');
    const elNodes = document.getElementById('stat-nodes');
    const elAccounts = document.getElementById('stat-accounts');
    const elUptime = document.getElementById('stat-uptime');
    const elConsensus = document.getElementById('stat-consensus');

    if (successful.length === 0) {
        if (elNetwork) elNetwork.textContent = 'OFFLINE';
        if (elConsensus) elConsensus.textContent = '0%';
        return;
    }

    // AGGREGATE DATA
    const firstNode = successful[0];
    const maxAccounts = Math.max(...successful.map(s => s.total_accounts || 0));
    const avgUptime = successful.reduce((acc, s) => acc + (s.uptime || 0), 0) / successful.length;
    
    // Peer Discovery
    const discoveredPeers = successful.flatMap(s => s.peers || []);
    if (discoveredPeers.length > 0) {
        const newPeers = [...new Set([...window.known_peers, ...discoveredPeers])]
            .filter(p => p && p !== window.location.origin);
        if (newPeers.length !== window.known_peers.length) {
            window.known_peers = newPeers;
            localStorage.setItem('sl1_peers', JSON.stringify(newPeers));
        }
    }

    // Update UI
    if (elNetwork) elNetwork.textContent = firstNode.network || 'Simple-L1';
    if (elNodes) elNodes.textContent = `${successful.length} / ${uniqueEndpoints.length} UP`;
    if (elAccounts) elAccounts.textContent = maxAccounts;
    
    if (elUptime) {
        const minutes = Math.floor(avgUptime / 60);
        const seconds = Math.floor(avgUptime % 60);
        elUptime.textContent = `${minutes}m ${seconds}s`;
    }

    if (elConsensus) {
        const consensusPercent = Math.round((successful.length / uniqueEndpoints.length) * 100);
        elConsensus.textContent = `${consensusPercent}%`;
        elConsensus.style.color = consensusPercent >= 100 ? '#00ff00' : '#ffcc00';
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
    const elBalSL1 = document.getElementById('balance-sl1');
    const elBalBTC = document.getElementById('balance-btc');
    const elBalETH = document.getElementById('balance-eth');
    
    if (elBalSL1) elBalSL1.textContent = (account.balances.SL1 || 0).toLocaleString();
    if (elBalBTC) elBalBTC.textContent = (account.balances.BTC || 0).toFixed(8);
    if (elBalETH) elBalETH.textContent = (account.balances.ETH || 0).toFixed(4);

    const addrBTC = document.getElementById('addr-btc');
    const addrETH = document.getElementById('addr-eth');
    if (addrBTC) addrBTC.textContent = (account.external_addresses || {}).BTC || 'REVOKED';
    if (addrETH) addrETH.textContent = (account.external_addresses || {}).ETH || 'REVOKED';

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

setInterval(updateNetworkStatus, 3000);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   UI TABS & NAVIGATION
-------------------------------------------------------------------------- */
window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    
    // Find the button by text or specific logic
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
   IDENTITY & CONSENSUS ENGINE
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
    let handle = usernameInput.value || '@anonymous';
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
    const amount = parseFloat(document.getElementById('stat-send-amount')?.value || document.getElementById('send-amount')?.value);
    
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
