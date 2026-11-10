/**
 * Componentes reutilizáveis:
 *   createStatCard(label, value, colorClass)
 *   createCard(title, subtitle, status, actions)
 *   createToast(msg, type)
 *   showModal(title, bodyHtml, onConfirm, onCancel)
 *   createBadge(text, color)
 */
const UI = (() => {

    // ── Escape helpers (anti XSS) ─────────────────

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    /** Escapa para string JS entre aspas simples (contexto onclick). */
    function escJs(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    /** Escapa para atributo HTML que contém uma string JS (onclick="fn('...')"). */
    function escAttr(value) {
        return escapeHtml(escJs(value));
    }

    function createStatCard(label, value, colorClass = '') {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <div class="stat-card-label">${label}</div>
            <div class="stat-card-value ${colorClass}">${value}</div>
        `;
        return card;
    }

    function createCard({ title, subtitle = '', status = '', statusClass = '', info = [] }) {
        const card = document.createElement('div');
        card.className = 'card';

        let infoHtml = '';
        if (info.length) {
            infoHtml = '<div class="card-info">';
            info.forEach(([k, v]) => {
                infoHtml += `<div class="card-info-item"><span class="card-info-key">${k}</span><span class="card-info-val">${v}</span></div>`;
            });
            infoHtml += '</div>';
        }

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${title}</div>
                ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
            </div>
            ${status ? `<div class="card-status ${statusClass}">${status}</div>` : ''}
            ${infoHtml}
        `;
        return card;
    }

    /** Ícone SVG do catálogo (monocromático, currentColor). */
    function icon(name, size) {
        return (typeof ICONS !== 'undefined' && ICONS.icon) ? ICONS.icon(name, size) : '';
    }

    /** Skeletons de carregamento (§5.3): 'card' | 'row' | 'line' */
    function skeletons(type = 'card', count = 3) {
        let html = '';
        if (type === 'row' || type === 'table') {
            for (let i = 0; i < count; i++) html += '<div class="skeleton" style="height:38px;margin-bottom:6px;border-radius:var(--radius-sm)"></div>';
            return html;
        }
        if (type === 'line') {
            for (let i = 0; i < count; i++) html += '<div class="skeleton" style="height:14px;margin-bottom:10px"></div>';
            return html;
        }
        for (let i = 0; i < count; i++) {
            html += '<div class="card" style="padding:16px;min-height:150px;pointer-events:none">' +
                '<div class="skeleton" style="height:18px;width:55%;margin-bottom:14px"></div>' +
                '<div class="skeleton" style="height:12px;margin-bottom:8px"></div>' +
                '<div class="skeleton" style="height:12px;width:80%;margin-bottom:8px"></div>' +
                '<div class="skeleton" style="height:12px;width:65%"></div></div>';
        }
        return html;
    }

    /** Tempo relativo: ISO/Date/ms → "agora", "há 12s", "há 3min", "há 2h", "há 5d" */
    function timeAgo(ts) {
        if (!ts) return '—';
        const d = (ts instanceof Date) ? ts : new Date(ts);
        if (isNaN(d.getTime())) return '—';
        const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
        if (diff < 5) return 'agora';
        if (diff < 60) return `há ${Math.round(diff)}s`;
        if (diff < 3600) return `há ${Math.round(diff / 60)}min`;
        if (diff < 86400) return `há ${Math.round(diff / 3600)}h`;
        return `há ${Math.round(diff / 86400)}d`;
    }

    /** Estado vazio/erro padronizado (ícone + título + msg + retry opcional) */
    function stateView(kind = 'empty', msg = '', opts = {}) {
        const iconName = opts.icon || (kind === 'error' ? 'alert' : 'layers');
        const title = opts.title || (kind === 'error' ? 'Ocorreu um erro' : 'Nada por aqui');
        const retry = opts.retry
            ? `<button class="btn btn-sm btn-secondary" data-role="state-retry" style="margin-top:12px">${icon('refresh')} Tentar novamente</button>`
            : '';
        return `<div class="state-view ${kind}">
            <span class="state-view-icon">${icon(iconName, 44)}</span>
            <div class="state-view-title">${escapeHtml(title)}</div>
            ${msg ? `<div class="state-view-msg">${escapeHtml(msg)}</div>` : ''}
            ${retry}
        </div>`;
    }

    /** Liga o botão de retry criado por stateView ao container */
    function bindStateRetry(container, fn) {
        const btn = container && container.querySelector ? container.querySelector('[data-role="state-retry"]') : null;
        if (btn && fn) btn.addEventListener('click', fn);
    }

    /** Chips de contadores da toolbar (total/online/degradado/offline) */
    function toolbarCounters(devices) {
        const total = devices.length;
        const online = devices.filter(d => d.state?.status === 'online').length;
        const degraded = devices.filter(d => d.state?.status === 'degraded').length;
        const warning = devices.filter(d => d.state?.status === 'warning').length;
        const offline = devices.filter(d => d.state?.status === 'offline').length;
        return `<span class="dcard-counter">${total} total</span>` +
            `<span class="dcard-counter"><span class="dcard-status-shape online"></span>${online}</span>` +
            `<span class="dcard-counter"><span class="dcard-status-shape degraded"></span>${degraded}</span>` +
            (warning ? `<span class="dcard-counter"><span class="dcard-status-shape warning"></span>${warning}</span>` : '') +
            `<span class="dcard-counter"><span class="dcard-status-shape offline"></span>${offline}</span>`;
    }

    /** Chip de grupo clicável (navega para a página do grupo) */
    function groupChip(name, groupId) {
        const id = groupId || '';
        return `<a class="dcard-group-chip" href="#/group/${encodeURIComponent(id)}" title="Abrir grupo">${escapeHtml(name || id)}</a>`;
    }

    /** Status bar V2: forma + rótulo + reason truncado */
    function statusBar(status, reason = '') {
        const cfg = {
            online:   { label: 'ONLINE',        shape: 'online' },
            degraded: { label: 'DEGRADADO',     shape: 'degraded' },
            warning:  { label: 'ATENÇÃO',       shape: 'warning' },
            offline:  { label: 'OFFLINE',       shape: 'offline' },
            unknown:  { label: 'DESCONHECIDO',  shape: 'unknown' },
        }[status] || { label: (status || 'unknown').toUpperCase(), shape: 'unknown' };
        return `<span class="dcard-status-shape ${cfg.shape}" aria-hidden="true"></span>` +
            `<span class="dcard-status-label">${cfg.label}</span>` +
            (reason ? `<span class="dcard-status-reason">${escapeHtml(reason)}</span>` : '');
    }

    /**
     * Trata 409 adb_busy_scrcpy (regra ADB×scrcpy §3.3 do docs/09):
     * oferece parar o scrcpy e repetir a ação. Retorna true se tratou.
     */
    function confirmStopScrcpy(err, onRetry) {
        if (!err || err.status !== 409 || !String(err.message || '').includes('adb_busy_scrcpy')) {
            return false;
        }
        showModal(
            'scrcpy ativo',
            `<p>⚠️ Esta ação usa <strong>ADB</strong> e vai derrubar o espelhamento do scrcpy neste device.</p>` +
            `<p class="text-muted text-sm">Toque em confirmar para parar o scrcpy e repetir a ação.</p>`,
            async () => {
                try { await API.post('/scrcpy/stop'); } catch (e) {}
                UI.createToast('scrcpy parado — repetindo ação...', 'info');
                if (onRetry) await onRetry();
            }
        );
        return true;
    }

    // ── Fila inteligente de Toasts ─────────────────
    const _toastQueue = [];
    const _activeToasts = new Map(); // key -> { el, count, timer, duration }
    const MAX_ACTIVE_TOASTS = 3;

    function _getDefaultToastDuration(type) {
        switch (type) {
            case 'success': return 3000;
            case 'info': return 4000;
            case 'warning': return 6000;
            case 'error': return null; // persistente até clique
            default: return 4000;
        }
    }

    function _dismissToast(key) {
        const item = _activeToasts.get(key);
        if (!item) return;
        if (item.timer) clearTimeout(item.timer);
        _activeToasts.delete(key);

        item.el.classList.add('toast-leave');
        setTimeout(() => {
            item.el.remove();
            _processToastQueue();
        }, 300);
    }

    function _processToastQueue() {
        while (_activeToasts.size < MAX_ACTIVE_TOASTS && _toastQueue.length > 0) {
            const next = _toastQueue.shift();
            if (_activeToasts.has(next.cleanMsg)) {
                _incrementToastCount(next.cleanMsg);
            } else {
                _displayToast(next.cleanMsg, next.type, next.duration);
            }
        }
    }

    function _incrementToastCount(cleanMsg) {
        const item = _activeToasts.get(cleanMsg);
        if (!item) return;
        item.count++;
        let badge = item.el.querySelector('.toast-count-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'toast-count-badge badge';
            badge.style.cssText = 'margin-left:auto;margin-right:6px;font-size:0.75rem;padding:2px 6px;border-radius:10px;font-weight:600;opacity:0.85;';
            const closeBtn = item.el.querySelector('.toast-close');
            item.el.insertBefore(badge, closeBtn);
        }
        badge.textContent = `(×${item.count})`;

        // Reiniciar contagem do timer se configurado
        if (item.timer) clearTimeout(item.timer);
        if (item.duration !== null && item.duration > 0) {
            item.timer = setTimeout(() => _dismissToast(cleanMsg), item.duration);
        }
    }

    function _displayToast(cleanMsg, type, duration) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconName = { success: 'check', error: 'x', warning: 'alert', info: 'help' }[type] || 'help';

        toast.innerHTML = `
            <span class="toast-icon">${icon(iconName)}</span>
            <span class="toast-msg">${escapeHtml(cleanMsg)}</span>
            <button class="toast-close" aria-label="Fechar">&times;</button>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            _dismissToast(cleanMsg);
        });

        const effectiveDuration = (duration !== undefined) ? duration : _getDefaultToastDuration(type);

        const toastItem = {
            el: toast,
            count: 1,
            timer: null,
            duration: effectiveDuration
        };

        if (effectiveDuration !== null && effectiveDuration > 0) {
            toastItem.timer = setTimeout(() => {
                _dismissToast(cleanMsg);
            }, effectiveDuration);
        }

        _activeToasts.set(cleanMsg, toastItem);
        container.appendChild(toast);
    }

    function createToast(msg, type = 'info', duration = undefined) {
        const cleanMsg = String(msg ?? '').replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]+\s*/u, '').trim();
        if (!cleanMsg) return;

        // Se já aparece em um toast ativo, incrementa o contador (×N)
        if (_activeToasts.has(cleanMsg)) {
            _incrementToastCount(cleanMsg);
            return;
        }

        // Se já atingiu o limite de toasts visíveis, enfileira
        if (_activeToasts.size >= MAX_ACTIVE_TOASTS) {
            const alreadyQueued = _toastQueue.find(item => item.cleanMsg === cleanMsg);
            if (!alreadyQueued) {
                _toastQueue.push({ cleanMsg, type, duration });
            }
            return;
        }

        _displayToast(cleanMsg, type, duration);
    }

    // ── Focus Trap em Modais ─────────────────
    let _modalPrevFocus = null;
    let _modalTrapHandler = null;
    let _modalEscapeHandler = null;

    function showModal(title, bodyHtml, onConfirm, onCancel) {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        if (!container || !content) return;

        // Salvar elemento focado antes de abrir o modal
        _modalPrevFocus = document.activeElement;

        container.setAttribute('aria-labelledby', 'modal-title');
        content.setAttribute('aria-labelledby', 'modal-title');

        content.innerHTML = `
            <div class="modal-header">
                <h3 id="modal-title">${escapeHtml(title)}</h3>
                <button class="modal-close" id="modal-close-btn" aria-label="Fechar">&times;</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="modal-cancel-btn">Cancelar</button>
                <button class="btn btn-primary" id="modal-confirm-btn">Confirmar</button>
            </div>
        `;

        container.classList.remove('hidden');

        // Limpar handlers prévios caso ainda registrados
        if (_modalTrapHandler) {
            content.removeEventListener('keydown', _modalTrapHandler);
            _modalTrapHandler = null;
        }
        if (_modalEscapeHandler) {
            document.removeEventListener('keydown', _modalEscapeHandler);
            _modalEscapeHandler = null;
        }

        // Focus trap
        const focusable = content.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // Focar o primeiro elemento
        setTimeout(() => first?.focus(), 50);

        // Prender o foco
        _modalTrapHandler = function trapFocus(e) {
            if (e.key !== 'Tab') return;
            const currentFocusables = content.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const curFirst = currentFocusables[0] || first;
            const curLast = currentFocusables[currentFocusables.length - 1] || last;
            if (e.shiftKey) {
                if (document.activeElement === curFirst) {
                    e.preventDefault();
                    curLast?.focus();
                }
            } else {
                if (document.activeElement === curLast) {
                    e.preventDefault();
                    curFirst?.focus();
                }
            }
        };
        content.addEventListener('keydown', _modalTrapHandler);

        const close = () => {
            hideModal();
            if (onCancel) onCancel();
        };

        // Fechar com Escape
        _modalEscapeHandler = function onEscape(e) {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', _modalEscapeHandler);

        document.getElementById('modal-close-btn').addEventListener('click', close);
        document.getElementById('modal-cancel-btn').addEventListener('click', close);
        document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
            if (onConfirm) await onConfirm();
            hideModal();
        });

        const overlay = container.querySelector('.modal-overlay');
        if (overlay) {
            overlay.onclick = close;
        }
    }

    function hideModal() {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');
        if (container) {
            container.classList.add('hidden');
        }
        if (_modalTrapHandler && content) {
            content.removeEventListener('keydown', _modalTrapHandler);
            _modalTrapHandler = null;
        }
        if (_modalEscapeHandler) {
            document.removeEventListener('keydown', _modalEscapeHandler);
            _modalEscapeHandler = null;
        }
        // Restaurar foco ao fechar
        if (_modalPrevFocus && typeof _modalPrevFocus.focus === 'function') {
            try { _modalPrevFocus.focus(); } catch (e) {}
            _modalPrevFocus = null;
        }
    }

    function createBadge(text, type = 'info') {
        return `<span class="badge badge-${type}">${text}</span>`;
    }

    function statusClass(status) {
        switch (status) {
            case 'online': return 'success';
            case 'offline': return 'danger';
            case 'degraded':
            case 'warning': return 'warning';
            default: return 'muted';
        }
    }

    function statusIcon(status) {
        // Monocromático: ícone stroke, cor via currentColor
        const map = {
            online: 'check',
            offline: 'x',
            degraded: 'pause',
            warning: 'alert',
            unknown: 'help',
        };
        return icon(map[status] || 'help');
    }

    function setPageTitle(title) {
        const el = document.getElementById('page-title');
        if (el) el.textContent = title;
        document.title = `${title} — Painel TV Box`;
    }

    function launchScrcpy(device) {
        if (!device || !device.ip) {
            createToast('Dispositivo sem endereço IP configurado', 'error');
            return;
        }
        const name = device.name || device.id;
        const ip = device.ip;
        const port = device.adb_port || 5555;
        const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
        const protoUrl = `paineltvbox://${ip}:${port}/?name=${encodeURIComponent(name)}&server=${encodeURIComponent(origin)}`;
        window.location.href = protoUrl;
        createToast(`🖥️ Abrindo Scrcpy para ${escapeHtml(name)}... (Se não abrir, instale o cliente na aba Acesso Remoto)`, 'info', 4000);
    }

    async function launchScrcpyHost(deviceId, name) {
        createToast(`Iniciando Scrcpy no servidor para ${name || deviceId}...`, 'info', 2000);
        try {
            const res = await API.post(`/scrcpy/start/${encodeURIComponent(deviceId)}`);
            if (res.success) {
                createToast(`🖥️ Janela Scrcpy aberta no servidor (PID ${res.pid})!`, 'success');
            } else {
                createToast(res.error || 'Falha ao iniciar Scrcpy no servidor', 'error');
            }
        } catch (e) {
            createToast(e.message || 'Erro ao conectar ao Scrcpy no servidor', 'error');
        }
    }

    /**
     * Pastilha de status consistente .state (Design System Unificado v2)
     */
    function stateBadge(status, opts = {}) {
        const s = String(status ?? '').toLowerCase();
        let cls = 'unknown';
        let shape = '○';
        let label = (opts.label || s).toUpperCase() || 'DESCONHECIDO';
        if (s === 'online' || s === 'ok' || s === 'active') {
            cls = 'ok'; shape = '●'; if (!opts.label) label = 'ONLINE';
        } else if (s === 'offline' || s === 'error' || s === 'bad' || s === 'failed') {
            cls = 'bad'; shape = '✕'; if (!opts.label) label = 'OFFLINE';
        } else if (s === 'degraded' || s === 'warning' || s === 'warn') {
            cls = 'warn'; shape = '▲'; if (!opts.label) label = (s === 'degraded' ? 'DEGRADADO' : 'ATENÇÃO');
        }
        const ageHtml = opts.age ? ` <span class="age">${escapeHtml(opts.age)}</span>` : '';
        const reasonHtml = opts.reason ? ` title="${escapeHtml(opts.reason)}"` : '';
        return `<span class="state ${cls}"${reasonHtml}><span class="shape" aria-hidden="true">${shape}</span><span class="label">${escapeHtml(label)}</span>${ageHtml}</span>`;
    }

    /**
     * Toolbar canônico da página (Design System Unificado v2)
     * @param {Object} opts
     * @param {string} [opts.title] Título exibido na barra
     * @param {number|string} [opts.count] Contador opcional ao lado do título
     * @param {boolean|string|Object} [opts.search] Campo de busca compacto
     * @param {Array|string} [opts.filters] Chips de filtros rápidos [{ id, label, active, count }]
     * @param {Array|string} [opts.actions] Botões de ação [{ label, icon, primary, action, id, class, title, onclick }]
     * @returns {string} HTML estruturado
     */
    function pageToolbar({ title = '', count = null, search = null, filters = null, actions = null } = {}) {
        // Título e badge de contagem (.page-toolbar-title)
        let titleHtml = '';
        if (title) {
            const countHtml = (count !== null && count !== undefined && count !== '')
                ? ` <span class="page-toolbar-count badge">${escapeHtml(count)}</span>`
                : '';
            titleHtml = `<h2 class="page-toolbar-title">${escapeHtml(title)}${countHtml}</h2>`;
        }

        // Chips de filtros rápidos (.page-toolbar-filters)
        let filtersHtml = '';
        if (Array.isArray(filters) && filters.length > 0) {
            const chips = filters.map(f => {
                if (typeof f === 'string') return f;
                const fid = f.id ?? '';
                const flabel = f.label ?? fid;
                const activeCls = f.active ? ' active' : '';
                const cnt = (f.count !== null && f.count !== undefined)
                    ? ` <span class="chip-count">${escapeHtml(f.count)}</span>`
                    : '';
                return `<button type="button" class="filter-chip${activeCls}" data-filter="${escapeHtml(fid)}">${escapeHtml(flabel)}${cnt}</button>`;
            }).join('');
            filtersHtml = `<div class="page-toolbar-filters" role="group" aria-label="Filtros">${chips}</div>`;
        } else if (typeof filters === 'string' && filters.trim()) {
            filtersHtml = `<div class="page-toolbar-filters">${filters}</div>`;
        }

        // Campo de busca compacto (.page-toolbar-search)
        let searchHtml = '';
        if (search) {
            const sObj = (typeof search === 'object' && search !== null) ? search : {};
            const sId = sObj.id || 'toolbar-search';
            const sPlaceholder = sObj.placeholder || (typeof search === 'string' ? search : 'Buscar... [/]');
            const sValue = sObj.value ?? '';
            // Ícone de lupa ICONS.search
            const searchIconSvg = (typeof ICONS !== 'undefined' && ICONS.search)
                ? (typeof ICONS.search === 'function' ? ICONS.search() : ICONS.search)
                : icon('search', 16);
            searchHtml = `
                <div class="page-toolbar-search">
                    <span class="search-icon" aria-hidden="true">${searchIconSvg}</span>
                    <input type="text" id="${escapeHtml(sId)}" class="form-input search-input" placeholder="${escapeHtml(sPlaceholder)}" value="${escapeHtml(sValue)}" aria-label="${escapeHtml(sPlaceholder)}" autocomplete="off" />
                    <kbd class="search-kbd" title="Atalho: /">/</kbd>
                </div>
            `;
        }

        // Grupo de botões de ações primárias/secundárias (.page-toolbar-actions)
        let actionsHtml = '';
        if (Array.isArray(actions) && actions.length > 0) {
            const btns = actions.map(a => {
                if (typeof a === 'string') return a;
                const cls = a.class || (a.primary ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm');
                const iconSvg = a.icon ? `${icon(a.icon)} ` : '';
                const idAttr = a.id ? ` id="${escapeHtml(a.id)}"` : '';
                const actionAttr = a.action ? ` data-action="${escapeHtml(a.action)}"` : '';
                const titleAttr = a.title ? ` title="${escapeHtml(a.title)}"` : '';
                const onclickAttr = a.onclick ? ` onclick="${escapeHtml(a.onclick)}"` : '';
                const ariaLabel = a.ariaLabel || a.title || (!a.label && a.action ? a.action : '');
                const ariaAttr = ariaLabel ? ` aria-label="${escapeHtml(ariaLabel)}"` : '';
                return `<button type="button" class="${escapeHtml(cls)}"${idAttr}${actionAttr}${titleAttr}${ariaAttr}${onclickAttr}>${iconSvg}${escapeHtml(a.label || '')}</button>`;
            }).join('');
            actionsHtml = `<div class="page-toolbar-actions">${btns}</div>`;
        } else if (typeof actions === 'string' && actions.trim()) {
            actionsHtml = `<div class="page-toolbar-actions">${actions}</div>`;
        }

        const leftParts = [];
        if (titleHtml) leftParts.push(titleHtml);
        if (filtersHtml) leftParts.push(filtersHtml);

        const rightParts = [];
        if (searchHtml) rightParts.push(searchHtml);
        if (actionsHtml) rightParts.push(actionsHtml);

        return `<div class="page-toolbar">` +
            `<div class="page-toolbar-left">${leftParts.join('')}</div>` +
            `<div class="page-toolbar-right">${rightParts.join('')}</div>` +
        `</div>`;
    }

    /**
     * Tabela densa NOC-style (Design System Unificado v2)
     * @param {Object} opts
     * @param {string} [opts.id] ID opcional para o elemento <table>
     * @param {Array} opts.columns Definições de colunas [{ key, label, sortable, align, width, class, render }]
     * @param {Array} opts.rows Dados das linhas [{ id, ... }]
     * @param {boolean} [opts.expandable] Se verdadeiro, adiciona coluna de expansão e linha de detalhe
     * @param {boolean} [opts.selectable] Se verdadeiro, adiciona checkbox de seleção
     * @param {string} [opts.emptyMessage] Mensagem quando não houver linhas
     * @returns {string} HTML estruturado
     */
    function dataTable({ id = '', columns = [], rows = [], expandable = false, selectable = false, emptyMessage = 'Nenhum registro encontrado' } = {}) {
        if (!rows || rows.length === 0) {
            return stateView('empty', emptyMessage);
        }

        const normCols = (columns || []).map(c => {
            if (typeof c === 'string') return { key: c.toLowerCase(), label: c };
            return c;
        });

        let totalCols = normCols.length;
        if (selectable) totalCols++;
        if (expandable) totalCols++;

        // Header thead
        let theadHtml = '<thead><tr>';
        if (selectable) {
            theadHtml += `<th class="col-select"><input type="checkbox" class="data-table-select-all" aria-label="Selecionar todos" data-role="select-all" onchange="UI.toggleSelectAll(this)"></th>`;
        }
        if (expandable) {
            theadHtml += `<th class="col-expand" aria-label="Expandir"></th>`;
        }

        normCols.forEach(col => {
            const isActions = col.key === 'actions' || col.actions;
            const alignStyle = col.align ? `text-align:${col.align};` : (isActions ? 'text-align:right;' : '');
            const widthStyle = col.width ? `width:${col.width};` : '';
            const styleAttr = (alignStyle || widthStyle) ? ` style="${alignStyle}${widthStyle}"` : '';
            const sortClass = col.sortable ? 'sortable' : '';
            const actionClass = isActions ? 'col-actions' : '';
            const thClasses = [sortClass, actionClass, col.class || ''].filter(Boolean).join(' ');
            const classAttr = thClasses ? ` class="${thClasses}"` : '';
            const sortAttr = col.sortable ? ` data-sort="${escapeHtml(col.key)}"` : '';
            const sortIconHtml = col.sortable ? ` <span class="sort-icon" aria-hidden="true">${icon('chevron-down', 12)}</span>` : '';
            theadHtml += `<th${classAttr}${sortAttr}${styleAttr}>${escapeHtml(col.label || col.key)}${sortIconHtml}</th>`;
        });
        theadHtml += '</tr></thead>';

        // Body tbody
        let tbodyHtml = '<tbody>';
        rows.forEach((row, rowIndex) => {
            const rowId = row.id ?? row.deviceId ?? `row-${rowIndex}`;
            const rowClass = `data-row stagger-item${row.class ? ` ${row.class}` : ''}`;
            
            tbodyHtml += `<tr class="${rowClass}" id="data-row-${escapeHtml(rowId)}" data-id="${escapeHtml(rowId)}">`;

            if (selectable) {
                tbodyHtml += `<td class="col-select"><input type="checkbox" class="data-table-select-row" aria-label="Selecionar linha" data-id="${escapeHtml(rowId)}" value="${escapeHtml(rowId)}"></td>`;
            }

            if (expandable) {
                tbodyHtml += `<td class="col-expand"><button type="button" class="btn-icon-sm data-row-expand-btn" data-action="expand" data-id="${escapeHtml(rowId)}" aria-label="Expandir detalhes" aria-expanded="false" onclick="UI.toggleRowDetail('${escAttr(rowId)}')">${icon('chevron-right', 14)}</button></td>`;
            }

            normCols.forEach(col => {
                const isActions = col.key === 'actions' || col.actions;
                const cellVal = row[col.key];
                const alignStyle = col.align ? `text-align:${col.align};` : (isActions ? 'text-align:right;' : '');
                const styleAttr = alignStyle ? ` style="${alignStyle}"` : '';
                const tdClasses = [isActions ? 'col-actions' : '', col.class || ''].filter(Boolean).join(' ');
                const classAttr = tdClasses ? ` class="${tdClasses}"` : '';

                let cellContent = '';
                if (typeof col.render === 'function') {
                    cellContent = col.render(cellVal, row, rowIndex);
                } else if (col.key === 'status' || col.key === 'state') {
                    const st = (typeof cellVal === 'object' && cellVal?.status) ? cellVal.status : cellVal;
                    cellContent = stateBadge(st);
                } else if (cellVal === null || cellVal === undefined || cellVal === '') {
                    cellContent = '<span class="text-muted">—</span>';
                } else {
                    cellContent = escapeHtml(cellVal);
                }

                tbodyHtml += `<td${classAttr}${styleAttr}>${cellContent}</td>`;
            });

            tbodyHtml += '</tr>';

            // Linha de detalhe se expandable
            if (expandable) {
                let detailContent = '';
                if (typeof row.detail === 'function') {
                    detailContent = row.detail(row, rowIndex);
                } else if (typeof row.detail === 'string') {
                    detailContent = row.detail;
                }
                tbodyHtml += `
                    <tr class="data-row-detail-tr" data-detail-for="${escapeHtml(rowId)}">
                        <td colspan="${totalCols}" class="data-row-detail-cell">
                            <div class="data-row-detail" id="detail-${escapeHtml(rowId)}">
                                ${detailContent}
                            </div>
                        </td>
                    </tr>
                `;
            }
        });
        tbodyHtml += '</tbody>';

        const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
        return `<div class="data-table-wrapper"><table class="data-table table-dense"${idAttr}>${theadHtml}${tbodyHtml}</table></div>`;
    }

    function toggleRowDetail(rowId) {
        const detail = document.getElementById(`detail-${rowId}`);
        const btn = document.querySelector(`[data-action="expand"][data-id="${window.CSS && CSS.escape ? CSS.escape(rowId) : rowId}"]`);
        const tr = detail ? detail.closest('.data-row-detail-tr') : null;
        if (!detail) return;
        const isOpen = detail.classList.contains('open');
        if (isOpen) {
            detail.classList.remove('open');
            if (tr) tr.classList.remove('open');
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.classList.remove('expanded');
            }
        } else {
            detail.classList.add('open');
            if (tr) tr.classList.add('open');
            if (btn) {
                btn.setAttribute('aria-expanded', 'true');
                btn.classList.add('expanded');
            }
        }
    }

    function toggleSelectAll(masterCheckbox) {
        if (!masterCheckbox) return;
        const table = masterCheckbox.closest('table');
        if (!table) return;
        const checkboxes = table.querySelectorAll('tbody input.data-table-select-row');
        checkboxes.forEach(cb => { cb.checked = masterCheckbox.checked; });
    }

    function getSelectedRows(tableIdOrEl) {
        const root = (typeof tableIdOrEl === 'string') ? document.getElementById(tableIdOrEl) : tableIdOrEl;
        if (!root) return [];
        const checked = root.querySelectorAll('tbody input.data-table-select-row:checked');
        return Array.from(checked).map(cb => cb.value || cb.dataset.id);
    }

    /**
     * Helper global para alternar o estado de carregamento de um botão.
     * Adiciona/remove a classe .is-loading, desabilita/habilita o botão e preserva o conteúdo original.
     * @param {HTMLElement|string} btnOrId - Elemento do botão ou seu ID / seletor
     * @param {boolean} isLoading - Se deve ativar o estado de loading
     * @param {string|null} [originalText=null] - Texto/HTML original opcional
     * @returns {HTMLElement|null} O botão manipulado
     */
    function btnLoading(btnOrId, isLoading, originalText = null) {
        const btn = (typeof btnOrId === 'string')
            ? (document.getElementById(btnOrId) || document.querySelector(btnOrId))
            : btnOrId;
        if (!btn) return null;

        if (isLoading) {
            if (originalText !== null && originalText !== undefined) {
                btn.dataset.originalText = String(originalText);
            }
            if (btn.dataset.originalHtml === undefined) {
                btn.dataset.originalHtml = btn.innerHTML;
            }
            btn.classList.add('is-loading');
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
        } else {
            btn.classList.remove('is-loading');
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            if (originalText !== null && originalText !== undefined) {
                btn.innerHTML = originalText;
                delete btn.dataset.originalHtml;
                delete btn.dataset.originalText;
            } else if (btn.dataset.originalText !== undefined) {
                btn.innerHTML = btn.dataset.originalText;
                delete btn.dataset.originalText;
                delete btn.dataset.originalHtml;
            } else if (btn.dataset.originalHtml !== undefined) {
                btn.innerHTML = btn.dataset.originalHtml;
                delete btn.dataset.originalHtml;
            }
        }
        return btn;
    }

    return {
        createStatCard, createCard, createToast, showModal, hideModal,
        createBadge, statusClass, statusIcon, setPageTitle,
        escapeHtml, escJs, escAttr, icon, skeletons, timeAgo,
        stateView, bindStateRetry, toolbarCounters, groupChip,
        statusBar, confirmStopScrcpy, launchScrcpy, launchScrcpyHost,
        pageToolbar, dataTable, stateBadge, toggleRowDetail, toggleSelectAll, getSelectedRows,
        btnLoading
    };
})();

