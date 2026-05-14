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

        // Update Status Indicators (Asynchronous Finality)
        const hasPendingBTC = account.provenance_log.some(e => e.type === 'SETTLE_START') && 
                             !account.provenance_log.some(e => e.type === 'SETTLE_FINAL' && new Date(e.timestamp) > new Date(account.provenance_log.find(x => x.type === 'SETTLE_START').timestamp));
        
        const elStatusBTC = document.getElementById('status-btc');
        if (hasPendingBTC) {
            elStatusBTC.textContent = 'STATUS: SETTLING (WAITING CONFIRMATIONS)';
            elStatusBTC.style.color = 'var(--card-yellow)';
        } else {
            elStatusBTC.textContent = 'STATUS: FINALIZED';
            elStatusBTC.style.color = '#888';
        }

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
                    ${entry.intent_hash ? `<div class="log-meta">INTENT: ${entry.intent_hash.substring(0, 12)}...</div>` : ''}
                    ${entry.signature ? `<div class="log-meta">PROOF: ${entry.signature}</div>` : ''}
                </div>
            `).reverse().join('');
        }
    } catch (err) {}
}

setInterval(updateNetworkStatus, 3000); // Polling faster for better async feedback
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

/* -------------------------------------------------------------------------
   TABS & UI LOGIC
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
   UTILITIES
-------------------------------------------------------------------------- */
function appendLine(text, className = '') {
    const line = document.createElement('div');
    line.className = 'terminal-line ' + className;
    line.innerHTML = text;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
    return line;
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function base64ToBuffer(base64) {
    const binary = window.atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) { buffer[i] = binary.charCodeAt(i); }
    return buffer.buffer;
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bufferToBase64URL(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const charCode of bytes) { str += String.fromCharCode(charCode); }
    return window.btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/* -------------------------------------------------------------------------
   CORE AUTHORIZATION
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
    try {
        appendLine(`>>> [1/5] АНКОРИНГ: Привязка авторитета к аппаратному анклаву...`);
        const optionsRes = await fetch(`/api/register/options?handle=${encodeURIComponent(handle)}`);
        const options = await optionsRes.json();
        options.challenge = base64ToBuffer(options.challenge);
        options.user.id = base64ToBuffer(options.user.id);
        appendLine(`[ACTION] Подпишите манифест личности через TouchID/FaceID...`, 'text-yellow');
        const credential = await navigator.credentials.create({ publicKey: options });
        const credId = bufferToHex(credential.rawId);
        const pubKeyHex = credId.substring(0, 64); 
        const address = `sl1_${pubKeyHex.substring(0, 40)}`;
        window.currentAddress = address;
        appendLine(`[ROOT] Canonical ID: ${address}`, 'text-green');
        const syncRes = await fetch('/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, publicKey: pubKeyHex, credentialId: credId, handle })
        });
        if ((await syncRes.json()).success) {
            appendLine(`[SUCCESS] Суверенный манифест опубликован.`, 'text-green');
            refreshAccountData();
            await sleep(1500); showTab('portfolio');
        }
    } catch (err) { appendLine(`[!] ОШИБКА АВТОРИТЕТА: ${err.message}`, 'text-red'); }
    btnConsensus.disabled = false;
}

if (btnConsensus) btnConsensus.addEventListener('click', runRealConsensus);

/* -------------------------------------------------------------------------
   CRYPTOGRAPHIC INTENT EXECUTION
-------------------------------------------------------------------------- */
window.executeSend = async function() {
    const to_handle = document.getElementById('send-to').value;
    const amount = parseFloat(document.getElementById('send-amount').value);
    if (!to_handle || isNaN(amount)) return alert('Укажите получателя и сумму');
    
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.innerHTML = 'SIGNING INTENT...';
    
    try {
        const intent = { from: window.currentAddress, to_handle, amount, asset: 'SL1', nonce: window.currentAccount.nonce };
        const intent_json = JSON.stringify(intent);
        const encoder = new TextEncoder();
        const intent_data = encoder.encode(intent_json);
        const intent_hash_buffer = await crypto.subtle.digest('SHA-256', intent_data);
        const intent_hash = bufferToHex(intent_hash_buffer);

        appendLine(`[INTENT] Создание намерения: ${intent_hash.substring(0, 12)}...`, 'text-highlight');
        const authOptions = {
            challenge: intent_hash_buffer,
            allowCredentials: [{ id: base64ToBuffer(window.currentAccount.credentialId), type: 'public-key' }],
            userVerification: 'required'
        };
        
        appendLine(`[ACTION] Подтвердите перевод через FaceID/TouchID...`, 'text-yellow');
        const assertion = await navigator.credentials.get({ publicKey: authOptions });
        const sigHex = bufferToHex(assertion.response.signature);
        appendLine(`[OK] Намерение подписано криптографически.`, 'text-green');

        const res = await fetch('/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...intent,
                signature: sigHex,
                clientDataJSON: bufferToBase64URL(assertion.response.clientDataJSON),
                authenticatorData: bufferToBase64URL(assertion.response.authenticatorData)
            })
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
        } else { throw new Error(data.error); }
    } catch (err) {
        alert(`Ошибка: ${err.message}`);
        btn.innerHTML = 'CONFIRM INTENT';
        btn.disabled = false;
    }
};

window.initiateBTCDeposit = async function() {
    if (!window.currentAddress) { alert('Активируйте ROOT AUTHORITY'); showTab('identity'); return; }
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
        btn.innerHTML = `BTC ADDR: ${deposit_address.substring(0, 10)}...`;
        
        await sleep(3000);
        btn.innerHTML = 'DETECTING DEPOSIT...';
        
        await sleep(2000);
        const mintRes = await fetch('/api/assets/simulate-mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ btc_address: deposit_address, amount: 0.125 })
        });
        
        if (mintRes.ok) {
            btn.innerHTML = 'SETTLEMENT STARTED ⏳';
            refreshAccountData();
            setTimeout(() => { btn.innerHTML = oldText; btn.disabled = false; }, 4000);
        }
    } catch (err) { btn.innerHTML = 'FAILED'; btn.disabled = false; }
};
