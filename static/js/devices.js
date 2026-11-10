/**
 * Devices Page — gerenciamento de dispositivos (Design System v2 NOC-Style):
 *   Tabela densa NOC, toolbar canônico, miniaturas 16:9 com DOM.crossFadeImage,
 *   pastilhas .state consistentes, expansão inline com métricas e seleção em lote (.bulk).
 */
const DEVICES = (() => {
    let refreshTimer = null;
    let screenshotTimer = null;
    let boundGlobalKeyHandler = null;
    let boundDocClickHandler = null;

    // ── Estado da página ──
    let devicesCache = [];
    let groupNames = {};                // id -> name
    let selectedIds = new Set();
    const filters = {
        q: '',
        status: 'all',                  // 'all' | 'online' | 'warning' | 'offline'
        group: ''
    };
    const blobUrls = new Map();         // deviceId -> blobUrl (para revogação e crossFade)

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function timeAgoStr(d) {
        const seen = latestSeen(d);
        return seen ? UI.timeAgo(seen) : '—';
    }

    async function render(el) {
        UI.setPageTitle('TV Boxes');

        el.innerHTML = `
            <div class="devices-page">
                <div id="devices-toolbar-mount"></div>
                <div id="devices-table-wrap">
                    ${UI.skeletons('table', 5)}
                </div>
                <!-- Barra flutuante de ações em lote -->
                <div class="bulk devices-bulk" id="devices-bulk-bar" role="region" aria-label="Ações em lote">
                    <b><span id="bulk-selected-count">0</span> selecionado(s)</b>
                    <span class="sp"></span>
                    <button type="button" class="btn btn-sm btn-primary" onclick="DEVICES.bulkReloadKiosk()">${UI.icon('refresh', 14)} Recarregar Kiosk</button>
                    <button type="button" class="btn btn-sm btn-danger" onclick="DEVICES.bulkReboot()">${UI.icon('reboot', 14)} Reboot</button>
                    <button type="button" class="btn btn-sm btn-ghost" onclick="DEVICES.clearSelection()">Desmarcar todos</button>
                </div>
            </div>
        `;

        setupGlobalListeners();
        await loadDevices();

        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(loadDevicesSilent, 15000);

        if (screenshotTimer) clearInterval(screenshotTimer);
        screenshotTimer = setInterval(refreshScreenshots, 6000);
    }

    function setupGlobalListeners() {
        if (!boundDocClickHandler) {
            boundDocClickHandler = (e) => {
                if (!e.target.closest('.dropdown-wrap') && !e.target.closest('.actions-cell')) {
                    document.querySelectorAll('.devices-page .dropdown-menu.open').forEach(m => m.classList.remove('open'));
                }
            };
            document.addEventListener('click', boundDocClickHandler);
        }
    }

    // ── WebSocket Listener ──
    WS.on('health', (data) => {
        if (!data.device_id) return;
        const dev = devicesCache.find(d => d.id === data.device_id);
        if (dev) {
            if (!dev.state) dev.state = {};
            dev.state.status = data.status;
            if (data.reason !== undefined) dev.state.reason = data.reason;
            if (data.timestamp) dev.last_seen = data.timestamp;

            // Atualização pontual do badge de status se presente no DOM
            const tr = document.getElementById(`data-row-${data.device_id}`);
            if (tr) {
                const statusTd = tr.querySelector('.status-cell');
                if (statusTd) {
                    statusTd.innerHTML = UI.stateBadge(data.status, {
                        age: UI.timeAgo(data.timestamp || latestSeen(dev)),
                        reason: data.reason
                    });
                }
            }
            updateCounters();
        }
    });

    // ── Carga de Dados ──
    async function loadDevices() {
        const wrap = document.getElementById('devices-table-wrap');
        try {
            const [devices, groups] = await Promise.all([
                API.get('/devices'),
                API.get('/groups').catch(() => [])
            ]);

            devicesCache = Array.isArray(devices) ? devices : [];
            groupNames = {};
            (Array.isArray(groups) ? groups : []).forEach(g => { groupNames[g.id] = g.name || g.id; });

            renderToolbar();
            renderTable();
            refreshScreenshots();
        } catch (e) {
            if (wrap) {
                wrap.innerHTML = UI.stateView('error', e.message, { retry: true, title: 'Erro ao carregar TV Boxes' });
                UI.bindStateRetry(wrap, loadDevices);
            }
        }
    }

    async function loadDevicesSilent() {
        try {
            const devices = await API.get('/devices');
            devicesCache = Array.isArray(devices) ? devices : [];
            renderToolbar();
            renderTable();
            refreshScreenshots();
        } catch (e) {
            // Silencioso em polling em background
        }
    }

    // ── Filtragem e Ordenação ──
    function applyFilters() {
        const q = (filters.q || '').trim().toLowerCase();
        const statusFilter = filters.status;

        return devicesCache.filter(d => {
            // Filtro por status
            if (statusFilter !== 'all') {
                const st = (d.state?.status || 'unknown').toLowerCase();
                if (statusFilter === 'online' && st !== 'online') return false;
                if (statusFilter === 'warning' && st !== 'warning' && st !== 'degraded') return false;
                if (statusFilter === 'offline' && st !== 'offline' && st !== 'unknown') return false;
            }

            // Filtro por texto
            if (q) {
                const grp = groupNames[d.group] || d.group || '';
                const hay = `${d.name || ''} ${d.id || ''} ${d.ip || ''} ${d.location || ''} ${grp} ${d.target_url || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }

            return true;
        });
    }

    function calculateStatusCounts() {
        let total = devicesCache.length;
        let online = 0;
        let warning = 0;
        let offline = 0;

        devicesCache.forEach(d => {
            const st = (d.state?.status || 'unknown').toLowerCase();
            if (st === 'online') online++;
            else if (st === 'warning' || st === 'degraded') warning++;
            else offline++;
        });

        return { total, online, warning, offline };
    }

    // ── Renderização da Toolbar ──
    function renderToolbar() {
        const mount = document.getElementById('devices-toolbar-mount');
        if (!mount) return;

        const counts = calculateStatusCounts();

        const toolbarHtml = UI.pageToolbar({
            title: 'TV Boxes',
            count: counts.total,
            filters: [
                { id: 'all', label: 'Todos', count: counts.total, active: filters.status === 'all' },
                { id: 'online', label: 'Online', count: counts.online, active: filters.status === 'online' },
                { id: 'warning', label: 'Atenção', count: counts.warning, active: filters.status === 'warning' },
                { id: 'offline', label: 'Offline', count: counts.offline, active: filters.status === 'offline' }
            ],
            search: {
                id: 'devices-search',
                placeholder: 'Buscar nome ou IP... [/]',
                value: filters.q
            },
            actions: [
                { label: 'Novo TV Box', icon: 'plus', primary: true, onclick: 'DEVICES.showAddDialog()' },
                { label: 'Replicar Scripts', icon: 'upload', id: 'provision-all-btn', onclick: 'DEVICES.provisionAll()' }
            ]
        });

        DOM.patch(mount, toolbarHtml);
        bindToolbarEvents(mount);
    }

    function updateCounters() {
        const counts = calculateStatusCounts();
        const chips = document.querySelectorAll('#devices-toolbar-mount .filter-chip');
        chips.forEach(chip => {
            const fid = chip.dataset.filter;
            const cntSpan = chip.querySelector('.chip-count');
            if (cntSpan && counts[fid] !== undefined) {
                cntSpan.textContent = counts[fid];
            }
        });
        const titleCount = document.querySelector('#devices-toolbar-mount .page-toolbar-count');
        if (titleCount) titleCount.textContent = counts.total;
    }

    function bindToolbarEvents(mount) {
        // Busca com filtragem instantânea
        const searchInput = mount.querySelector('#devices-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                filters.q = searchInput.value;
                renderTable();
            });
        }

        // Filtros rápidos
        mount.querySelectorAll('.filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                filters.status = btn.dataset.filter || 'all';
                mount.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                renderTable();
            });
        });
    }

    // ── Renderização da Tabela Densa ──
    function renderTable() {
        const wrap = document.getElementById('devices-table-wrap');
        if (!wrap) return;

        if (devicesCache.length === 0) {
            wrap.innerHTML = UI.stateView('empty', 'Nenhum TV Box cadastrado. Clique em "+ Novo TV Box" para adicionar.', {
                icon: 'tv',
                title: 'Nenhum dispositivo'
            });
            updateBulkBar();
            return;
        }

        const filtered = applyFilters();
        if (filtered.length === 0) {
            wrap.innerHTML = UI.stateView('empty', 'Nenhum TV Box corresponde ao filtro aplicado.', {
                icon: 'search',
                title: 'Sem resultados'
            });
            updateBulkBar();
            return;
        }

        const columns = [
            {
                key: 'thumb',
                label: 'Tela',
                width: '88px',
                align: 'center',
                render: (_, d) => {
                    const status = (d.state?.status || 'unknown').toLowerCase();
                    const isOff = status === 'offline' || status === 'unknown';
                    return `
                        <div class="device-thumb ${isOff ? 'off' : ''}" onclick="event.stopPropagation(); DEVICES.openScrcpy('${UI.escAttr(d.id)}')" title="Acesso Remoto Scrcpy">
                            <img data-thumb-id="${UI.escAttr(d.id)}" alt="Tela ${UI.escapeHtml(d.name || d.id)}" style="display:none" onload="this.style.display='block'; if(this.nextElementSibling) this.nextElementSibling.style.display='none'" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex'">
                            <div class="thumb-fallback" aria-hidden="true">${UI.icon('tv', 18)}</div>
                            <span class="thumb-overlay-hint">Scrcpy</span>
                        </div>
                    `;
                }
            },
            {
                key: 'device',
                label: 'Dispositivo',
                sortable: true,
                render: (_, d) => {
                    const portStr = d.adb_port && d.adb_port !== 5555 ? `:${d.adb_port}` : '';
                    return `
                        <div class="device-info-cell">
                            <div class="device-name-row">
                                <a href="#/device/${encodeURIComponent(d.id)}" class="device-name-link" onclick="event.stopPropagation()">${UI.escapeHtml(d.name || d.id)}</a>
                            </div>
                            <div class="device-sub-row mono">${UI.escapeHtml(d.ip || '--')}${portStr}</div>
                            ${d.description ? `<div class="device-desc-sub" title="${UI.escAttr(d.description)}">${UI.escapeHtml(d.description)}</div>` : ''}
                        </div>
                    `;
                }
            },
            {
                key: 'status',
                label: 'Status',
                sortable: true,
                render: (_, d) => {
                    const st = d.state?.status || 'unknown';
                    return `<div class="status-cell">${UI.stateBadge(st, { age: timeAgoStr(d), reason: d.state?.reason })}</div>`;
                }
            },
            {
                key: 'group_loc',
                label: 'Grupo & Local',
                render: (_, d) => {
                    const grpName = groupNames[d.group] || d.group;
                    return `
                        <div class="group-loc-cell">
                            ${d.group ? `<a href="#/group/${encodeURIComponent(d.group)}" class="badge-group" onclick="event.stopPropagation()">${UI.escapeHtml(grpName)}</a>` : '<span class="text-muted">—</span>'}
                            ${d.location ? `<span class="badge-loc" title="Localização">${UI.escapeHtml(d.location)}</span>` : ''}
                        </div>
                    `;
                }
            },
            {
                key: 'app',
                label: 'App / Kiosk',
                render: (_, d) => {
                    const isWeb = (d.mode || 'web') === 'web';
                    const browserLabel = d.web_browser === 'chrome' ? 'Chrome' : (d.web_browser === 'browser' ? 'Browser Padrão' : 'Free Kiosk Browser');
                    const appLabel = isWeb ? browserLabel : (d.player?.toUpperCase() || 'VLC');
                    const displayUrl = d.target_url || d.state?.kiosk_url || '';
                    return `
                        <div class="app-cell">
                            <div class="app-label">${UI.escapeHtml(appLabel)}</div>
                            ${displayUrl ? `<div class="app-url mono" title="${UI.escAttr(displayUrl)}">${UI.escapeHtml(displayUrl)}</div>` : ''}
                        </div>
                    `;
                }
            },
            {
                key: 'actions',
                label: 'Ações',
                align: 'right',
                render: (_, d) => {
                    return `
                        <div class="actions-cell" onclick="event.stopPropagation()">
                            <button type="button" class="btn-icon-sm" onclick="DEVICES.openScrcpy('${UI.escAttr(d.id)}')" title="Acesso Remoto Scrcpy" aria-label="Acesso Remoto Scrcpy">${UI.icon('monitor', 15)}</button>
                            <button type="button" class="btn-icon-sm" onclick="DEVICES.reloadKiosk('${UI.escAttr(d.id)}')" title="Recarregar Kiosk" aria-label="Recarregar Kiosk">${UI.icon('refresh', 15)}</button>
                            <a href="#/device/${encodeURIComponent(d.id)}" class="btn-icon-sm" title="Ver detalhes do TV Box" aria-label="Ver detalhes do TV Box">${UI.icon('arrow-right', 14)}</a>
                            <div class="dropdown-wrap">
                                <button type="button" class="btn-icon-sm btn-more" onclick="DEVICES.toggleRowMenu(event, '${UI.escAttr(d.id)}')" title="Mais opções" aria-label="Mais opções">${UI.icon('more-vertical', 15)}</button>
                                <div class="dropdown-menu" id="row-menu-${UI.escAttr(d.id)}">
                                    <button type="button" class="dropdown-item" onclick="DEVICES.openScrcpyHost('${UI.escAttr(d.id)}')">${UI.icon('monitor', 14)} Abrir no Servidor</button>
                                    <button type="button" class="dropdown-item" onclick="DEVICES.captureScreenshot('${UI.escAttr(d.id)}')">${UI.icon('camera', 14)} Capturar Screenshot</button>
                                    <button type="button" class="dropdown-item" onclick="DEVICES.rebootDevice('${UI.escAttr(d.id)}')">${UI.icon('reboot', 14)} Reiniciar TV Box</button>
                                    <div class="dropdown-divider"></div>
                                    <button type="button" class="dropdown-item" onclick="DEVICES.renameDialog('${UI.escAttr(d.id)}', '${UI.escAttr(d.name)}')">${UI.icon('edit', 14)} Renomear</button>
                                    <button type="button" class="dropdown-item" onclick="DEVICES.groupDialog('${UI.escAttr(d.id)}', '${UI.escAttr(d.group)}')">${UI.icon('users', 14)} Mover Grupo</button>
                                    <div class="dropdown-divider"></div>
                                    <button type="button" class="dropdown-item danger" onclick="DEVICES.remove('${UI.escAttr(d.id)}')">${UI.icon('trash', 14)} Excluir TV Box</button>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }
        ];

        const rows = filtered.map(d => ({
            id: d.id,
            thumb: '',
            device: '',
            status: d.state?.status || 'unknown',
            group_loc: '',
            app: '',
            actions: '',
            detail: (row) => renderRowDetail(d)
        }));

        const tableHtml = UI.dataTable({
            id: 'devices-table',
            columns,
            rows,
            selectable: true,
            expandable: true,
            emptyMessage: 'Nenhum TV Box encontrado'
        });

        DOM.patch(wrap, tableHtml);
        bindTableEvents(wrap);
        syncSelectedCheckboxes();
        updateBulkBar();
    }

    function renderRowDetail(d) {
        const uptime = d.state?.uptime ? `${Math.round(d.state.uptime / 3600)} h` : '—';
        const heartbeatStr = d.state?.last_heartbeat ? UI.timeAgo(d.state.last_heartbeat) : (d.state?.last_seen ? UI.timeAgo(d.state.last_seen) : '—');
        const reason = d.state?.reason || 'Operação normal';
        const rebootCount = d.state?.reboot_count ?? 0;

        return `
            <div class="device-detail-inner">
                <div class="device-detail-grid">
                    <div>
                        <div class="detail-section-title">Hardware & Sistema</div>
                        <div class="detail-kv-list">
                            <div class="detail-kv"><span class="detail-kv-key">Modelo</span><span class="detail-kv-val">${UI.escapeHtml(d.model || 'Android TV Box')}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Android OS</span><span class="detail-kv-val">${UI.escapeHtml(d.android_version || 'Android (ADB)')}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Endereço MAC</span><span class="detail-kv-val mono">${UI.escapeHtml(d.mac || '—')}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Uptime</span><span class="detail-kv-val">${uptime}</span></div>
                        </div>
                    </div>

                    <div>
                        <div class="detail-section-title">Rede & Conexão</div>
                        <div class="detail-kv-list">
                            <div class="detail-kv"><span class="detail-kv-key">Endereço IP</span><span class="detail-kv-val mono">${UI.escapeHtml(d.ip || '—')}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Porta ADB</span><span class="detail-kv-val mono">${d.adb_port || 5555}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Último Contato</span><span class="detail-kv-val">${heartbeatStr}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Rede</span><span class="detail-kv-val">${UI.escapeHtml(d.connection_type || 'Ethernet / Wi-Fi')}</span></div>
                        </div>
                    </div>

                    <div>
                        <div class="detail-section-title">Watchdog & Diagnóstico</div>
                        <div class="detail-kv-list">
                            <div class="detail-kv"><span class="detail-kv-key">Reboots Hoje</span><span class="detail-kv-val">${rebootCount}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Recuperação</span><span class="detail-kv-val">${d.recovery_enabled !== false ? 'Habilitada' : 'Desabilitada'}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Diagnóstico</span><span class="detail-kv-val text-muted" title="${UI.escAttr(reason)}">${UI.escapeHtml(reason)}</span></div>
                            <div class="detail-kv"><span class="detail-kv-key">Aplicação</span><span class="detail-kv-val">${d.mode === 'web' ? 'Kiosk Web' : 'Stream RTSP'}</span></div>
                        </div>
                    </div>
                </div>

                <div class="detail-actions-row">
                    <button type="button" class="btn btn-sm btn-primary" onclick="DEVICES.openScrcpy('${UI.escAttr(d.id)}')">${UI.icon('monitor', 14)} Abrir Scrcpy</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="DEVICES.openScrcpyHost('${UI.escAttr(d.id)}')">${UI.icon('monitor', 14)} Abrir no Servidor</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="DEVICES.captureScreenshot('${UI.escAttr(d.id)}')">${UI.icon('camera', 14)} Capturar Screenshot</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="DEVICES.reloadKiosk('${UI.escAttr(d.id)}')">${UI.icon('refresh', 14)} Recarregar Kiosk</button>
                    <button type="button" class="btn btn-sm btn-warning" onclick="DEVICES.rebootDevice('${UI.escAttr(d.id)}')">${UI.icon('reboot', 14)} Reiniciar TV Box</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="DEVICES.renameDialog('${UI.escAttr(d.id)}', '${UI.escAttr(d.name)}')">${UI.icon('edit', 14)} Renomear</button>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="DEVICES.groupDialog('${UI.escAttr(d.id)}', '${UI.escAttr(d.group)}')">${UI.icon('users', 14)} Mover Grupo</button>
                    <button type="button" class="btn btn-sm btn-danger" onclick="DEVICES.remove('${UI.escAttr(d.id)}')">${UI.icon('trash', 14)} Excluir</button>
                </div>
            </div>
        `;
    }

    function bindTableEvents(wrap) {
        const table = wrap.querySelector('#devices-table');
        if (!table) return;

        // Seleção de linhas (master e individuais)
        table.addEventListener('change', (e) => {
            if (e.target.matches('.data-table-select-all')) {
                const checked = e.target.checked;
                const rows = table.querySelectorAll('tbody input.data-table-select-row');
                rows.forEach(cb => {
                    cb.checked = checked;
                    const id = cb.value || cb.dataset.id;
                    if (id) {
                        if (checked) selectedIds.add(id);
                        else selectedIds.delete(id);
                    }
                });
                updateBulkBar();
            } else if (e.target.matches('.data-table-select-row')) {
                const id = e.target.value || e.target.dataset.id;
                if (id) {
                    if (e.target.checked) selectedIds.add(id);
                    else selectedIds.delete(id);
                }
                updateBulkBar();
            }
        });

        // Clique na linha expande o detalhe
        table.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, textarea, label, .dropdown-menu, .col-actions, .col-select, .device-thumb')) {
                return;
            }
            const tr = e.target.closest('tr.data-row');
            if (tr && tr.dataset.id) {
                UI.toggleRowDetail(tr.dataset.id);
            }
        });
    }

    function syncSelectedCheckboxes() {
        const table = document.getElementById('devices-table');
        if (!table) return;
        const checkboxes = table.querySelectorAll('tbody input.data-table-select-row');
        let allChecked = checkboxes.length > 0;
        checkboxes.forEach(cb => {
            const id = cb.value || cb.dataset.id;
            const checked = selectedIds.has(id);
            cb.checked = checked;
            if (!checked) allChecked = false;
        });
        const master = table.querySelector('.data-table-select-all');
        if (master) master.checked = allChecked;
    }

    function updateBulkBar() {
        const bulkBar = document.getElementById('devices-bulk-bar');
        const countSpan = document.getElementById('bulk-selected-count');
        if (!bulkBar) return;

        const count = selectedIds.size;
        if (count > 0) {
            bulkBar.classList.add('on');
            if (countSpan) countSpan.textContent = count;
        } else {
            bulkBar.classList.remove('on');
            if (countSpan) countSpan.textContent = '0';
        }
    }

    function clearSelection() {
        selectedIds.clear();
        syncSelectedCheckboxes();
        updateBulkBar();
    }

    // ── Miniaturas e DOM.crossFadeImage ──
    async function refreshScreenshots() {
        const wrap = document.getElementById('devices-table-wrap');
        if (!wrap) return;

        const imgs = wrap.querySelectorAll('img[data-thumb-id]');
        const now = Date.now();

        imgs.forEach(async (img) => {
            const id = img.dataset.thumbId;
            if (!id) return;
            const dev = devicesCache.find(d => d.id === id);
            const status = (dev?.state?.status || 'unknown').toLowerCase();
            if (status === 'offline') return;

            try {
                const blobUrl = await API.fetchBlobUrl(`/devices/${encodeURIComponent(id)}/screenshot?_t=${now}`);
                const oldUrl = blobUrls.get(id);
                if (oldUrl) URL.revokeObjectURL(oldUrl);
                blobUrls.set(id, blobUrl);

                if (typeof DOM !== 'undefined' && typeof DOM.crossFadeImage === 'function') {
                    DOM.crossFadeImage(img, blobUrl);
                } else {
                    img.src = blobUrl;
                }
                img.style.display = 'block';
                if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
            } catch (e) {
                // Silencioso se sem screenshot
            }
        });
    }

    // ── Ações Operacionais ──
    function toggleRowMenu(event, deviceId) {
        event.stopPropagation();
        const menu = document.getElementById(`row-menu-${deviceId}`);
        if (!menu) return;
        const isOpen = menu.classList.contains('open');
        document.querySelectorAll('.devices-page .dropdown-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) menu.classList.add('open');
    }

    function openScrcpy(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        if (dev) {
            UI.launchScrcpy(dev);
        } else {
            UI.launchScrcpy({ id: deviceId, ip: deviceId });
        }
    }

    function openScrcpyHost(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        UI.launchScrcpyHost(deviceId, dev?.name || deviceId);
    }

    async function captureScreenshot(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        const name = dev?.name || deviceId;
        UI.createToast(`Capturando tela de ${name}...`, 'info', 2000);
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/screenshot`);
            if (res.success) {
                UI.createToast(`📸 Screenshot capturado em ${name}!`, 'success');
                refreshScreenshots();
            } else {
                UI.createToast(res.error || 'Falha ao capturar screenshot', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao capturar screenshot', 'error');
        }
    }

    async function reloadKiosk(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        const name = dev?.name || deviceId;
        UI.createToast(`Recarregando Kiosk em ${name}...`, 'info', 2000);
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/start-stream`);
            if (res.success) {
                UI.createToast(`🔄 Kiosk recarregado em ${name}!`, 'success');
                setTimeout(loadDevicesSilent, 1500);
            } else {
                UI.createToast(res.error || res.output || 'Falha ao recarregar Kiosk', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao recarregar Kiosk', 'error');
        }
    }

    function rebootDevice(deviceId) {
        const dev = devicesCache.find(d => d.id === deviceId);
        const name = dev?.name || deviceId;
        UI.showModal(
            `Reiniciar ${name}`,
            `<p>Deseja enviar comando de reinicialização para <strong>${UI.escapeHtml(name)}</strong>?</p><p class="text-muted text-sm">O TV Box levará cerca de 60 segundos para reiniciar.</p>`,
            async () => {
                UI.createToast(`Enviando reboot para ${name}...`, 'info', 2000);
                try {
                    const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/reboot`);
                    if (res.success) {
                        UI.createToast(`⏻ Reboot enviado com sucesso para ${name}!`, 'success');
                        setTimeout(loadDevicesSilent, 3000);
                    } else {
                        UI.createToast(res.error || 'Falha ao enviar reboot', 'error');
                    }
                } catch (e) {
                    UI.createToast(e.message || 'Erro ao reiniciar dispositivo', 'error');
                }
            }
        );
    }

    // ── Ações em Lote (Bulk) ──
    async function bulkReloadKiosk() {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        UI.createToast(`Recarregando Kiosk em ${ids.length} TV Boxe(s)...`, 'info');
        let successCount = 0;

        for (const id of ids) {
            try {
                const res = await API.post(`/devices/${encodeURIComponent(id)}/start-stream`);
                if (res.success) successCount++;
            } catch (e) {}
        }

        UI.createToast(`Kiosk recarregado em ${successCount}/${ids.length} dispositivo(s).`, successCount > 0 ? 'success' : 'error');
        setTimeout(loadDevicesSilent, 1500);
    }

    function bulkReboot() {
        const ids = Array.from(selectedIds);
        if (ids.length === 0) return;

        UI.showModal(
            `Reiniciar ${ids.length} TV Boxes`,
            `<p>Tem certeza de que deseja reiniciar <strong>${ids.length} TV Box(es) selecionados</strong>?</p>`,
            async () => {
                UI.createToast(`Enviando reboot para ${ids.length} TV Boxe(s)...`, 'info');
                let successCount = 0;
                for (const id of ids) {
                    try {
                        const res = await API.post(`/devices/${encodeURIComponent(id)}/reboot`);
                        if (res.success) successCount++;
                    } catch (e) {}
                }
                UI.createToast(`Reboot enviado para ${successCount}/${ids.length} dispositivo(s).`, successCount > 0 ? 'success' : 'error');
                clearSelection();
                setTimeout(loadDevicesSilent, 3000);
            }
        );
    }

    // ── Diálogos de CRUD ──
    function showAddDialog() {
        UI.showModal(
            'Novo TV Box',
            `
                <div class="form-group"><label class="form-label">Nome *</label><input type="text" id="d-name" class="form-input" placeholder="Ex: TV Box Recepção"></div>
                <div class="form-group"><label class="form-label">IP *</label><input type="text" id="d-ip" class="form-input" placeholder="Ex: 192.168.1.100"></div>
                <div class="form-group"><label class="form-label">Porta ADB</label><input type="text" id="d-port" class="form-input" value="5555"></div>
                <div class="form-group"><label class="form-label">App / Navegador Kiosk</label>
                    <select id="d-browser" class="form-input">
                        <option value="freekiosk">Free Kiosk Browser (Recomendado)</option>
                        <option value="chrome">Google Chrome</option>
                        <option value="browser">Browser Padrão</option>
                    </select>
                </div>
                <div class="form-group"><label class="form-label">URL da Aplicação</label><input type="url" id="d-url" class="form-input" placeholder="https://painel.empresa.com"></div>
                <div class="form-group"><label class="form-label">Localização</label><input type="text" id="d-loc" class="form-input" placeholder="Ex: Bloco A - Entrada"></div>
                <div class="form-group"><label class="form-label">Descrição</label><input type="text" id="d-desc" class="form-input" placeholder="Painel de Atendimento"></div>
            `,
            async () => {
                const name = (document.getElementById('d-name')?.value || '').trim();
                const ip = (document.getElementById('d-ip')?.value || '').trim();
                if (!name || !ip) { UI.createToast('Nome e IP são obrigatórios', 'error'); return; }

                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                const data = {
                    id: slug,
                    name,
                    ip,
                    adb_port: parseInt(document.getElementById('d-port')?.value || '5555', 10),
                    location: (document.getElementById('d-loc')?.value || '').trim(),
                    description: (document.getElementById('d-desc')?.value || '').trim(),
                    mode: 'web',
                    web_browser: document.getElementById('d-browser')?.value || 'freekiosk',
                    target_url: (document.getElementById('d-url')?.value || '').trim(),
                    player: 'vlc',
                    rtsp_path: slug.toUpperCase(),
                };
                try {
                    await API.post('/devices', data);
                    UI.createToast(`"${name}" adicionado com sucesso`, 'success');
                    await loadDevices();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    function renameDialog(deviceId, currentName) {
        UI.showModal(
            `Renomear ${currentName}`,
            `<div class="form-group"><label class="form-label">Novo nome</label><input type="text" id="ren-name" class="form-input" value="${UI.escapeHtml(currentName)}"></div>`,
            async () => {
                const newName = (document.getElementById('ren-name')?.value || '').trim();
                if (!newName) { UI.createToast('Nome é obrigatório', 'error'); return; }
                try {
                    await API.put(`/devices/${encodeURIComponent(deviceId)}`, { name: newName });
                    UI.createToast(`Renomeado para "${newName}"`, 'success');
                    await loadDevices();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function groupDialog(deviceId, currentGroup) {
        const groupsRes = await API.get('/groups').catch(() => []);
        const groups = Array.isArray(groupsRes) ? groupsRes : [];
        const options = groups.map(g => `<option value="${UI.escapeHtml(g.id)}" ${g.id === currentGroup ? 'selected' : ''}>${UI.escapeHtml(g.name || g.id)}</option>`).join('');
        UI.showModal(
            'Mover para Grupo',
            `
                <div class="form-group"><label class="form-label">Grupo</label>
                <select id="grp-select" class="form-input">
                    <option value="" ${!currentGroup ? 'selected' : ''}>Nenhum</option>
                    ${options}
                </select></div>
            `,
            async () => {
                const groupId = document.getElementById('grp-select')?.value || '';
                try {
                    await API.put(`/devices/${encodeURIComponent(deviceId)}`, { group: groupId });
                    UI.createToast('Grupo atualizado', 'success');
                    await loadDevices();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function remove(deviceId) {
        UI.showModal(
            `Remover ${deviceId}`,
            `<p>Tem certeza de que deseja remover este TV Box? Esta ação é irreversível.</p>`,
            async () => {
                try {
                    await API.del(`/devices/${encodeURIComponent(deviceId)}`);
                    selectedIds.delete(deviceId);
                    UI.createToast('Dispositivo removido', 'success');
                    await loadDevices();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function provisionAll() {
        const btn = document.getElementById('provision-all-btn');
        if (!btn) return;
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `${UI.icon('refresh', 14)} Replicando...`;
        UI.createToast('Replicando scripts para todos os TV Boxes...', 'info');
        try {
            const res = await API.post('/devices/provision-all');
            const total = res?.total ?? 0;
            const ok = res?.ok ?? 0;
            const failed = Object.entries(res?.results || {})
                .filter(([, r]) => !r?.success)
                .map(([id]) => id);
            if (ok === total && total > 0) {
                UI.createToast(`Scripts replicados em ${ok} TV Boxe(s).`, 'success');
            } else if (ok > 0) {
                UI.createToast(`Replicado em ${ok}/${total} (falhou: ${failed.join(', ') || '—'})`, 'warning', 6000);
            } else {
                UI.createToast('Falha ao replicar scripts — verifique o log.', 'error', 6000);
            }
            loadDevicesSilent();
        } catch (e) {
            UI.createToast('Erro ao replicar scripts.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }

    function destroy() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (screenshotTimer) { clearInterval(screenshotTimer); screenshotTimer = null; }
        if (boundDocClickHandler) {
            document.removeEventListener('click', boundDocClickHandler);
            boundDocClickHandler = null;
        }
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
        blobUrls.clear();
        selectedIds.clear();
    }

    return {
        render,
        destroy,
        showAddDialog,
        renameDialog,
        groupDialog,
        remove,
        provisionAll,
        openScrcpy,
        openScrcpyHost,
        reloadKiosk,
        rebootDevice,
        captureScreenshot,
        toggleRowMenu,
        bulkReloadKiosk,
        bulkReboot,
        clearSelection
    };
})();
