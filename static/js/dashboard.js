/**
 * Dashboard — comandos rápidos + métricas + status.
 *   Cada card de TV Box tem: Start, Stop, Reboot.
 */
const DASHBOARD = (() => {
    let statusInterval = null;

    // ── Histórico de recuperações do watchdog (via WS) ──
    // device_id -> { when: timestamp, event: string }
    const recoveryLog = {};

    // ── Estado da coleção (filtros/sort/cache) ──
    let devicesCache = [];
    let groupNames = {};            // id -> name
    let eventsCount = 0;
    const filters = { q: '', group: '', sort: 'name' };

    async function render(el) {
        UI.setPageTitle('Dashboard');

        el.innerHTML = `
            <div class="section-title">
                Sistema
                <span class="section-subtitle">uso do servidor em tempo real</span>
            </div>
            <div class="stat-grid" id="system-grid">
                ${UI.skeletons('card', 4)}
            </div>
            <div class="section-title">
                TV Boxes
                <span class="section-subtitle">filtro e busca</span>
            </div>
            <div class="dcard-toolbar" id="device-toolbar">
                <div class="dcard-toolbar-counters" id="device-counters"></div>
                <div class="dcard-toolbar-controls">
                    <input type="text" class="form-input" id="dcard-search" placeholder="Buscar nome ou IP..." aria-label="Buscar dispositivo">
                    <select class="form-input" id="dcard-group" aria-label="Filtrar por grupo"><option value="">Todos os grupos</option></select>
                    <select class="form-input" id="dcard-sort" aria-label="Ordenar">
                        <option value="name">Nome</option>
                        <option value="ip">IP</option>
                        <option value="status">Status</option>
                    </select>
                </div>
            </div>
            <div class="card-grid" id="device-grid">
                ${UI.skeletons('card', 3)}
            </div>
            <div class="section-title mt-md">Eventos
                <span class="section-subtitle" id="event-count"></span>
                <span style="flex:1"></span>
                <button class="btn btn-ghost btn-sm" onclick="DASHBOARD.downloadLog()">${UI.icon('download')} Baixar log</button>
                <button class="btn btn-ghost btn-sm" onclick="DASHBOARD.viewLog()">${UI.icon('file-text')} Ver logs</button>
                <button class="btn btn-ghost btn-sm" onclick="DASHBOARD.clearEvents()">Limpar</button>
            </div>
            <div class="dcard-events" id="event-list" aria-live="polite">
                <div class="text-muted text-sm">Sem eventos recentes.</div>
            </div>
        `;

        bindToolbar();
        await loadSystemMetrics();
        await loadDevices();
        startAutoRefresh();
    }

    // Listeners registrados UMA vez (não acumulam entre renders)
    WS.on('health', (data) => {
        updateDeviceCard(data.device_id, data.status, data.reason, data.timestamp);
        if (data.device_id && data.status) {
            addEvent({
                kind: 'event',
                deviceId: data.device_id,
                message: `${data.status.toUpperCase()}${data.reason ? ' · ' + data.reason : ''}`,
                ts: Date.parse(data.timestamp) || Date.now(),
                shape: data.status,
            });
        }
    });
    WS.on('system_metrics', (data) => updateSystemMetrics(data));
    WS.on('recovery', (data) => {
        if (!data.device_id) return;
        recoveryLog[data.device_id] = { when: Date.now(), event: data.event || 'recuperação' };
        const el = document.querySelector(`[data-watchdog="${CSS.escape(data.device_id)}"]`);
        if (el) el.textContent = watchdogInfo(data.device_id);
        addEvent({ kind: 'recovery', deviceId: data.device_id, message: `recuperação: ${data.event || 'executada'}`, ts: Date.parse(data.timestamp) || Date.now() });
    });
    WS.on('alert', (data) => {
        if (!data.device_id) return;
        recoveryLog[data.device_id] = { when: Date.now(), event: 'alerta crítico' };
        const el = document.querySelector(`[data-watchdog="${CSS.escape(data.device_id)}"]`);
        if (el) el.textContent = watchdogInfo(data.device_id);
        addEvent({ kind: 'alert', deviceId: data.device_id, message: data.message || 'alerta crítico', ts: Date.parse(data.timestamp) || Date.now() });
    });

    // ── TV Boxes — cards com comandos ──────────────

    async function loadDevices() {
        try {
            const devices = await API.get('/devices');
            devicesCache = Array.isArray(devices) ? devices : [];

            // Nomes de grupos (uma vez por visita)
            if (Object.keys(groupNames).length === 0) {
                const groups = await API.get('/groups').catch(() => []);
                (Array.isArray(groups) ? groups : []).forEach(g => { groupNames[g.id] = g.name || g.id; });
                populateGroupFilter(Object.keys(groupNames));
            }

            renderDevices();
        } catch (e) {
            const grid = document.getElementById('device-grid');
            if (grid) grid.innerHTML = UI.stateView('error', e.message, { retry: true });
            UI.bindStateRetry(grid, loadDevices);
        }
    }

    function applyFilters() {
        const q = filters.q.trim().toLowerCase();
        let list = devicesCache.filter(d => {
            if (filters.group && d.group !== filters.group) return false;
            if (q) {
                const hay = `${d.name || ''} ${d.ip || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        const sort = filters.sort;
        list.sort((a, b) => {
            if (sort === 'ip') return (a.ip || '').localeCompare(b.ip || '');
            if (sort === 'status') return (a.state?.status || '').localeCompare(b.state?.status || '');
            return (a.name || a.id).localeCompare(b.name || b.id);
        });
        return list;
    }

    function renderDevices() {
        const grid = document.getElementById('device-grid');
        const counters = document.getElementById('device-counters');
        if (!grid) return;

        if (counters) counters.innerHTML = UI.toolbarCounters(devicesCache);

        if (devicesCache.length === 0) {
            grid.innerHTML = UI.stateView('empty', 'Use a aba Dispositivos para adicionar.', { icon: 'tv', title: 'Nenhum dispositivo' });
            return;
        }
        const list = applyFilters();
        if (list.length === 0) {
            grid.innerHTML = UI.stateView('empty', 'Nenhum dispositivo corresponde ao filtro.', { icon: 'search', title: 'Sem resultados' });
            return;
        }

        grid.innerHTML = '';
        list.forEach(d => grid.appendChild(buildCard(d)));
    }

    function buildCard(d) {
        const card = document.createElement('div');
        card.className = 'card device-card'; card.dataset.deviceId = d.id;
        const status = d.state?.status || 'unknown';
        const reason = d.state?.reason || '';
        const icon = UI.statusIcon(status); const sClass = UI.statusClass(status);
        const groupChip = d.group ? UI.groupChip(groupNames[d.group] || d.group, d.group) : '';

        card.innerHTML = `
            <div class="card-header dcard-header">
                <div class="card-title">${icon} <a href="#/device/${encodeURIComponent(d.id)}" class="dcard-title-link">${UI.escapeHtml(d.name || d.id)}</a></div>
                <div class="dcard-header-right">
                    ${groupChip}
                    <div class="dropdown-wrap">
                        <button class="dropdown-btn" onclick="DASHBOARD.toggleMenu(event,'${d.id}')" title="Ações" aria-label="Ações">${UI.icon('chevron-down')}</button>
                        <div class="dropdown-menu" id="menu-${d.id}">
                            <button class="dropdown-item" onclick="DASHBOARD.cmd('${d.id}','reboot')">${UI.icon('reboot')} Reboot</button>
                            <div class="dropdown-divider"></div>
                            <button class="dropdown-item" onclick="DASHBOARD.rename('${d.id}','${UI.escAttr(d.name)}')">${UI.icon('edit')} Renomear</button>
                            <button class="dropdown-item" onclick="DASHBOARD.renameStream('${d.id}','${UI.escAttr(d.rtsp_path)}')">${UI.icon('file-text')} Alterar Path RTSP</button>
                            <button class="dropdown-item" onclick="DASHBOARD.createGroup('${d.id}')">${UI.icon('plus')} Criar Grupo</button>
                            <button class="dropdown-item" onclick="DASHBOARD.moveGroup('${d.id}','${UI.escAttr(d.group)}')">${UI.icon('users')} Mover para Grupo</button>
                            <div class="dropdown-divider"></div>
                            <button class="dropdown-item danger" onclick="DASHBOARD.deleteDevice('${d.id}')">${UI.icon('trash')} Excluir TV Box</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="dcard-status ${sClass}" id="status-${d.id}">
                ${renderStatusBar(status, reason)}
            </div>
            <div class="card-info dcard-meta">
                <div class="card-info-item"><span class="card-info-key">IP</span><span class="card-info-val">${UI.escapeHtml(d.ip || '--')}</span></div>
                <div class="card-info-item"><span class="card-info-key">Player</span><span class="card-info-val">${UI.escapeHtml(d.player || 'vlc')}</span></div>
                <div class="card-info-item"><span class="card-info-key">Grupo</span><span class="card-info-val">${UI.escapeHtml(groupNames[d.group] || d.group || '--')}</span></div>
            </div>
            <div class="dcard-life">
                <span class="dcard-fresh" title="Último health check / heartbeat">${freshness(d)}</span>
                <span class="dcard-watchdog" data-watchdog="${d.id}">${watchdogInfo(d.id, d)}</span>
            </div>
            <div class="card-actions dcard-actions">
                <button class="btn btn-sm btn-success cmd-btn" data-action="start-stream" data-device="${d.id}">${UI.icon('play')} Start</button>
                <button class="btn btn-sm btn-secondary cmd-btn" data-action="stop-stream" data-device="${d.id}">${UI.icon('stop')} Stop</button>
            </div>
        `;

        card.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                runCommand(btn.dataset.device, btn.dataset.action, btn);
            });
        });

        return card;
    }

    function bindToolbar() {
        const search = document.getElementById('dcard-search');
        const group = document.getElementById('dcard-group');
        const sort = document.getElementById('dcard-sort');
        if (search) search.addEventListener('input', () => { filters.q = search.value; renderDevices(); });
        if (group) group.addEventListener('change', () => { filters.group = group.value; renderDevices(); });
        if (sort) sort.addEventListener('change', () => { filters.sort = sort.value; renderDevices(); });
    }

    function populateGroupFilter(ids) {
        const sel = document.getElementById('dcard-group');
        if (!sel) return;
        const opts = ['<option value="">Todos os grupos</option>'].concat(
            ids.sort().map(id => `<option value="${UI.escapeHtml(id)}">${UI.escapeHtml(groupNames[id] || id)}</option>`)
        );
        sel.innerHTML = opts.join('');
    }

    async function runCommand(deviceId, action, btn) {
        if (btn) btn.disabled = true;
        const label = { 'start-stream': 'play', 'stop-stream': 'stop', 'reboot': 'reboot' }[action] || 'help';
        UI.createToast(`${deviceId}...`, 'info', 2000);

        try {
            const confirmActions = ['reboot'];
            if (confirmActions.includes(action)) {
                if (!confirm(`Tem certeza que deseja ${action} em ${deviceId}?`)) {
                    if (btn) btn.disabled = false;
                    return;
                }
            }
            const res = await API.post(`/devices/${deviceId}/${action}`);
            UI.createToast(`${res.success ? '✅' : '❌'} ${deviceId}: ${res.output || res.error || action}`, res.success ? 'success' : 'error');
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
        // Recarrega status após breve delay
        setTimeout(loadDevices, 2000);
    }

    function renderStatusBar(status, reason = '') {
        const cfg = {
            online:   { label: 'ONLINE',        shape: 'online' },
            degraded: { label: 'DEGRADADO',     shape: 'degraded' },
            warning:  { label: 'ATENÇÃO',       shape: 'warning' },
            offline:  { label: 'OFFLINE',       shape: 'offline' },
            unknown:  { label: 'DESCONHECIDO',  shape: 'unknown' },
        }[status] || { label: (status || 'unknown').toUpperCase(), shape: 'unknown' };

        return `
            <span class="dcard-status-shape ${cfg.shape}" aria-hidden="true"></span>
            <span class="dcard-status-label">${cfg.label}</span>
            ${reason ? `<span class="dcard-status-reason">${UI.escapeHtml(reason)}</span>` : ''}
        `;
    }

    function fmtAgo(sec) {
        if (sec < 60) return `${Math.round(sec)}s`;
        if (sec < 3600) return `${Math.round(sec / 60)}min`;
        if (sec < 86400) return `${Math.round(sec / 3600)}h`;
        return `${Math.round(sec / 86400)}d`;
    }

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function freshness(device) {
        const seen = latestSeen(device);
        if (!seen) return 'nunca visto';
        return `visto há ${UI.timeAgo(seen)}`;
    }

    function watchdogInfo(deviceId, device) {
        const rec = recoveryLog[deviceId];
        if (rec) {
            return `watchdog: ${rec.event} · há ${fmtAgo((Date.now() - rec.when) / 1000)}`;
        }
        if (device && device.state?.last_recovery_time) {
            return `watchdog: recuperação · ${freshness(device.state.last_recovery_time)}`;
        }
        return '';
    }

    function updateDeviceCard(deviceId, newStatus, reason = '', lastSeen) {
        const el = document.getElementById(`status-${deviceId}`);
        if (!el) return;
        el.className = `dcard-status ${UI.statusClass(newStatus)}`;
        el.innerHTML = renderStatusBar(newStatus, reason);
        // Atualiza a frescura junto (o timestamp do evento ≈ last_seen)
        if (lastSeen) {
            const fresh = el.closest('.device-card')?.querySelector('.dcard-fresh');
            if (fresh) fresh.textContent = freshness({ last_seen: lastSeen });
        }
    }

    // ── Feed de eventos (A1) ─────────────────────

    function addEvent({ kind = 'event', deviceId = '', message = '', ts = Date.now(), shape = '' }) {
        const list = document.getElementById('event-list');
        if (!list) return;
        const placeholder = list.querySelector('.text-muted');
        if (placeholder) placeholder.remove();

        const item = document.createElement('div');
        item.className = `dcard-event ${kind === 'alert' ? 'alert' : ''}`;
        const iconHtml = kind === 'alert' ? UI.icon('alert')
            : kind === 'recovery' ? UI.icon('refresh')
            : (shape ? `<span class="dcard-status-shape ${shape}" aria-hidden="true"></span>` : UI.icon('help'));
        item.innerHTML = `${iconHtml} <span>${UI.escapeHtml(deviceId)} — ${UI.escapeHtml(message)}</span> <span class="dcard-event-time">${UI.timeAgo(ts)}</span>`;
        list.prepend(item);
        while (list.children.length > 30) list.lastElementChild.remove();

        eventsCount++;
        const count = document.getElementById('event-count');
        if (count) count.textContent = `${eventsCount} eventos`;
    }

    function clearEvents() {
        const list = document.getElementById('event-list');
        if (list) list.innerHTML = '<div class="text-muted text-sm">Sem eventos recentes.</div>';
        eventsCount = 0;
        const count = document.getElementById('event-count');
        if (count) count.textContent = '';
    }

    function viewLog() {
        window.location.hash = '#/logs';
    }

    function downloadLog() {
        window.open(API.authUrl('/api/logs/download?source=watchdog'), '_blank');
    }

    // ── Métricas do servidor ───────────────────────

    async function loadSystemMetrics() {
        const grid = document.getElementById('system-grid');
        if (!grid) return;

        try {
            const [m, h] = await Promise.all([
                API.get('/system/metrics'),
                API.get('/system/metrics/history?last_n=30').catch(() => null),
            ]);
            grid.innerHTML = '';
            const sparkColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#FAFAFA';
            const cards = [
                {l:'CPU', v:`${m.cpu_percent ?? '--'} %`, c:'stat-blue', k:'cpu', clr:sparkColor},
                {l:'RAM', v:`${m.ram_percent ?? '--'} %`, c:'stat-green', k:'ram', clr:sparkColor},
                {l:'Disco', v:`${m.disk_percent ?? '--'} %`, c:'stat-orange', k:'disk', clr:sparkColor},
                {l:'Uptime', v:m.uptime || '--', c:'', k:null, clr:''},
            ];
            cards.forEach(({l, v, c, k, clr}, idx) => {
                const card = UI.createStatCard(l, v, c);
                // Adiciona sparkline se tiver histórico
                if (k && h && h[k] && h[k].length > 1) {
                    const svg = makeSparkline(h[k], clr, 80, 24, `spark${idx}`);
                    const sparkWrapper = document.createElement('div');
                    sparkWrapper.className = 'sparkline-wrap';
                    sparkWrapper.innerHTML = svg;
                    card.appendChild(sparkWrapper);
                }
                grid.appendChild(card);
            });
        } catch (e) {
            grid.innerHTML = `<div class="error-state">Erro métricas: ${e.message}</div>`;
        }
    }

    function makeSparkline(data, color, width, height, idSuffix = '') {
        if (!data || data.length < 2) return '';
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const pad = 2;
        const w = width - pad * 2;
        const h = height - pad * 2;
        const step = w / (data.length - 1);
        const points = data.map((d, i) => {
            const x = pad + i * step;
            const y = pad + h - ((d - min) / range) * h;
            return `${x},${y}`;
        }).join(' ');
        const gid = `g-${idSuffix || color.replace(/[^a-zA-Z0-9]/g, '')}`;
        return `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
                <defs>
                    <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <polygon points="0,${height} ${points} ${width},${height}" fill="url(#${gid})"/>
                <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
            </svg>`;
    }

    function updateSystemMetrics(data) {
        const grid = document.getElementById('system-grid');
        if (!grid) return;
        if (data.cpu_percent !== undefined || data.ram_percent !== undefined) {
            loadSystemMetrics();
        }
    }

    function startAutoRefresh() {
        if (statusInterval) clearInterval(statusInterval);
        statusInterval = setInterval(() => {
            loadDevices();
            loadSystemMetrics();
        }, 15000);
    }

    function destroy() {
        if (statusInterval) {
            clearInterval(statusInterval);
            statusInterval = null;
        }
    }

    // ── Dropdown ─────────────────────────────────

    function toggleMenu(event, deviceId) {
        event.stopPropagation();
        // Fecha todos
        document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
        // Abre o atual
        const menu = document.getElementById(`menu-${deviceId}`);
        if (menu) menu.classList.toggle('open');
        // Fecha ao clicar fora
        const close = (e) => {
            if (!e.target.closest('.dropdown-wrap')) {
                document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 10);
    }

    function rename(deviceId, currentName) {
        UI.showModal('Renomear', `<div class="form-group"><label class="form-label">Novo nome</label><input type="text" id="ren-name" class="form-input" value="${UI.escapeHtml(currentName)}"></div>`,
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
                // Associa device ao grupo
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
        UI.showModal('Mover para Grupo', `
            <div class="form-group"><label class="form-label">Selecionar grupo</label>
            <select id="g-select" class="form-input"><option value="">Nenhum</option>${opts}</select></div>`,
            async () => {
                const g = document.getElementById('g-select')?.value || '';
                await API.put(`/devices/${deviceId}`, { group: g });
                UI.createToast(`📂 Device movido para "${g || 'Nenhum'}"`, 'success');
                loadDevices();
            }
        );
    }

    async function cmd(deviceId, action) {
        try {
            const res = await API.post(`/devices/${deviceId}/${action}`);
            UI.createToast(res.success ? `✅ ${action} executado` : `❌ ${res.error || 'Falha'}`, res.success ? 'success' : 'error');
            setTimeout(loadDevices, 2000);
        } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
    }

    function deleteDevice(deviceId) {
        UI.showModal(`Excluir ${deviceId}`, `<p>Tem certeza? O dispositivo será removido permanentemente.</p>`, async () => {
            try {
                await API.del(`/devices/${deviceId}`);
                UI.createToast('🗑️ Dispositivo removido', 'success');
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

    return { render, destroy, toggleMenu, rename, renameStream, createGroup, moveGroup, cmd, deleteDevice, deleteGroup, addEvent, clearEvents, viewLog, downloadLog };
})();
