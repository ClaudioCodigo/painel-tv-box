/**
 * MediaMTX Page — mostra paths, readers, publisher, bitrate.
 */
const MEDIAMTX = (() => {
    let refreshTimer = null;

    async function render(el) {
        UI.setPageTitle('MediaMTX');

        el.innerHTML = `
            <div class="section-title">${UI.icon('server')} Status do MediaMTX</div>
            <div class="mediamtx-health" id="mtx-health">
                <div class="loading">Verificando...</div>
            </div>

            <div class="section-title mt-md">${UI.icon('layers')} Paths</div>
            <div class="mediamtx-paths" id="mtx-paths">
                ${UI.skeletons('row', 4)}
            </div>
        `;

        await loadHealth();
        await loadPaths();
        startAutoRefresh();
    }

    async function loadHealth() {
        try {
            const h = await API.get('/mediamtx/health');
            const el = document.getElementById('mtx-health');
            if (!el) return;

            if (h.alive) {
                el.innerHTML = `<span class="dcard-status-shape online" aria-hidden="true"></span><span class="text-sm">Online</span><span class="text-muted text-sm" style="margin-left:8px">api 9997 · rtsp 8554</span>`;
            } else {
                el.innerHTML = `<span class="dcard-status-shape offline" aria-hidden="true"></span><span class="text-sm">Offline</span><span class="text-muted text-sm" style="margin-left:8px">${UI.escapeHtml(h.error || '')}</span>`;
            }
        } catch (e) {
            const el = document.getElementById('mtx-health');
            if (el) el.innerHTML = `<span class="dcard-status-shape offline" aria-hidden="true"></span><span class="text-sm">Erro</span><span class="text-muted text-sm" style="margin-left:8px">${UI.escapeHtml(e.message)}</span>`;
        }
    }

    async function loadPaths() {
        try {
            const res = await API.get('/mediamtx/paths');
            const el = document.getElementById('mtx-paths');
            if (!el) return;

            if (!res.success) {
                el.innerHTML = UI.stateView('error', res.error, { retry: true });
                UI.bindStateRetry(el, loadPaths);
                return;
            }

            const items = res.data?.items || [];
            if (items.length === 0) {
                el.innerHTML = UI.stateView('empty', 'Nenhuma path configurada no MediaMTX.', { icon: 'layers', title: 'Sem paths' });
                return;
            }

            let html = '<div class="mediamtx-table">';
            html += `
                <div class="mediamtx-row mediamtx-header">
                    <span>Path</span>
                    <span>Status</span>
                    <span>Publisher</span>
                    <span>Readers</span>
                    <span>Tracks</span>
                    <span>Bytes</span>
                </div>
            `;

            for (const path of items) {
                const name = path.name || '--';
                const ready = !!path.ready;
                const statusHtml = `<span class="dcard-status-shape ${ready ? 'online' : 'offline'}" aria-hidden="true"></span>${ready ? ' Online' : ' Offline'}`;
                const publisher = path.sourceType || path.source || 'Nenhum';
                const readers = path.readers?.length || 0;
                const tracks = path.tracks?.length || 0;
                const bytesRecv = formatBytes(path.bytesReceived || 0);
                const bytesSent = formatBytes(path.bytesSent || 0);

                html += `
                    <div class="mediamtx-row">
                        <span class="path-name">${UI.escapeHtml(name)}</span>
                        <span class="${ready ? 'text-success' : 'text-danger'}">${statusHtml}</span>
                        <span>${UI.escapeHtml(publisher)}</span>
                        <span>${readers}</span>
                        <span>${tracks}</span>
                        <span class="text-muted text-sm">${bytesRecv} / ${bytesSent}</span>
                    </div>
                `;
            }

            html += '</div>';
            el.innerHTML = html;
        } catch (e) {
            const el = document.getElementById('mtx-paths');
            if (el) el.innerHTML = UI.stateView('error', e.message, { retry: true });
            UI.bindStateRetry(el, loadPaths);
        }
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
            loadHealth();
            loadPaths();
        }, 10000);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    function formatBytes(num) {
        if (!num || num === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (num >= 1024 && i < units.length - 1) {
            num /= 1024;
            i++;
        }
        return num.toFixed(1) + ' ' + units[i];
    }

    return { render, destroy };
})();
