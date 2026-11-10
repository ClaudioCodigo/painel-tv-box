/**
 * Mural (NOC) — Grade de monitoramento visual ao vivo.
 * Atualiza miniaturas de todos os TV Boxes em tempo real e abre sessões scrcpy com duplo-clique.
 */
const MURAL = (() => {
    let refreshTimer = null;
    let devices = [];
    let groupNames = {};
    let selectedGroup = '';

    async function render(el) {
        UI.setPageTitle('Mural (NOC)');

        el.innerHTML = `
            <div class="mural-page">
                <button class="mural-fs-exit btn btn-sm" onclick="MURAL.toggleFullscreen()" title="Sair da tela cheia" aria-label="Sair da tela cheia">✕ Sair da tela cheia</button>
                <div class="panel">
                    <div class="toolbar">
                        <span class="panel-title">Mural em tempo real (NOC)</span>
                        <span class="hint text-muted text-sm">captura contínua · duplo-clique numa tela abre o scrcpy</span>
                        <span class="sp"></span>
                        <span class="field">
                            <select id="mural-group-select" aria-label="Filtrar área">
                                <option value="">Todas as áreas</option>
                            </select>
                        </span>
                        <button class="btn btn-sm" onclick="MURAL.refreshNow()">↻ Atualizar</button>
                        <button class="btn btn-sm" onclick="MURAL.openMosaic()">▣ Mosaico</button>
                        <button class="btn btn-sm btn-primary" onclick="MURAL.toggleFullscreen()">▦ Tela cheia</button>
                        <button class="btn btn-sm" onclick="window.location.hash='#/'">Lista</button>
                    </div>
                    <div class="mural" id="mural-grid">
                        <div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-muted)">Carregando telas...</div>
                    </div>
                </div>
            </div>
        `;

        document.addEventListener('fullscreenchange', onFullscreenChange);
        if (document.fullscreenElement) {
            document.body.classList.add('mural-fullscreen');
        }

        const groupSel = document.getElementById('mural-group-select');
        if (groupSel) {
            groupSel.addEventListener('change', () => {
                selectedGroup = groupSel.value;
                renderTiles();
            });
        }

        await loadData();
        startAutoRefresh();
    }

    async function loadData() {
        try {
            const [devs, grps] = await Promise.all([
                API.get('/devices'),
                API.get('/groups').catch(() => []),
            ]);
            devices = Array.isArray(devs) ? devs : [];
            (Array.isArray(grps) ? grps : []).forEach(g => { groupNames[g.id] = g.name || g.id; });

            const groupSel = document.getElementById('mural-group-select');
            if (groupSel) {
                const opts = ['<option value="">Todas as áreas</option>'].concat(
                    Object.keys(groupNames).map(id => `<option value="${UI.escAttr(id)}" ${selectedGroup === id ? 'selected' : ''}>${UI.escapeHtml(groupNames[id] || id)}</option>`)
                );
                groupSel.innerHTML = opts.join('');
            }

            renderTiles();
        } catch (e) {
            const grid = document.getElementById('mural-grid');
            if (grid) grid.innerHTML = `<div class="error-state">Erro: ${UI.escapeHtml(e.message)}</div>`;
        }
    }

    function normalizeStatus(status) {
        if (!status) return 'unknown';
        const s = String(status).toLowerCase();
        if (s === 'online') return 'ok';
        if (s === 'degraded' || s === 'warning') return 'warn';
        if (s === 'offline' || s === 'error') return 'bad';
        return 'unknown';
    }

    function renderTiles() {
        const grid = document.getElementById('mural-grid');
        if (!grid) return;

        let list = devices;
        if (selectedGroup) {
            list = list.filter(d => d.group === selectedGroup);
        }

        if (list.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-muted)">Nenhum TV Box nesta área.</div>';
            return;
        }

        const shapes = { ok: '●', warn: '◐', bad: '✕', unknown: '○' };
        const labels = { ok: 'NO AR', warn: 'ATENÇÃO', bad: 'FORA', unknown: 'NOVO' };

        grid.innerHTML = list.map(d => {
            const st = normalizeStatus(d.state?.status);
            const isOff = st === 'bad';
            const shape = shapes[st] || '○';
            const label = labels[st] || st.toUpperCase();
            const seen = d.last_seen || d.last_heartbeat;
            const age = seen ? UI.timeAgo(seen) : '—';
            const ip = d.ip || d.config?.ip || '';

            return `
                <div class="tile ${st === 'bad' ? 'bad' : ''} ${isOff ? 'off' : ''}" data-id="${UI.escAttr(d.id)}" ondblclick="MURAL.openDeviceScrcpy('${UI.escAttr(d.id)}')" title="Duplo-clique para abrir no Scrcpy">
                    <div class="tile-head">
                        <span class="tile-name">${UI.escapeHtml(d.name || d.id)}</span>
                        ${ip ? `<span class="tile-ip">${UI.escapeHtml(ip)}</span>` : ''}
                        <span class="sp"></span>
                        <span class="state ${st}" style="font-size:10px;padding:1px 7px">
                            <span class="shape" aria-hidden="true">${shape}</span>
                            <span>${label}</span>
                            <span class="age">${age}</span>
                        </span>
                    </div>
                    <div class="tile-screen">
                        <img alt="Tela ${UI.escapeHtml(d.name || d.id)}" loading="lazy" style="display:none"
                             onload="this.style.display='block'; if (this.nextElementSibling) this.nextElementSibling.style.display='none'"
                             onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='grid'">
                        <div class="fake" aria-hidden="true">
                            <div class="hdr"></div>
                            <div class="grid2"><i></i><i></i><i></i></div>
                        </div>
                        ${isOff ? `<div class="tile-msg"><b>sem sinal</b></div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        refreshScreenshots(true);
    }

    async function updateTileBlob(img, id, now) {
        try {
            const blobUrl = await API.fetchBlobUrl(`/devices/${encodeURIComponent(id)}/screenshot?_t=${now}`);
            if (img._blobUrl) { URL.revokeObjectURL(img._blobUrl); }
            img._blobUrl = blobUrl;
            img.src = blobUrl;
            img.style.display = 'block';
            if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
        } catch (e) {
            img.style.display = 'none';
            if (img.nextElementSibling) img.nextElementSibling.style.display = 'grid';
        }
    }

    function refreshScreenshots(force = false) {
        const grid = document.getElementById('mural-grid');
        if (!grid) return;
        const now = Date.now();
        grid.querySelectorAll('.tile').forEach(tile => {
            const id = tile.dataset.id;
            const img = tile.querySelector('img');
            if (!id || !img) return;
            // Atualiza dispositivos que não estão marcados como sem sinal, ou todos se force
            if (force || !tile.classList.contains('bad')) {
                updateTileBlob(img, id, now);
            }
        });
    }

    function refreshNow() {
        refreshScreenshots(true);
        if (typeof UI !== 'undefined' && UI.createToast) {
            UI.createToast('Atualizando capturas das telas...', 'info');
        }
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => refreshScreenshots(false), 5000);
    }

    function onFullscreenChange() {
        const isFs = !!document.fullscreenElement;
        const page = document.querySelector('.mural-page');
        if (isFs && page) {
            document.body.classList.add('mural-fullscreen');
        } else {
            document.body.classList.remove('mural-fullscreen');
        }
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
        document.body.classList.remove('mural-fullscreen');
        document.querySelectorAll('#mural-grid .tile img').forEach(img => {
            if (img._blobUrl) { URL.revokeObjectURL(img._blobUrl); img._blobUrl = null; }
        });
    }

    function openDeviceScrcpy(deviceId) {
        const dev = devices.find(d => d.id === deviceId);
        if (dev) UI.launchScrcpy(dev);
        else UI.launchScrcpy({ id: deviceId, ip: deviceId });
    }

    function openMosaic() {
        const active = devices.filter(d => normalizeStatus(d.state?.status) === 'ok' && d.ip).slice(0, 4);
        if (active.length === 0) {
            UI.createToast('Nenhum dispositivo online para abrir mosaico', 'warning');
            return;
        }
        UI.createToast(`Abrindo mosaico com ${active.length} TV Box(es)...`, 'info');
        active.forEach(d => UI.launchScrcpy(d));
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                document.body.classList.add('mural-fullscreen');
            }).catch(() => {});
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    document.body.classList.remove('mural-fullscreen');
                }).catch(() => {
                    document.body.classList.remove('mural-fullscreen');
                });
            } else {
                document.body.classList.remove('mural-fullscreen');
            }
        }
    }

    return { render, destroy, openDeviceScrcpy, openMosaic, toggleFullscreen, refreshNow };
})();
