/**
 * Dashboard v2 — "Sala de Controle"
 * Supervisão de frota de TV Boxes, métricas de saúde, ações rápidas e feed ao vivo.
 */
const DASHBOARD = (() => {
    let statusInterval = null;
    let ageTimer = null;
    let secondsSinceUpdate = 0;
    let expandedDeviceId = null;
    const selectedDevices = new Set();

    // ── Histórico de recuperações do watchdog (via WS) ──
    // device_id -> { when: timestamp, event: string }
    const recoveryLog = {};

    // ── Estado da coleção (filtros/sort/cache) ──
    let devicesCache = [];
    let groupNames = {};            // id -> name
    let eventsCount = 0;
    const filters = { q: '', group: '', sort: 'priority' };
    let incidentDismissed = false;

    // Normalização de status operacional
    function normalizeStatus(status) {
        if (!status) return 'unknown';
        const s = String(status).toLowerCase();
        if (s === 'online') return 'ok';
        if (s === 'degraded' || s === 'warning') return 'warn';
        if (s === 'offline' || s === 'error' || s === 'failed') return 'bad';
        return 'unknown';
    }

    const STATUS_RANK = { bad: 0, warn: 1, unknown: 2, ok: 3 };

    async function render(el) {
        UI.setPageTitle('Sala de Controle');

        el.innerHTML = `
            <!-- FAIXA DE INCIDENTE -->
            <div class="incident" id="incident-banner" style="display:none">
                <span class="glyph" aria-hidden="true">!</span>
                <div class="incident-txt" id="incident-text">Carregando status da frota...</div>
                <span class="sp"></span>
                <button class="btn btn-sm" id="btn-focus-attention">Ver fila de atenção</button>
                <button class="btn btn-sm btn-ghost" id="btn-dismiss-incident">silenciar</button>
            </div>

            <!-- KPIS DE FROTA -->
            <div class="kpis" id="fleet-kpis">
                <div class="kpi" id="kpi-online">
                    <div class="kpi-top"><span aria-hidden="true">●</span> No ar</div>
                    <div class="kpi-val num" id="kpi-online-val">--<small> / --</small></div>
                    <div class="kpi-foot"><span class="spark" id="spark-online"></span> <span id="kpi-online-foot">24 h</span></div>
                </div>
                <div class="kpi" id="kpi-attention">
                    <div class="kpi-top"><span aria-hidden="true">◐</span> Atenção</div>
                    <div class="kpi-val num" id="kpi-attention-val">0</div>
                    <div class="kpi-foot"><span class="spark" id="spark-warn"></span> <span id="kpi-attention-foot">kiosk · watchdog</span></div>
                </div>
                <div class="kpi" id="kpi-offline">
                    <div class="kpi-top"><span aria-hidden="true">✕</span> Fora</div>
                    <div class="kpi-val num" id="kpi-offline-val">0</div>
                    <div class="kpi-foot"><span class="spark" id="spark-bad"></span> <span id="kpi-offline-foot">0 em recuperação</span></div>
                </div>
                <div class="kpi" id="kpi-sessions">
                    <div class="kpi-top"><span aria-hidden="true">▣</span> Sessões scrcpy</div>
                    <div class="kpi-val num" id="kpi-sessions-val">--</div>
                    <div class="kpi-foot" id="kpi-sessions-foot">Acesso remoto 1-clique</div>
                </div>
            </div>

            <!-- GRADE PRINCIPAL (LISTA + RAIL DIREITO) -->
            <div class="body-grid">
                <!-- PAINEL DA ESQUERDA: LISTA DE TV BOXES -->
                <div class="panel">
                    <div class="toolbar">
                        <span class="panel-title">TV Boxes</span>
                        <span class="field">
                            <input id="dcard-search" placeholder="filtro rápido…" aria-label="Filtro rápido" value="${UI.escAttr(filters.q)}">
                        </span>
                        <span class="field">
                            <select id="dcard-group" aria-label="Filtrar por grupo">
                                <option value="">Todas as áreas</option>
                            </select>
                        </span>
                        <span class="field">
                            <select id="dcard-sort" aria-label="Ordenar">
                                <option value="priority" ${filters.sort === 'priority' ? 'selected' : ''}>Atenção primeiro</option>
                                <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Nome</option>
                                <option value="ip" ${filters.sort === 'ip' ? 'selected' : ''}>IP</option>
                            </select>
                        </span>
                        <span class="sp"></span>
                        <span class="seg" role="group" aria-label="Modo de exibição">
                            <button class="on" id="view-mode-list">Lista</button>
                            <button id="view-mode-mural" onclick="window.location.hash='#/mural'">Mural</button>
                        </span>
                        <button class="btn btn-sm" onclick="window.location.hash='#/mural'">▦ Mosaico</button>
                    </div>

                    <div class="rows" id="device-rows">
                        <div style="padding:20px;text-align:center;color:var(--text-muted)">Carregando TV Boxes...</div>
                    </div>

                    <!-- BARRA DE AÇÕES EM LOTE -->
                    <div class="bulk" id="bulk-bar">
                        <b><span id="bulk-count">0</span> selecionados</b>
                        <button class="btn btn-sm" onclick="DASHBOARD.bulkReloadKiosk()">↻ Recarregar kiosk</button>
                        <button class="btn btn-sm" onclick="DASHBOARD.bulkChangeUrl()">⇄ Trocar URL</button>
                        <button class="btn btn-sm btn-danger" onclick="DASHBOARD.bulkReboot()">⏻ Reiniciar</button>
                        <span class="sp"></span>
                        <button class="btn btn-sm btn-ghost" onclick="DASHBOARD.clearBulkSelection()">limpar seleção</button>
                    </div>
                </div>

                <!-- RAIL DIREITO: ATIVIDADE + SISTEMA -->
                <div class="stack">
                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">Atividade</span>
                            <span class="sp"></span>
                            <span class="live" style="font-size:11px"><span class="pulse" aria-hidden="true"></span> WS</span>
                        </div>
                        <div class="feed" id="event-feed" aria-live="polite">
                            <div class="feed-item"><div class="feed-txt text-muted">Aguardando eventos do sistema...</div></div>
                        </div>
                    </div>

                    <div class="panel">
                        <div class="panel-head">
                            <span class="panel-title">Servidor</span>
                        </div>
                        <div class="sys" id="server-sys">
                            <div class="meter">
                                <div class="meter-top"><span>CPU</span><b class="num" id="srv-cpu">--%</b></div>
                                <div class="track"><i id="srv-cpu-bar" style="width:0%"></i></div>
                            </div>
                            <div class="meter">
                                <div class="meter-top"><span>RAM</span><b class="num" id="srv-ram">--%</b></div>
                                <div class="track"><i id="srv-ram-bar" style="width:0%"></i></div>
                            </div>
                            <div class="meter">
                                <div class="meter-top"><span>Disco</span><b class="num" id="srv-disk">--%</b></div>
                                <div class="track"><i id="srv-disk-bar" style="width:0%"></i></div>
                            </div>
                            <div style="border-top:1px solid var(--border-subtle);padding-top:9px;display:flex;flex-direction:column;gap:6px">
                                <div class="svc" id="svc-api"><span aria-hidden="true">●</span> API do painel :8080</div>
                                <div class="svc" id="svc-adb"><span aria-hidden="true">●</span> ADB do painel :5038</div>
                                <div class="svc" id="svc-mtx"><span aria-hidden="true">○</span> MediaMTX :8554</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- LEGENDA DE TECLAS DE ATALHO -->
            <div class="kbd-legend">
                <span><kbd>/</kbd> buscar</span>
                <span><kbd>j</kbd><kbd>k</kbd> navegar</span>
                <span><kbd>Enter</kbd> abrir tela</span>
                <span><kbd>r</kbd> recarregar kiosk</span>
                <span><kbd>R</kbd> reiniciar</span>
                <span><kbd>Esc</kbd> fechar detalhe</span>
                <span class="sp" style="flex:1"></span>
                <span id="fleet-summary-footer">Painel TV Box v2</span>
            </div>
        `;

        bindToolbar();
        bindIncidentBanner();
        startAgeTicker();
        await loadSystemMetrics();
        await loadDevices();
        await loadScrcpySessions();
        startAutoRefresh();
    }

    // ── Listeners de WebSocket registrados com segurança ──
    function initWsListeners() {
        if (typeof WS === 'undefined' || !WS.on) return;
        WS.on('health', (data) => {
            resetAgeTicker();
            updateDeviceStatus(data.device_id, data.status, data.reason, data.timestamp);
            if (data.device_id && data.status) {
                addFeedItem({
                    kind: 'health',
                    deviceId: data.device_id,
                    message: `${data.status.toUpperCase()}${data.reason ? ' · ' + data.reason : ''}`,
                    ts: Date.parse(data.timestamp) || Date.now(),
                    dot: normalizeStatus(data.status),
                });
            }
        });

        WS.on('system_metrics', (data) => {
            resetAgeTicker();
            updateSystemMetrics(data);
        });

        WS.on('recovery', (data) => {
            resetAgeTicker();
            if (!data.device_id) return;
            recoveryLog[data.device_id] = { when: Date.now(), event: data.event || 'recuperação' };
            flashRow(data.device_id);
            addFeedItem({
                kind: 'recovery',
                deviceId: data.device_id,
                message: `recuperação watchdog: ${data.event || 'executada'}`,
                ts: Date.parse(data.timestamp) || Date.now(),
                dot: 'warn',
            });
            updateKPIs();
        });

        WS.on('alert', (data) => {
            resetAgeTicker();
            if (!data.device_id) return;
            recoveryLog[data.device_id] = { when: Date.now(), event: 'alerta crítico' };
            flashRow(data.device_id);
            addFeedItem({
                kind: 'alert',
                deviceId: data.device_id,
                message: data.message || 'alerta crítico',
                ts: Date.parse(data.timestamp) || Date.now(),
                dot: 'bad',
            });
            updateKPIs();
        });
    }
    initWsListeners();

    // ── Ticker de idade do dado ──
    function startAgeTicker() {
        if (ageTimer) clearInterval(ageTimer);
        secondsSinceUpdate = 0;
        ageTimer = setInterval(() => {
            secondsSinceUpdate++;
        }, 1000);
    }

    function resetAgeTicker() {
        secondsSinceUpdate = 0;
    }

    // ── Dispositivos ──
    async function loadDevices() {
        try {
            const devices = await API.get('/devices');
            devicesCache = Array.isArray(devices) ? devices : [];

            if (Object.keys(groupNames).length === 0) {
                const groups = await API.get('/groups').catch(() => []);
                (Array.isArray(groups) ? groups : []).forEach(g => { groupNames[g.id] = g.name || g.id; });
                populateGroupFilter(Object.keys(groupNames));
            }

            renderDeviceRows();
            updateKPIs();
            updateIncidentBanner();
        } catch (e) {
            const container = document.getElementById('device-rows');
            if (container) {
                container.innerHTML = `<div class="error-state">Erro ao carregar dispositivos: ${UI.escapeHtml(e.message)}</div>`;
            }
        }
    }

    async function loadScrcpySessions() {
        try {
            const status = await API.get('/scrcpy/status').catch(() => null);
            const kpiSessionsVal = document.getElementById('kpi-sessions-val');
            const kpiSessionsFoot = document.getElementById('kpi-sessions-foot');
            if (kpiSessionsVal) {
                const count = status?.sessions_count ?? (status?.current_version ? 'v' + status.current_version : '0');
                kpiSessionsVal.textContent = count;
            }
            if (kpiSessionsFoot && status?.current_version) {
                kpiSessionsFoot.textContent = `scrcpy v${status.current_version} ativa`;
            }
        } catch (e) {
            // Silencioso
        }
    }

    function applyFilters() {
        let list = [...devicesCache];
        const q = (filters.q || '').trim().toLowerCase();
        if (q) {
            list = list.filter(d => {
                const hay = `${d.name || ''} ${d.id || ''} ${d.ip || ''} ${d.target_url || ''} ${groupNames[d.group] || ''}`.toLowerCase();
                return hay.includes(q);
            });
        }
        if (filters.group) {
            list = list.filter(d => d.group === filters.group);
        }

        const sort = filters.sort;
        list.sort((a, b) => {
            if (sort === 'priority') {
                const sa = normalizeStatus(a.state?.status);
                const sb = normalizeStatus(b.state?.status);
                const diff = (STATUS_RANK[sa] ?? 2) - (STATUS_RANK[sb] ?? 2);
                if (diff !== 0) return diff;
                return (a.name || a.id).localeCompare(b.name || b.id);
            }
            if (sort === 'ip') return (a.ip || '').localeCompare(b.ip || '');
            return (a.name || a.id).localeCompare(b.name || b.id);
        });
        return list;
    }

    function renderDeviceRows() {
        const container = document.getElementById('device-rows');
        if (!container) return;

        if (devicesCache.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:32px 16px;text-align:center">
                    <div class="empty-title">Nenhum TV Box cadastrado</div>
                    <div class="empty-desc">Adicione dispositivos na aba TV Boxes ou no Wizard.</div>
                    <div style="margin-top:12px"><a href="#/devices" class="btn btn-sm btn-primary">+ Adicionar TV Box</a></div>
                </div>`;
            return;
        }

        const list = applyFilters();
        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:24px 16px;text-align:center">
                    <div class="empty-title">Nenhum resultado encontrado</div>
                    <div class="empty-desc">Tente ajustar a busca ou o filtro de área.</div>
                </div>`;
            return;
        }

        container.innerHTML = list.map(d => buildRowHtml(d)).join('');
        bindRowEvents();
        updateBulkBar();
    }

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function statePillHtml(d) {
        const status = d.state?.status || 'unknown';
        const norm = normalizeStatus(status);
        const shapes = { ok: '●', warn: '◐', bad: '✕', unknown: '○' };
        const labels = { ok: 'NO AR', warn: 'ATENÇÃO', bad: 'FORA', unknown: 'NOVO' };
        const shape = shapes[norm] || '○';
        const label = labels[norm] || status.toUpperCase();
        const seen = latestSeen(d);
        const age = seen ? UI.timeAgo(seen) : '—';

        return `
            <span class="state ${norm}">
                <span class="shape" aria-hidden="true">${shape}</span>
                <span>${label}</span>
                <span class="age">${age}</span>
            </span>
        `;
    }

    function buildRowHtml(d) {
        const status = d.state?.status || 'unknown';
        const norm = normalizeStatus(status);
        const isSelected = selectedDevices.has(d.id);
        const isExpanded = expandedDeviceId === d.id;
        const isOff = norm === 'bad' || norm === 'unknown';
        const reason = d.state?.reason || '';
        const groupName = groupNames[d.group] || d.group || '';
        const appLabel = d.mode === 'web'
            ? (d.web_browser === 'chrome' ? 'Chrome' : (d.web_browser === 'browser' ? 'Browser' : 'Free Kiosk'))
            : (d.player?.toUpperCase() || 'VLC');

        const wdCount = d.state?.reboot_count ? `${d.state.reboot_count} hoje` : (recoveryLog[d.id] ? 'recuperado' : 'ok');
        const screenshotUrl = API.authUrl(`/devices/${encodeURIComponent(d.id)}/screenshot`);

        return `
            <div class="row ${norm === 'bad' ? 'is-bad' : 'is-ok'} ${isSelected ? 'sel' : ''} ${isExpanded ? 'expanded' : ''}" data-id="${UI.escAttr(d.id)}">
                <input class="cbx" type="checkbox" data-cbx="${UI.escAttr(d.id)}" ${isSelected ? 'checked' : ''} aria-label="Selecionar ${UI.escapeHtml(d.name || d.id)}">
                
                <div class="thumb ${isOff ? 'off' : ''}" onclick="DASHBOARD.openScrcpy('${UI.escAttr(d.id)}')">
                    <img src="${screenshotUrl}" alt="Tela ${UI.escapeHtml(d.name || d.id)}" loading="lazy" onerror="this.style.display='none'">
                    <div class="screen"><div class="bar"></div><div class="cols"><i></i><i></i></div></div>
                    ${isOff ? `<div class="offmark">${norm === 'bad' ? 'SEM SINAL' : 'NOVO'}</div>` : ''}
                </div>

                <div class="who" onclick="DASHBOARD.toggleExpand('${UI.escAttr(d.id)}')">
                    <div class="who-name">
                        <a href="#/device/${encodeURIComponent(d.id)}" class="who-nm" onclick="event.stopPropagation()">${UI.escapeHtml(d.name || d.id)}</a>
                        ${groupName ? `<span class="chip">${UI.escapeHtml(groupName)}</span>` : ''}
                    </div>
                    <div class="who-meta">
                        <span class="mono">${UI.escapeHtml(d.ip || '--')}</span>
                        ${d.target_url ? `<span class="mono url" title="${UI.escapeHtml(d.target_url)}">${UI.escapeHtml(d.target_url)}</span>` : ''}
                        <span>${UI.escapeHtml(appLabel)}</span>
                        <span title="Watchdog">wd ${UI.escapeHtml(wdCount)}</span>
                    </div>
                    ${reason ? `<div class="reason">${UI.escapeHtml(reason)}</div>` : ''}
                </div>

                <div onclick="DASHBOARD.toggleExpand('${UI.escAttr(d.id)}')">
                    ${statePillHtml(d)}
                </div>

                <div class="acts">
                    <button class="btn btn-sm btn-primary" onclick="DASHBOARD.openScrcpy('${UI.escAttr(d.id)}')" title="Abrir scrcpy neste PC">▣ abrir</button>
                    <button class="btn btn-sm" onclick="DASHBOARD.reloadKiosk('${UI.escAttr(d.id)}')" title="Recarregar Kiosk no TV Box">↻</button>
                    <div class="dropdown-wrap">
                        <button class="btn btn-sm btn-icon" onclick="DASHBOARD.toggleMenu(event,'${UI.escAttr(d.id)}')" title="Mais opções">⋯</button>
                        <div class="dropdown-menu" id="menu-${UI.escAttr(d.id)}">
                            <button class="dropdown-item" onclick="DASHBOARD.openScrcpy('${UI.escAttr(d.id)}')">🖥️ Abrir neste PC</button>
                            <button class="dropdown-item" onclick="DASHBOARD.openScrcpyHost('${UI.escAttr(d.id)}')">🖥️ Abrir no Servidor</button>
                            <button class="dropdown-item" onclick="DASHBOARD.captureScreenshot('${UI.escAttr(d.id)}')">📸 Capturar Tela</button>
                            <button class="dropdown-item" onclick="DASHBOARD.reloadKiosk('${UI.escAttr(d.id)}')">↻ Recarregar Kiosk</button>
                            <button class="dropdown-item" onclick="DASHBOARD.configureKiosk('${UI.escAttr(d.id)}')">⚙️ Configurar URL / App</button>
                            <button class="dropdown-item" onclick="DASHBOARD.cmd('${UI.escAttr(d.id)}','reboot')">⏻ Reiniciar TV Box</button>
                            <div class="dropdown-divider"></div>
                            <button class="dropdown-item" onclick="DASHBOARD.rename('${UI.escAttr(d.id)}','${UI.escAttr(d.name)}')">✏️ Renomear</button>
                            <button class="dropdown-item" onclick="DASHBOARD.moveGroup('${UI.escAttr(d.id)}','${UI.escAttr(d.group)}')">📁 Mover Grupo</button>
                            <div class="dropdown-divider"></div>
                            <button class="dropdown-item danger" onclick="DASHBOARD.deleteDevice('${UI.escAttr(d.id)}')">🗑️ Excluir TV Box</button>
                        </div>
                    </div>
                </div>
            </div>

            ${isExpanded ? buildDetailHtml(d) : ''}
        `;
    }

    function buildDetailHtml(d) {
        const uptime = d.state?.uptime ? `${Math.round(d.state.uptime / 3600)} h` : '—';
        const recCount = d.state?.reboot_count || (recoveryLog[d.id] ? 1 : 0);
        const lastAction = recoveryLog[d.id]?.event || (d.state?.last_recovery_time ? 'recuperação' : 'nenhuma');

        return `
            <div class="detail" id="detail-${UI.escAttr(d.id)}">
                <div class="detail-grid">
                    <div>
                        <h4>Identificação</h4>
                        <div class="kv"><span>ID</span><span class="mono">${UI.escapeHtml(d.id)}</span></div>
                        <div class="kv"><span>IP / Porta ADB</span><span class="mono">${UI.escapeHtml(d.ip)}:${d.adb_port || 5555}</span></div>
                        <div class="kv"><span>Modo</span><span>${d.mode === 'web' ? 'Kiosk Web' : 'RTSP Vídeo'}</span></div>
                        <div class="kv"><span>Uptime</span><span>${uptime}</span></div>
                    </div>

                    <div>
                        <h4>Watchdog (24 h)</h4>
                        <div class="kv"><span>Recuperações</span><span>${recCount}</span></div>
                        <div class="kv"><span>Última Ação</span><span>${UI.escapeHtml(lastAction)}</span></div>
                        <div class="kv"><span>Heartbeat</span><span>${d.last_heartbeat ? UI.timeAgo(d.last_heartbeat) : '—'}</span></div>
                        <div class="kv"><span>Rede</span><span>${d.connection_type || 'Ethernet / Wi-Fi'}</span></div>
                    </div>

                    <div>
                        <h4>Cascata de Recuperação</h4>
                        <div class="kv"><span>1. player retry</span><span>automático</span></div>
                        <div class="kv"><span>2. reconexão Wi-Fi</span><span>se configurado</span></div>
                        <div class="kv"><span>3. reboot</span><span>após timeout</span></div>
                        <div class="kv"><span>4. alerta</span><span>notificação WS</span></div>
                    </div>

                    <div style="grid-column:1/-1">
                        <h4>Ações Rápidas</h4>
                        <div class="detail-actions">
                            <button class="btn btn-sm btn-primary" onclick="DASHBOARD.openScrcpy('${UI.escAttr(d.id)}')">▣ Abrir tela agora</button>
                            <button class="btn btn-sm" onclick="DASHBOARD.captureScreenshot('${UI.escAttr(d.id)}')">📸 Capturar tela</button>
                            <button class="btn btn-sm" onclick="DASHBOARD.configureKiosk('${UI.escAttr(d.id)}')">⇄ Trocar URL / Kiosk</button>
                            <button class="btn btn-sm" onclick="DASHBOARD.reloadKiosk('${UI.escAttr(d.id)}')">↻ Recarregar Kiosk</button>
                            <button class="btn btn-sm btn-danger" onclick="DASHBOARD.cmd('${UI.escAttr(d.id)}','reboot')">⏻ Reiniciar TV Box</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function toggleExpand(deviceId) {
        expandedDeviceId = (expandedDeviceId === deviceId) ? null : deviceId;
        renderDeviceRows();
    }

    function flashRow(deviceId) {
        const row = document.querySelector(`.row[data-id="${CSS.escape(deviceId)}"]`);
        if (row) {
            row.classList.add('flash');
            setTimeout(() => row.classList.remove('flash'), 1200);
        }
    }

    function updateDeviceStatus(deviceId, newStatus, reason = '', lastSeen) {
        const dev = devicesCache.find(d => d.id === deviceId);
        if (dev) {
            if (!dev.state) dev.state = {};
            dev.state.status = newStatus;
            if (reason) dev.state.reason = reason;
            if (lastSeen) dev.last_seen = lastSeen;
        }
        flashRow(deviceId);
        renderDeviceRows();
        updateKPIs();
        updateIncidentBanner();
    }

    function bindRowEvents() {
        document.querySelectorAll('#device-rows .cbx').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.cbx;
                if (cb.checked) selectedDevices.add(id);
                else selectedDevices.delete(id);
                updateBulkBar();
                const row = cb.closest('.row');
                if (row) row.classList.toggle('sel', cb.checked);
            });
        });
    }

    function updateBulkBar() {
        const bar = document.getElementById('bulk-bar');
        const count = document.getElementById('bulk-count');
        const n = selectedDevices.size;
        if (bar && count) {
            count.textContent = n;
            bar.classList.toggle('on', n > 0);
        }
    }

    function clearBulkSelection() {
        selectedDevices.clear();
        document.querySelectorAll('#device-rows .cbx').forEach(cb => { cb.checked = false; });
        document.querySelectorAll('#device-rows .row').forEach(r => r.classList.remove('sel'));
        updateBulkBar();
    }

    // ── Ações em Lote ──
    async function bulkReloadKiosk() {
        const ids = Array.from(selectedDevices);
        if (!ids.length) return;
        UI.createToast(`Recarregando Kiosk em ${ids.length} TV Box(es)...`, 'info');
        for (const id of ids) {
            try { await API.post(`/devices/${encodeURIComponent(id)}/start-stream`); } catch (e) {}
        }
        UI.createToast(`✅ Comando enviado para ${ids.length} dispositivo(s)`, 'success');
        clearBulkSelection();
        setTimeout(loadDevices, 1500);
    }

    async function bulkChangeUrl() {
        const ids = Array.from(selectedDevices);
        if (!ids.length) return;
        UI.showModal('Definir URL em Lote', `
            <p class="text-sm">Aplicar nova URL para os <b>${ids.length}</b> TV Box(es) selecionados:</p>
            <div class="form-group mt-sm">
                <label class="form-label">Nova URL da Página / Signage:</label>
                <input type="url" id="bulk-url-input" class="form-input" placeholder="https://app.exemplo.com">
            </div>
        `, async () => {
            const url = document.getElementById('bulk-url-input')?.value.trim();
            if (!url) return;
            UI.createToast(`Aplicando URL em ${ids.length} dispositivos...`, 'info');
            for (const id of ids) {
                try {
                    await API.put(`/devices/${id}`, { mode: 'web', target_url: url });
                    await API.post(`/devices/${encodeURIComponent(id)}/start-stream`);
                } catch (e) {}
            }
            UI.createToast(`✅ URL configurada em ${ids.length} TV Box(es)!`, 'success');
            clearBulkSelection();
            setTimeout(loadDevices, 1500);
        });
    }

    async function bulkReboot() {
        const ids = Array.from(selectedDevices);
        if (!ids.length) return;
        if (!confirm(`Tem certeza que deseja reiniciar ${ids.length} TV Box(es) selecionados?`)) return;
        UI.createToast(`Reiniciando ${ids.length} dispositivo(s)...`, 'info');
        for (const id of ids) {
            try { await API.post(`/devices/${encodeURIComponent(id)}/reboot`); } catch (e) {}
        }
        UI.createToast(`✅ Comando de reinicialização disparado`, 'success');
        clearBulkSelection();
        setTimeout(loadDevices, 2000);
    }

    // ── KPIs e Incident Banner ──
    function updateKPIs() {
        let online = 0;
        let warn = 0;
        let bad = 0;
        const total = devicesCache.length;

        devicesCache.forEach(d => {
            const norm = normalizeStatus(d.state?.status);
            if (norm === 'ok') online++;
            else if (norm === 'warn') warn++;
            else if (norm === 'bad') bad++;
        });

        const elOnline = document.getElementById('kpi-online-val');
        const elWarn = document.getElementById('kpi-attention-val');
        const elBad = document.getElementById('kpi-offline-val');
        const kpiBadCard = document.getElementById('kpi-offline');
        const kpiWarnCard = document.getElementById('kpi-attention');

        if (elOnline) elOnline.innerHTML = `${online}<small> / ${total}</small>`;
        if (elWarn) elWarn.textContent = warn;
        if (elBad) elBad.textContent = bad;

        if (kpiBadCard) kpiBadCard.classList.toggle('attention', bad > 0);
        if (kpiWarnCard) kpiWarnCard.classList.toggle('attention', warn > 0);

        renderSparklines(online, warn, bad);
    }

    function renderSparklines(okCount, warnCount, badCount) {
        const sparkOk = document.getElementById('spark-online');
        const sparkWarn = document.getElementById('spark-warn');
        const sparkBad = document.getElementById('spark-bad');
        if (sparkOk) sparkOk.innerHTML = [3,4,4,5,5,6,6,6,7,8,8,8].map(v => `<i style="height:${20 + v * 9}%"></i>`).join('');
        if (sparkWarn) sparkWarn.innerHTML = [0,1,0,1,2,1,1,2,2,1,2,warnCount > 0 ? 3 : 1].map(v => `<i style="height:${20 + v * 9}%"></i>`).join('');
        if (sparkBad) sparkBad.innerHTML = [1,0,0,1,0,1,1,0,2,1,2,badCount > 0 ? 4 : 1].map(v => `<i style="height:${20 + v * 9}%"></i>`).join('');
    }

    function updateIncidentBanner() {
        const banner = document.getElementById('incident-banner');
        const text = document.getElementById('incident-text');
        if (!banner || !text || incidentDismissed) {
            if (banner && incidentDismissed) banner.style.display = 'none';
            return;
        }

        const badDevices = [];
        const warnDevices = [];

        devicesCache.forEach(d => {
            const norm = normalizeStatus(d.state?.status);
            if (norm === 'bad') badDevices.push(d);
            else if (norm === 'warn' || recoveryLog[d.id]) warnDevices.push(d);
        });

        const totalIssues = badDevices.length + warnDevices.length;
        if (totalIssues === 0) {
            banner.style.display = 'none';
            return;
        }

        banner.style.display = 'flex';
        const highlights = [];
        if (badDevices.length > 0) {
            highlights.push(`<b>${UI.escapeHtml(badDevices[0].name || badDevices[0].id)}</b> fora do ar`);
        }
        if (warnDevices.length > 0) {
            highlights.push(`<b>${UI.escapeHtml(warnDevices[0].name || warnDevices[0].id)}</b> com alertas`);
        }

        text.innerHTML = `
            <b>${totalIssues} de ${devicesCache.length} precisam de atenção agora</b> — 
            ${badDevices.length} fora e ${warnDevices.length} degradada(s): 
            ${highlights.join(' · ')}
        `;
    }

    function bindIncidentBanner() {
        const btnFocus = document.getElementById('btn-focus-attention');
        const btnDismiss = document.getElementById('btn-dismiss-incident');
        if (btnFocus) {
            btnFocus.addEventListener('click', () => {
                const sel = document.getElementById('dcard-sort');
                if (sel) { sel.value = 'priority'; filters.sort = 'priority'; renderDeviceRows(); }
            });
        }
        if (btnDismiss) {
            btnDismiss.addEventListener('click', () => {
                incidentDismissed = true;
                const banner = document.getElementById('incident-banner');
                if (banner) banner.style.display = 'none';
            });
        }
    }

    // ── Feed de Atividade ──
    function addFeedItem({ message = '', deviceId = '', ts = Date.now(), dot = '' }) {
        const feed = document.getElementById('event-feed');
        if (!feed) return;

        const placeholder = feed.querySelector('.text-muted');
        if (placeholder) placeholder.remove();

        const item = document.createElement('div');
        item.className = 'feed-item';
        const dotClass = dot === 'bad' ? 'bad' : (dot === 'warn' ? 'warn' : '');
        item.innerHTML = `
            <span class="feed-dot ${dotClass}" aria-hidden="true"></span>
            <div class="feed-txt">
                <b>${UI.escapeHtml(deviceId)}</b> ${UI.escapeHtml(message)}
                <time>${UI.timeAgo(ts)}</time>
            </div>
        `;
        feed.prepend(item);
        while (feed.children.length > 25) feed.lastElementChild.remove();
        eventsCount++;
    }

    function addEvent(ev) {
        addFeedItem(ev);
    }

    function clearEvents() {
        const feed = document.getElementById('event-feed');
        if (feed) feed.innerHTML = '<div class="feed-item"><div class="feed-txt text-muted">Sem eventos recentes.</div></div>';
        eventsCount = 0;
    }

    function viewLog() {
        window.location.hash = '#/logs';
    }

    function downloadLog() {
        window.open(API.authUrl('/api/logs/download?source=watchdog'), '_blank');
    }

    // ── Métricas do Servidor ──
    async function loadSystemMetrics() {
        try {
            const m = await API.get('/system/metrics');
            updateSystemMetrics(m);
        } catch (e) {
            // Silencioso
        }
    }

    function updateSystemMetrics(m) {
        if (!m) return;
        const cpu = m.cpu_percent != null ? Math.round(m.cpu_percent) : null;
        const ram = m.ram_percent != null ? Math.round(m.ram_percent) : null;
        const disk = m.disk_percent != null ? Math.round(m.disk_percent) : null;

        const elCpu = document.getElementById('srv-cpu');
        const elCpuBar = document.getElementById('srv-cpu-bar');
        const elRam = document.getElementById('srv-ram');
        const elRamBar = document.getElementById('srv-ram-bar');
        const elDisk = document.getElementById('srv-disk');
        const elDiskBar = document.getElementById('srv-disk-bar');

        if (cpu != null && elCpu && elCpuBar) {
            elCpu.textContent = `${cpu}%`;
            elCpuBar.style.width = `${cpu}%`;
        }
        if (ram != null && elRam && elRamBar) {
            elRam.textContent = `${ram}%`;
            elRamBar.style.width = `${ram}%`;
        }
        if (disk != null && elDisk && elDiskBar) {
            elDisk.textContent = `${disk}%`;
            elDiskBar.style.width = `${disk}%`;
        }
    }

    // ── Toolbar ──
    function bindToolbar() {
        const search = document.getElementById('dcard-search');
        const group = document.getElementById('dcard-group');
        const sort = document.getElementById('dcard-sort');
        if (search) search.addEventListener('input', () => { filters.q = search.value; renderDeviceRows(); });
        if (group) group.addEventListener('change', () => { filters.group = group.value; renderDeviceRows(); });
        if (sort) sort.addEventListener('change', () => { filters.sort = sort.value; renderDeviceRows(); });
    }

    function populateGroupFilter(ids) {
        const sel = document.getElementById('dcard-group');
        if (!sel) return;
        const opts = ['<option value="">Todas as áreas</option>'].concat(
            ids.sort().map(id => `<option value="${UI.escapeHtml(id)}">${UI.escapeHtml(groupNames[id] || id)}</option>`)
        );
        sel.innerHTML = opts.join('');
    }

    function startAutoRefresh() {
        if (statusInterval) clearInterval(statusInterval);
        statusInterval = setInterval(() => {
            loadDevices();
            loadSystemMetrics();
            loadScrcpySessions();
        }, 15000);
    }

    function destroy() {
        if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
        if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
    }

    // ── Dropdown e Ações Individuais ──
    function toggleMenu(event, deviceId) {
        event.stopPropagation();
        document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
        const menu = document.getElementById(`menu-${deviceId}`);
        if (menu) menu.classList.toggle('open');
        const close = (e) => {
            if (!e.target.closest('.dropdown-wrap')) {
                document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 10);
    }

    function openScrcpy(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        if (dev) UI.launchScrcpy(dev);
        else UI.launchScrcpy({ id: deviceId, ip: deviceId });
    }

    function openScrcpyHost(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        UI.launchScrcpyHost(deviceId, dev?.name || deviceId);
    }

    async function reloadKiosk(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        const name = dev?.name || deviceId;
        UI.createToast(`Recarregando Kiosk em ${name}...`, 'info', 2000);
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/start-stream`);
            if (res.success) {
                UI.createToast(`🔄 Kiosk recarregado em ${name}!`, 'success');
                flashRow(deviceId);
                setTimeout(loadDevices, 1500);
            } else {
                UI.createToast(res.error || res.output || 'Falha ao recarregar Kiosk', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao recarregar Kiosk', 'error');
        }
    }

    async function captureScreenshot(deviceId) {
        UI.createToast('📸 Solicitando captura de tela...', 'info', 2000);
        try {
            const res = await API.post(`/devices/${deviceId}/screenshot`);
            if (res.success) {
                UI.createToast('✅ Screenshot capturado', 'success');
                flashRow(deviceId);
                setTimeout(loadDevices, 1000);
            } else {
                UI.createToast(`❌ ${res.error || 'Falha ao capturar'}`, 'error');
            }
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
        }
    }

    async function configureKiosk(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        const currentUrl = dev?.target_url || '';
        const currentBrowser = dev?.web_browser || 'freekiosk';
        UI.showModal('Configurar Kiosk / Aplicação', `
            <div class="form-group">
                <label class="form-label" for="cfg-browser">Navegador / App Kiosk:</label>
                <select id="cfg-browser" class="form-input">
                    <option value="freekiosk" ${currentBrowser === 'freekiosk' ? 'selected' : ''}>Free Kiosk Browser (Recomendado)</option>
                    <option value="chrome" ${currentBrowser === 'chrome' ? 'selected' : ''}>Google Chrome</option>
                    <option value="browser" ${currentBrowser === 'browser' ? 'selected' : ''}>Browser Padrão</option>
                </select>
            </div>
            <div class="form-group mt-sm">
                <label class="form-label" for="cfg-target-url">URL da Página / Aplicação:</label>
                <input type="url" id="cfg-target-url" class="form-input" value="${UI.escAttr(currentUrl)}" placeholder="https://app.exemplo.com">
                <small class="text-muted" style="display:block;margin-top:4px">URL que o TV Box exibirá ao recarregar ou iniciar.</small>
            </div>
        `, async () => {
            const webBrowser = document.getElementById('cfg-browser')?.value || 'freekiosk';
            const targetUrl = document.getElementById('cfg-target-url')?.value.trim() || '';
            try {
                await API.put(`/devices/${deviceId}`, { mode: 'web', web_browser: webBrowser, target_url: targetUrl });
                UI.createToast('⚙️ Configuração salva com sucesso', 'success');
                await reloadKiosk(deviceId);
                loadDevices();
            } catch (e) {
                UI.createToast(`❌ ${e.message}`, 'error');
            }
        });
    }

    function rename(deviceId, currentName) {
        UI.showModal('Renomear TV Box', `<div class="form-group"><label class="form-label">Novo nome</label><input type="text" id="ren-name" class="form-input" value="${UI.escapeHtml(currentName)}"></div>`,
            async () => {
                const name = document.getElementById('ren-name')?.value?.trim();
                if (!name) return;
                await API.put(`/devices/${deviceId}`, { name });
                UI.createToast(`✏️ Renomeado para "${name}"`, 'success');
                loadDevices();
            }
        );
    }

    function renameStream(deviceId, currentPath) {
        UI.showModal('Path RTSP', `<div class="form-group"><label class="form-label">Path RTSP</label><input type="text" id="rtsp-path" class="form-input" value="${UI.escapeHtml(currentPath)}"></div>`,
            async () => {
                const p = document.getElementById('rtsp-path')?.value?.trim();
                if (!p) return;
                await API.put(`/devices/${deviceId}`, { rtsp_path: p });
                UI.createToast(`🔗 Path alterado para "${p}"`, 'success');
            }
        );
    }

    function createGroup(deviceId) {
        UI.showModal('Novo Grupo', `
            <div class="form-group"><label class="form-label">Nome do grupo</label><input type="text" id="g-name" class="form-input" placeholder="Ex: Armazéns"></div>
            <div class="form-group"><label class="form-label">Descrição (opcional)</label><input type="text" id="g-desc" class="form-input" placeholder="Ex: TV Boxes do setor"></div>`,
            async () => {
                const name = document.getElementById('g-name')?.value?.trim();
                if (!name) return;
                const res = await API.post('/groups', { name, description: document.getElementById('g-desc')?.value?.trim() || '' });
                await API.put(`/devices/${deviceId}`, { group: res.id || name });
                UI.createToast(`📁 Grupo "${name}" criado e device associado`, 'success');
                loadDevices();
            }
        );
    }

    async function moveGroup(deviceId, currentGroup) {
        const groups = await API.get('/groups').catch(() => []);
        const opts = (Array.isArray(groups) ? groups : []).map(g =>
            `<option value="${UI.escapeHtml(g.id)}" ${g.id === currentGroup ? 'selected' : ''}>${UI.escapeHtml(g.name || g.id)}</option>`
        ).join('');
        UI.showModal('Mover para Área / Grupo', `
            <div class="form-group"><label class="form-label">Selecionar área</label>
            <select id="g-select" class="form-input"><option value="">Nenhuma</option>${opts}</select></div>`,
            async () => {
                const g = document.getElementById('g-select')?.value || '';
                await API.put(`/devices/${deviceId}`, { group: g });
                UI.createToast(`📂 Movido para "${g || 'Nenhuma'}"`, 'success');
                loadDevices();
            }
        );
    }

    async function cmd(deviceId, action) {
        if (action === 'reboot') {
            if (!confirm(`Tem certeza que deseja reiniciar o TV Box ${deviceId}?`)) return;
        }
        try {
            const res = await API.post(`/devices/${deviceId}/${action}`);
            UI.createToast(res.success ? `✅ ${action} executado` : `❌ ${res.error || 'Falha'}`, res.success ? 'success' : 'error');
            setTimeout(loadDevices, 2000);
        } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
    }

    function deleteDevice(deviceId) {
        UI.showModal(`Excluir ${deviceId}`, `<p>Tem certeza? O TV Box será removido permanentemente.</p>`, async () => {
            try {
                await API.del(`/devices/${deviceId}`);
                UI.createToast('🗑️ TV Box removido', 'success');
                loadDevices();
            } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
        });
    }

    function deleteGroup(groupId) {
        if (!groupId) return;
        UI.showModal(`Excluir Grupo "${groupId}"`, `<p>Os dispositivos do grupo NÃO serão removidos.</p>`, async () => {
            try {
                await API.del(`/groups/${groupId}`);
                UI.createToast(`🗑️ Grupo "${groupId}" removido`, 'success');
                loadDevices();
            } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
        });
    }

    async function toggleMode(deviceId, currentMode) {
        const newMode = currentMode === 'web' ? 'stream' : 'web';
        if (newMode === 'web') {
            const dev = devicesCache.find(d => d.id === deviceId);
            const currentUrl = dev?.target_url || '';
            UI.showModal('Alternar para Modo Web (Signage)', `
                <p class="text-sm">O TV Box abrirá um navegador em tela cheia com a URL indicada.</p>
                <div class="form-group mt-sm">
                    <label class="form-label" for="tg-web-url">URL da Página / Signage:</label>
                    <input type="text" id="tg-web-url" class="form-control" value="${UI.escAttr(currentUrl)}" placeholder="http://${location.host}/signage?device_id=${encodeURIComponent(deviceId)}">
                </div>
            `, async () => {
                const targetUrl = document.getElementById('tg-web-url')?.value.trim() || '';
                try {
                    await API.put(`/devices/${deviceId}`, { mode: 'web', target_url: targetUrl });
                    UI.createToast('🌐 Modo alterado para Signage Web', 'success');
                    await API.post(`/devices/${deviceId}/start-stream`);
                    loadDevices();
                } catch (e) {
                    UI.createToast(`❌ ${e.message}`, 'error');
                }
            });
        } else {
            try {
                await API.put(`/devices/${deviceId}`, { mode: 'stream' });
                UI.createToast('🎬 Modo alterado para RTSP (Vídeo)', 'success');
                await API.post(`/devices/${deviceId}/start-stream`);
                loadDevices();
            } catch (e) {
                UI.createToast(`❌ ${e.message}`, 'error');
            }
        }
    }

    return {
        render,
        destroy,
        toggleMenu,
        toggleExpand,
        openScrcpy,
        openScrcpyHost,
        reloadKiosk,
        captureScreenshot,
        configureKiosk,
        rename,
        renameStream,
        createGroup,
        moveGroup,
        cmd,
        deleteDevice,
        deleteGroup,
        toggleMode,
        addEvent,
        clearEvents,
        viewLog,
        downloadLog,
        bulkReloadKiosk,
        bulkChangeUrl,
        bulkReboot,
        clearBulkSelection,
        loadDevices,
        getDevices: () => devicesCache,
    };
})();
