/**
 * Logs Page — busca, filtros avançados, download, auto-refresh.
 * Permite filtrar por TV Box, dia/mês/ano, nível e fonte, além de
 * exibir data e hora completas com timestamp relativo.
 */
const LOGS = (() => {
    let refreshTimer = null;
    let currentQuery = {};
    let inflight = false;
    let autoRefresh = true;
    let knownDevices = [];

    async function render(el) {
        UI.setPageTitle('Logs');

        // Lê parâmetros da URL caso venha direcionado (ex: #/logs?device=box-1)
        const urlParams = getUrlParams();

        el.innerHTML = `
            <div class="logs-page">
                <!-- Filtros -->
                <div class="logs-filters">
                    <div class="logs-filter-row">
                        <div class="form-group">
                            <label for="log-source">Fonte</label>
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
                            <label for="log-level">Nível</label>
                            <select id="log-level">
                                <option value="">Todos</option>
                                <option value="INFO">INFO</option>
                                <option value="WARNING">WARNING</option>
                                <option value="ERROR">ERROR</option>
                                <option value="DEBUG">DEBUG</option>
                                <option value="CRITICAL">CRITICAL</option>
                            </select>
                        </div>
                        <div class="form-group" style="min-width: 170px;">
                            <label for="log-device">TV Box</label>
                            <select id="log-device">
                                <option value="">Todas as TVs</option>
                            </select>
                        </div>
                        <div class="form-group" style="min-width: 220px;">
                            <label for="log-date">Data (Dia / Mês / Ano)</label>
                            <div class="log-date-wrap">
                                <input type="date" id="log-date" title="Selecione um dia específico">
                                <select id="log-date-preset" title="Atalho de período">
                                    <option value="">Qualquer data</option>
                                    <option value="today">Hoje</option>
                                    <option value="yesterday">Ontem</option>
                                    <option value="this_month">Este mês</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group form-group-grow">
                            <label for="log-query">Buscar</label>
                            <input type="text" id="log-query" placeholder="Texto na mensagem...">
                        </div>
                        <div class="form-group form-actions">
                            <button class="btn btn-primary btn-sm" onclick="LOGS.search(1)">${UI.icon('search')} Buscar</button>
                            <button class="btn btn-ghost btn-sm" onclick="LOGS.clearFilters()" title="Limpar todos os filtros">✕ Limpar</button>
                            <button class="btn btn-secondary btn-sm" onclick="LOGS.download()">${UI.icon('download')} Download</button>
                            <button class="btn btn-ghost btn-sm" id="log-refresh-toggle" onclick="LOGS.toggleAutoRefresh()" title="Pausar/retomar atualização">${UI.icon('pause')} Auto</button>
                        </div>
                    </div>
                    <div class="logs-info" id="logs-info"></div>
                    <div class="logs-level-chips" id="logs-level-chips">
                        <button class="log-chip active" data-level="">Todos</button>
                        <button class="log-chip" data-level="INFO">INFO</button>
                        <button class="log-chip" data-level="WARNING">WARNING</button>
                        <button class="log-chip" data-level="ERROR">ERROR</button>
                        <button class="log-chip" data-level="CRITICAL">CRITICAL</button>
                    </div>
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

        // Carrega lista de TV Boxes
        await loadDeviceOptions(urlParams.device || urlParams.device_id || '');

        // Aplica filtros vindos da URL caso existam
        if (urlParams.level) {
            const levelSel = document.getElementById('log-level');
            if (levelSel) levelSel.value = urlParams.level;
            updateLevelChips(urlParams.level);
        }
        if (urlParams.date) {
            const dateInput = document.getElementById('log-date');
            if (dateInput) dateInput.value = urlParams.date;
        }

        // Binds de data
        const dateInput = document.getElementById('log-date');
        const datePreset = document.getElementById('log-date-preset');
        if (dateInput) {
            dateInput.addEventListener('change', () => {
                if (datePreset) datePreset.value = '';
                search(1);
            });
        }
        if (datePreset) {
            datePreset.addEventListener('change', () => {
                handleDatePresetChange(datePreset.value);
            });
        }

        // Binds de inputs (mudança ou Enter aciona a busca)
        ['log-query', 'log-source', 'log-level', 'log-device'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'SELECT') {
                el.addEventListener('change', () => search(1));
            } else {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') search(1);
                });
            }
        });

        // Chips de nível
        document.querySelectorAll('.logs-level-chips .log-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const level = chip.dataset.level || '';
                const sel = document.getElementById('log-level');
                if (sel) sel.value = level;
                updateLevelChips(level);
                search(1);
            });
        });

        // Auto-refresh a cada 5s
        startAutoRefresh();

        // Carrega logs iniciais
        await search(1);
    }

    function updateLevelChips(activeLevel) {
        document.querySelectorAll('.logs-level-chips .log-chip').forEach(c => {
            c.classList.toggle('active', (c.dataset.level || '') === (activeLevel || ''));
        });
    }

    function handleDatePresetChange(val) {
        const dateInput = document.getElementById('log-date');
        const now = new Date();
        if (val === 'today') {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            if (dateInput) dateInput.value = `${y}-${m}-${d}`;
        } else if (val === 'yesterday') {
            const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const y = yest.getFullYear();
            const m = String(yest.getMonth() + 1).padStart(2, '0');
            const d = String(yest.getDate()).padStart(2, '0');
            if (dateInput) dateInput.value = `${y}-${m}-${d}`;
        } else if (val === 'this_month') {
            if (dateInput) dateInput.value = '';
        } else {
            if (dateInput) dateInput.value = '';
        }
        search(1);
    }

    async function loadDeviceOptions(preselect = '') {
        const sel = document.getElementById('log-device');
        if (!sel) return;
        try {
            const devs = await API.get('/devices');
            knownDevices = Array.isArray(devs) ? devs : [];
            let html = '<option value="">Todas as TVs</option>';
            knownDevices.forEach(d => {
                const label = `${d.name || d.id}${d.ip ? ' · ' + d.ip : ''}`;
                html += `<option value="${UI.escAttr(d.id)}">${UI.escapeHtml(label)}</option>`;
            });
            sel.innerHTML = html;
            if (preselect) {
                sel.value = preselect;
            }
        } catch (e) {
            // Silencioso
        }
    }

    function getUrlParams() {
        const hash = window.location.hash || '';
        const qIndex = hash.indexOf('?');
        if (qIndex === -1) return {};
        const queryString = hash.slice(qIndex + 1);
        const params = {};
        for (const [k, v] of new URLSearchParams(queryString).entries()) {
            params[k] = v;
        }
        return params;
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
        const dateInputVal = document.getElementById('log-date')?.value || '';
        const datePresetVal = document.getElementById('log-date-preset')?.value || '';

        let dateParam = dateInputVal;
        if (!dateParam && datePresetVal === 'this_month') {
            const now = new Date();
            dateParam = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        currentQuery = { source, level, q, device_id: device, date: dateParam, page };

        let url = `/logs?page=${page}&per_page=50`;
        if (source) url += `&source=${encodeURIComponent(source)}`;
        if (level) url += `&level=${encodeURIComponent(level)}`;
        if (q) url += `&q=${encodeURIComponent(q)}`;
        if (device) url += `&device_id=${encodeURIComponent(device)}`;
        if (dateParam) url += `&date=${encodeURIComponent(dateParam)}`;

        try {
            const res = await API.get(url);

            // Informações de paginação e contagem
            const info = document.getElementById('logs-info');
            if (info) {
                let filterSummary = [];
                if (device) filterSummary.push(`TV: ${device}`);
                if (dateParam) filterSummary.push(`Data: ${dateParam}`);
                if (level) filterSummary.push(`Nível: ${level}`);
                if (source) filterSummary.push(`Fonte: ${source}`);
                const extra = filterSummary.length ? ` · Filtros ativos: [${filterSummary.join(', ')}]` : '';
                info.textContent = `${res.total} evento(s) encontrado(s) (página ${res.page} de ${res.pages || 1})${extra}`;
            }

            // Tabela
            if (!res.items || res.items.length === 0) {
                el.innerHTML = '<div class="empty-state" style="padding:28px;text-align:center;color:var(--text-muted)">Nenhum log encontrado para os filtros selecionados.</div>';
                renderPagination(res);
                return;
            }

            let html = '<table class="log-table"><thead><tr>';
            html += '<th style="width:170px">Data / Hora</th><th style="width:90px">Nível</th><th style="width:100px">Fonte</th><th style="width:150px">TV Box</th><th>Mensagem</th>';
            html += '</tr></thead><tbody>';

            for (const item of res.items) {
                const levelClass = item.level === 'ERROR' || item.level === 'CRITICAL' ? 'log-error' :
                                   item.level === 'WARNING' ? 'log-warning' : 'log-info';

                // Data e hora estruturados
                const rawTs = item.timestamp || '';
                let dateDisplay = '--';
                let timeDisplay = '';
                let agoDisplay = '';

                if (rawTs) {
                    const parts = rawTs.split(' ');
                    const datePart = parts[0] || '';
                    const timePart = parts[1] || '';

                    if (datePart.includes('-')) {
                        const [y, m, d] = datePart.split('-');
                        dateDisplay = `${d}/${m}/${y}`;
                    } else {
                        dateDisplay = datePart;
                    }
                    timeDisplay = timePart;

                    const isoTs = rawTs.replace(' ', 'T');
                    agoDisplay = UI.timeAgo(isoTs);
                }

                // Dispositivo com badge interativo
                const devId = item.device && item.device !== '-' ? item.device : '';
                let devHtml = '<span class="text-muted">—</span>';
                if (devId) {
                    devHtml = `<button type="button" class="log-dev-badge" onclick="LOGS.filterDevice('${UI.escAttr(devId)}')" title="Filtrar eventos desta TV">${UI.escapeHtml(devId)}</button>`;
                }

                html += `<tr class="${levelClass}">
                    <td class="log-ts" title="${UI.escAttr(rawTs)}">
                        <div class="log-ts-date">${UI.escapeHtml(dateDisplay)}</div>
                        <div class="log-ts-time">
                            <span class="log-time-num">${UI.escapeHtml(timeDisplay)}</span>
                            ${agoDisplay ? `<span class="log-ts-ago">(${UI.escapeHtml(agoDisplay)})</span>` : ''}
                        </div>
                    </td>
                    <td><span class="log-badge ${levelClass}">${UI.escapeHtml(item.level || '-')}</span></td>
                    <td>${UI.escapeHtml(item.source || '-')}</td>
                    <td class="log-dev">${devHtml}</td>
                    <td class="log-msg">${UI.escapeHtml(item.message)}</td>
                </tr>`;
            }

            html += '</tbody></table>';
            el.innerHTML = html;

            // Paginação
            renderPagination(res);
        } catch (e) {
            el.innerHTML = `<div class="error-state">Erro ao buscar logs: ${UI.escapeHtml(e.message)}</div>`;
        }
    }

    function renderPagination(res) {
        const el = document.getElementById('logs-pagination');
        if (!el) return;

        if (!res || res.pages <= 1) {
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

    function filterDevice(deviceId) {
        const sel = document.getElementById('log-device');
        if (!sel) return;
        let found = false;
        for (const opt of sel.options) {
            if (opt.value === deviceId) {
                found = true;
                break;
            }
        }
        if (!found) {
            const newOpt = document.createElement('option');
            newOpt.value = deviceId;
            newOpt.textContent = deviceId;
            sel.appendChild(newOpt);
        }
        sel.value = deviceId;
        search(1);
        if (typeof UI !== 'undefined' && UI.createToast) {
            UI.createToast(`Filtrando logs do TV Box "${deviceId}"`, 'info', 2000);
        }
    }

    function clearFilters() {
        const sourceSel = document.getElementById('log-source');
        const levelSel = document.getElementById('log-level');
        const devSel = document.getElementById('log-device');
        const dateInput = document.getElementById('log-date');
        const datePreset = document.getElementById('log-date-preset');
        const queryInput = document.getElementById('log-query');

        if (sourceSel) sourceSel.value = '';
        if (levelSel) levelSel.value = '';
        if (devSel) devSel.value = '';
        if (dateInput) dateInput.value = '';
        if (datePreset) datePreset.value = '';
        if (queryInput) queryInput.value = '';

        updateLevelChips('');
        search(1);
        if (typeof UI !== 'undefined' && UI.createToast) {
            UI.createToast('Filtros de log limpos', 'info', 1500);
        }
    }

    async function download() {
        const source = document.getElementById('log-source')?.value || '';
        let url = '/api/logs/download';
        if (source) url += `?source=${encodeURIComponent(source)}`;
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

    return { render, search, download, destroy, toggleAutoRefresh, filterDevice, clearFilters };
})();
