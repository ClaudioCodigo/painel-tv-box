/**
 * Devices Page — gerenciamento de dispositivos:
 *   renomear, adicionar, excluir, mover para grupo.
 *   (comandos de stream ficam no Dashboard)
 */
const DEVICES = (() => {
    let refreshTimer = null;

    async function render(el) {
        UI.setPageTitle('Dispositivos');

        el.innerHTML = `
            <div class="devices-page">
                <div class="section-title">
                    📺 Gerenciar Dispositivos
                    <button class="btn btn-primary btn-sm" onclick="DEVICES.showAddDialog()">+ Novo TV Box</button>
                </div>
                <div id="devices-grid" class="card-grid">
                    <div class="loading">Carregando...</div>
                </div>
            </div>
        `;
        await loadDevices();
        refreshTimer = setInterval(loadDevices, 15000);
    }

    async function loadDevices() {
        const grid = document.getElementById('devices-grid');
        if (!grid) { clearInterval(refreshTimer); return; }

        try {
            const devices = await API.get('/devices');
            if (!devices || devices.length === 0) {
                grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div><div class="empty-title">Nenhum dispositivo</div><div class="empty-desc">Clique em "+ Novo TV Box" para começar.</div></div>`;
                return;
            }

            const groupsRes = await API.get('/groups').catch(() => []);
            const allGroups = Array.isArray(groupsRes) ? groupsRes : [];

            let html = '';
            for (const d of devices) {
                const status = d.state?.status || 'unknown';
                const sIcon = UI.statusIcon(status); const sClass = UI.statusClass(status);
                const ip = d.ip || '—';
                const group = d.group || '—';
                const player = d.player || 'vlc';
                const loc = d.location || '';

                html += `
                    <div class="card device-card">
                        <div class="card-header">
                            <div class="card-title">${sIcon} ${d.name || d.id}</div>
                            <div class="badge ${sClass}">${status}</div>
                        </div>
                        <div class="card-info">
                            <div class="card-info-item"><span class="card-info-key">IP</span><span class="card-info-val">${ip}</span></div>
                            <div class="card-info-item"><span class="card-info-key">Player</span><span class="card-info-val">${player}</span></div>
                            <div class="card-info-item"><span class="card-info-key">Grupo</span><span class="card-info-val">${group}</span></div>
                            ${loc ? `<div class="card-info-item"><span class="card-info-key">Local</span><span class="card-info-val">${loc}</span></div>` : ''}
                        </div>
                        <div class="card-actions">
                            <button class="btn btn-sm btn-secondary" onclick="DEVICES.renameDialog('${d.id}','${(d.name||'')}')">✏️ Renomear</button>
                            <button class="btn btn-sm btn-secondary" onclick="DEVICES.groupDialog('${d.id}','${group}')">📁 Grupo</button>
                            <button class="btn btn-sm btn-danger" onclick="DEVICES.remove('${d.id}')">🗑️</button>
                        </div>
                    </div>
                `;
            }
            grid.innerHTML = html;
        } catch (e) {
            grid.innerHTML = `<div class="error-state">Erro: ${e.message}</div>`;
        }
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
                    UI.createToast(`✅ "${name}" adicionado`, 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
            }
        );
    }

    function renameDialog(deviceId, currentName) {
        UI.showModal(
            `Renomear ${currentName}`,
            `<div class="form-group"><label class="form-label">Novo nome</label><input type="text" id="ren-name" class="form-input" value="${currentName}"></div>`,
            async () => {
                const newName = (document.getElementById('ren-name')?.value || '').trim();
                if (!newName) { UI.createToast('Nome é obrigatório', 'error'); return; }
                try {
                    await API.put(`/devices/${deviceId}`, { name: newName });
                    UI.createToast(`✅ Renomeado para "${newName}"`, 'success');
                    await loadDevices();
                } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
            }
        );
    }

    async function groupDialog(deviceId, currentGroup) {
        const groupsRes = await API.get('/groups').catch(() => []);
        const groups = Array.isArray(groupsRes) ? groupsRes : [];
        const options = groups.map(g => `<option value="${g.id}" ${g.id === currentGroup ? 'selected' : ''}>${g.name || g.id}</option>`).join('');
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
                    UI.createToast(`✅ Grupo atualizado`, 'success');
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

    return { render, showAddDialog, renameDialog, groupDialog, remove };
})();
