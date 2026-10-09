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
            const isOff = st === 'bad' || st === 'unknown';
            const screenshotUrl = API.authUrl(`/devices/${encodeURIComponent(d.id)}/screenshot`);
            const shape = shapes[st] || '○';
            const label = labels[st] || st.toUpperCase();
            const seen = d.last_seen || d.last_heartbeat;
            const age = seen ? UI.timeAgo(seen) : '—';

            return `
                <div class="tile ${st === 'bad' ? 'bad' : ''} ${isOff ? 'off' : ''}" data-id="${UI.escAttr(d.id)}" ondblclick="MURAL.openDeviceScrcpy('${UI.escAttr(d.id)}')" title="Duplo-clique para abrir no Scrcpy">
                    <div class="tile-head">
                        <span class="tile-name">${UI.escapeHtml(d.name || d.id)}</span>
                        <span class="sp"></span>
                        <span class="state ${st}" style="font-size:10px;padding:1px 7px">
                            <span class="shape" aria-hidden="true">${shape}</span>
                            <span>${label}</span>
                            <span class="age">${age}</span>
                        </span>
                    </div>
                    <div class="tile-screen">
                        <img src="${screenshotUrl}" alt="Tela ${UI.escapeHtml(d.name || d.id)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'">
                        <div class="fake" style="display:none" aria-hidden="true">
                            <div class="hdr"></div>
                            <div class="grid2"><i></i><i></i><i></i></div>
                        </div>
                        ${isOff ? `<div class="tile-msg"><b>${st === 'bad' ? 'sem sinal' : 'aguardando'}</b></div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function refreshScreenshots() {
        const grid = document.getElementById('mural-grid');
        if (!grid) return;
        const now = Date.now();
        grid.querySelectorAll('.tile img').forEach(img => {
            const tile = img.closest('.tile');
            if (tile && !tile.classList.contains('off')) {
                const id = tile.dataset.id;
                if (id) {
                    img.src = `${API.authUrl('/devices/' + encodeURIComponent(id) + '/screenshot')}&_t=${now}`;
                }
            }
        });
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshScreenshots, 5000);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
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
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        }
    }

    return { render, destroy, openDeviceScrcpy, openMosaic, toggleFullscreen };
})();
