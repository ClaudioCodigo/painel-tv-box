/**
 * Componentes reutilizáveis:
 *   createStatCard(label, value, colorClass)
 *   createCard(title, subtitle, status, actions)
 *   createToast(msg, type)
 *   showModal(title, bodyHtml, onConfirm, onCancel)
 *   createBadge(text, color)
 */
const UI = (() => {

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

    function createToast(msg, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || '';

        toast.innerHTML = `
            <span>${icon}</span>
            <span class="toast-msg">${msg}</span>
            <button class="toast-close">&times;</button>
        `;

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });

        container.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }
    }

    function showModal(title, bodyHtml, onConfirm, onCancel) {
        const container = document.getElementById('modal-container');
        const content = document.getElementById('modal-content');

        content.innerHTML = `
            <div class="modal-header">
                <h3>${title}</h3>
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
        switch (status) {
            case 'online': return '🟢';
            case 'offline': return '🔴';
            case 'degraded': return '🟡';
            case 'warning': return '🟠';
            default: return '⚪';
        }
    }

    function setPageTitle(title) {
        const el = document.getElementById('page-title');
        if (el) el.textContent = title;
        document.title = `${title} — Painel TV Box`;
    }

    return { createStatCard, createCard, createToast, showModal, hideModal, createBadge, statusClass, statusIcon, setPageTitle };
})();
