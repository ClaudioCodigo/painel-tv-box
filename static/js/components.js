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
        if (type === 'row') {
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

    function createToast(msg, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconName = { success: 'check', error: 'x', warning: 'alert', info: 'help' }[type] || 'help';
        // Remove emoji(s) iniciais da mensagem — o ícone stroke já comunica o tipo
        const cleanMsg = String(msg).replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]+\s*/u, '');

        toast.innerHTML = `
            <span class="toast-icon">${icon(iconName)}</span>
            <span class="toast-msg">${escapeHtml(cleanMsg)}</span>
            <button class="toast-close" aria-label="Fechar">&times;</button>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.classList.add('toast-leave');
            setTimeout(() => toast.remove(), 180);
        });

        container.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                toast.classList.add('toast-leave');
                setTimeout(() => toast.remove(), 180);
            }, duration);
        }
    }

    function showModal(title, bodyHtml, onConfirm, onCancel) {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');

        content.innerHTML = `
            <div class="modal-header">
                <h3>${escapeHtml(title)}</h3>
                <button class="modal-close" id="modal-close-btn">&times;</button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="modal-cancel-btn">Cancelar</button>
                <button class="btn btn-primary" id="modal-confirm-btn">Confirmar</button>
            </div>
        `;

        container.classList.remove('hidden');

        const close = () => {
            container.classList.add('hidden');
            if (onCancel) onCancel();
        };

        document.getElementById('modal-close-btn').addEventListener('click', close);
        document.getElementById('modal-cancel-btn').addEventListener('click', close);
        document.getElementById('modal-confirm-btn').addEventListener('click', () => {
            if (onConfirm) onConfirm();
            container.classList.add('hidden');
        });

        container.querySelector('.modal-overlay').addEventListener('click', close);
    }

    function hideModal() {
        document.getElementById('modal-container').classList.add('hidden');
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

    return { createStatCard, createCard, createToast, showModal, hideModal, createBadge, statusClass, statusIcon, setPageTitle, escapeHtml, escJs, escAttr, icon, skeletons, timeAgo, stateView, bindStateRetry, toolbarCounters, groupChip, statusBar };
})();
