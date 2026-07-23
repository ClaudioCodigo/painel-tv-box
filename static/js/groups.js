/**
 * Groups Page — lista, criar/editar, ações coletivas.
 */
const GROUPS = (() => {
    let currentGroupId = null;

    async function render(el) {
        UI.setPageTitle('Grupos');
        el.innerHTML = `
            <div class="groups-page">
                <div class="section-title">📁 Grupos</div>
                <div class="groups-toolbar">
                    <button class="btn btn-primary btn-sm" onclick="GROUPS.createForm()">+ Novo Grupo</button>
                </div>
                <div id="groups-list" class="groups-list">
                    <div class="loading">Carregando...</div>
                </div>
            </div>
        `;
        await loadGroups();
    }

    async function loadGroups() {
        const el = document.getElementById('groups-list');
        if (!el) return;

        try {
            const res = await API.get('/groups');
            if (!res || res.length === 0) {
                el.innerHTML = '<div class="empty-state">📁 Nenhum grupo criado.</div>';
                return;
            }

            let html = '';
            for (const g of res) {
                const devices = g.devices || [];
                const hasDevices = devices.length > 0;
                const onlineCount = devices.filter(d => d.status === 'online').length;

                html += `
                    <div class="group-card">
                        <div class="group-header">
                            <span class="group-icon">📁</span>
                            <div class="group-info">
                                <div class="group-name">${g.name || g.id}</div>
                                <div class="group-meta">${g.description || ''} — ${g.device_count} dispositivos (${onlineCount} online)</div>
                            </div>
                            <div class="group-actions-list">
                                <button class="btn btn-sm btn-primary" onclick="GROUPS.action('${g.id}', 'start-stream')" ${!hasDevices ? 'disabled' : ''}>▶ Start</button>
                                <button class="btn btn-sm btn-secondary" onclick="GROUPS.action('${g.id}', 'stop-stream')" ${!hasDevices ? 'disabled' : ''}>⏹ Stop</button>
                                <button class="btn btn-sm btn-warning" onclick="GROUPS.action('${g.id}', 'reboot')" ${!hasDevices ? 'disabled' : ''}>🔄 Reboot</button>
                                <button class="btn btn-sm btn-danger" onclick="GROUPS.deleteGroup('${g.id}')">🗑️</button>
                            </div>
                        </div>
                        ${hasDevices ? `
                        <div class="group-devices">
                            ${devices.map(d => `
                                <span class="group-device-tag ${UI.statusClass(d.status)}">
                                    ${UI.statusIcon(d.status)} ${d.name || d.id}
                                </span>
                            `).join('')}
                        </div>` : '<div class="text-muted text-sm" style="padding:8px 14px">Nenhum dispositivo neste grupo</div>'}
                    </div>
                `;
            }

            el.innerHTML = html;
        } catch (e) {
            el.innerHTML = `<div class="error-state">Erro: ${e.message}</div>`;
        }
    }

    function createForm() {
        UI.showModal(
            'Novo Grupo',
            `
                <div class="form-group">
                    <label class="form-label">Nome *</label>
                    <input type="text" id="g-name" class="form-input" placeholder="Ex: Armazéns">
                </div>
                <div class="form-group">
                    <label class="form-label">Descrição</label>
                    <input type="text" id="g-desc" class="form-input" placeholder="Ex: TV Boxes dos armazéns">
                </div>
            `,
            async () => {
                const name = document.getElementById('g-name')?.value;
                if (!name) { UI.createToast('Nome é obrigatório', 'error'); return; }
                try {
                    const res = await API.post('/groups', { name, description: document.getElementById('g-desc')?.value || '' });
                    UI.createToast(`✅ Grupo "${name}" criado`, 'success');
                    await loadGroups();
                } catch (e) {
                    UI.createToast(`❌ ${e.message}`, 'error');
                }
            }
        );
    }

    async function action(groupId, actionName) {
        const btn = document.querySelector(`[onclick*="'${groupId}', '${actionName}'"]`);
        if (btn) btn.disabled = true;
        try {
            const res = await API.post(`/groups/${groupId}/${actionName}`);
            UI.createToast(`${actionName} em ${res.total} dispositivos (${res.success_count} OK)`, res.success_count > 0 ? 'success' : 'warning');
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
        await loadGroups();
    }

    async function deleteGroup(groupId) {
        UI.showModal(
            `Remover ${groupId}`,
            `<p>Tem certeza? Os dispositivos do grupo NÃO serão removidos.</p>`,
            async () => {
                try {
                    await API.del(`/groups/${groupId}`);
                    UI.createToast('Grupo removido', 'success');
                    await loadGroups();
                } catch (e) {
                    UI.createToast(`❌ ${e.message}`, 'error');
                }
            }
        );
    }

    return { render, createForm, action, deleteGroup };
})();
