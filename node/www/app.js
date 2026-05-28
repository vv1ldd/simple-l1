const statusEls = {
    health: document.getElementById('node-health'),
    network: document.getElementById('stat-network'),
    accounts: document.getElementById('stat-accounts'),
    peers: document.getElementById('stat-peers'),
    root: document.getElementById('stat-root'),
    note: document.getElementById('status-note'),
};

const walletEls = {
    state: document.getElementById('wallet-state'),
    handle: document.getElementById('wallet-handle'),
    address: document.getElementById('wallet-address'),
    native: document.getElementById('wallet-native-balance'),
    assets: document.getElementById('wallet-assets'),
    operations: document.getElementById('wallet-operations'),
    receiptsCount: document.getElementById('wallet-receipts-count'),
    keys: document.getElementById('wallet-keys'),
};

const NATIVE_ASSET = 'SL';

function shortHash(value) {
    if (!value) return 'genesis';
    const text = String(value);
    if (text.length <= 18) return text;
    return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function setHealth(state, text) {
    if (!statusEls.health) return;
    statusEls.health.classList.remove('online', 'offline');
    statusEls.health.classList.add(state);
    statusEls.health.textContent = text;
}

async function loadStatus() {
    try {
        const response = await fetch('/api/status', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const status = await response.json();
        setHealth('online', 'online');

        if (statusEls.network) {
            statusEls.network.textContent = status.network || 'Simple Layer One';
        }
        if (statusEls.accounts) {
            statusEls.accounts.textContent = status.total_accounts ?? '0';
        }
        if (statusEls.peers) {
            statusEls.peers.textContent = status.peers_count ?? (status.peers || []).length ?? '0';
        }
        if (statusEls.root) {
            statusEls.root.textContent = shortHash(status.state_root);
            statusEls.root.title = status.state_root || 'genesis';
        }
        if (statusEls.note) {
            const caps = Array.isArray(status.capabilities) ? status.capabilities.length : 0;
            statusEls.note.textContent = `Node operational. ${caps} advertised capabilities.`;
        }
    } catch (error) {
        setHealth('offline', 'offline');
        if (statusEls.note) {
            statusEls.note.textContent = `Could not read /api/status: ${error.message}`;
        }
    }
}

function formatAmount(value, asset) {
    const amount = Number(value || 0);
    const maximumFractionDigits = asset === NATIVE_ASSET ? 4 : 6;

    return `${amount.toLocaleString('en-US', {
        minimumFractionDigits: asset === NATIVE_ASSET ? 2 : 0,
        maximumFractionDigits,
    })} ${asset}`;
}

function renderWalletEmpty(message) {
    if (walletEls.state) walletEls.state.textContent = 'empty';
    if (walletEls.handle) walletEls.handle.textContent = 'No wallet yet';
    if (walletEls.address) walletEls.address.textContent = message || 'Create an SL1 identity to initialize a wallet.';
    if (walletEls.native) walletEls.native.textContent = `0.00 ${NATIVE_ASSET}`;
    if (walletEls.assets) {
        walletEls.assets.innerHTML = `<div class="asset-row"><span>No assets yet</span><strong>0.00 ${NATIVE_ASSET}</strong></div>`;
    }
    if (walletEls.operations) {
        walletEls.operations.innerHTML = '<div class="operation-row"><span>Wallet history will appear after the first identity proof.</span><strong>waiting</strong></div>';
    }
}

function renderWallet(summary) {
    if (!summary || summary.status === 'empty') {
        renderWalletEmpty(summary?.message);
        return;
    }

    const account = summary.account || {};
    const balances = Array.isArray(summary.balances) ? summary.balances : [];
    const operations = Array.isArray(summary.operations) ? summary.operations : [];
    const receipts = Array.isArray(summary.receipts) ? summary.receipts : [];
    const nativeBalance = balances.find((balance) => balance.asset === NATIVE_ASSET) || { amount: 0, asset: NATIVE_ASSET };

    if (walletEls.state) walletEls.state.textContent = summary.status || 'active';
    if (walletEls.handle) walletEls.handle.textContent = account.handle || 'SL1 Wallet';
    if (walletEls.address) {
        walletEls.address.textContent = account.entity_l1_address || 'sl1e_pending';
        walletEls.address.title = account.entity_l1_address || '';
    }
    if (walletEls.native) walletEls.native.textContent = formatAmount(nativeBalance.available ?? nativeBalance.amount, NATIVE_ASSET);
    if (walletEls.keys) walletEls.keys.textContent = `${account.active_keys || 0} active`;
    if (walletEls.receiptsCount) walletEls.receiptsCount.textContent = `${receipts.length} receipts`;

    if (walletEls.assets) {
        walletEls.assets.innerHTML = balances.length
            ? balances.map((balance) => `
                <div class="asset-row">
                    <span>${balance.asset}<small>${balance.kind || 'asset projection'}</small></span>
                    <strong>${formatAmount(balance.available ?? balance.amount, balance.asset)}</strong>
                </div>
            `).join('')
            : `<div class="asset-row"><span>No assets yet</span><strong>0.00 ${NATIVE_ASSET}</strong></div>`;
    }

    if (walletEls.operations) {
        const operationRows = operations.length
            ? operations.map((operation) => `
                <div class="operation-row">
                    <span>
                        ${operation.description || operation.type || 'Wallet operation'}
                        <small>${operation.timestamp ? new Date(operation.timestamp).toLocaleString() : 'ledger event'}</small>
                    </span>
                    <strong>${operation.amount ? formatAmount(operation.amount, operation.asset || NATIVE_ASSET) : operation.status || 'settled'}</strong>
                </div>
            `).join('')
            : '<div class="operation-row"><span>No wallet operations yet<small>Receipts and rewards will appear here.</small></span><strong>empty</strong></div>';

        walletEls.operations.innerHTML = operationRows;
    }
}

async function loadWallet() {
    if (!walletEls.state) return;

    try {
        const response = await fetch('/api/wallet/summary', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        renderWallet(await response.json());
    } catch (error) {
        if (walletEls.state) walletEls.state.textContent = 'sync pending';
        renderWalletEmpty('Wallet projection is not live on this node yet. Restart SL1 node to enable /api/wallet/summary.');
    }
}

function markActiveSection() {
    const anchors = [...document.querySelectorAll('.nav-links a')];
    const sections = anchors
        .map((anchor) => document.querySelector(anchor.getAttribute('href')))
        .filter(Boolean);

    let activeId = '';
    for (const section of sections) {
        const rect = section.getBoundingClientRect();
        if (rect.top < 160) activeId = section.id;
    }

    anchors.forEach((anchor) => {
        const isActive = anchor.getAttribute('href') === `#${activeId}`;
        anchor.style.color = isActive ? 'var(--text)' : '';
    });
}

function configureWalletConnectLink() {
    const link = document.getElementById('wallet-open-passkey');
    if (!link) return;

    const origin = window.location.origin;
    const params = new URLSearchParams({
        client_id: window.location.hostname || 'simplel1.online',
        client_name: 'SL1 Wallet',
        redirect_uri: `${origin}/#wallet`,
        state: 'wallet-demo',
        nonce: 'wallet-demo',
        mode: 'connect',
        flow: 'connect',
    });

    link.href = `/authorize?${params.toString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
    configureWalletConnectLink();
    loadStatus();
    loadWallet();
    setInterval(loadStatus, 10000);
    setInterval(loadWallet, 15000);
    markActiveSection();
    window.addEventListener('scroll', markActiveSection, { passive: true });
});
