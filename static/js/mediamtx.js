/**
 * MediaMTX Page — mostra paths, readers, publisher, bitrate e gerencia Host Streaming de Janelas (Office/PowerPoint).
 */
const MEDIAMTX = (() => {
    let refreshTimer = null;

    async function render(el) {
        UI.setPageTitle('MediaMTX & Streaming');

        el.innerHTML = `
            <div class="section-title">${UI.icon('server')} Status do MediaMTX</div>
            <div class="mediamtx-health" id="mtx-health">
                <div class="loading">Verificando...</div>
            </div>

            <div class="section-title mt-md" style="display:flex;align-items:center;justify-content:space-between">
                <div>${UI.icon('monitor')} Transmissão de Janelas Windows (Office / PowerPoint)</div>
                <button class="btn btn-sm btn-primary" onclick="MEDIAMTX.openStartHostStreamModal()">+ Transmitir Janela</button>
            </div>
            <div id="host-streams-container">
                <div class="loading">Carregando transmissões...</div>
            </div>

            <div class="section-title mt-md">${UI.icon('layers')} Paths do MediaMTX <span class="section-subtitle" id="mtx-count"></span></div>
            <div class="mediamtx-paths" id="mtx-paths">
                ${UI.skeletons('row', 4)}
            </div>
        `;

        await loadHealth();
        await loadHostStreams();
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

    async function loadHostStreams() {
        const el = document.getElementById('host-streams-container');
        if (!el) return;

        try {
            const res = await API.get('/host-stream/streams');
            const streams = res.streams || [];

            if (streams.length === 0) {
                el.innerHTML = `
                    <div class="empty-state" style="padding:var(--space-4);background:var(--bg-surface);border:1px dashed var(--border-subtle);border-radius:var(--radius-md);text-align:center">
                        <span class="text-muted text-sm">Nenhuma janela sendo transmitida no momento.</span>
                        <div style="margin-top:var(--space-2)">
                            <button class="btn btn-sm btn-secondary" onclick="MEDIAMTX.openStartHostStreamModal()">Iniciar transmissão do PowerPoint ou Janela</button>
                        </div>
                    </div>`;
                return;
            }

            let html = '<div class="host-streams-grid">';
            streams.forEach(s => {
                const profileBadge = s.profile === 'fixed'
                    ? '<span class="badge badge-info" style="font-size:0.75em">📌 Slide Fixo do Mês (2 fps)</span>'
                    : '<span class="badge badge-success" style="font-size:0.75em">🔄 Loop Contínuo (30 fps)</span>';

                html += `
                    <div class="host-stream-card">
                        <div class="host-stream-header">
                            <span class="host-stream-title" title="${UI.escAttr(s.window_title)}">${UI.escapeHtml(s.window_title)}</span>
                            ${profileBadge}
                        </div>
                        <div class="host-stream-meta">
                            <span>ID: <code>${UI.escapeHtml(s.stream_id)}</code></span>
                            <span>${s.fps} FPS</span>
                        </div>
                        <div class="host-stream-url">
                            RTSP: <strong>rtsp://${location.hostname}:8554/${UI.escapeHtml(s.rtsp_path)}</strong>
                        </div>
                        <div style="margin-top:auto;display:flex;justify-content:flex-end">
                            <button class="btn btn-sm btn-danger" onclick="MEDIAMTX.stopHostStream('${UI.escAttr(s.stream_id)}')">Parar Transmissão</button>
                        </div>
                    </div>`;
            });
            html += '</div>';
            el.innerHTML = html;
        } catch (e) {
            el.innerHTML = `<div class="text-danger text-sm">Erro ao carregar host streams: ${UI.escapeHtml(e.message)}</div>`;
        }
    }

    async function openStartHostStreamModal() {
        UI.createToast('Buscando janelas abertas no Windows...', 'info', 2000);
        try {
            const [winRes, devRes] = await Promise.all([
                API.get('/host-stream/windows'),
                API.get('/devices'),
            ]);

            const windows = winRes.windows || [];
            const devices = Array.isArray(devRes) ? devRes : [];

            let winOptions = '<option value="desktop">🖥️ Área de Trabalho Completa (Desktop)</option>';
            windows.forEach(w => {
                const prefix = w.app === 'powerpoint' ? '📊 [PowerPoint] ' : (w.app === 'excel' ? '📈 [Excel] ' : '🪟 ');
                winOptions += `<option value="${UI.escAttr(w.title)}">${prefix}${UI.escapeHtml(w.title)}</option>`;
            });

            let devCheckboxes = '';
            if (devices.length > 0) {
                devCheckboxes = `<div class="form-group mt-sm"><label class="form-label text-sm">Reproduzir automaticamente nos TV Boxes:</label><div style="max-height:120px;overflow-y:auto;background:var(--bg-deep);padding:6px;border-radius:var(--radius-xs)">`;
                devices.forEach(d => {
                    devCheckboxes += `
                        <label style="display:flex;align-items:center;gap:6px;font-size:0.85em;padding:2px 0">
                            <input type="checkbox" name="host_stream_dev" value="${UI.escAttr(d.id)}">
                            <span>${UI.escapeHtml(d.name || d.id)} (${UI.escapeHtml(d.ip)})</span>
                        </label>`;
                });
                devCheckboxes += `</div></div>`;
            }

            const modalHtml = `
                <div class="form-group">
                    <label class="form-label" for="hs-window">Janela a Transmitir:</label>
                    <select id="hs-window" class="form-control" onchange="
                        const v = this.value.toLowerCase();
                        const idInp = document.getElementById('hs-id');
                        if (v.includes('powerpoint')) {
                            idInp.value = v.includes('mes') || v.includes('outubro') ? 'ppt-mes' : 'ppt-loop';
                        }
                    ">
                        ${winOptions}
                    </select>
                </div>
                <div class="form-group mt-sm">
                    <label class="form-label" for="hs-id">Identificador do Stream (ID na rota RTSP):</label>
                    <input type="text" id="hs-id" class="form-control" value="ppt-loop" placeholder="ex: ppt-loop ou ppt-mes">
                    <span class="text-xs text-muted">Será transmitido em rtsp://&lt;servidor&gt;:8554/live/&lt;ID&gt;</span>
                </div>
                <div class="form-group mt-sm">
                    <label class="form-label">Perfil de Transmissão:</label>
                    <div style="display:flex;flex-direction:column;gap:6px;font-size:0.85em">
                        <label style="display:flex;align-items:center;gap:8px">
                            <input type="radio" name="hs_profile" value="loop" checked>
                            <span><strong>🔄 Loop Contínuo (30 fps)</strong> — Para apresentações com slides em rotação contínua</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px">
                            <input type="radio" name="hs_profile" value="fixed">
                            <span><strong>📌 Slide Fixo do Mês (2 fps)</strong> — Ultra-econômico (baixo consumo de CPU), para metas ou aviso estático</span>
                        </label>
                    </div>
                </div>
                ${devCheckboxes}
            `;

            UI.showModal('Transmitir Janela para as TVs', modalHtml, async () => {
                const windowTitle = document.getElementById('hs-window').value;
                const streamId = document.getElementById('hs-id').value.trim() || 'stream-janela';
                const profile = document.querySelector('input[name="hs_profile"]:checked')?.value || 'loop';

                const targetDevs = Array.from(document.querySelectorAll('input[name="host_stream_dev"]:checked')).map(cb => cb.value);

                try {
                    UI.createToast('Iniciando stream da janela...', 'info', 3000);
                    const res = await API.post('/host-stream/start', {
                        stream_id: streamId,
                        window_title: windowTitle,
                        profile: profile,
                        target_device_ids: targetDevs,
                    });

                    if (res.success) {
                        UI.createToast(`✅ Transmissão '${streamId}' iniciada com sucesso!`, 'success');
                        await loadHostStreams();
                        await loadPaths();
                    }
                } catch (err) {
                    UI.createToast(`❌ ${err.message}`, 'error', 5000);
                }
            });
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
    }

    async function stopHostStream(streamId) {
        try {
            await API.post('/host-stream/stop', { stream_id: streamId });
            UI.createToast(`Transmissão '${streamId}' encerrada`, 'info');
            await loadHostStreams();
            await loadPaths();
        } catch (e) {
            UI.createToast(`Erro ao encerrar: ${e.message}`, 'error');
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
                const count = document.getElementById('mtx-count');
                if (count) count.textContent = '0 paths';
                return;
            }

            const count = document.getElementById('mtx-count');
            if (count) count.textContent = `${items.length} path${items.length > 1 ? 's' : ''}`;

            let html = `
                <div class="mediamtx-list">
                    <div class="mediamtx-row" style="font-weight:600;font-size:0.75em;text-transform:uppercase;color:var(--text-muted)">
                        <span>Nome</span>
                        <span>Status</span>
                        <span>Publisher</span>
                        <span>Readers</span>
                        <span>Tracks</span>
                        <span>Tráfego</span>
                    </div>
            `;

            for (const item of items) {
                const name = item.name || '';
                const ready = item.ready || false;
                const tracks = item.tracks ? item.tracks.length : 0;
                const readers = item.readers ? item.readers.length : 0;
                const bytesRecv = formatBytes(item.bytesReceived || 0);
                const bytesSent = formatBytes(item.bytesSent || 0);

                let statusHtml = '';
                if (ready) {
                    statusHtml = '<span class="badge badge-success">Ativo</span>';
                } else {
                    statusHtml = '<span class="badge badge-muted">Aguardando</span>';
                }

                let publisher = '—';
                if (item.source) {
                    publisher = item.source.type || 'source';
                }

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
            loadHostStreams();
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

    return { render, destroy, openStartHostStreamModal, stopHostStream };
})();
