/* -------------------------------------------------------------------------
   HA NETWORK STATUS POLLING (Quorum & Parallel Discovery)
-------------------------------------------------------------------------- */
window.known_peers = [];
window.active_node_url = ''; 

async function updateNetworkStatus() {
    const endpoints = [window.location.origin, ...window.known_peers];
    const uniqueEndpoints = [...new Set(endpoints)];
    
    // Parallel fetch from all nodes
    const results = await Promise.allSettled(uniqueEndpoints.map(async (url) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 2500);
        const response = await fetch(`${url}/api/status`, { signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) throw new Error('Down');
        return response.json();
    }));

    const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

    if (successful.length === 0) {
        document.getElementById('stat-consensus').textContent = 'OFFLINE';
        document.getElementById('stat-consensus').style.color = 'var(--clr-red)';
        return;
    }

    // AGGREGATE DATA (Quorum Logic)
    const maxAccounts = Math.max(...successful.map(s => s.total_accounts || 0));
    const avgUptime = successful.reduce((acc, s) => acc + (s.uptime || 0), 0) / successful.length;
    const allPeers = successful.flatMap(s => s.peers || []);
    window.known_peers = [...new Set([...window.known_peers, ...allPeers])].filter(p => p !== window.location.origin);

    // Update UI
    const elNodes = document.getElementById('stat-nodes');
    const elAccounts = document.getElementById('stat-accounts');
    const elUptime = document.getElementById('stat-uptime');
    const elConsensus = document.getElementById('stat-consensus');

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
        elConsensus.style.color = consensusPercent > 70 ? 'var(--clr-green)' : 'var(--card-yellow)';
    }

    // Also try to refresh account from the MOST fresh node (highest account count)
    if (window.currentAddress) {
        refreshAccountData();
    }
}

async function refreshAccountData() {
    if (!window.currentAddress) return;
    const endpoints = [window.location.origin, ...window.known_peers];
    
    // Try to find any node that has the account
    for (const url of endpoints) {
        try {
            const res = await fetch(`${url}/accounts/${window.currentAddress}`);
            if (res.ok) {
                const account = await res.json();
                window.currentAccount = account;
                updateAccountUI(account);
                return; // Found it
            }
        } catch (e) {}
    }
}

function updateAccountUI(account) {
    document.getElementById('balance-sl1').textContent = (account.balances.SL1 || 0).toLocaleString();
    document.getElementById('balance-btc').textContent = (account.balances.BTC || 0).toFixed(8);
    document.getElementById('balance-eth').textContent = (account.balances.ETH || 0).toFixed(4);

    const addrBTC = document.getElementById('addr-btc');
    const addrETH = document.getElementById('addr-eth');
    if (addrBTC) addrBTC.textContent = account.external_addresses.BTC || 'REVOKED';
    if (addrETH) addrETH.textContent = account.external_addresses.ETH || 'REVOKED';

    if (account.provenance_log) {
        const logContainer = document.getElementById('provenance-log');
        logContainer.innerHTML = account.provenance_log.map(entry => `
            <div class="log-entry">
                <div class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                <div><span class="log-type">${entry.type}</span> <span class="log-detail">${entry.detail}</span></div>
            </div>
        `).reverse().join('');
    }
}

setInterval(updateNetworkStatus, 3000);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   UI LOGIC
-------------------------------------------------------------------------- */
window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    const btn = event?.currentTarget || [...document.querySelectorAll('.tab-btn')].find(b => b.innerText.toLowerCase() === tabName);
    if (btn) btn.classList.add('active');
};

window.showSendForm = () => document.getElementById('send-form').style.display = 'flex';
window.hideSendForm = () => document.getElementById('send-form').style.display = 'none';

/* -------------------------------------------------------------------------
   CORE AUTHORIZATION
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
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runRealConsensus() {
    let handle = usernameInput.value || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    consoleOutput.innerHTML = '';
    btnConsensus.disabled = true;
    appendLine(`[AUTHORITY] Инициализация канонического корня для ${handle}...`, 'text-highlight');
    try {
        const address = `sl1_${Math.random().toString(16).substring(2, 42)}`;
        window.currentAddress = address;
        
        // Multi-node announcement (Announce to all known nodes)
        const endpoints = [window.location.origin, ...window.known_peers];
        let successCount = 0;
        
        for (const url of endpoints) {
            try {
                const res = await fetch(`${url}/accounts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address, publicKey: '0x...', credentialId: '...', handle })
                });
                if (res.ok) successCount++;
            } catch (e) {}
        }

        if (successCount > 0) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован на ${successCount} узлах.`, 'text-green');
            refreshAccountData();
            await sleep(1500); showTab('portfolio');
        }
    } catch (err) { appendLine(`[!] ОШИБКА: ${err.message}`, 'text-red'); }
    btnConsensus.disabled = false;
}

if (btnConsensus) btnConsensus.addEventListener('click', runRealConsensus);

/* -------------------------------------------------------------------------
   TRANSACTION EXECUTION
-------------------------------------------------------------------------- */
window.executeSend = async function() {
    const to_handle = document.getElementById('send-to').value;
    const amount = parseFloat(document.getElementById('send-amount').value);
    if (!to_handle || isNaN(amount)) return alert('Укажите получателя и сумму');
    
    const btn = event.currentTarget;
    btn.disabled = true;
    
    try {
        // Send to current origin, it will broadcast
        const res = await fetch('/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: window.currentAddress, to_handle, amount, asset: 'SL1' })
        });
        const data = await res.json();
        if (data.success) {
            hideSendForm();
            refreshAccountData();
        } else { throw new Error(data.error); }
    } catch (err) { alert(`Ошибка: ${err.message}`); }
    btn.disabled = false;
};
