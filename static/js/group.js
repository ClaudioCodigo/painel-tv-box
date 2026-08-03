/**
 * Group Page — detalhe de um grupo: contadores, ações coletivas e devices (V2).
 * Rota #/group/{id} (substitui o placeholder "em breve").
 */
const GROUP_PAGE = (() => {
    let groupId = null;
    let refreshTimer = null;

    async function render(el, id) {
        groupId = id;
        UI.setPageTitle('Grupo');
        el.innerHTML = `<div id="group-detail">${UI.skeletons('line', 4)}</div>`;

        await load();
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(load, 15000);
    }

    async function load() {
        const container = document.getElementById('group-detail');
        if (!container) return;
        try {
            const group = await API.get(`/groups/${groupId}`);
            container.innerHTML = renderGroup(group);
        } catch (e) {
            container.innerHTML = UI.stateView('error', e.message, { retry: true });
            UI.bindStateRetry(container, load);
        }
    }

    function renderGroup(group) {
        const devices = group.devices || [];
        const online = devices.filter(d => d.status === 'online').length;
        const degraded = devices.filter(d => d.status === 'degraded' || d.status === 'warning').length;
        const offline = devices.filter(d => d.status === 'offline').length;
        const hasDevices = devices.length > 0;

        return `
            <div class="groups-page">
                <div class="section-title">
                    ${UI.icon('users')} ${UI.escapeHtml(group.name || group.id)}
                    <span class="section-subtitle">${UI.escapeHtml(group.description || '')}</span>
                </div>
                <div class="dcard-toolbar">
                    <div class="dcard-toolbar-counters">
                        <span class="dcard-counter">${devices.length} total</span>
                        <span class="dcard-counter"><span class="dcard-status-shape online"></span>${online}</span>
                        <span class="dcard-counter"><span class="dcard-status-shape degraded"></span>${degraded}</span>
                        <span class="dcard-counter"><span class="dcard-status-shape offline"></span>${offline}</span>
                    </div>
                    <div class="dcard-toolbar-controls">
                        <button class="btn btn-primary btn-sm" onclick="GROUP_PAGE.action('start-stream')" ${!hasDevices ? 'disabled' : ''}>${UI.icon('play')} Start todos</button>
                        <button class="btn btn-secondary btn-sm" onclick="GROUP_PAGE.action('stop-stream')" ${!hasDevices ? 'disabled' : ''}>${UI.icon('stop')} Stop todos</button>
                        <button class="btn btn-secondary btn-sm" onclick="GROUP_PAGE.action('reboot')" ${!hasDevices ? 'disabled' : ''}>${UI.icon('reboot')} Reboot todos</button>
                    </div>
                </div>
                <div class="card-grid">
                    ${devices.length === 0
                        ? UI.stateView('empty', 'Nenhum device neste grupo.', { icon: 'tv', title: 'Grupo vazio' })
                        : devices.map(deviceCard).join('')}
                </div>
            </div>
        `;
    }

    function deviceCard(d) {
        const status = d.status || 'unknown';
        const icon = UI.statusIcon(status); const sClass = UI.statusClass(status);
        return `
            <a class="card device-card" href="#/device/${encodeURIComponent(d.id)}">
                <div class="card-header dcard-header">
                    <div class="card-title">${icon} ${UI.escapeHtml(d.name || d.id)}</div>
                </div>
                <div class="dcard-status ${sClass}">${UI.statusBar(status)}</div>
                <div class="dcard-life"><span class="dcard-fresh">${UI.escapeHtml(d.ip || '--')}</span></div>
            </a>`;
    }

    async function action(actionName) {
        const label = { 'start-stream': 'Start', 'stop-stream': 'Stop', 'reboot': 'Reboot' }[actionName] || actionName;
        UI.showModal(
            `${label} no grupo`,
            `<p>Executar <strong>${UI.escapeHtml(label)}</strong> em todos os devices deste grupo?</p>`,
            async () => {
                try {
                    const res = await API.post(`/groups/${groupId}/${actionName}`);
                    const ok = res.success_count || 0;
                    UI.createToast(`${label}: ${ok}/${res.total} OK`, ok > 0 ? 'success' : 'warning');
                    load();
                } catch (e) { UI.createToast(`Erro: ${e.message}`, 'error'); }
            }
        );
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    return { render, destroy, action };
})();
