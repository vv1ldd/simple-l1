const GREEK_ALPHABET = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];

async function triggerNext() {
    const currentName = process.env.NODE_NAME || 'node-alpha';
    const currentLetter = currentName.split('-')[1];
    const currentIndex = GREEK_ALPHABET.indexOf(currentLetter);
    
    if (currentIndex === -1 || currentIndex === GREEK_ALPHABET.length - 1) {
        console.log('[RELAY] End of chain or unknown name. Stopping.');
        return;
    }

    const nextLetter = GREEK_ALPHABET[currentIndex + 1];
    const nextNodeName = `node-${nextLetter}`;
    
    console.log(`[RELAY] I am ${currentName}. Looking for ${nextNodeName}...`);

    try {
        // 1. Get Peer List from self (we already have PEX data)
        const res = await fetch('http://localhost:3000/api/network/peers');
        const data = await res.json();
        
        // 2. Find the next node's webhook in the cluster
        // For now, we'll use a convention: 
        // We'll try to find a peer that responds to /api/network/deploy-info
        const peers = (data.peers || '').split(',').filter(Boolean);
        
        for (const peer of peers) {
            try {
                const infoRes = await fetch(`${peer.replace(/\/$/, '')}/api/network/deploy-info`);
                if (infoRes.ok) {
                    const info = await infoRes.json();
                    if (info.node === nextNodeName && info.webhook) {
                        console.log(`[RELAY] Found webhook for ${nextNodeName}. Triggering...`);
                        const triggerRes = await fetch(info.webhook, { headers: { 'Authorization': `Bearer ${process.env.DEPLOY_TOKEN}` } });
                        console.log(`[RELAY] Triggered ${nextNodeName}: ${triggerRes.status}`);
                        return;
                    }
                }
            } catch (e) {}
        }
        
        console.log(`[RELAY] Could not find webhook for ${nextNodeName} in the cluster.`);
    } catch (err) {
        console.error('[RELAY] Critical error:', err.message);
    }
}

triggerNext();
