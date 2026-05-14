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
        
        // Update Balances
        document.getElementById('balance-sl1').textContent = account.balances.SL1.toLocaleString();
        document.getElementById('balance-btc').textContent = account.balances.BTC.toFixed(8);
        document.getElementById('balance-eth').textContent = (account.balances.ETH || 0).toFixed(4);

        // Update Projections
        if (account.external_addresses) {
            document.getElementById('addr-btc').textContent = account.external_addresses.BTC;
            document.getElementById('addr-eth').textContent = account.external_addresses.ETH;
        }

        // Update Policies
        if (account.authority_policies) {
            const list = document.getElementById('policy-list');
            list.innerHTML = account.authority_policies.active_policies.map(p => `<div class="policy-item">✓ ${p}</div>`).join('');
            
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
                </div>
            `).reverse().join('');
        }
    } catch (err) {}
}

setInterval(updateNetworkStatus, 5000);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   TABS & UI LOGIC
-------------------------------------------------------------------------- */
window.showTab = function(tabName) {
    document.querySelectorAll('.terminal-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).classList.add('active');
    // Find the button that was clicked or the button with matching tabName
    const btn = event?.currentTarget || [...document.querySelectorAll('.tab-btn')].find(b => b.innerText.toLowerCase() === tabName);
    if (btn) btn.classList.add('active');
};

window.showSendForm = () => document.getElementById('send-form').style.display = 'flex';
window.hideSendForm = () => document.getElementById('send-form').style.display = 'none';

/* -------------------------------------------------------------------------
   I18N & TERMINAL UTILS
-------------------------------------------------------------------------- */
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

function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        buffer[i] = binary.charCodeAt(i);
    }
    return buffer.buffer;
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/* -------------------------------------------------------------------------
   CORE ORCHESTRATION: REGISTRATION & TRANSACTIONS
-------------------------------------------------------------------------- */
const consoleOutput = document.getElementById('console-output');
const btnConsensus = document.getElementById('btn-trigger-consensus');
const usernameInput = document.getElementById('username-input');

async function runRealConsensus() {
    let handle = usernameInput.value || '@anonymous';
    if (!handle.startsWith('@')) handle = '@' + handle;
    
    consoleOutput.innerHTML = '';
    btnConsensus.disabled = true;
    
    appendLine(`[AUTHORITY] Инициализация канонического корня для ${handle}...`, 'text-highlight');
    await sleep(500);
    
    try {
        appendLine(`>>> [1/5] АНКОРИНГ: Привязка авторитета к аппаратному анклаву...`);
        const optionsRes = await fetch(`/api/register/options?handle=${encodeURIComponent(handle)}`);
        const options = await optionsRes.json();
        options.challenge = base64ToBuffer(options.challenge);
        options.user.id = base64ToBuffer(options.user.id);
        
        appendLine(`[ACTION] Подпишите глобальный манифест личности через TouchID/FaceID...`, 'text-yellow');
        const credential = await navigator.credentials.create({ publicKey: options });
        
        appendLine(`[OK] Hardware-bound Authority Established!`, 'text-green');
        const credId = bufferToHex(credential.rawId);
        const pubKeyHex = credId.substring(0, 64); 
        const address = `sl1_${pubKeyHex.substring(0, 40)}`;
        window.currentAddress = address;
        
        appendLine(`[ROOT] Canonical ID: <span style="color:var(--card-yellow);">${address}</span>`);
        await sleep(600);
        appendLine(`[PROJECTION] Развертывание расчетных интерфейсов BTC и ETH...`);
        
        const syncRes = await fetch('/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, publicKey: pubKeyHex, credentialId: credId, handle })
        });
        const syncData = await syncRes.json();
        
        if (syncData.success) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован.`, 'text-green');
            refreshAccountData();
            await sleep(1500);
            showTab('portfolio');
        } else { throw new Error('Ошибка манифеста'); }
        
    } catch (err) {
        appendLine(`[!] ОШИБКА: НАРУШЕНИЕ ЦЕПОЧКИ АВТОРИТЕТА`, 'text-red');
        appendLine(`-> Причина: <span style="font-size:0.8rem;">${err.message}</span>`);
    }
    btnConsensus.disabled = false;
}

if (btnConsensus) btnConsensus.addEventListener('click', runRealConsensus);

/* -------------------------------------------------------------------------
   INTENT EXECUTION: SEND & DEPOSIT
-------------------------------------------------------------------------- */
window.executeSend = async function() {
    const toHandle = document.getElementById('send-to').value;
    const amount = parseFloat(document.getElementById('send-amount').value);
    
    if (!toHandle || isNaN(amount)) return alert('Укажите получателя и сумму');
    
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.innerHTML = 'AUTHORIZING INTENT...';
    
    try {
        // In a real system, we would sign this intent with WebAuthn here
        // For the MVP demo, we assume the session is active
        appendLine(`[INTENT] Создание намерения: ${amount} SL1 -> ${toHandle}...`, 'text-highlight');
        
        const res = await fetch('/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: window.currentAddress, to_handle: toHandle, amount, asset: 'SL1' })
        });
        
        const data = await res.json();
        if (data.success) {
            btn.innerHTML = 'INTENT EXECUTED! ✨';
            btn.classList.replace('btn-purple', 'btn-green');
            hideSendForm();
            refreshAccountData();
            setTimeout(() => {
                btn.innerHTML = 'CONFIRM INTENT';
                btn.classList.replace('btn-green', 'btn-purple');
                btn.disabled = false;
            }, 3000);
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        alert(`Ошибка: ${err.message}`);
        btn.innerHTML = 'CONFIRM INTENT';
        btn.disabled = false;
    }
};

window.initiateBTCDeposit = async function() {
    if (!window.currentAddress) { alert('Сначала активируйте ROOT AUTHORITY'); showTab('identity'); return; }
    const btn = event.currentTarget;
    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'SYNCING PROJECTION...';
    try {
        const res = await fetch('/api/assets/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sl1_address: window.currentAddress, asset: 'BTC' })
        });
        const { deposit_address } = await res.json();
        btn.innerHTML = `BTC ADDR: <span style="font-size:0.6rem;">${deposit_address}</span>`;
        await sleep(4000);
        btn.innerHTML = 'SETTLEMENT IN PROGRESS...';
        await sleep(2000);
        const mintRes = await fetch('/api/assets/simulate-mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ btc_address: deposit_address, amount: 0.125 })
        });
        if (mintRes.ok) {
            btn.innerHTML = 'SETTLEMENT COMPLETE! ✨';
            refreshAccountData();
            setTimeout(() => { btn.innerHTML = oldText; btn.disabled = false; }, 5000);
        }
    } catch (err) { btn.innerHTML = 'FAILED'; btn.disabled = false; }
};
