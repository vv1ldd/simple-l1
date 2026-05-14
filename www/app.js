/* -------------------------------------------------------------------------
   NETWORK STATUS POLLING & DATA REFRESH
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
        
        if (window.currentAddress) {
            refreshAccountData();
        }
        
    } catch (err) {
        console.warn('Failed to fetch network status:', err);
    }
}

async function refreshAccountData() {
    if (!window.currentAddress) return;
    try {
        const res = await fetch(`/accounts/${window.currentAddress}`);
        if (!res.ok) return;
        const account = await res.json();
        window.currentAccount = account; 
        
        // Update Balances
        document.getElementById('balance-sl1').textContent = account.balances.SL1.toLocaleString();
        document.getElementById('balance-btc').textContent = account.balances.BTC.toFixed(8);
        document.getElementById('balance-eth').textContent = (account.balances.ETH || 0).toFixed(4);

        // Update Status Indicators
        const hasPendingBTC = account.provenance_log.some(e => e.type === 'SETTLE_START') && 
                             !account.provenance_log.some(e => e.type === 'SETTLE_FINAL' && new Date(e.timestamp) > new Date(account.provenance_log.find(x => x.type === 'SETTLE_START').timestamp));
        
        const elStatusBTC = document.getElementById('status-btc');
        if (elStatusBTC) {
            if (hasPendingBTC) {
                elStatusBTC.textContent = 'STATUS: SETTLING';
                elStatusBTC.style.color = 'var(--card-yellow)';
            } else {
                elStatusBTC.textContent = 'STATUS: FINALIZED';
                elStatusBTC.style.color = '#888';
            }
        }

        // Update Projections (Handle Revocation)
        const addrBTC = document.getElementById('addr-btc');
        const addrETH = document.getElementById('addr-eth');
        if (addrBTC) addrBTC.textContent = account.external_addresses.BTC || 'REVOKED';
        if (addrETH) addrETH.textContent = account.external_addresses.ETH || 'REVOKED';

        // Update Policies
        if (account.authority_policies) {
            const list = document.getElementById('policy-list');
            let policyItems = account.authority_policies.active_policies.map(p => `<div class="policy-item">✓ ${p}</div>`);
            if (account.authority_policies.delegations) {
                account.authority_policies.delegations.forEach(d => {
                    policyItems.push(`<div class="policy-item" style="color:var(--card-yellow)">→ Delegate: ${d.to} (${d.limit} ${d.asset})</div>`);
                });
            }
            list.innerHTML = policyItems.join('');
            
            const scope = document.getElementById('policy-scope');
            scope.innerHTML = account.authority_policies.intent_scope.map(s => `<span class="tag">${s.toUpperCase()}</span>`).join('');
        }

        // Update Provenance Log
        if (account.provenance_log) {
            const logContainer = document.getElementById('provenance-log');
            logContainer.innerHTML = account.provenance_log.map(entry => `
                <div class="log-entry">
                    <div class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</div>
                    <div><span class="log-type">${entry.type}</span> <span class="log-detail">${entry.detail}</span></div>
                    ${entry.intent_hash ? `<div class="log-meta">INTENT: ${entry.intent_hash.substring(0, 12)}...</div>` : ''}
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
   AUTHORITY MANAGEMENT (DELEGATE / REVOKE)
-------------------------------------------------------------------------- */
window.executeDelegate = async function() {
    const target = document.getElementById('delegate-to').value;
    const limit = parseFloat(document.getElementById('delegate-limit').value);
    if (!target || isNaN(limit)) return alert('Укажите получателя и лимит');

    const btn = event.currentTarget;
    btn.disabled = true;
    
    try {
        const res = await fetch('/api/authority/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: window.currentAddress, type: 'DELEGATE', target, asset: 'SL1', limit })
        });
        if ((await res.json()).success) {
            refreshAccountData();
            alert(`Доступ к ${limit} SL1 делегирован пользователю ${target}`);
        }
    } catch (err) { alert('Ошибка делегирования'); }
    btn.disabled = false;
};

window.revokeProjection = async function(asset) {
    if (!confirm(`Вы уверены, что хотите отозвать проекцию ${asset}? Это действие необратимо.`)) return;
    try {
        const res = await fetch('/api/authority/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: window.currentAddress, type: 'REVOKE', asset })
        });
        if ((await res.json()).success) {
            refreshAccountData();
        }
    } catch (err) { alert('Ошибка отзыва'); }
};

/* -------------------------------------------------------------------------
   CORE AUTHORIZATION & ORCHESTRATION
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

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runRealConsensus() {
    let handle = usernameInput.value || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    consoleOutput.innerHTML = '';
    btnConsensus.disabled = true;
    appendLine(`[AUTHORITY] Инициализация канонического корня для ${handle}...`, 'text-highlight');
    try {
        const optionsRes = await fetch(`/api/register/options?handle=${encodeURIComponent(handle)}`);
        const options = await optionsRes.json();
        // WebAuthn simulation / registration
        const address = `sl1_${Math.random().toString(16).substring(2, 42)}`;
        window.currentAddress = address;
        const syncRes = await fetch('/accounts', {
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

window.initiateBTCDeposit = async function() {
    if (!window.currentAddress) return;
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
        const res = await fetch('/api/assets/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sl1_address: window.currentAddress, asset: 'BTC' })
        });
        const { deposit_address } = await res.json();
        btn.innerHTML = `BTC: ${deposit_address.substring(0, 10)}...`;
        await sleep(3000);
        await fetch('/api/assets/simulate-mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ btc_address: deposit_address, amount: 0.125 })
        });
        refreshAccountData();
        setTimeout(() => { btn.innerHTML = '+ DEPOSIT BTC'; btn.disabled = false; }, 4000);
    } catch (err) { btn.disabled = false; }
};
