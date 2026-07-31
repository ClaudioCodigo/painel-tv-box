/**
 * Devices Page — gerenciamento de dispositivos (padrão V2):
 *   status bar com reason, frescura, toolbar (busca/filtro/sort), WS ao vivo.
 *   Clique no card abre a página de detalhe do device.
 */
const DEVICES = (() => {
    let refreshTimer = null;

    // ── Estado da coleção ──
    let devicesCache = [];
    let groupNames = {};            // id -> name
    const filters = { q: '', group: '', sort: 'name' };

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function freshness(device) {
        const seen = latestSeen(device);
        return seen ? `visto há ${UI.timeAgo(seen)}` : 'nunca visto';
    }

    async function render(el) {
        UI.setPageTitle('Dispositivos');

        el.innerHTML = `
            <div class="devices-page">
                <div class="section-title">
                    ${UI.icon('tv')} Gerenciar Dispositivos
                    <button class="btn btn-primary btn-sm" onclick="DEVICES.showAddDialog()">${UI.icon('plus')} Novo TV Box</button>
                </div>
                <div class="dcard-toolbar" id="devices-toolbar">
                    <div class="dcard-toolbar-counters" id="devices-counters"></div>
                    <div class="dcard-toolbar-controls">
                        <input type="text" class="form-input" id="devices-search" placeholder="Buscar nome ou IP..." aria-label="Buscar dispositivo">
                        <select class="form-input" id="devices-group" aria-label="Filtrar por grupo"><option value="">Todos os grupos</option></select>
                        <select class="form-input" id="devices-sort" aria-label="Ordenar">
                            <option value="name">Nome</option>
                            <option value="ip">IP</option>
                            <option value="status">Status</option>
                        </select>
                    </div>
                </div>
                <div id="devices-grid" class="card-grid">
                    ${UI.skeletons('card', 3)}
                </div>
            </div>
        `;

        bindToolbar();
        await loadDevices();
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(loadDevices, 15000);
    }

    // Listener único (não acumula)
    WS.on('health', (data) => {
        if (!data.device_id) return;
        const el = document.getElementById(`dstatus-${data.device_id}`);
        if (el) {
            el.className = `dcard-status ${UI.statusClass(data.status)}`;
            el.innerHTML = UI.statusBar(data.status, data.reason);
        }
        const fresh = el && el.closest('.device-card')?.querySelector('.dcard-fresh');
        if (fresh && data.timestamp) fresh.textContent = `visto há ${UI.timeAgo(data.timestamp)}`;
    });

    async function loadDevices() {
        try {
            const devices = await API.get('/devices');
            devicesCache = Array.isArray(devices) ? devices : [];

            if (Object.keys(groupNames).length === 0) {
                const groups = await API.get('/groups').catch(() => []);
                (Array.isArray(groups) ? groups : []).forEach(g => { groupNames[g.id] = g.name || g.id; });
                populateGroupFilter(Object.keys(groupNames));
            }

            renderDevices();
        } catch (e) {
            const grid = document.getElementById('devices-grid');
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
        const grid = document.getElementById('devices-grid');
        const counters = document.getElementById('devices-counters');
        if (!grid) return;

        if (counters) counters.innerHTML = UI.toolbarCounters(devicesCache);

        if (devicesCache.length === 0) {
            grid.innerHTML = UI.stateView('empty', 'Clique em "Novo TV Box" para começar.', { icon: 'tv', title: 'Nenhum dispositivo' });
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
        const sIcon = UI.statusIcon(status); const sClass = UI.statusClass(status);
        const groupChip = d.group ? UI.groupChip(groupNames[d.group] || d.group, d.group) : '';
        const loc = d.location || '';

        card.innerHTML = `
            <div class="card-header dcard-header">
                <div class="card-title">${sIcon} ${UI.escapeHtml(d.name || d.id)}</div>
                <div class="dcard-header-right">${groupChip}</div>
            </div>
            <div class="dcard-status ${sClass}" id="dstatus-${d.id}">
                ${UI.statusBar(status, reason)}
            </div>
            <div class="card-info dcard-meta">
                <div class="card-info-item"><span class="card-info-key">IP</span><span class="card-info-val">${UI.escapeHtml(d.ip || '--')}</span></div>
                <div class="card-info-item"><span class="card-info-key">Player</span><span class="card-info-val">${UI.escapeHtml(d.player || 'vlc')}</span></div>
                <div class="card-info-item"><span class="card-info-key">Grupo</span><span class="card-info-val">${UI.escapeHtml(groupNames[d.group] || d.group || '--')}</span></div>
                ${loc ? `<div class="card-info-item"><span class="card-info-key">Local</span><span class="card-info-val">${UI.escapeHtml(loc)}</span></div>` : ''}
            </div>
            <div class="dcard-life">
                <span class="dcard-fresh" title="Último health check / heartbeat">${freshness(d)}</span>
            </div>
            <div class="card-actions dcard-actions">
                <button class="btn btn-sm btn-secondary" onclick="DEVICES.renameDialog('${d.id}','${UI.escAttr(d.name)}')">${UI.icon('edit')} Renomear</button>
                <button class="btn btn-sm btn-secondary" onclick="DEVICES.groupDialog('${d.id}','${UI.escAttr(d.group)}')">${UI.icon('users')} Grupo</button>
                <button class="btn btn-sm btn-danger" onclick="DEVICES.remove('${d.id}')">${UI.icon('trash')}</button>
            </div>
        `;

        // Clique no card → página de detalhe do device
        card.addEventListener('click', () => { window.location.hash = `#/device/${encodeURIComponent(d.id)}`; });
        card.querySelectorAll('button, a').forEach(el => el.addEventListener('click', (e) => e.stopPropagation()));

        return card;
    }

    function bindToolbar() {
        const search = document.getElementById('devices-search');
        const group = document.getElementById('devices-group');
        const sort = document.getElementById('devices-sort');
        if (search) search.addEventListener('input', () => { filters.q = search.value; renderDevices(); });
        if (group) group.addEventListener('change', () => { filters.group = group.value; renderDevices(); });
        if (sort) sort.addEventListener('change', () => { filters.sort = sort.value; renderDevices(); });
    }

    function populateGroupFilter(ids) {
        const sel = document.getElementById('devices-group');
        if (!sel) return;
        const opts = ['<option value="">Todos os grupos</option>'].concat(
            ids.sort().map(id => `<option value="${UI.escapeHtml(id)}">${UI.escapeHtml(groupNames[id] || id)}</option>`)
        );
        sel.innerHTML = opts.join('');
    }

    function showAddDialog() {
        UI.showModal(
            'Novo TV Box',
            `
                <div class="form-group"><label class="form-label">Nome *</label><input type="text" id="d-name" class="form-input" placeholder="Ex: TV Box Portaria"></div>
                <div class="form-group"><label class="form-label">IP *</label><input type="text" id="d-ip" class="form-input" placeholder="Ex: 192.168.254.232"></div>
                <div class="form-group"><label class="form-label">Porta ADB</label><input type="text" id="d-port" class="form-input" value="5555"></div>
                <div class="form-group"><label class="form-label">Localização</label><input type="text" id="d-loc" class="form-input" placeholder="Ex: Armazém 1B"></div>
                <div class="form-group"><label class="form-label">Descrição</label><input type="text" id="d-desc" class="form-input" placeholder="Stream câmera frontal"></div>
                <div class="form-group"><label class="form-label">Player</label><select id="d-player" class="form-input"><option value="vlc">VLC</option><option value="mpv">MPV</option></select></div>
                <div class="form-group"><label class="form-label">Path RTSP</label><input type="text" id="d-rtsp" class="form-input" placeholder="Ex: TV_BOX_PORTARIA"></div>
            `,
            async () => {
                const name = (document.getElementById('d-name')?.value || '').trim();
                const ip   = (document.getElementById('d-ip')?.value || '').trim();
                if (!name || !ip) { UI.createToast('Nome e IP são obrigatórios', 'error'); return; }

                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
                const data = {
                    id: slug, name,
                    ip,
                    adb_port: parseInt(document.getElementById('d-port')?.value || '5555'),
                    location: (document.getElementById('d-loc')?.value || '').trim(),
                    description: (document.getElementById('d-desc')?.value || '').trim(),
                    player: document.getElementById('d-player')?.value || 'vlc',
                    rtsp_path: (document.getElementById('d-rtsp')?.value || '').trim() || slug.toUpperCase(),
                };
                try {
                    await API.post('/devices', data);
                    UI.createToast(`"${name}" adicionado`, 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
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
                    await API.put(`/devices/${deviceId}`, { name: newName });
                    UI.createToast(`Renomeado para "${newName}"`, 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
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
                    await API.put(`/devices/${deviceId}`, { group: groupId });
                    UI.createToast('Grupo atualizado', 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
            }
        );
    }

    async function remove(deviceId) {
        UI.showModal(`Remover ${deviceId}`, `<p>Tem certeza? Esta ação é irreversível.</p>`,
            async () => {
                try {
                    await API.del(`/devices/${deviceId}`);
                    UI.createToast('Dispositivo removido', 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
            }
        );
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    return { render, destroy, showAddDialog, renameDialog, groupDialog, remove };
})();
