/* -------------------------------------------------------------------------
   HA NETWORK STATUS POLLING (Failover Logic)
-------------------------------------------------------------------------- */
window.known_peers = [];
window.active_node_url = ''; // Empty means current origin

async function smartFetch(path, options = {}) {
    const urls = [window.active_node_url, ...window.known_peers, ''];
    for (const baseUrl of urls) {
        try {
            const fullUrl = baseUrl ? (baseUrl.endsWith('/') ? baseUrl + path.substring(1) : baseUrl + path) : path;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000); // 3s timeout
            
            const response = await fetch(fullUrl, { ...options, signal: controller.signal });
            clearTimeout(id);
            
            if (response.ok) {
                if (baseUrl !== window.active_node_url) {
                    console.log(`[HA] Switched active node to: ${baseUrl || 'origin'}`);
                    window.active_node_url = baseUrl;
                }
                return response;
            }
        } catch (err) {
            console.warn(`[HA] Node ${baseUrl || 'origin'} failed, trying next...`);
        }
    }
    throw new Error('All nodes unreachable');
}

async function updateNetworkStatus() {
    try {
        const response = await smartFetch('/api/status');
        const data = await response.json();
        
        // Discovery: Update peers list
        if (data.peers && data.peers.length > 0) {
            window.known_peers = [...new Set([...window.known_peers, ...data.peers])];
        }

        const elNetwork = document.getElementById('stat-network');
        const elNodes = document.getElementById('stat-nodes');
        const elAccounts = document.getElementById('stat-accounts');
        const elUptime = document.getElementById('stat-uptime');

        if (elNetwork) {
            elNetwork.textContent = data.node_name ? `${data.network} (${data.node_name})` : data.network;
        }
        
        if (elNodes) {
            const totalNodes = (data.peers || []).length + 1;
            elNodes.textContent = `${totalNodes} (Live)`;
        }

        if (elAccounts) elAccounts.textContent = data.total_accounts;
        
        if (elUptime) {
            const minutes = Math.floor(data.uptime / 60);
            const seconds = Math.floor(data.uptime % 60);
            elUptime.textContent = `${minutes}m ${seconds}s`;
        }
        
        if (window.currentAddress) {
            refreshAccountData();
        }
        
    } catch (err) {
        console.error('[HA] Network totally offline');
    }
}

async function refreshAccountData() {
    if (!window.currentAddress) return;
    try {
        const res = await smartFetch(`/accounts/${window.currentAddress}`);
        const account = await res.json();
        window.currentAccount = account; 
        
        // Update UI
        document.getElementById('balance-sl1').textContent = (account.balances.SL1 || 0).toLocaleString();
        document.getElementById('balance-btc').textContent = (account.balances.BTC || 0).toFixed(8);
        document.getElementById('balance-eth').textContent = (account.balances.ETH || 0).toFixed(4);

        const addrBTC = document.getElementById('addr-btc');
        const addrETH = document.getElementById('addr-eth');
        if (addrBTC) addrBTC.textContent = account.external_addresses.BTC || 'REVOKED';
        if (addrETH) addrETH.textContent = account.external_addresses.ETH || 'REVOKED';

        if (account.authority_policies) {
            const list = document.getElementById('policy-list');
            let policyItems = account.authority_policies.active_policies.map(p => `<div class="policy-item">✓ ${p}</div>`);
            list.innerHTML = policyItems.join('');
        }

        if (account.provenance_log) {
            const logContainer = document.getElementById('provenance-log');
            logContainer.innerHTML = account.provenance_log.map(entry => `
                <div class="log-entry">
                    <div class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                    <div><span class="log-type">${entry.type}</span> <span class="log-detail">${entry.detail}</span></div>
                </div>
            `).reverse().join('');
        }
    } catch (err) {}
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
        const syncRes = await smartFetch('/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, publicKey: '0x...', credentialId: '...', handle })
        });
        if ((await syncRes.json()).success) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован.`, 'text-green');
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
        const res = await smartFetch('/transactions', {
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

window.initiateBTCDeposit = async function() {
    if (!window.currentAddress) return;
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
        const res = await smartFetch('/api/assets/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sl1_address: window.currentAddress, asset: 'BTC' })
        });
        const { deposit_address } = await res.json();
        btn.innerHTML = `BTC: ${deposit_address.substring(0, 10)}...`;
        await sleep(3000);
        await smartFetch('/api/assets/simulate-mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ btc_address: deposit_address, amount: 0.125 })
        });
        refreshAccountData();
        setTimeout(() => { btn.innerHTML = '+ DEPOSIT BTC'; btn.disabled = false; }, 4000);
    } catch (err) { btn.disabled = false; }
};
