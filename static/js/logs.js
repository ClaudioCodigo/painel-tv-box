/**
 * Logs Page — Feed Cronológico Estilo Terminal NOC (Fase 3B).
 *   - Toolbar com filtros avançados (busca, severidade, TV Box dinâmica, período, fonte)
 *   - Terminal feed denso com visual monospaced, timestamps HH:mm:ss.SSS, badges e live streaming WS
 *   - Pausa/Retomada de feed, scroll automático e exportação de logs
 */
const LOGS = (() => {
    let refreshTimer = null;
    let currentQuery = {};
    let inflight = false;
    let isFeedPaused = false;
    let autoScroll = true;
    let knownDevices = [];
    let wsHandler = null;
    const maxTerminalLines = 500;

    /**
     * Formata timestamp para exibição no terminal: HH:mm:ss.SSS e data completa
     */
    function formatTs(raw) {
        if (!raw) {
            const now = new Date();
            const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
            return { time, full: now.toLocaleString() };
        }

        // Tenta parse ISO ou "YYYY-MM-DD HH:mm:ss"
        let d = new Date(raw);
        if (isNaN(d.getTime())) {
            const parts = raw.split(' ');
            if (parts.length >= 2) {
                const dateParts = parts[0].split('-');
                const timeParts = parts[1].split(':');
                if (dateParts.length === 3 && timeParts.length >= 2) {
                    d = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], timeParts[2] || 0);
                }
            }
        }

        if (!isNaN(d.getTime())) {
            const h = String(d.getHours()).padStart(2, '0');
            const m = String(d.getMinutes()).padStart(2, '0');
            const s = String(d.getSeconds()).padStart(2, '0');
            const ms = String(d.getMilliseconds()).padStart(3, '0');
            return {
                time: `${h}:${m}:${s}.${ms}`,
                full: d.toLocaleString()
            };
        }

        // Fallback: se raw já contiver hora
        return {
            time: raw.length > 12 ? raw.slice(-12) : raw,
            full: raw
        };
    }

    /**
     * Retorna metadados de classe e rótulo por severidade
     */
    function getSeverityMeta(level) {
        const lvl = String(level || 'INFO').toUpperCase();
        switch (lvl) {
            case 'CRITICAL':
                return { cls: 'crit', label: 'CRÍT' };
            case 'ERROR':
                return { cls: 'bad', label: 'ERRO' };
            case 'WARNING':
            case 'WARN':
                return { cls: 'warn', label: 'AVISO' };
            case 'DEBUG':
                return { cls: 'debug', label: 'DEBUG' };
            case 'INFO':
            default:
                return { cls: 'info', label: 'INFO' };
        }
    }

    /**
     * Renderiza página de logs
     */
    async function render(el) {
        UI.setPageTitle('Logs & Eventos');
        const urlParams = getUrlParams();

        el.innerHTML = `
            <div class="logs-page">
                <!-- 1. Toolbar de Filtros & Ações NOC -->
                <div class="logs-toolbar-card">
                    <div class="logs-toolbar-header">
                        <div class="logs-toolbar-title-wrap">
                            <h1 class="logs-page-title">${UI.icon('terminal', 20)} Logs & Eventos</h1>
                            <span class="text-muted text-xs">Console de auditoria e monitoramento em tempo real</span>
                        </div>
                        <div class="logs-toolbar-actions">
                            <button class="btn btn-primary btn-sm" onclick="LOGS.search(1)">
                                ${UI.icon('search')} Buscar
                            </button>
                            <button class="btn btn-secondary btn-sm" id="btn-feed-pause" onclick="LOGS.togglePause()" title="Pausar ou retomar recebimento de eventos">
                                <span id="feed-pause-icon">${UI.icon('pause')}</span> <span id="feed-pause-label">Pausar Feed</span>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="LOGS.download()" title="Exportar arquivo de log completo">
                                ${UI.icon('download')} Exportar Logs
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick="LOGS.clearFilters()" title="Limpar todos os filtros">
                                ✕ Limpar
                            </button>
                        </div>
                    </div>

                    <!-- Linha de controles de filtro -->
                    <div class="logs-filter-grid">
                        <div class="filter-field filter-grow">
                            <label class="filter-label" for="log-query">Busca por Texto</label>
                            <div class="filter-input-wrap">
                                <input type="text" id="log-query" class="form-input" placeholder="Filtrar por mensagem, IP ou detalhe..." />
                            </div>
                        </div>

                        <div class="filter-field">
                            <label class="filter-label" for="log-device">TV Box</label>
                            <select id="log-device" class="form-select font-mono">
                                <option value="">Todas as TVs</option>
                            </select>
                        </div>

                        <div class="filter-field">
                            <label class="filter-label" for="log-source">Fonte</label>
                            <select id="log-source" class="form-select">
                                <option value="">Todas as fontes</option>
                                <option value="system">Sistema</option>
                                <option value="adb">ADB</option>
                                <option value="mediamtx">MediaMTX</option>
                                <option value="watchdog">Watchdog</option>
                                <option value="user">Usuário</option>
                                <option value="api">API</option>
                            </select>
                        </div>

                        <div class="filter-field filter-date-field">
                            <label class="filter-label" for="log-date">Período / Data</label>
                            <div class="date-input-group">
                                <input type="date" id="log-date" class="form-input" />
                                <select id="log-date-preset" class="form-select">
                                    <option value="">Qualquer data</option>
                                    <option value="today">Hoje</option>
                                    <option value="yesterday">Ontem</option>
                                    <option value="this_month">Este mês</option>
                                </select>
                            </div>
                        </div>

                        <input type="hidden" id="log-level" value="" />
                    </div>

                    <!-- Chips de Severidade -->
                    <div class="logs-severity-row">
                        <span class="severity-label text-muted text-xs font-semibold">Severidade:</span>
                        <div class="severity-chips" id="severity-chips">
                            <button type="button" class="chip-filter active" data-level="">Todos</button>
                            <button type="button" class="chip-filter chip-info" data-level="INFO">Info</button>
                            <button type="button" class="chip-filter chip-warn" data-level="WARNING">Aviso</button>
                            <button type="button" class="chip-filter chip-bad" data-level="ERROR">Erro</button>
                            <button type="button" class="chip-filter chip-crit" data-level="CRITICAL">Crítico</button>
                        </div>
                        <div class="logs-active-summary text-muted text-xs" id="logs-summary" role="status" aria-live="polite"></div>
                    </div>
                </div>

                <!-- 2. Terminal NOC Console Feed -->
                <div class="terminal-container">
                    <div class="terminal-header">
                        <div class="terminal-header-left">
                            <span class="term-status-dot active" id="term-live-dot" title="Streaming WebSocket Ativo"></span>
                            <span class="term-title-text font-mono" id="term-live-status">LIVE STREAM NOC</span>
                            <span class="term-badge-count font-mono" id="term-count-badge">0 eventos</span>
                        </div>
                        <div class="terminal-header-right">
                            <label class="term-checkbox-label text-xs" title="Mantém rolagem acompanhando os novos eventos">
                                <input type="checkbox" id="term-autoscroll" checked />
                                <span>Auto-scroll</span>
                            </label>
                            <button type="button" class="btn btn-ghost btn-xs" onclick="LOGS.clearTerminal()" title="Limpar visualização do console" aria-label="Limpar visualização do console">
                                Limpar Tela
                            </button>
                        </div>
                    </div>

                    <!-- Corpo do Terminal -->
                    <div class="terminal-body" id="terminal-feed" role="log" aria-live="polite" aria-atomic="false">
                        <div class="term-skeleton p-4">${UI.skeletons('row', 8)}</div>
                    </div>
                </div>

                <!-- 3. Paginação Histórica -->
                <div class="logs-pagination-bar" id="logs-pagination"></div>
            </div>
        `;

        // 1. Carrega opções de dispositivos
        await loadDeviceOptions(urlParams.device || urlParams.device_id || '');

        // 2. Aplica parâmetros da URL se houver
        if (urlParams.level) {
            const levelInput = document.getElementById('log-level');
            if (levelInput) levelInput.value = urlParams.level;
            updateSeverityChips(urlParams.level);
        }
        if (urlParams.date) {
            const dateInput = document.getElementById('log-date');
            if (dateInput) dateInput.value = urlParams.date;
        }
        if (urlParams.source) {
            const srcSel = document.getElementById('log-source');
            if (srcSel) srcSel.value = urlParams.source;
        }
        if (urlParams.q) {
            const qInput = document.getElementById('log-query');
            if (qInput) qInput.value = urlParams.q;
        }

        // 3. Event Listeners de Filtros
        setupFilterListeners();

        // 4. Inicia WebSocket e polling periódico
        setupWebSocket();
        startAutoRefresh();

        // 5. Busca inicial
        await search(1);
    }

    /**
     * Configura listeners de interação nos filtros
     */
    function setupFilterListeners() {
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

        ['log-query', 'log-source', 'log-device'].forEach(id => {
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

        // Chips de severidade
        document.querySelectorAll('#severity-chips .chip-filter').forEach(chip => {
            chip.addEventListener('click', () => {
                const lvl = chip.dataset.level || '';
                const hiddenInput = document.getElementById('log-level');
                if (hiddenInput) hiddenInput.value = lvl;
                updateSeverityChips(lvl);
                search(1);
            });
        });

        // Toggle do autoscroll
        const autoScrollCb = document.getElementById('term-autoscroll');
        if (autoScrollCb) {
            autoScrollCb.addEventListener('change', (e) => {
                autoScroll = e.target.checked;
                if (autoScroll) scrollToBottom();
            });
        }
    }

    function updateSeverityChips(activeLevel) {
        document.querySelectorAll('#severity-chips .chip-filter').forEach(c => {
            const match = (c.dataset.level || '') === (activeLevel || '');
            c.classList.toggle('active', match);
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
                const label = `${d.name || d.id}${d.ip ? ' (' + d.ip + ')' : ''}`;
                html += `<option value="${UI.escAttr(d.id)}">${UI.escapeHtml(label)}</option>`;
            });
            sel.innerHTML = html;
            if (preselect) sel.value = preselect;
        } catch (e) {
            console.warn('[LOGS] Falha ao carregar lista de devices:', e.message);
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

    /**
     * Executa busca com paginação e filtros
     */
    async function search(page = 1) {
        const feed = document.getElementById('terminal-feed');
        if (!feed || inflight) return;
        inflight = true;

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

            // Atualiza resumo
            const summary = document.getElementById('logs-summary');
            if (summary) {
                const parts = [];
                if (device) parts.push(`TV: ${device}`);
                if (dateParam) parts.push(`Data: ${dateParam}`);
                if (level) parts.push(`Nível: ${level}`);
                if (source) parts.push(`Fonte: ${source}`);
                const extra = parts.length ? ` · [${parts.join(', ')}]` : '';
                summary.textContent = `${res.total} eventos encontrados (pág ${res.page}/${res.pages || 1})${extra}`;
            }

            // Atualiza contador do terminal
            const countBadge = document.getElementById('term-count-badge');
            if (countBadge) {
                countBadge.textContent = `${res.items?.length || 0} exibidos`;
            }

            // Renderiza linhas no terminal
            renderTerminalLines(res.items || []);
            renderPagination(res);

            if (autoScroll) scrollToBottom();
        } catch (e) {
            feed.innerHTML = `<div class="term-empty-state text-danger p-4">Erro ao buscar logs: ${UI.escapeHtml(e.message)}</div>`;
        } finally {
            inflight = false;
        }
    }

    /**
     * Renderiza o conjunto de linhas no terminal NOC
     */
    function renderTerminalLines(items) {
        const feed = document.getElementById('terminal-feed');
        if (!feed) return;

        if (!items || items.length === 0) {
            feed.innerHTML = '<div class="term-empty-state p-5 text-muted text-center">Nenhum registro de log encontrado para os filtros selecionados.</div>';
            return;
        }

        const linesHtml = items.map(item => createLineHtml(item)).join('');
        feed.innerHTML = linesHtml;
    }

    /**
     * Cria HTML individual de uma linha de console
     */
    function createLineHtml(item) {
        const sev = getSeverityMeta(item.level);
        const tsObj = formatTs(item.timestamp);
        const devId = (item.device && item.device !== '-') ? item.device : '';
        const devHtml = devId
            ? `<button type="button" class="term-dev-badge" onclick="LOGS.filterDevice('${UI.escAttr(devId)}')" title="Filtrar eventos desta TV">[${UI.escapeHtml(devId)}]</button>`
            : `<span class="term-dev-empty text-muted">[-]</span>`;

        return `
            <div class="term-line term-lvl-${sev.cls}">
                <span class="term-ts" title="${UI.escAttr(tsObj.full)}">${tsObj.time}</span>
                <span class="term-badge term-badge-${sev.cls}">${sev.label}</span>
                <span class="term-src">[${UI.escapeHtml(item.source || '-')}]</span>
                <span class="term-dev-col">${devHtml}</span>
                <span class="term-msg">${UI.escapeHtml(item.message || '')}</span>
            </div>
        `;
    }

    /**
     * Adiciona linha recebida em tempo real via WebSocket (streaming)
     */
    function appendLiveLog(item) {
        if (isFeedPaused) return;

        const feed = document.getElementById('terminal-feed');
        if (!feed) return;

        // Se o container estiver vazio ou em estado vazio, limpa
        if (feed.querySelector('.term-empty-state') || feed.querySelector('.term-skeleton')) {
            feed.innerHTML = '';
        }

        // Verifica filtros ativos
        if (currentQuery.device_id && item.device && item.device !== currentQuery.device_id) return;
        if (currentQuery.level && item.level && item.level.toUpperCase() !== currentQuery.level.toUpperCase()) return;
        if (currentQuery.source && item.source && item.source.toLowerCase() !== currentQuery.source.toLowerCase()) return;
        if (currentQuery.q && item.message && !item.message.toLowerCase().includes(currentQuery.q.toLowerCase())) return;

        const lineWrapper = document.createElement('div');
        lineWrapper.innerHTML = createLineHtml(item);
        const newLine = lineWrapper.firstElementChild;
        if (!newLine) return;

        newLine.classList.add('term-line-live');
        feed.appendChild(newLine);

        // Limita tamanho do DOM para manter fluidez
        while (feed.children.length > maxTerminalLines) {
            feed.removeChild(feed.firstElementChild);
        }

        // Atualiza contador
        const countBadge = document.getElementById('term-count-badge');
        if (countBadge) {
            countBadge.textContent = `${feed.children.length} exibidos`;
        }

        if (autoScroll) {
            scrollToBottom();
        }
    }

    function scrollToBottom() {
        const feed = document.getElementById('terminal-feed');
        if (feed) {
            feed.scrollTop = feed.scrollHeight;
        }
    }

    /**
     * Integração com WebSocket para eventos em tempo real
     */
    function setupWebSocket() {
        if (typeof WS === 'undefined') return;
        if (wsHandler) WS.off('all', wsHandler);

        wsHandler = (ev) => {
            if (!ev) return;
            const now = new Date().toISOString();
            let level = 'INFO';
            let msg = '';
            const dev = ev.device_id || '-';
            const src = ev.type || 'ws';

            if (ev.type === 'alert') {
                level = ev.severity === 'critical' ? 'CRITICAL' : 'WARNING';
                msg = ev.message || 'Alerta do sistema';
            } else if (ev.type === 'health') {
                level = ev.status === 'offline' ? 'ERROR' : (ev.status === 'degraded' ? 'WARNING' : 'INFO');
                msg = `Health Check: status=${ev.status}${ev.reason ? ' (' + ev.reason + ')' : ''}`;
            } else if (ev.type === 'magisk') {
                level = ev.step === 'error' ? 'ERROR' : 'INFO';
                msg = `Magisk Provisioning: passo ${ev.step || 'andamento'}`;
            } else {
                msg = ev.message || JSON.stringify(ev);
            }

            appendLiveLog({
                timestamp: now,
                level: level,
                source: src,
                device: dev,
                message: msg
            });
        };

        WS.on('all', wsHandler);
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
            // Se o feed estiver pausado ou usuário navegando em página > 1, não sobrescreve
            if (!isFeedPaused && (!currentQuery.page || currentQuery.page === 1)) {
                search(1);
            }
        }, 8000);
    }

    function togglePause() {
        isFeedPaused = !isFeedPaused;
        const btn = document.getElementById('btn-feed-pause');
        const iconEl = document.getElementById('feed-pause-icon');
        const labelEl = document.getElementById('feed-pause-label');
        const dot = document.getElementById('term-live-dot');
        const statusText = document.getElementById('term-live-status');

        if (isFeedPaused) {
            if (btn) btn.classList.add('active');
            if (iconEl) iconEl.innerHTML = UI.icon('play');
            if (labelEl) labelEl.textContent = 'Retomar Feed';
            if (dot) dot.classList.remove('active');
            if (statusText) statusText.textContent = 'FEED PAUSADO';
            UI.createToast('Feed de eventos pausado', 'info', 2000);
        } else {
            if (btn) btn.classList.remove('active');
            if (iconEl) iconEl.innerHTML = UI.icon('pause');
            if (labelEl) labelEl.textContent = 'Pausar Feed';
            if (dot) dot.classList.add('active');
            if (statusText) statusText.textContent = 'LIVE STREAM NOC';
            UI.createToast('Feed de eventos retomado', 'info', 2000);
            search(1);
        }
    }

    function filterDevice(devId) {
        const sel = document.getElementById('log-device');
        if (!sel) return;

        let found = false;
        for (const opt of sel.options) {
            if (opt.value === devId) {
                found = true;
                break;
            }
        }
        if (!found) {
            const opt = document.createElement('option');
            opt.value = devId;
            opt.textContent = devId;
            sel.appendChild(opt);
        }
        sel.value = devId;
        search(1);
        UI.createToast(`Filtrando logs do TV Box "${devId}"`, 'info', 2000);
    }

    function clearFilters() {
        const q = document.getElementById('log-query');
        const dev = document.getElementById('log-device');
        const src = document.getElementById('log-source');
        const dt = document.getElementById('log-date');
        const dtPreset = document.getElementById('log-date-preset');
        const lvl = document.getElementById('log-level');

        if (q) q.value = '';
        if (dev) dev.value = '';
        if (src) src.value = '';
        if (dt) dt.value = '';
        if (dtPreset) dtPreset.value = '';
        if (lvl) lvl.value = '';

        updateSeverityChips('');
        search(1);
        UI.createToast('Filtros de log limpos', 'info', 1500);
    }

    function clearTerminal() {
        const feed = document.getElementById('terminal-feed');
        if (feed) {
            feed.innerHTML = '<div class="term-empty-state p-5 text-muted text-center">Console limpo pelo operador. Aguardando novos eventos...</div>';
        }
        const countBadge = document.getElementById('term-count-badge');
        if (countBadge) countBadge.textContent = '0 eventos';
    }

    async function download() {
        const source = document.getElementById('log-source')?.value || '';
        let url = '/api/logs/download';
        if (source) url += `?source=${encodeURIComponent(source)}`;

        try {
            UI.createToast('Preparando download do log...', 'info', 2000);
            await API.download(url, `logs-${source || 'all'}-${Date.now()}.txt`);
            UI.createToast('✅ Logs baixados com sucesso', 'success');
        } catch (e) {
            UI.createToast(`Falha no download: ${e.message}`, 'error');
        }
    }

    function renderPagination(res) {
        const el = document.getElementById('logs-pagination');
        if (!el) return;

        if (!res || res.pages <= 1) {
            el.innerHTML = '';
            return;
        }

        el.innerHTML = `
            <div class="pagination">
                <button class="btn btn-sm btn-secondary" onclick="LOGS.search(${res.page - 1})" ${res.page <= 1 ? 'disabled' : ''}>
                    ← Anterior
                </button>
                <span class="pagination-info font-mono">Página ${res.page} de ${res.pages}</span>
                <button class="btn btn-sm btn-secondary" onclick="LOGS.search(${res.page + 1})" ${res.page >= res.pages ? 'disabled' : ''}>
                    Próximo →
                </button>
            </div>
        `;
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (wsHandler && typeof WS !== 'undefined') {
            WS.off('all', wsHandler);
            wsHandler = null;
        }
    }

    return {
        render,
        search,
        download,
        destroy,
        togglePause,
        filterDevice,
        clearFilters,
        clearTerminal
    };
})();
