/**
 * Logs Page — busca, filtros, download, auto-refresh.
 */
const LOGS = (() => {
    let refreshTimer = null;
    let currentQuery = {};
    let inflight = false;
    let autoRefresh = true;

    async function render(el) {
        UI.setPageTitle('Logs');

        el.innerHTML = `
            <div class="logs-page">
                <!-- Filtros -->
                <div class="logs-filters">
                    <div class="logs-filter-row">
                        <div class="form-group">
                            <label>Fonte</label>
                            <select id="log-source">
                                <option value="">Todas</option>
                                <option value="system">Sistema</option>
                                <option value="adb">ADB</option>
                                <option value="mediamtx">MediaMTX</option>
                                <option value="watchdog">Watchdog</option>
                                <option value="user">Usuário</option>
                                <option value="api">API</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Nível</label>
                            <select id="log-level">
                                <option value="">Todos</option>
                                <option value="INFO">INFO</option>
                                <option value="WARNING">WARNING</option>
                                <option value="ERROR">ERROR</option>
                                <option value="DEBUG">DEBUG</option>
                                <option value="CRITICAL">CRITICAL</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Buscar</label>
                            <input type="text" id="log-query" placeholder="Texto na mensagem...">
                        </div>
                        <div class="form-group">
                            <label>Device ID</label>
                            <input type="text" id="log-device" placeholder="tv-box-pier">
                        </div>
                        <div class="form-group">
                            <label>&nbsp;</label>
                            <button class="btn btn-primary btn-sm" onclick="LOGS.search()">${UI.icon('search')} Buscar</button>
                        </div>
                        <div class="form-group">
                            <label>&nbsp;</label>
                            <button class="btn btn-secondary btn-sm" onclick="LOGS.download()">${UI.icon('download')} Download</button>
                        </div>
                        <div class="form-group">
                            <label>&nbsp;</label>
                            <button class="btn btn-ghost btn-sm" id="log-refresh-toggle" onclick="LOGS.toggleAutoRefresh()" title="Pausar/retomar atualização automática">${UI.icon('pause')} Auto</button>
                        </div>
                    </div>
                    <div class="logs-info" id="logs-info"></div>
                </div>

                <!-- Tabela de logs -->
                <div class="logs-table-wrapper">
                    <div class="logs-table" id="logs-table">
                        ${UI.skeletons('row', 6)}
                    </div>
                </div>

                <!-- Paginação -->
                <div class="logs-pagination" id="logs-pagination"></div>
            </div>
        `;

        // Auto-refresh a cada 5s
        startAutoRefresh();

        // Carrega dados iniciais
        await search();
    }

    async function search(page = 1) {
        const el = document.getElementById('logs-table');
        if (!el || inflight) return;
        inflight = true;
        try {
            await doSearch(page);
        } finally {
            inflight = false;
        }
    }

    async function doSearch(page = 1) {
        const el = document.getElementById('logs-table');
        if (!el) return;

        const source = document.getElementById('log-source')?.value || '';
        const level = document.getElementById('log-level')?.value || '';
        const q = document.getElementById('log-query')?.value || '';
        const device = document.getElementById('log-device')?.value || '';

        currentQuery = { source, level, q, device_id: device, page };

        let url = `/logs?page=${page}&per_page=50`;
        if (source) url += `&source=${source}`;
        if (level) url += `&level=${level}`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        if (device) url += `&device_id=${encodeURIComponent(device)}`;

        try {
            const res = await API.get(url);

            // Info
            const info = document.getElementById('logs-info');
            if (info) {
                info.textContent = `${res.total} entradas (pág ${res.page}/${res.pages})`;
            }

            // Tabela
            if (!res.items || res.items.length === 0) {
                el.innerHTML = '<div class="empty-state">Nenhum log encontrado.</div>';
                return;
            }

            let html = '<table class="log-table"><thead><tr>';
            html += '<th>Data/Hora</th><th>Nível</th><th>Fonte</th><th>Dispositivo</th><th>Mensagem</th>';
            html += '</tr></thead><tbody>';

            for (const item of res.items) {
                const levelClass = item.level === 'ERROR' || item.level === 'CRITICAL' ? 'log-error' :
                                   item.level === 'WARNING' ? 'log-warning' : 'log-info';
                html += `<tr class="${levelClass}">
                    <td class="log-ts">${escapeHtml(item.timestamp || '--')}</td>
                    <td><span class="log-badge ${levelClass}">${escapeHtml(item.level || '-')}</span></td>
                    <td>${escapeHtml(item.source || '-')}</td>
                    <td class="log-dev">${escapeHtml(item.device && item.device !== '-' ? item.device : '')}</td>
                    <td class="log-msg">${escapeHtml(item.message)}</td>
                </tr>`;
            }

            html += '</tbody></table>';
            el.innerHTML = html;

            // Paginação
            renderPagination(res);
        } catch (e) {
            el.innerHTML = `<div class="error-state">Erro: ${e.message}</div>`;
        }
    }

    function renderPagination(res) {
        const el = document.getElementById('logs-pagination');
        if (!el) return;

        if (res.pages <= 1) {
            el.innerHTML = '';
            return;
        }

        let html = '<div class="pagination">';
        html += `<button class="btn btn-sm btn-secondary" onclick="LOGS.search(${res.page - 1})" ${res.page <= 1 ? 'disabled' : ''}>← Anterior</button>`;
        html += `<span class="pagination-info">Página ${res.page} de ${res.pages}</span>`;
        html += `<button class="btn btn-sm btn-secondary" onclick="LOGS.search(${res.page + 1})" ${res.page >= res.pages ? 'disabled' : ''}>Próximo →</button>`;
        html += '</div>';
        el.innerHTML = html;
    }

    async function download() {
        const source = document.getElementById('log-source')?.value || '';
        let url = '/api/logs/download';
        if (source) url += `?source=${source}`;
        window.open(url, '_blank');
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
            if (autoRefresh) search(currentQuery.page || 1);
        }, 5000);
    }

    function toggleAutoRefresh() {
        autoRefresh = !autoRefresh;
        const btn = document.getElementById('log-refresh-toggle');
        if (btn) {
            btn.innerHTML = `${UI.icon(autoRefresh ? 'pause' : 'play')} Auto`;
            btn.classList.toggle('btn-ghost', autoRefresh);
            btn.classList.toggle('btn-secondary', !autoRefresh);
            btn.title = autoRefresh ? 'Pausar atualização automática' : 'Retomar atualização automática';
        }
        UI.createToast(autoRefresh ? 'Auto-refresh ativado' : 'Auto-refresh pausado', 'info', 2000);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return { render, search, download, destroy, toggleAutoRefresh };
})();
