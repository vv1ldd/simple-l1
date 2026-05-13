/**
 * ===========================================================
 * SIMPLE-L1 | The Cryptographic Sovereignty Machine (v4.0)
 * 100% Honest Multilingual WebAuthn Blockchain Simulator
 * Supported: EN, RU, ES, TR, TK, KK
 * ===========================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-trigger-consensus');
    const consoleBody = document.getElementById('console-output');
    const langSelect = document.getElementById('lang-select');

    // ==========================================
    // 1. ИНТЕРНАЦИОНАЛИЗАЦИЯ И МЕНЕДЖЕР ЯЗЫКОВ
    // ==========================================
    
    // Определяем стартовый язык
    let currentLang = localStorage.getItem('sl1_lang') || 'ru';
    
    // Если язык из системы поддерживается и в куках пусто — берем его
    if (!localStorage.getItem('sl1_lang')) {
        const sysLang = navigator.language.substring(0, 2).toLowerCase();
        if (window.SL1_TRANSLATIONS && window.SL1_TRANSLATIONS[sysLang]) {
            currentLang = sysLang;
        }
    }

    const t = (key, replacements = {}) => {
        const dict = window.SL1_TRANSLATIONS[currentLang] || window.SL1_TRANSLATIONS.en;
        let text = dict[key] || window.SL1_TRANSLATIONS.en[key] || key;
        
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    };

    const setLanguage = (lang) => {
        if (!window.SL1_TRANSLATIONS[lang]) return;
        currentLang = lang;
        localStorage.setItem('sl1_lang', lang);
        
        // Обновляем визуальные элементы
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = t(key);
            
            // Если элемент input/textarea
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.setAttribute('placeholder', translation);
            } else {
                el.innerHTML = translation;
            }
        });

        // Синхронизируем селект в навбаре
        if (langSelect) {
            langSelect.value = lang;
        }

        // Локализация динамической кнопки (если она не в режиме исполнения)
        if (!btn.disabled) {
            btn.innerText = t('btn_consensus');
        }
    };

    // Обработчик изменения языка в шапке
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            setLanguage(e.target.value);
            
            // Если консоль пустая, локализуем стартовое сообщение
            if (consoleBody.children.length === 2 && !btn.disabled) {
                consoleBody.innerHTML = `
                    <div class="terminal-line">${t('term_offline')}</div>
                    <div class="terminal-line text-highlight">${t('term_wait_gen')}</div>
                `;
            }
        });
    }

    // Запускаем переключатель при старте
    setLanguage(currentLang);

    // ==========================================
    // 2. УТИЛИТЫ И ПОМОЩНИКИ
    // ==========================================
    const appendLine = (text, className = '') => {
        const div = document.createElement('div');
        div.className = `terminal-line ${className}`;
        div.innerHTML = text;
        consoleBody.appendChild(div);
        consoleBody.scrollTop = consoleBody.scrollHeight;
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const randomHex = (len) => {
        const chars = '0123456789abcdef';
        let res = '';
        for (let i = 0; i < len; i++) res += chars[Math.floor(Math.random() * chars.length)];
        return res;
    };

    const bufToHex = (buffer) => Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const base64UrlToBuffer = (base64url) => {
        const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        const pad = (4 - (base64.length % 4)) % 4;
        const str = window.atob(base64 + '='.repeat(pad));
        return Uint8Array.from(str, c => c.charCodeAt(0));
    };

    const abortSimulation = (message) => {
        appendLine(t('term_abort_title'), "prompt");
        appendLine(`  -> Reason: <span style='color:var(--clr-red); font-weight:900;'>${message}</span>`);
        appendLine(t('term_halted'));
        btn.disabled = false;
        btn.innerText = t('btn_retry');
    };

    // ==========================================
    // 3. ГЛАВНЫЙ ИСПОЛНИТЕЛЬНЫЙ МЕХАНИЗМ КОНСЕНСУСА
    // ==========================================
    const runConsensusSimulation = async () => {
        const userInput = document.getElementById('username-input');
        const rawUsername = userInput.value.trim() || "@vv1ldd";
        
        btn.disabled = true;
        btn.innerText = t('btn_executing');
        
        consoleBody.innerHTML = `<div class="terminal-line text-highlight">${t('term_init_kernel', {user: rawUsername})}</div>`;
        await sleep(800);

        // Стейт-контроллер смены имени пользователя
        const lastUser = localStorage.getItem('sl1_last_user');
        if (lastUser !== rawUsername) {
            localStorage.removeItem('sl1_credential_id');
            localStorage.removeItem('sl1_public_key');
            localStorage.removeItem('sl1_address');
            localStorage.setItem('sl1_last_user', rawUsername);
        }

        const storedCredId = localStorage.getItem('sl1_credential_id');
        const storedPubKeyHex = localStorage.getItem('sl1_public_key');
        const storedAddress = localStorage.getItem('sl1_address');

        let activeCredId = storedCredId;
        let activePubKeyHex = storedPubKeyHex;
        let activeAddress = storedAddress;

        const hostname = window.location.hostname;
        const rpId = hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes(".") ? hostname : undefined;

        // ==========================================
        // ЭТАП 1: ГЕНЕРАЦИЯ ИДЕНТИЧНОСТИ
        // ==========================================
        if (!activeCredId || !activePubKeyHex || !activeAddress) {
            appendLine(t('term_keygen_title'), "prompt");
            appendLine(`<span class='text-highlight'>${t('term_prompt1')}</span>`);
            await sleep(1000);

            try {
                if (!navigator.credentials || !navigator.credentials.create) {
                    throw new Error("WebAuthn not supported in this environment.");
                }

                const challenge = crypto.getRandomValues(new Uint8Array(32));
                const userId = crypto.getRandomValues(new Uint8Array(16));

                const createOptions = {
                    publicKey: {
                        challenge: challenge,
                        rp: { 
                            name: "Simple-L1 Network Protocol", // Глобальное имя протокола в Keychain
                            id: rpId 
                        },
                        user: {
                            id: userId,
                            name: `${rawUsername}@sl1.network`,
                            displayName: rawUsername
                        },
                        pubKeyCredParams: [{alg: -7, type: "public-key"}],
                        authenticatorSelection: {
                            authenticatorAttachment: "platform",
                            userVerification: "required"
                        },
                        timeout: 60000,
                        attestation: "none"
                    }
                };

                // ВЫЗОВ TouchID №1 (Keygen)
                const credential = await navigator.credentials.create(createOptions);
                
                if (!credential) {
                    throw new Error("Secure Enclave response empty.");
                }

                activeCredId = credential.id;
                
                if (credential.response && credential.response.getPublicKey) {
                    const spkiBuffer = credential.response.getPublicKey();
                    activePubKeyHex = bufToHex(spkiBuffer);

                    // Детерминированный хэш адреса
                    const hashBuffer = await crypto.subtle.digest('SHA-256', spkiBuffer);
                    const hashHex = bufToHex(hashBuffer);
                    activeAddress = `sl1_${hashHex.substring(0, 40)}`;

                    // Атомарная запись в стейт
                    localStorage.setItem('sl1_credential_id', activeCredId);
                    localStorage.setItem('sl1_public_key', activePubKeyHex);
                    localStorage.setItem('sl1_address', activeAddress);

                    appendLine(t('term_success_keygen'), "trace-success");
                    appendLine(`${t('term_spki_key')} <span class="trace-key">0x${activePubKeyHex.substring(0, 40)}...</span>`);
                    appendLine(`${t('term_l1_addr')} <span class="trace-success">${activeAddress}</span>`);
                    await sleep(1500);
                } else {
                    throw new Error("Failed to get public key object.");
                }

            } catch (e) {
                abortSimulation(`USER_REJECTED_GEN (${e.message})`);
                return;
            }
        } else {
            // Восстановление из сохраненной истории
            appendLine(t('term_detected'), "prompt");
            appendLine(`${t('term_addr_found')} <span class="trace-success">${activeAddress}</span>`);
            appendLine(`${t('term_pubkey')} <span style="color:#5c6370;">0x${activePubKeyHex.substring(0, 32)}...</span>`);
            await sleep(1200);
        }

        // ==========================================
        // ЭТАП 2: СЕРИАЛИЗАЦИЯ ИНТЕНТА (Borsh)
        // ==========================================
        appendLine(t('term_serialize_title'), "prompt");
        await sleep(600);
        appendLine(t('term_domain_sep'));
        appendLine(`${t('term_signer_bound')} ${activeAddress.substring(0, 12)}...`);
        
        const borshHex = `53494d504c455f4c313a3a54583a3a5631${randomHex(100)}`;
        appendLine(t('term_borsh_out'));
        appendLine(`<span style="color:#6f7687;">${borshHex.substring(0, 64)}...</span>`);
        await sleep(1200);

        // ==========================================
        // ЭТАП 3: ПОДПИСЬ НАМЕРЕНИЯ (Biometric Assertion)
        // ==========================================
        appendLine(t('term_attestation_title'), "prompt");
        appendLine(`<span class='text-highlight'>${t('term_prompt2')}</span>`);
        await sleep(1000);

        let rawSignatureHex = "";

        try {
            if (!navigator.credentials || !navigator.credentials.get) {
                throw new Error("WebAuthn get not supported in this environment.");
            }

            const challenge = crypto.getRandomValues(new Uint8Array(32));
            const credBuffer = base64UrlToBuffer(activeCredId);

            const getOptions = {
                publicKey: {
                    challenge: challenge,
                    rpId: rpId,
                    allowCredentials: [{
                        type: "public-key",
                        id: credBuffer
                    }],
                    userVerification: "required",
                    timeout: 60000
                }
            };

            // ВЫЗОВ TouchID №2 (Подпись бинарного пакета)
            const assertion = await navigator.credentials.get(getOptions);

            if (!assertion) {
                throw new Error("Signing failed.");
            }

            if (assertion.response && assertion.response.signature) {
                const sigBuffer = assertion.response.signature;
                rawSignatureHex = bufToHex(sigBuffer);

                appendLine(t('term_success_sig'), "trace-success");
                appendLine(`${t('term_raw_sig')} <span class="trace-hash">0x${rawSignatureHex.substring(0, 40)}...</span>`);
                await sleep(1500);
            } else {
                throw new Error("Enclave assertion failed.");
            }

        } catch (e) {
            abortSimulation(`USER_REJECTED_SIGN (${e.message})`);
            return;
        }

        // ==========================================
        // ЭТАП 4: АГРЕГАЦИЯ И MERKLE ДЕРЕВО
        // ==========================================
        appendLine(t('term_batch_title'), "prompt");
        await sleep(800);
        const txHash = randomHex(64);
        appendLine(`${t('term_payload_hash')} <span class="trace-hash">0x${txHash}</span>`);
        
        const merkleRoot = randomHex(64);
        appendLine(`${t('term_merkle_root')} <span class="trace-success">0x${merkleRoot}</span>`);
        await sleep(1000);

        // ==========================================
        // ЭТАП 5: ВЕРИФИКАЦИЯ ВАЛИДАТОРАМИ
        // ==========================================
        appendLine(t('term_verify_title'), "prompt");
        await sleep(600);
        appendLine(t('term_node_fetch'));
        appendLine(`${t('term_node_verify')} (0x${activePubKeyHex.substring(0, 20)}...)`);
        await sleep(1000);
        appendLine(t('term_inv1'));
        
        const finalStateRoot = randomHex(64);
        appendLine(t('term_inv2'));
        await sleep(1200);
        appendLine(t('term_state_converged', {root: `[0x${finalStateRoot}]`}));
        await sleep(900);

        // ==========================================
        // ЭТАП 6 И 7: ФИНАЛИЗАЦИЯ И ЗАПИСЬ
        // ==========================================
        appendLine(t('term_durability_title'), "prompt");
        await sleep(700);
        appendLine(t('term_disk_commit'));
        await sleep(500);

        appendLine(t('term_finality_title'), "prompt");
        appendLine(`<span class='trace-success' style="font-weight:900; font-size: 15px;">${t('term_block_sealed')}</span>`);
        
        btn.disabled = false;
        btn.innerText = t('btn_retry');
    };

    btn.addEventListener('click', runConsensusSimulation);
});
