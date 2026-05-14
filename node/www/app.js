/**
 * ===========================================================
 * SIMPLE-L1 | The Cryptographic Sovereignty Machine (v5.0)
 * 100% Honest Polyglot WebAuthn Blockchain Simulator
 * Includes Adaptive Visitor Profiling & Auto-Locale Routing
 * Supported: 18 International Technological Languages
 * ===========================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-trigger-consensus');
    const consoleBody = document.getElementById('console-output');
    const langSelect = document.getElementById('lang-select');

    // ==========================================
    // 1. ИНТЕРНАЦИОНАЛИЗАЦИЯ И УМНЫЙ ПРОФАЙЛЕР
    // ==========================================
    
    // Улучшенный детектор вероятного языка с поддержкой принудительного ручного выбора
    const detectBestLanguage = () => {
        // Если пользователь когда-либо ВРУЧНУЮ выбрал язык — намертво используем его
        const manualSaved = localStorage.getItem('sl1_lang_manual');
        if (manualSaved && window.SL1_TRANSLATIONS[manualSaved]) {
            return { lang: manualSaved, isManualOverride: true };
        }
        
        // Если выбора не было — анализируем стек настроек браузера (вероятностный маппинг)
        const browserLangs = navigator.languages || [navigator.language || 'en'];
        for (let item of browserLangs) {
            const base = item.split('-')[0].toLowerCase();
            if (window.SL1_TRANSLATIONS[base]) {
                return { lang: base, isManualOverride: false };
            }
        }
        return { lang: 'en', isManualOverride: false };
    };

    // Сбор телеметрии и профайла для терминала
    const buildVisitorProfile = () => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown Temporal Vector";
        const threads = navigator.hardwareConcurrency || "Generic";
        
        let platform = "Generic Node";
        const ua = navigator.userAgent.toLowerCase();
        if (ua.indexOf("mac") !== -1) platform = "Apple Silicon / macOS";
        else if (ua.indexOf("windows") !== -1) platform = "Windows Intel/AMD";
        else if (ua.indexOf("linux") !== -1) platform = "GNU/Linux Core";
        else if (ua.indexOf("iphone") !== -1 || ua.indexOf("ipad") !== -1) platform = "iOS Secure Element";
        else if (ua.indexOf("android") !== -1) platform = "Android Hardware";

        return {
            timezone: tz,
            cores: threads,
            os: platform,
            langStack: (navigator.languages || [navigator.language || "unknown"]).slice(0, 3).join(', ')
        };
    };

    const detectionResult = detectBestLanguage();
    let currentLang = detectionResult.lang;

    const t = (key, replacements = {}) => {
        const dict = window.SL1_TRANSLATIONS[currentLang] || window.SL1_TRANSLATIONS.en;
        let text = dict[key] || window.SL1_TRANSLATIONS.en[key] || key;
        
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    };

    const setLanguage = (lang, persistAsManual = false) => {
        if (!window.SL1_TRANSLATIONS[lang]) return;
        currentLang = lang;
        
        // Сохраняем в localStorage только в том случае, если пользователь ЯВНО нажал кнопку в UI
        if (persistAsManual) {
            localStorage.setItem('sl1_lang_manual', lang);
        }
        
        // Локализация статических элементов DOM
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = t(key);
            
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.setAttribute('placeholder', translation);
            } else {
                el.innerHTML = translation;
            }
        });

        // Синхронизируем меню выбора в навигации
        if (langSelect) {
            langSelect.value = lang;
        }

        // Адаптация кнопки запуска
        if (!btn.disabled) {
            btn.innerText = t('btn_consensus');
        }
    };

    // МГНОВЕННОЕ применение языка ПРИ ЗАПУСКЕ, до любых анимаций, чтобы полностью исключить мерцание (FOUC)
    setLanguage(currentLang);

    // ==========================================
    // 2. УТИЛИТЫ И КОНСОЛЬНЫЙ ВЫВОД
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
    // 3. ДИНАМИЧЕСКИЙ БУТЛОАДЕР (ЗАГРУЗКА НОДЫ)
    // ==========================================
    const runNodeBootloader = async () => {
        // Очищаем исходный HTML и запускаем интерактивную инициализацию
        consoleBody.innerHTML = '';
        
        appendLine("[BOOTLOADER] Initiating local Node handshake...", "text-highlight");
        await sleep(400);
        
        const profile = buildVisitorProfile();
        
        appendLine(`[PROFILER] Extracting hardware telemetry:`);
        await sleep(200);
        appendLine(`  -> Host Architecture: <span style="color:var(--clr-yellow);">${profile.os}</span>`);
        await sleep(150);
        appendLine(`  -> Thread Topology: <span style="color:var(--clr-pink);">${profile.cores} CPU units</span>`);
        await sleep(150);
        appendLine(`  -> Temporal Vector: ${profile.timezone}`);
        await sleep(150);
        appendLine(`  -> Browser Locale Graph: [${profile.langStack}]`);
        await sleep(300);
        
        const matchType = detectionResult.isManualOverride ? "USER_OVERRIDE_ACTIVE" : "PROBABILISTIC_MAPPED";
        appendLine(`[RESOLVER] Native Language Binding: <span class="trace-success">${currentLang.toUpperCase()} (${matchType})</span> ✅`);
        await sleep(400);
        
        // Применяем обнаруженный язык ко всему сайту
        setLanguage(currentLang);
        
        appendLine("[SYSTEM] Execution sandbox locked. Socket ready.");
        await sleep(300);
        
        // Финальные приветственные строки на целевом языке
        appendLine(`<div style="border-top:1px dashed #333; margin: 10px 0 5px 0;"></div>`);
        appendLine(t('term_offline'));
        appendLine(t('term_wait_gen'), "text-highlight");
    };

    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            // Второй флаг 'true' помечает действие как принудительный выбор пользователя
            setLanguage(e.target.value, true);
            
            // Если терминал сейчас просто ждёт запуск консенсуса — локализуем последние две строки ожидания
            if (!btn.disabled) {
                // Оставляем лог загрузки, меняем только финальные строки
                const lines = consoleBody.querySelectorAll('.terminal-line');
                if (lines.length > 2) {
                    lines[lines.length - 2].innerText = t('term_offline');
                    lines[lines.length - 1].innerText = t('term_wait_gen');
                }
            }
        });
    }

    // ==========================================
    // 4. ГЛАВНЫЙ ИСПОЛНИТЕЛЬНЫЙ МЕХАНИЗМ
    // ==========================================
    const runConsensusSimulation = async () => {
        const userInput = document.getElementById('username-input');
        const rawUsername = userInput.value.trim() || "@vv1ldd";
        
        btn.disabled = true;
        btn.innerText = t('btn_executing');
        
        consoleBody.innerHTML = `<div class="terminal-line text-highlight">${t('term_init_kernel', {user: rawUsername})}</div>`;
        await sleep(800);

        // Очистка сессии при смене пользователя
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
                    throw new Error("WebAuthn not supported.");
                }

                const challenge = crypto.getRandomValues(new Uint8Array(32));
                const userId = crypto.getRandomValues(new Uint8Array(16));

                const createOptions = {
                    publicKey: {
                        challenge: challenge,
                        rp: { 
                            name: "Simple-L1 Network Protocol", 
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

                const credential = await navigator.credentials.create(createOptions);
                
                if (!credential) {
                    throw new Error("Secure Enclave returned empty.");
                }

                activeCredId = credential.id;
                
                if (credential.response && credential.response.getPublicKey) {
                    const spkiBuffer = credential.response.getPublicKey();
                    activePubKeyHex = bufToHex(spkiBuffer);

                    const hashBuffer = await crypto.subtle.digest('SHA-256', spkiBuffer);
                    const hashHex = bufToHex(hashBuffer);
                    activeAddress = `sl1_${hashHex.substring(0, 40)}`;

                    localStorage.setItem('sl1_credential_id', activeCredId);
                    localStorage.setItem('sl1_public_key', activePubKeyHex);
                    localStorage.setItem('sl1_address', activeAddress);

                    appendLine(t('term_success_keygen'), "trace-success");
                    appendLine(`${t('term_spki_key')} <span class="trace-key">0x${activePubKeyHex.substring(0, 40)}...</span>`);
                    appendLine(`${t('term_l1_addr')} <span class="trace-success">${activeAddress}</span>`);
                    await sleep(1500);
                } else {
                    throw new Error("No public key structure.");
                }

            } catch (e) {
                abortSimulation(`USER_REJECTED_GEN (${e.message})`);
                return;
            }
        } else {
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
        // ЭТАП 3: ПОДПИСЬ НАМЕРЕНИЯ
        // ==========================================
        appendLine(t('term_attestation_title'), "prompt");
        appendLine(`<span class='text-highlight'>${t('term_prompt2')}</span>`);
        await sleep(1000);

        let rawSignatureHex = "";

        try {
            if (!navigator.credentials || !navigator.credentials.get) {
                throw new Error("WebAuthn assertion failed.");
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

            const assertion = await navigator.credentials.get(getOptions);

            if (!assertion) {
                throw new Error("Signing aborted.");
            }

            if (assertion.response && assertion.response.signature) {
                const sigBuffer = assertion.response.signature;
                rawSignatureHex = bufToHex(sigBuffer);

                appendLine(t('term_success_sig'), "trace-success");
                appendLine(`${t('term_raw_sig')} <span class="trace-hash">0x${rawSignatureHex.substring(0, 40)}...</span>`);
                await sleep(1500);
            } else {
                throw new Error("Biometric signature invalid.");
            }

        } catch (e) {
            abortSimulation(`USER_REJECTED_SIGN (${e.message})`);
            return;
        }

        // ==========================================
        // ЭТАП 4: АГРЕГАЦИЯ
        // ==========================================
        appendLine(t('term_batch_title'), "prompt");
        await sleep(800);
        const txHash = randomHex(64);
        appendLine(`${t('term_payload_hash')} <span class="trace-hash">0x${txHash}</span>`);
        
        const merkleRoot = randomHex(64);
        appendLine(`${t('term_merkle_root')} <span class="trace-success">0x${merkleRoot}</span>`);
        await sleep(1000);

        // ==========================================
        // ЭТАП 5: ВЕРИФИКАЦИЯ
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
        // ЭТАП 6 И 7: ФИНАЛИЗАЦИЯ
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

    // НАЖАТИЕ КНОПКИ ЗАПУСКА КОНСЕНСУСА
    btn.addEventListener('click', runConsensusSimulation);

    // ЗАПУСКАЕМ АВТОНОМНЫЙ БУТЛОАДЕР ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
    runNodeBootloader();
});
