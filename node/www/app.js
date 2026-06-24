const statusEls = {
    health: document.getElementById('node-health'),
    network: document.getElementById('stat-network'),
    accounts: document.getElementById('stat-accounts'),
    peers: document.getElementById('stat-peers'),
    root: document.getElementById('stat-root'),
    note: document.getElementById('status-note'),
};

const identityEls = {
    state: document.getElementById('wallet-state'),
    handle: document.getElementById('wallet-handle'),
    address: document.getElementById('wallet-address'),
    native: document.getElementById('wallet-native-balance'),
    providersState: document.getElementById('identity-providers-state'),
    providersList: document.getElementById('identity-providers-list'),
    linkVault: document.getElementById('link-meanly-vault'),
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

function renderIdentityEmpty(message) {
    if (identityEls.state) identityEls.state.textContent = 'empty';
    if (identityEls.handle) identityEls.handle.textContent = 'No identity yet';
    if (identityEls.address) {
        identityEls.address.textContent = message || 'Sign in with a passkey to create your SL1 identity.';
    }
    if (identityEls.native) identityEls.native.textContent = `0.00 ${NATIVE_ASSET}`;
    if (identityEls.providersState) identityEls.providersState.textContent = 'none';
    if (identityEls.providersList) {
        identityEls.providersList.innerHTML = `
            <div class="provider-row">
                <span>No provider linked<small>Instruments live in Vault, not in SL1.</small></span>
                <strong>unlinked</strong>
            </div>
        `;
    }
    if (identityEls.operations) {
        identityEls.operations.innerHTML = '<div class="operation-row"><span>Protocol activity appears after your first identity proof.</span><strong>waiting</strong></div>';
    }
}

function renderProviderRows(summary) {
    const providers = Array.isArray(summary.providers) ? summary.providers : [];
    const defaultProvider = summary.identity_surface?.default_provider;
    const vaultUrl = defaultProvider?.link_url || 'https://meanly.one';

    if (identityEls.linkVault) {
        identityEls.linkVault.href = vaultUrl;
        identityEls.linkVault.textContent = defaultProvider?.status === 'linked'
            ? 'Open Meanly Vault'
            : 'Link Meanly Vault';
    }

    if (providers.length > 0) {
        if (identityEls.providersState) {
            identityEls.providersState.textContent = `${providers.length} linked`;
        }
        if (identityEls.providersList) {
            identityEls.providersList.innerHTML = providers.map((provider) => {
                const label = provider.label || provider.provider_id || 'Provider';
                const instrumentCount = Number(provider.instrument_count || provider.instruments?.length || 0);
                const status = provider.status || 'active';
                const openUrl = provider.open_url || vaultUrl;

                return `
                    <div class="provider-row">
                        <span>${label}<small>${instrumentCount > 0 ? `${instrumentCount} instruments` : 'No instruments yet'}</small></span>
                        <a class="provider-open" href="${openUrl}">${status === 'active' ? 'Open' : 'Link'}</a>
                    </div>
                `;
            }).join('');
        }
        return;
    }

    if (identityEls.providersState) {
        identityEls.providersState.textContent = defaultProvider?.status === 'linked' ? 'linked' : 'none';
    }
    if (identityEls.providersList) {
        identityEls.providersList.innerHTML = `
            <div class="provider-row">
                <span>${defaultProvider?.label || 'Meanly Vault'}<small>No provider linked on this identity yet.</small></span>
                <strong>unlinked</strong>
            </div>
        `;
    }
}

function renderIdentity(summary) {
    if (!summary || summary.status === 'empty') {
        renderIdentityEmpty(summary?.message);
        return;
    }

    const identity = summary.identity || summary.account || {};
    const nativeBalance = summary.native
        || (Array.isArray(summary.balances) ? summary.balances.find((balance) => balance.asset === NATIVE_ASSET) : null)
        || { amount: 0, asset: NATIVE_ASSET };
    const operations = Array.isArray(summary.operations) ? summary.operations : [];
    const receipts = Array.isArray(summary.receipts) ? summary.receipts : [];

    if (identityEls.state) identityEls.state.textContent = summary.status || 'active';
    if (identityEls.handle) identityEls.handle.textContent = identity.handle || 'SL1 Identity';
    if (identityEls.address) {
        identityEls.address.textContent = identity.entity_l1_address || 'sl1e_pending';
        identityEls.address.title = identity.entity_l1_address || '';
    }
    if (identityEls.native) {
        identityEls.native.textContent = formatAmount(nativeBalance.available ?? nativeBalance.amount, NATIVE_ASSET);
    }
    if (identityEls.keys) identityEls.keys.textContent = `${identity.active_keys || 0} active`;
    if (identityEls.receiptsCount) identityEls.receiptsCount.textContent = `${receipts.length} receipts`;

    renderProviderRows(summary);

    if (identityEls.operations) {
        const operationRows = operations.length
            ? operations.map((operation) => `
                <div class="operation-row">
                    <span>
                        ${operation.description || operation.type || 'Protocol event'}
                        <small>${operation.timestamp ? new Date(operation.timestamp).toLocaleString() : 'ledger event'}</small>
                    </span>
                    <strong>${operation.amount ? formatAmount(operation.amount, operation.asset || NATIVE_ASSET) : operation.status || 'settled'}</strong>
                </div>
            `).join('')
            : '<div class="operation-row"><span>No protocol activity yet<small>Receipts and rewards will appear here.</small></span><strong>empty</strong></div>';

        identityEls.operations.innerHTML = operationRows;
    }
}

async function loadIdentity() {
    if (!identityEls.state) return;

    try {
        const response = await fetch('/api/identity/summary', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        renderIdentity(await response.json());
    } catch (error) {
        if (identityEls.state) identityEls.state.textContent = 'sync pending';
        renderIdentityEmpty('Identity summary is not live on this node yet. Restart SL1 node to enable /api/identity/summary.');
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

function configureIdentityConnectLink() {
    const link = document.getElementById('wallet-open-passkey');
    if (!link) return;

    const hostname = window.location.hostname || 'simplelayer.one';
    const siteOrigin = window.location.origin;
    const issuerOrigin = hostname === 'simplelayer.one' || hostname === 'www.simplelayer.one'
        ? 'https://pass.simplelayer.one'
        : siteOrigin;
    const redirectOrigin = hostname.startsWith('pass.') ? 'https://simplelayer.one' : siteOrigin;
    const params = new URLSearchParams({
        client_id: hostname.startsWith('pass.') ? 'simplelayer.one' : hostname,
        client_name: 'SL1 Identity',
        redirect_uri: `${redirectOrigin}/#identity`,
        state: 'identity-demo',
        nonce: 'identity-demo',
        mode: 'connect',
        flow: 'connect',
    });

    link.href = `${issuerOrigin}/authorize?${params.toString()}`;
}

function redirectLegacyWalletHash() {
    if (window.location.hash === '#wallet') {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}#identity`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    redirectLegacyWalletHash();
    configureIdentityConnectLink();
    loadStatus();
    loadIdentity();
    setInterval(loadStatus, 10000);
    setInterval(loadIdentity, 15000);
    markActiveSection();
    window.addEventListener('scroll', markActiveSection, { passive: true });
});
