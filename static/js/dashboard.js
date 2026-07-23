/**
 * Dashboard — comandos rápidos + métricas + status.
 *   Cada card de TV Box tem: Start, Stop, Reboot.
 */
const DASHBOARD = (() => {
    let statusInterval = null;

    async function render(el) {
        UI.setPageTitle('Dashboard');

        el.innerHTML = `
            <div class="section-title">📺 TV Boxes <span class="text-muted text-sm">— comandos rápidos</span></div>
            <div class="card-grid" id="device-grid">
                <div class="loading">Carregando...</div>
            </div>
            <div class="section-title mt-md">📋 Eventos</div>
            <div class="log-list" id="event-list"><div class="text-muted text-sm">Aguardando...</div></div>
        `;

        await loadDevices();
        startAutoRefresh();
        WS.on('health', (data) => updateDeviceCard(data.device_id, data.status));
        WS.on('system_metrics', (data) => updateSystemMetrics(data));
    }

    // ── TV Boxes — cards com comandos ──────────────

    async function loadDevices() {
        const grid = document.getElementById('device-grid');
        if (!grid) return;

        try {
            const devices = await API.get('/devices');
            if (!devices || devices.length === 0) {
                grid.innerHTML = '<div class="empty-state">📺 Nenhum TV Box. Use a aba <a href="#/devices">Dispositivos</a> para adicionar.</div>';
                return;
            }
            grid.innerHTML = '';

            devices.forEach(d => {
                const card = document.createElement('div');
                card.className = 'card device-card'; card.dataset.deviceId = d.id;
                const status = d.state?.status || 'unknown';
                const reason = d.state?.reason || '';
                const icon = UI.statusIcon(status); const sClass = UI.statusClass(status);
                const isOnline = status === 'online';

                card.innerHTML = `
                    <div class="card-header">
                        <div class="card-title">${icon} ${d.name || d.id}</div>
                        <div class="dropdown-wrap">
                            <button class="dropdown-btn" onclick="DASHBOARD.toggleMenu(event,'${d.id}')" title="Ações">⋮</button>
                            <div class="dropdown-menu" id="menu-${d.id}">
                                <button class="dropdown-item" onclick="DASHBOARD.rename('${d.id}','${(d.name||'').replace(/'/g,"\\'")}')">✏️ Renomear</button>
                                <button class="dropdown-item" onclick="DASHBOARD.createGroup('${d.id}')">📁 Criar Grupo</button>
                                <button class="dropdown-item" onclick="DASHBOARD.moveGroup('${d.id}','${(d.group||'')}')">📂 Mover para Grupo</button>
                                <div class="dropdown-divider"></div>
                                <button class="dropdown-item" onclick="DASHBOARD.cmd('${d.id}','start-stream')">▶ Iniciar Stream</button>
                                <button class="dropdown-item" onclick="DASHBOARD.cmd('${d.id}','stop-stream')">⏹ Parar Stream</button>
                                <button class="dropdown-item" onclick="DASHBOARD.renameStream('${d.id}','${(d.rtsp_path||'').replace(/'/g,"\\'")}')">🔗 Alterar Path RTSP</button>
                                <div class="dropdown-divider"></div>
                                <button class="dropdown-item danger" onclick="DASHBOARD.deleteGroup('${d.group||''}')" ${!d.group?'disabled':''}>🗑️ Excluir Grupo '${d.group||''}'</button>
                                <button class="dropdown-item danger" onclick="DASHBOARD.deleteDevice('${d.id}')">🗑️ Excluir TV Box</button>
                            </div>
                        </div>
                    </div>
                    <div class="card-stream-status ${sClass}" id="status-${d.id}">
                        <div class="card-stream-indicator ${isOnline ? 'stream-live' : 'stream-off'}">
                            ${isOnline ? '<span class="live-dot"></span> STREAM ATIVA' : '<span class="sd-offline" style="width:6px;height:6px;display:inline-block;border-radius:50%"></span> SEM STREAM'}
                        </div>
                        ${reason ? `<div class="card-stream-reason">${reason}</div>` : ''}
                    </div>
                    <div class="card-info">
                        <div class="card-info-item"><span class="card-info-key">IP</span><span class="card-info-val">${d.ip || '--'}</span></div>
                        <div class="card-info-item"><span class="card-info-key">Player</span><span class="card-info-val">${d.player || '--'}</span></div>
                        <div class="card-info-item"><span class="card-info-key">Grupo</span><span class="card-info-val">${d.group || '--'}</span></div>
                    </div>
                    <div class="card-id-row" title="Clique para copiar o ID do dispositivo">
                        <span class="card-id-label">ID:</span>
                        <code class="card-id-value" onclick="DASHBOARD.copyDeviceId('${d.id}')">${d.id}</code>
                        <span class="card-id-copied" id="copied-${d.id}" style="display:none">✅ Copiado!</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn btn-sm btn-success cmd-btn" data-action="start-stream" data-device="${d.id}">▶ Start</button>
                        <button class="btn btn-sm btn-secondary cmd-btn" data-action="stop-stream" data-device="${d.id}">⏹ Stop</button>
                        <button class="btn btn-sm btn-warning cmd-btn" data-action="reboot" data-device="${d.id}">🔄 Reboot</button>
                    </div>
                `;

                // Bind dos botões de comando
                card.querySelectorAll('.cmd-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = btn.dataset.action;
                        const device = btn.dataset.device;
                        runCommand(device, action, btn);
                    });
                });

                grid.appendChild(card);
            });
        } catch (e) {
            grid.innerHTML = `<div class="error-state">Erro: ${e.message}</div>`;
        }
    }

    async function runCommand(deviceId, action, btn) {
        if (btn) btn.disabled = true;
        const label = { 'start-stream': '▶', 'stop-stream': '⏹', 'reboot': '🔄' }[action] || action;
        UI.createToast(`${label} ${deviceId}...`, 'info', 2000);

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

    function updateDeviceCard(deviceId, newStatus) {
        const el = document.getElementById(`status-${deviceId}`);
        if (el) {
            el.textContent = newStatus.toUpperCase();
            el.className = `card-status ${UI.statusClass(newStatus)}`;
        }
    }

    function copyDeviceId(deviceId) {
        navigator.clipboard.writeText(deviceId).then(() => {
            const el = document.getElementById(`copied-${deviceId}`);
            if (el) { el.style.display = 'inline'; setTimeout(() => el.style.display = 'none', 1500); }
        }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = deviceId; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            UI.createToast(`📋 ID copiado: ${deviceId}`, 'success', 2000);
        });
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
            const cards = [
                {l:'CPU', v:`${m.cpu_percent ?? '--'} %`, c:'stat-blue', k:'cpu', clr:'#00F2FE'},
                {l:'RAM', v:`${m.ram_percent ?? '--'} %`, c:'stat-green', k:'ram', clr:'#7C4DFF'},
                {l:'Disco', v:`${m.disk_percent ?? '--'} %`, c:'stat-orange', k:'disk', clr:'#00E676'},
                {l:'Uptime', v:m.uptime || '--', c:'', k:null, clr:''},
            ];
            cards.forEach(({l, v, c, k, clr}) => {
                const card = UI.createStatCard(l, v, c);
                // Adiciona sparkline se tiver histórico
                if (k && h && h[k] && h[k].length > 1) {
                    const svg = makeSparkline(h[k], clr, 80, 24);
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

    function makeSparkline(data, color, width, height) {
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
        return `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline">
                <defs>
                    <linearGradient id="g-${color.replace('#','')}" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                <polygon points="0,${height} ${points} ${width},${height}" fill="url(#g-${color.replace('#','')})"/>
                <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
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
        }, 15000);
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
        UI.showModal('Renomear', `<div class="form-group"><label class="form-label">Novo nome</label><input type="text" id="ren-name" class="form-input" value="${currentName}"></div>`,
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
        UI.showModal('Path RTSP', `<div class="form-group"><label class="form-label">Path RTSP</label><input type="text" id="rtsp-path" class="form-input" value="${currentPath}"></div>`,
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
            `<option value="${g.id}" ${g.id === currentGroup ? 'selected' : ''}>${g.name || g.id}</option>`
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

    return { render, copyDeviceId, toggleMenu, rename, renameStream, createGroup, moveGroup, cmd, deleteDevice, deleteGroup };
})();
