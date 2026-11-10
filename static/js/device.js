/**
 * Device Page — detalhe e controle de um TV Box (Fase 3B NOC-style).
 * Layout em 2 colunas:
 *   - Barra Sticky de Ações no Topo
 *   - Coluna Esquerda (60%): Screenshot ao vivo, Controles Kiosk Web/Player, D-Pad Remoto
 *   - Coluna Direita (40%): Informações do Dispositivo, Watchdog & Linha do Tempo, Apps Instalados
 *   - Gaveta (Drawer) Shell ADB na base
 */
const DEVICE_PAGE = (() => {
    let deviceId = null;
    let refreshTimer = null;
    let groupName = '';
    let currentDevice = null;
    let currentStatus = null;
    let wsHandler = null;
    let isCapturingScreenshot = false;
    let isShellDrawerOpen = false;

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function freshness(d) {
        const seen = latestSeen(d);
        return seen ? `visto há ${UI.timeAgo(seen)}` : 'nunca visto';
    }

    /**
     * Renderização inicial da página do dispositivo
     */
    async function render(el, id) {
        deviceId = id;
        UI.setPageTitle(`Dispositivo ${id}`);

        // Skeleton de carregamento com cards v2
        el.innerHTML = `
            <div class="device-page-layout">
                <div class="device-loading-skeleton">
                    ${UI.skeletons('card', 3)}
                </div>
            </div>
        `;

        try {
            const [device, statusRes] = await Promise.all([
                API.get(`/devices/${encodeURIComponent(deviceId)}`),
                API.get(`/devices/${encodeURIComponent(deviceId)}/status`).catch(() => null)
            ]);

            currentDevice = device;
            currentStatus = statusRes;

            groupName = device.group || '';
            if (groupName) {
                const groups = await API.get('/groups').catch(() => []);
                const g = (Array.isArray(groups) ? groups : []).find(x => x.id === groupName);
                if (g) groupName = g.name || g.id;
            }

            renderLayout(el, device, statusRes);
            loadApps();
            startAutoRefresh();
            setupWebSocket();
        } catch (e) {
            el.innerHTML = `
                <div class="device-page-layout">
                    ${UI.stateView('error', e.message || 'Erro ao carregar detalhes do dispositivo', { retry: true })}
                </div>
            `;
            UI.bindStateRetry(el, () => render(el, deviceId));
        }
    }

    /**
     * Monta o layout estrutural completo de 2 colunas NOC-style
     */
    function renderLayout(el, device, st) {
        const dstate = device.state || {};
        const status = dstate.status || (st?.adb_connected ? 'online' : 'unknown');
        const reason = dstate.reason || '';
        const ipDisplay = device.ip ? `${device.ip}:${device.adb_port || 5555}` : '--';
        const chip = device.group ? UI.groupChip(groupName || device.group, device.group) : '';
        const locationBadge = device.location ? `<span class="device-loc-badge" title="Localização">${UI.icon('map-pin') || ''} ${UI.escapeHtml(device.location)}</span>` : '';

        el.innerHTML = `
            <div class="device-page-layout" id="device-container">
                <!-- 1. Barra de Ações Sticky no Topo -->
                <header class="device-sticky-header" id="device-sticky-header">
                    <div class="device-header-left">
                        <div class="device-header-icon">${UI.icon('tv', 26) || UI.icon('monitor', 26)}</div>
                        <div class="device-header-titles">
                            <div class="device-header-title-row">
                                <h1 class="device-header-title">${UI.escapeHtml(device.name || device.id)}</h1>
                                <code class="device-id-pill" title="ID do Dispositivo">${UI.escapeHtml(device.id)}</code>
                                <div id="device-header-status-badge">
                                    ${UI.stateBadge(status, { reason })}
                                </div>
                            </div>
                            <div class="device-header-meta">
                                <span class="device-meta-ip"><strong class="font-mono">${UI.escapeHtml(ipDisplay)}</strong></span>
                                ${chip}
                                ${locationBadge}
                                <span class="device-meta-freshness" id="device-freshness">${freshness(dstate)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="device-header-actions">
                        <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.openScrcpy()" title="Espelhamento remoto de alta performance via Scrcpy">
                            ${UI.icon('monitor')} Scrcpy (1-Clique)
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.reloadKiosk()" title="Reinicia o Kiosk Web no navegador configurado">
                            ${UI.icon('refresh')} Recarregar Kiosk
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.rebootDevice()" title="Reinicia o TV Box Android">
                            ${UI.icon('reboot')} Reiniciar Aparelho
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.provisionScripts()" title="Provisiona e atualiza scripts internos no Android">
                            ${UI.icon('upload')} Provisionar Scripts
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="DEVICE_PAGE.deleteDevice()" title="Remove permanentemente o dispositivo">
                            ${UI.icon('trash')} Excluir
                        </button>
                    </div>
                </header>

                <!-- 2. Grid Principal em 2 Colunas (60% / 40%) -->
                <main class="device-noc-grid">
                    <!-- Coluna Esquerda (60%): Live Screenshot + Kiosk Web Controls + Remote D-Pad -->
                    <section class="device-col-main">
                        <!-- Card 1: Screenshot Ao Vivo -->
                        <div class="card device-card">
                            <div class="card-header">
                                <div class="card-title-wrap">
                                    <h2 class="card-title">${UI.icon('camera')} Screenshot Ao Vivo</h2>
                                    <span class="text-muted text-xs" id="d-screenshot-meta">Visualização sob demanda</span>
                                </div>
                                <div class="card-header-actions">
                                    <button class="btn btn-secondary btn-sm" id="d-btn-capture" onclick="DEVICE_PAGE.captureScreenshot()">
                                        <span class="btn-spinner" id="d-shot-spinner" style="display:none">${UI.icon('refresh')}</span>
                                        ${UI.icon('camera')} Capturar Agora
                                    </button>
                                </div>
                            </div>
                            <div class="device-screen-wrapper" id="d-screen-wrapper">
                                <img id="d-screen-img" class="device-live-img" src="" alt="Captura de tela do TV Box" style="display:none;" onclick="window.open(this.src, '_blank')" title="Clique para expandir" />
                                <div id="d-screen-placeholder" class="device-screen-placeholder">
                                    <div class="placeholder-icon">${UI.icon('monitor', 48)}</div>
                                    <p class="placeholder-text">Nenhuma imagem carregada na sessão</p>
                                    <button class="btn btn-sm btn-secondary" onclick="DEVICE_PAGE.captureScreenshot()">${UI.icon('camera')} Obter captura da tela</button>
                                </div>
                            </div>
                        </div>

                        <!-- Card 2: Controles Kiosk Web & Player -->
                        <div class="card device-card">
                            <div class="card-header">
                                <div class="card-title-wrap">
                                    <h2 class="card-title">${UI.icon('play')} Controles Kiosk Web</h2>
                                    <span class="text-muted text-xs">Transmissão de conteúdo e controle do navegador</span>
                                </div>
                                <div id="d-activity-badge">
                                    <span class="badge badge-mono text-xs" title="Atividade Android em foco">${UI.escapeHtml(dstate.current_activity || 'Sem atividade')}</span>
                                </div>
                            </div>
                            <div class="kiosk-controls-body">
                                <div class="form-group" style="margin-bottom:var(--space-3)">
                                    <label class="form-label text-xs font-semibold" for="d-web-url">URL da Página Web / Stream RTSP</label>
                                    <div class="input-with-button">
                                        <input type="url" id="d-web-url" class="form-input" placeholder="https://app.powerbi.com/view?... ou rtsp://..." value="${UI.escapeHtml(device.target_url || '')}" />
                                    </div>
                                </div>

                                <div class="kiosk-config-grid">
                                    <div class="form-group" style="margin-bottom:0">
                                        <label class="form-label text-xs font-semibold" for="d-player-select">Player / Navegador</label>
                                        <select id="d-player-select" class="form-select">
                                            <option value="freekiosk" ${(!device.web_browser || device.web_browser === 'freekiosk') && device.mode !== 'stream' ? 'selected' : ''}>Free Kiosk Browser (Recomendado)</option>
                                            <option value="chrome" ${device.web_browser === 'chrome' && device.mode !== 'stream' ? 'selected' : ''}>Google Chrome</option>
                                            <option value="browser" ${device.web_browser === 'browser' && device.mode !== 'stream' ? 'selected' : ''}>Navegador Padrão</option>
                                            <option value="vlc" ${device.player === 'vlc' || device.mode === 'stream' ? 'selected' : ''}>VLC Player (Stream RTSP)</option>
                                            <option value="mpv" ${device.player === 'mpv' ? 'selected' : ''}>MPV Player (Stream RTSP)</option>
                                        </select>
                                    </div>
                                    <div class="form-group" style="margin-bottom:0; align-self:flex-end">
                                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.saveWebConfig()" style="width:100%">
                                            ${UI.icon('check')} Salvar Configuração
                                        </button>
                                    </div>
                                </div>

                                <div class="kiosk-action-footer">
                                    <div class="kiosk-playback-btns">
                                        <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.action('start-stream')">
                                            ${UI.icon('play')} Iniciar / Abrir
                                        </button>
                                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.action('stop-stream')">
                                            ${UI.icon('stop')} Parar / Fechar
                                        </button>
                                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.reloadKiosk()">
                                            ${UI.icon('refresh')} Recarregar
                                        </button>
                                    </div>
                                    <div class="kiosk-recovery-wrap">
                                        <label class="switch-control" title="Watchdog reabre o conteúdo se cair">
                                            <input type="checkbox" id="d-recovery-toggle" ${device.recovery_enabled !== false ? 'checked' : ''} onchange="DEVICE_PAGE.toggleRecovery(this.checked)">
                                            <span class="switch-slider"></span>
                                            <span class="switch-text text-xs">Recuperação Automática</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Card 3: D-Pad de Navegação Remota -->
                        <div class="card device-card">
                            <div class="card-header">
                                <div class="card-title-wrap">
                                    <h2 class="card-title">${UI.icon('layers')} Controle Remoto (D-Pad Virtual)</h2>
                                    <span class="text-muted text-xs">Interação de teclado e controle remoto via ADB</span>
                                </div>
                            </div>
                            <div class="dpad-card-body">
                                <div class="dpad-interactive-wrapper">
                                    <div class="dpad-cross-grid">
                                        <button type="button" class="dpad-btn dpad-up" onclick="DEVICE_PAGE.sendKey(19)" title="Para Cima" aria-label="Cima">▲</button>
                                        <button type="button" class="dpad-btn dpad-left" onclick="DEVICE_PAGE.sendKey(21)" title="Para Esquerda" aria-label="Esquerda">◀</button>
                                        <button type="button" class="dpad-btn dpad-center" onclick="DEVICE_PAGE.sendKey(23)" title="OK / Selecionar" aria-label="OK">OK</button>
                                        <button type="button" class="dpad-btn dpad-right" onclick="DEVICE_PAGE.sendKey(22)" title="Para Direita" aria-label="Direita">▶</button>
                                        <button type="button" class="dpad-btn dpad-down" onclick="DEVICE_PAGE.sendKey(20)" title="Para Baixo" aria-label="Baixo">▼</button>
                                    </div>
                                </div>
                                <div class="dpad-actions-bar">
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(4)" title="Voltar (Back)">
                                        ${UI.icon('chevron-left')} Voltar
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(3)" title="Início (Home)">
                                        ${UI.icon('home')} Home
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(82)" title="Menu">
                                        Menu
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(25)" title="Volume -">
                                        Vol -
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(24)" title="Volume +">
                                        Vol +
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.sendKey(26)" title="Tela / Power">
                                        ${UI.icon('power')} Power
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <!-- Coluna Direita (40%): Hardware & Rede + Watchdog Timeline + Apps Instalados -->
                    <aside class="device-col-side">
                        <!-- Card 4: Informações do Dispositivo -->
                        <div class="card device-card">
                            <div class="card-header">
                                <h2 class="card-title">${UI.icon('server')} Informações do Dispositivo</h2>
                            </div>
                            <div class="device-info-table" id="d-info-table">
                                ${renderDeviceInfoRows(device, st)}
                            </div>
                        </div>

                        <!-- Card 5: Watchdog & Linha do Tempo -->
                        <div class="card device-card">
                            <div class="card-header">
                                <h2 class="card-title">${UI.icon('clock')} Watchdog & Linha do Tempo</h2>
                            </div>
                            <div class="device-watchdog-content" id="d-watchdog-content">
                                ${renderWatchdogRows(dstate)}
                            </div>
                        </div>

                        <!-- Card 6: Apps Instalados (APK) -->
                        <div class="card device-card">
                            <div class="card-header">
                                <div class="card-title-wrap">
                                    <h2 class="card-title">${UI.icon('archive')} Apps Instalados</h2>
                                    <span class="badge" id="d-apps-count-badge">Carregando...</span>
                                </div>
                                <div class="card-header-actions">
                                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.installApp()" title="Fazer upload de APK">
                                        ${UI.icon('upload')} Instalar APK
                                    </button>
                                    <button class="btn btn-ghost btn-sm" onclick="DEVICE_PAGE.loadApps()" title="Recarregar lista de apps" aria-label="Recarregar lista de apps">
                                        ${UI.icon('refresh')}
                                    </button>
                                </div>
                            </div>
                            <input type="file" id="d-apk-file" accept=".apk" style="display:none" />
                            <div class="apps-list-container" id="d-apps-list">
                                <div class="text-muted text-xs p-3">Carregando apps instalados...</div>
                            </div>
                        </div>
                    </aside>
                </main>

                <!-- 3. Gaveta (Drawer) Shell ADB na Base -->
                <div class="device-shell-drawer ${isShellDrawerOpen ? 'open' : ''}" id="device-shell-drawer">
                    <div class="shell-drawer-header" onclick="DEVICE_PAGE.toggleShellDrawer()">
                        <div class="shell-drawer-title">
                            <span class="shell-icon">${UI.icon('terminal')}</span>
                            <strong>Terminal Shell ADB</strong>
                            <span class="text-muted text-xs">Acesso rápido ao console do TV Box</span>
                        </div>
                        <div class="shell-drawer-quick-chips" onclick="event.stopPropagation()">
                            <button type="button" class="quick-chip" onclick="DEVICE_PAGE.runQuickCommand('getprop ro.build.version.release')">Android Version</button>
                            <button type="button" class="quick-chip" onclick="DEVICE_PAGE.runQuickCommand('dumpsys battery')">Bateria</button>
                            <button type="button" class="quick-chip" onclick="DEVICE_PAGE.runQuickCommand('uptime')">Uptime</button>
                            <button type="button" class="quick-chip" onclick="DEVICE_PAGE.runQuickCommand('pm list packages -3')">Apps -3</button>
                        </div>
                        <button type="button" class="btn btn-ghost btn-sm shell-drawer-toggle" aria-label="Expandir ou recolher shell" aria-expanded="${isShellDrawerOpen ? 'true' : 'false'}">
                            ${isShellDrawerOpen ? '▼ Recolher' : '▲ Expandir'}
                        </button>
                    </div>
                    <div class="shell-drawer-body" id="shell-drawer-body">
                        <div class="device-shell-output" id="d-shell-out" role="log" aria-live="polite">Aguardando comando. Digite abaixo ou selecione um atalho...</div>
                        <div class="device-shell-input-row">
                            <span class="shell-prompt">$</span>
                            <input type="text" id="d-shell-input" placeholder="Digite um comando shell ADB (ex: getprop ro.product.model)" onkeydown="if(event.key==='Enter')DEVICE_PAGE.runShell()" autocomplete="off" />
                            <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.runShell()">Executar</button>
                            <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.clearShell()">Limpar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Renderiza linhas do card de Informações do Dispositivo
     */
    function renderDeviceInfoRows(device, st) {
        const adbConnected = st?.adb_connected;
        const adbText = adbConnected ? 'Conectado' : 'Offline';
        const adbClass = adbConnected ? 'text-success' : 'text-danger';
        const rootText = st?.root ? 'Sim (Root Ativo)' : 'Não';
        const modelText = st?.model || device.model || '--';
        const androidVer = st?.android_version || '--';
        const uptimeText = st?.uptime ? UI.timeAgo(new Date(Date.now() - (st.uptime * 1000))) : (st?.uptime_str || '--');

        return `
            <div class="info-row"><span class="info-key">Endereço IP</span><span class="info-val font-mono">${UI.escapeHtml(device.ip || '--')}</span></div>
            <div class="info-row"><span class="info-key">Porta ADB</span><span class="info-val font-mono">${device.adb_port || 5555}</span></div>
            <div class="info-row"><span class="info-key">Conexão ADB</span><span class="info-val ${adbClass} font-semibold">${adbText}</span></div>
            <div class="info-row"><span class="info-key">Endereço MAC</span><span class="info-val font-mono">${UI.escapeHtml(device.mac || '--')}</span></div>
            <div class="info-row"><span class="info-key">Modelo</span><span class="info-val">${UI.escapeHtml(modelText)}</span></div>
            <div class="info-row"><span class="info-key">Android</span><span class="info-val">${UI.escapeHtml(androidVer)}</span></div>
            <div class="info-row"><span class="info-key">Root</span><span class="info-val">${rootText}</span></div>
            <div class="info-row"><span class="info-key">Grupo</span><span class="info-val">${UI.escapeHtml(groupName || device.group || '--')}</span></div>
            <div class="info-row"><span class="info-key">Localização</span><span class="info-val">${UI.escapeHtml(device.location || '--')}</span></div>
            <div class="info-row"><span class="info-key">Uptime</span><span class="info-val">${uptimeText}</span></div>
        `;
    }

    /**
     * Renderiza linhas do card de Watchdog e Linha do Tempo
     */
    function renderWatchdogRows(dstate) {
        const hbDisplay = dstate.last_heartbeat ? freshness({ last_heartbeat: dstate.last_heartbeat }) : '—';
        const pingDisplay = dstate.last_signage_ping ? freshness({ last_heartbeat: dstate.last_signage_ping }) : '—';
        const recDisplay = dstate.last_recovery_time ? freshness({ last_heartbeat: dstate.last_recovery_time }) : 'Nenhuma';
        const reboots = dstate.reboot_count || 0;

        return `
            <div class="info-row">
                <span class="info-key">Status Watchdog</span>
                <span class="info-val"><span class="badge badge-ok">Ativo & Monitorando</span></span>
            </div>
            <div class="info-row">
                <span class="info-key">Heartbeat OS</span>
                <span class="info-val font-mono">${hbDisplay}</span>
            </div>
            <div class="info-row">
                <span class="info-key">Ping da Página Web</span>
                <span class="info-val font-mono">${pingDisplay}</span>
            </div>
            <div class="info-row">
                <span class="info-key">Última Recuperação</span>
                <span class="info-val">${recDisplay}</span>
            </div>
            <div class="info-row">
                <span class="info-key">Reboots Automáticos</span>
                <span class="info-val"><strong class="font-mono">${reboots}</strong></span>
            </div>

            <div class="recovery-cascade-wrap">
                <div class="recovery-cascade-title text-xs font-semibold text-muted">Cascata de Recuperação Automática</div>
                <div class="recovery-steps-row">
                    <div class="recovery-step completed" title="1. Tenta reabrir o player/kiosk">1. Player</div>
                    <div class="recovery-step-arrow">→</div>
                    <div class="recovery-step completed" title="2. Reinicia interface Wi-Fi">2. Wi-Fi</div>
                    <div class="recovery-step-arrow">→</div>
                    <div class="recovery-step completed" title="3. Reinicia interface Ethernet">3. Ethernet</div>
                    <div class="recovery-step-arrow">→</div>
                    <div class="recovery-step completed" title="4. Reboot do aparelho se persistir">4. Reboot</div>
                </div>
            </div>
        `;
    }

    /**
     * Atualização dinâmica com DOM.patch sem perder estado ou foco
     */
    async function refreshStatus() {
        if (!deviceId) return;
        try {
            const [st, dev] = await Promise.all([
                API.get(`/devices/${encodeURIComponent(deviceId)}/status`).catch(() => null),
                API.get(`/devices/${encodeURIComponent(deviceId)}`).catch(() => null)
            ]);

            if (dev) currentDevice = dev;
            if (st) currentStatus = st;

            const dstate = dev?.state || {};
            const status = dstate.status || (st?.adb_connected ? 'online' : 'unknown');
            const reason = dstate.reason || '';

            // 1. Patch no Badge de Status do Header Sticky
            const statusBadgeContainer = document.getElementById('device-header-status-badge');
            if (statusBadgeContainer) {
                DOM.patch(statusBadgeContainer, UI.stateBadge(status, { reason }));
            }

            // 2. Patch no texto de freshness
            const freshEl = document.getElementById('device-freshness');
            if (freshEl) {
                freshEl.textContent = freshness(dstate);
            }

            // 3. Patch nas Informações do Dispositivo
            const infoContainer = document.getElementById('d-info-table');
            if (infoContainer && dev) {
                DOM.patch(infoContainer, renderDeviceInfoRows(dev, st));
            }

            // 4. Patch no Watchdog e Linha do Tempo
            const watchdogContainer = document.getElementById('d-watchdog-content');
            if (watchdogContainer) {
                DOM.patch(watchdogContainer, renderWatchdogRows(dstate));
            }

            // 5. Patch na atividade atual
            const activityBadge = document.getElementById('d-activity-badge');
            if (activityBadge) {
                DOM.patch(activityBadge, `<span class="badge badge-mono text-xs" title="Atividade Android em foco">${UI.escapeHtml(dstate.current_activity || 'Sem atividade')}</span>`);
            }
        } catch (e) {
            console.warn('[DEVICE_PAGE] Status refresh failed:', e.message);
        }
    }

    /**
     * Timer periódico de atualização
     */
    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshStatus, 15000);
    }

    /**
     * Listener para eventos WebSocket
     */
    function setupWebSocket() {
        if (typeof WS === 'undefined') return;
        if (wsHandler) WS.off('all', wsHandler);

        wsHandler = (ev) => {
            if (!ev || (ev.device_id && ev.device_id !== deviceId)) return;
            if (ev.type === 'health' || ev.type === 'alert' || ev.type === 'magisk') {
                refreshStatus();
            }
        };
        WS.on('all', wsHandler);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (wsHandler && typeof WS !== 'undefined') {
            WS.off('all', wsHandler);
            wsHandler = null;
        }
        const img = document.getElementById('d-screen-img');
        if (img && img._blobUrl) {
            URL.revokeObjectURL(img._blobUrl);
            img._blobUrl = null;
        }
    }

    // ── Screenshots com DOM.crossFadeImage ──────────────────

    async function captureScreenshot() {
        if (isCapturingScreenshot || !deviceId) return;
        isCapturingScreenshot = true;

        const btn = document.getElementById('d-btn-capture');
        const spinner = document.getElementById('d-shot-spinner');
        const img = document.getElementById('d-screen-img');
        const placeholder = document.getElementById('d-screen-placeholder');
        const meta = document.getElementById('d-screenshot-meta');

        if (btn) btn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';

        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/screenshot`);
            if (res.success && res.screenshot_url) {
                const blobUrl = await API.fetchBlobUrl(`${res.screenshot_url}?t=${Date.now()}`);
                if (img) {
                    if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
                    img._blobUrl = blobUrl;
                    img.style.display = 'block';
                    if (placeholder) placeholder.style.display = 'none';
                    DOM.crossFadeImage(img, blobUrl);
                }
                if (meta) {
                    const kb = (res.size_bytes / 1024).toFixed(1);
                    meta.textContent = `Capturado agora (${kb} KB)`;
                }
                UI.createToast(`Screenshot capturado (${(res.size_bytes / 1024).toFixed(1)} KB)`, 'success');
            } else {
                UI.createToast(`Erro: ${res.error || 'Falha ao capturar screenshot'}`, 'error');
            }
        } catch (e) {
            UI.createToast(`Erro na captura: ${e.message}`, 'error');
        } finally {
            isCapturingScreenshot = false;
            if (btn) btn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    }

    // ── Kiosk Web & Players ────────────────────────────────

    async function saveWebConfig() {
        const urlInput = document.getElementById('d-web-url');
        const playerSelect = document.getElementById('d-player-select');
        if (!urlInput) return;

        const target_url = urlInput.value.trim();
        const selected = playerSelect ? playerSelect.value : 'freekiosk';

        const isStream = (selected === 'vlc' || selected === 'mpv');
        const payload = {
            target_url: target_url,
            mode: isStream ? 'stream' : 'web',
            web_browser: isStream ? 'chrome' : selected,
            player: isStream ? selected : 'vlc'
        };

        try {
            await API.put(`/devices/${encodeURIComponent(deviceId)}`, payload);
            UI.createToast('Configuração salva com sucesso', 'success');
            refreshStatus();
        } catch (e) {
            UI.createToast(`Erro ao salvar: ${e.message}`, 'error');
        }
    }

    async function reloadKiosk() {
        UI.createToast('Recarregando Kiosk no TV Box...', 'info', 2000);
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/start-stream`);
            if (res.success !== false) {
                UI.createToast('🔄 Kiosk recarregado com sucesso!', 'success');
                refreshStatus();
            } else {
                UI.createToast(res.error || res.output || 'Falha ao recarregar Kiosk', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao recarregar Kiosk', 'error');
        }
    }

    async function toggleRecovery(enabled) {
        try {
            await API.put(`/devices/${encodeURIComponent(deviceId)}`, { recovery_enabled: enabled });
            UI.createToast(enabled ? 'Recuperação automática ativada' : 'Recuperação automática desativada', 'success');
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
    }

    async function action(actName) {
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/${actName}`, {});
            const msg = res.success !== false ? `${actName} executado` : `Falha: ${res.error || res.output || ''}`;
            UI.createToast(msg, res.success !== false ? 'success' : 'error');
            refreshStatus();
        } catch (e) {
            if (!UI.confirmStopScrcpy(e, () => action(actName))) {
                UI.createToast(`Erro em ${actName}: ${e.message}`, 'error');
            }
        }
    }

    // ── D-Pad Remoto ADB ───────────────────────────────────

    async function sendKey(keycode) {
        if (!deviceId) return;
        try {
            await API.post(`/devices/${encodeURIComponent(deviceId)}/shell`, { command: `input keyevent ${keycode}` });
        } catch (e) {
            UI.createToast(`Erro ao enviar comando: ${e.message}`, 'error');
        }
    }

    // ── Ações de Cabeçalho ─────────────────────────────────

    async function openScrcpy() {
        try {
            const dev = currentDevice || await API.get(`/devices/${encodeURIComponent(deviceId)}`);
            if (dev && dev.ip) {
                UI.launchScrcpy(dev);
            } else {
                UI.launchScrcpy({ id: deviceId, ip: deviceId });
            }
        } catch (e) {
            UI.launchScrcpy({ id: deviceId, ip: deviceId });
        }
    }

    async function rebootDevice() {
        UI.showModal(
            'Reiniciar TV Box',
            `<p>Deseja reiniciar o aparelho <strong>${UI.escapeHtml(deviceId)}</strong> agora?</p>`,
            async () => {
                await action('reboot');
            }
        );
    }

    async function provisionScripts() {
        const btn = document.querySelector('[onclick*="provisionScripts"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/provision`);
            UI.createToast(res.success ? `${res.scripts_count} scripts provisionados com sucesso` : `Erro: ${res.errors?.join(', ')}`, res.success ? 'success' : 'error');
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
    }

    async function deleteDevice() {
        UI.showModal(
            `Remover ${deviceId}`,
            `<p>Tem certeza? As configurações e o YAML de <strong>${UI.escapeHtml(deviceId)}</strong> serão excluídos permanentemente.</p>`,
            async () => {
                try {
                    await API.del(`/devices/${encodeURIComponent(deviceId)}`);
                    UI.createToast('Dispositivo removido com sucesso', 'success');
                    window.location.hash = '#/devices';
                } catch (e) {
                    UI.createToast(`Erro ao remover: ${e.message}`, 'error');
                }
            }
        );
    }

    // ── Gerenciamento de Apps (APK) ─────────────────────────

    async function loadApps() {
        const listEl = document.getElementById('d-apps-list');
        const badgeEl = document.getElementById('d-apps-count-badge');
        if (!listEl) return;

        try {
            const res = await API.get(`/devices/${encodeURIComponent(deviceId)}/apps`);
            if (!res.success || !res.packages || res.packages.length === 0) {
                listEl.innerHTML = '<div class="text-muted text-xs p-3">Nenhum app de terceiros instalado.</div>';
                if (badgeEl) badgeEl.textContent = '0 apps';
                return;
            }

            if (badgeEl) badgeEl.textContent = `${res.packages.length} apps`;

            let html = '';
            res.packages.forEach(p => {
                html += `
                    <div class="app-item-row">
                        <div class="app-item-info">
                            <span class="app-item-name">${UI.escapeHtml(p.name)}</span>
                            <code class="app-item-pkg">${UI.escapeHtml(p.package)}</code>
                        </div>
                        <button class="btn btn-ghost btn-sm app-uninstall-btn" onclick="DEVICE_PAGE.uninstallApp('${UI.escAttr(p.package)}')" title="Desinstalar ${UI.escAttr(p.name)}" aria-label="Desinstalar ${UI.escAttr(p.name)}">
                            ${UI.icon('trash')}
                        </button>
                    </div>
                `;
            });
            listEl.innerHTML = html;
        } catch (e) {
            listEl.innerHTML = `<div class="text-danger text-xs p-3">Erro ao carregar apps: ${UI.escapeHtml(e.message)}</div>`;
            if (badgeEl) badgeEl.textContent = 'Erro';
        }
    }

    async function installApp() {
        const input = document.getElementById('d-apk-file');
        if (!input) return;

        input.onchange = async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.name.endsWith('.apk')) {
                UI.createToast('Selecione um arquivo com extensão .apk', 'error');
                return;
            }

            UI.createToast(`Enviando ${file.name}...`, 'info', 4000);

            try {
                const data = await API.upload(`/devices/${encodeURIComponent(deviceId)}/install-apk`, file, 'file');
                if (data.success) {
                    UI.createToast(`App ${file.name} instalado com sucesso`, 'success');
                    await loadApps();
                } else {
                    UI.createToast(data.error || data.output || 'Falha na instalação do APK', 'error');
                }
            } catch (err) {
                UI.createToast(`Erro: ${err.message}`, 'error');
            }
            input.value = '';
        };
        input.click();
    }

    async function uninstallApp(pkg) {
        UI.showModal(
            `Desinstalar ${pkg}`,
            `<p>Deseja desinstalar o pacote <strong>${UI.escapeHtml(pkg)}</strong> do aparelho?</p>`,
            async () => {
                try {
                    const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/uninstall-app`, { package: pkg });
                    if (res.success) {
                        UI.createToast(`${pkg} desinstalado com sucesso`, 'success');
                        await loadApps();
                    } else {
                        UI.createToast(res.output || 'Falha ao desinstalar', 'error');
                    }
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    // ── Drawer Shell ADB ───────────────────────────────────

    function toggleShellDrawer() {
        isShellDrawerOpen = !isShellDrawerOpen;
        const drawer = document.getElementById('device-shell-drawer');
        const toggleBtn = drawer ? drawer.querySelector('.shell-drawer-toggle') : null;
        if (drawer) {
            drawer.classList.toggle('open', isShellDrawerOpen);
        }
        if (toggleBtn) {
            toggleBtn.innerHTML = isShellDrawerOpen ? '▼ Recolher' : '▲ Expandir';
            toggleBtn.setAttribute('aria-expanded', isShellDrawerOpen ? 'true' : 'false');
        }
        if (isShellDrawerOpen) {
            const input = document.getElementById('d-shell-input');
            if (input) setTimeout(() => input.focus(), 150);
        }
    }

    function runQuickCommand(cmd) {
        if (!isShellDrawerOpen) toggleShellDrawer();
        const input = document.getElementById('d-shell-input');
        if (input) input.value = cmd;
        runShell();
    }

    async function runShell() {
        const input = document.getElementById('d-shell-input');
        const output = document.getElementById('d-shell-out');
        if (!input || !output || !deviceId) return;

        const command = input.value.trim();
        if (!command) return;

        const prev = output.textContent;
        output.textContent = prev + `\n$ ${command}\n[executando...]`;
        output.scrollTop = output.scrollHeight;

        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/shell`, { command });
            const exitStr = res.exit_code !== undefined ? ` (exit: ${res.exit_code})` : '';
            output.textContent = prev + `\n$ ${command}\n${res.output || '(sem output)'}\n[concluído${exitStr}]`;
        } catch (e) {
            output.textContent = prev + `\n$ ${command}\nErro: ${e.message}`;
        }

        input.value = '';
        output.scrollTop = output.scrollHeight;
    }

    function clearShell() {
        const output = document.getElementById('d-shell-out');
        if (output) output.textContent = 'Shell limpo. Aguardando novo comando...';
    }

    return {
        render,
        destroy,
        refreshStatus,
        openScrcpy,
        reloadKiosk,
        rebootDevice,
        provisionScripts,
        deleteDevice,
        action,
        saveWebConfig,
        toggleRecovery,
        captureScreenshot,
        sendKey,
        loadApps,
        installApp,
        uninstallApp,
        toggleShellDrawer,
        runQuickCommand,
        runShell,
        clearShell
    };
})();
