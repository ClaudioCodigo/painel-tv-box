/**
 * Device Page — detalhe e controle de um TV Box (Fase B, tabs).
 *   Visão geral | Stream | Apps | Shell | Screenshots
 */
const DEVICE_PAGE = (() => {
    let deviceId = null;
    let refreshTimer = null;
    let currentTab = 'visao';
    const loadedTabs = new Set();
    let groupName = '';

    function latestSeen(d) {
        if (!d || (!d.last_seen && !d.last_heartbeat)) return null;
        const a = d.last_seen ? new Date(d.last_seen).getTime() : 0;
        const b = d.last_heartbeat ? new Date(d.last_heartbeat).getTime() : 0;
        return new Date(Math.max(a, b)).toISOString();
    }

    function freshness(d) {
        const seen = latestSeen(d);
        return seen ? `visto há ${UI.timeAgo(seen)}` : 'nunca visto';
    }

    async function render(el, id) {
        deviceId = id;
        currentTab = 'visao';
        loadedTabs.clear();
        UI.setPageTitle('Dispositivo');

        el.innerHTML = `<div class="device-detail">${UI.skeletons('line', 5)}</div>`;

        try {
            const device = await API.get(`/devices/${deviceId}`);
            groupName = device.group || '';
            if (groupName) {
                const groups = await API.get('/groups').catch(() => []);
                const g = (Array.isArray(groups) ? groups : []).find(x => x.id === groupName);
                if (g) groupName = g.name || g.id;
            }
            renderShell(el, device);
            await switchTab(currentTab);
            refreshStatus();
            startAutoRefresh();
        } catch (e) {
            el.innerHTML = `<div class="device-detail">${UI.stateView('error', e.message, { retry: true })}</div>`;
            UI.bindStateRetry(el, () => render(el, deviceId));
        }
    }

    function renderShell(el, device) {
        const status = device.state?.status || 'unknown';
        const reason = device.state?.reason || '';
        const icon = UI.statusIcon(status); const sClass = UI.statusClass(status);
        const chip = device.group ? UI.groupChip(groupName || device.group, device.group) : '';

        el.innerHTML = `
            <div class="device-detail">
                <div class="card dcard-header" style="padding:var(--space-4)">
                    <div class="card-title">${icon} ${UI.escapeHtml(device.name || device.id)}</div>
                    <div class="dcard-header-right">${chip}</div>
                </div>
                <div class="dcard-status ${sClass}" id="device-header-status">
                    ${UI.statusBar(status, reason)}
                </div>
                <div class="dcard-life">
                    <span id="device-fresh">${freshness(device.state)}</span>
                </div>

                <div class="device-actions" style="margin-top:var(--space-4)">
                    <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.action('start-stream')">${UI.icon('play')} Start</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.action('stop-stream')">${UI.icon('stop')} Stop</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.action('reboot')">${UI.icon('reboot')} Reboot</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.refreshStatus()">${UI.icon('refresh')} Atualizar</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.provisionScripts()">${UI.icon('upload')} Scripts</button>
                    <button class="btn btn-danger btn-sm" onclick="DEVICE_PAGE.deleteDevice()">${UI.icon('trash')} Remover</button>
                </div>

                <div class="device-tabs" role="tablist" aria-label="Seções do dispositivo">
                    <button class="tab-pill active" data-tab="visao" role="tab" aria-selected="true" onclick="DEVICE_PAGE.switchTab('visao')">Visão geral</button>
                    <button class="tab-pill" data-tab="stream" role="tab" aria-selected="false" onclick="DEVICE_PAGE.switchTab('stream')">Stream</button>
                    <button class="tab-pill" data-tab="apps" role="tab" aria-selected="false" onclick="DEVICE_PAGE.switchTab('apps')">Apps</button>
                    <button class="tab-pill" data-tab="shell" role="tab" aria-selected="false" onclick="DEVICE_PAGE.switchTab('shell')">Shell</button>
                    <button class="tab-pill" data-tab="screenshots" role="tab" aria-selected="false" onclick="DEVICE_PAGE.switchTab('screenshots')">Screenshots</button>
                </div>
                <div class="device-tab-content" id="device-tab-content">
                    ${UI.skeletons('line', 4)}
                </div>
            </div>
        `;
    }

    async function switchTab(name) {
        currentTab = name;
        document.querySelectorAll('.device-tabs .tab-pill').forEach(b => {
            const active = b.dataset.tab === name;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        const container = document.getElementById('device-tab-content');
        if (!container) return;

        if (!loadedTabs.has(name)) {
            container.innerHTML = UI.skeletons('line', 4);
            try {
                const device = await API.get(`/devices/${deviceId}`);
                if (name === 'visao') renderVisao(container, device);
                else if (name === 'stream') renderStream(container, device);
                else if (name === 'apps') renderApps(container, device);
                else if (name === 'shell') renderShellTab(container);
                else if (name === 'screenshots') renderScreenshots(container);
                loadedTabs.add(name);
            } catch (e) {
                container.innerHTML = UI.stateView('error', e.message, { retry: true });
                UI.bindStateRetry(container, () => switchTab(name));
            }
        } else {
            // Recarrega dados frescos nas abas que dependem de state
            try {
                const device = await API.get(`/devices/${deviceId}`);
                if (name === 'visao') renderVisao(container, device);
                else if (name === 'stream') renderStream(container, device);
                else if (name === 'apps') await loadApps();
                else if (name === 'screenshots') renderScreenshots(container);
            } catch (e) { /* mantém conteúdo anterior */ }
        }
    }

    // ── Tabs ────────────────────────────────────

    function renderVisao(container, device) {
        const st = device.state || {};
        container.innerHTML = `
            <div class="device-grid">
                <div class="device-info-card">
                    <h3>${UI.icon('layers')} Rede</h3>
                    <div class="info-row"><span class="info-key">IP</span><span class="info-val">${UI.escapeHtml(device.ip || '--')}</span></div>
                    <div class="info-row"><span class="info-key">ADB</span><span class="info-val" id="d-adb">Verificando...</span></div>
                    <div class="info-row"><span class="info-key">MAC</span><span class="info-val">${UI.escapeHtml(device.mac || '--')}</span></div>
                    <div class="info-row"><span class="info-key">Grupo</span><span class="info-val">${UI.escapeHtml(groupName || device.group || '--')}</span></div>
                    <div class="info-row"><span class="info-key">Local</span><span class="info-val">${UI.escapeHtml(device.location || '--')}</span></div>
                </div>
                <div class="device-info-card">
                    <h3>${UI.icon('monitor')} Config Stream</h3>
                    <div class="info-row"><span class="info-key">Path RTSP</span><span class="info-val">${UI.escapeHtml(device.rtsp_path || '--')}</span></div>
                    <div class="info-row"><span class="info-key">Player</span><span class="info-val">${UI.escapeHtml(device.player || 'vlc')}</span></div>
                    <div class="info-row"><span class="info-key">Root</span><span class="info-val" id="d-root">--</span></div>
                    <div class="info-row"><span class="info-key">Modelo</span><span class="info-val" id="d-model">--</span></div>
                    <div class="info-row"><span class="info-key">Porta ADB</span><span class="info-val">${device.adb_port}</span></div>
                </div>
            </div>
            <div class="device-info-card full" style="margin-top:var(--space-4)">
                <h3>${UI.icon('clock')} Linha de vida</h3>
                <div class="info-row"><span class="info-key">Heartbeat</span><span class="info-val" id="d-heartbeat">${st.last_heartbeat ? freshness({ last_heartbeat: st.last_heartbeat }) : '—'}</span></div>
                <div class="info-row"><span class="info-key">Última recuperação</span><span class="info-val">${st.last_recovery_time ? freshness({ last_recovery_time: st.last_recovery_time }) : '—'}</span></div>
                <div class="info-row"><span class="info-key">Reboots (watchdog)</span><span class="info-val">${st.reboot_count || 0}</span></div>
            </div>
        `;
    }

    function renderStream(container, device) {
        const st = device.state || {};
        container.innerHTML = `
            <div class="device-grid">
                <div class="device-info-card">
                    <h3>${UI.icon('monitor')} Status do stream</h3>
                    <div class="info-row"><span class="info-key">Atividade em foco</span><span class="info-val" id="d-activity">${UI.escapeHtml(st.current_activity || '—')}</span></div>
                    <div class="info-row"><span class="info-key">Player</span><span class="info-val">${UI.escapeHtml(device.player || 'vlc')}</span></div>
                    <div class="info-row"><span class="info-key">Path RTSP</span><span class="info-val">${UI.escapeHtml(device.rtsp_path || '—')}</span></div>
                    <div class="info-row"><span class="info-key">Args extras</span><span class="info-val">${UI.escapeHtml(device.player_extra_args || '—')}</span></div>
                </div>
                <div class="device-info-card">
                    <h3>${UI.icon('play')} Controle</h3>
                    <p class="text-muted text-sm" style="margin-bottom:var(--space-3)">Abre ou fecha o stream no TV Box (VLC/MPV).</p>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.action('start-stream')">${UI.icon('play')} Iniciar</button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.action('stop-stream')">${UI.icon('stop')} Parar</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderApps(container) {
        container.innerHTML = `
            <div class="device-info-card full">
                <h3>${UI.icon('archive')} APK — Gerenciar Apps</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
                    <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.installApp()">${UI.icon('upload')} Instalar APK</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.loadApps()">${UI.icon('refresh')} Recarregar Lista</button>
                    <span class="text-muted text-sm" id="d-apk-status" style="margin-left:4px;align-self:center"></span>
                </div>
                <input type="file" id="d-apk-file" accept=".apk" style="display:none">
                <div id="d-apps-list" class="apps-list">
                    <div class="text-muted text-sm">Carregando apps instalados...</div>
                </div>
            </div>
        `;
        loadApps();
    }

    function renderShellTab(container) {
        container.innerHTML = `
            <div class="device-info-card full">
                <h3>${UI.icon('terminal')} Shell Remoto</h3>
                <div class="device-shell-output" id="d-shell-out">Digite um comando abaixo...</div>
                <div class="device-shell-input">
                    <input type="text" id="d-shell-input" placeholder="Digite um comando (ex: getprop ro.build.version.release)" onkeydown="if(event.key==='Enter')DEVICE_PAGE.runShell()">
                    <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.runShell()">Executar</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.clearShell()">Limpar</button>
                </div>
            </div>
        `;
    }

    function renderScreenshots(container) {
        container.innerHTML = `
            <div class="device-info-card full">
                <h3>${UI.icon('camera')} Screenshot</h3>
                <div style="display:flex;gap:8px;margin-bottom:10px">
                    <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.captureScreenshot()">${UI.icon('camera')} Capturar agora</button>
                </div>
                <div id="d-screenshot-area">
                    <div class="text-muted text-sm">Clique em "Capturar agora" para obter screenshot.</div>
                </div>
                <div id="d-screenshot-img" class="device-screenshot" style="display:none">
                    <img id="d-screenshot-src" src="" alt="Screenshot" onclick="window.open(this.src, '_blank')">
                </div>
            </div>
        `;
    }

    // ── Status (atualiza header + visão geral + stream) ──

    async function refreshStatus() {
        try {
            const [st, device] = await Promise.all([
                API.get(`/devices/${deviceId}/status`).catch(() => null),
                API.get(`/devices/${deviceId}`).catch(() => null),
            ]);

            const statusEl = document.getElementById('device-header-status');
            const dstate = device?.state || {};
            const status = dstate.status || (st?.adb_connected ? 'online' : 'unknown');
            const reason = dstate.reason || '';
            if (statusEl) {
                statusEl.className = `dcard-status ${UI.statusClass(status)}`;
                statusEl.innerHTML = UI.statusBar(status, reason);
            }
            const fresh = document.getElementById('device-fresh');
            if (fresh) fresh.textContent = freshness(dstate);

            // Visão geral
            const adb = document.getElementById('d-adb');
            if (adb) adb.textContent = st ? (st.adb_connected ? 'Conectado' : 'Offline') : '—';
            const model = document.getElementById('d-model');
            if (model) model.textContent = st?.model || '--';
            const root = document.getElementById('d-root');
            if (root) root.textContent = st?.root ? 'Sim' : 'Não';
            const hb = document.getElementById('d-heartbeat');
            if (hb) hb.textContent = dstate.last_heartbeat ? freshness({ last_heartbeat: dstate.last_heartbeat }) : '—';

            // Stream
            const activity = document.getElementById('d-activity');
            if (activity) activity.textContent = dstate.current_activity || '—';
        } catch (e) {
            console.warn('Status refresh:', e.message);
        }
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshStatus, 15000);
    }

    function destroy() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // ── Apps ────────────────────────────────────

    async function loadApps() {
        const el = document.getElementById('d-apps-list');
        if (!el) return;
        const status = document.getElementById('d-apk-status');
        if (status) status.textContent = 'Carregando...';

        try {
            const res = await API.get(`/devices/${deviceId}/apps`);
            if (!res.success || !res.packages || res.packages.length === 0) {
                el.innerHTML = '<div class="text-muted text-sm">Nenhum app de terceiros instalado.</div>';
                if (status) status.textContent = '';
                return;
            }
            let html = `<div class="apps-count">${res.count} apps de terceiros</div>`;
            res.packages.forEach(p => {
                html += `
                    <div class="app-row">
                        <span class="app-name">${UI.escapeHtml(p.name)}</span>
                        <code class="app-pkg">${UI.escapeHtml(p.package)}</code>
                        <button class="btn btn-sm btn-danger" onclick="DEVICE_PAGE.uninstallApp('${UI.escAttr(p.package)}')">${UI.icon('trash')}</button>
                    </div>`;
            });
            el.innerHTML = html;
            if (status) status.textContent = '';
        } catch (e) {
            el.innerHTML = `<div class="text-danger">Erro: ${UI.escapeHtml(e.message)}</div>`;
            if (status) status.textContent = '';
        }
    }

    async function installApp() {
        const input = document.getElementById('d-apk-file');
        const status = document.getElementById('d-apk-status');
        if (!input) return;

        input.onchange = async function(file) {
            const f = file.target.files[0];
            if (!f) return;
            if (!f.name.endsWith('.apk')) { UI.createToast('Selecione um arquivo .apk', 'error'); return; }

            if (status) status.textContent = `Enviando ${f.name}...`;
            UI.createToast(`Enviando ${f.name}...`, 'info', 3000);

            try {
                const form = new FormData();
                form.append('file', f);
                const res = await fetch(`/api/devices/${deviceId}/install-apk`, { method: 'POST', body: form });
                const data = await res.json();
                if (data.success) {
                    UI.createToast(`${f.name} instalado`, 'success');
                    await loadApps();
                } else {
                    UI.createToast(`${data.error || 'Falha na instalação'}`, 'error');
                }
            } catch (e) {
                UI.createToast(`${e.message}`, 'error');
            }
            if (status) status.textContent = '';
            input.value = '';
        };
        input.click();
    }

    async function uninstallApp(pkg) {
        UI.showModal(`Remover ${pkg}`, `<p>Desinstalar <strong>${UI.escapeHtml(pkg)}</strong>?</p>`, async () => {
            try {
                const res = await API.post(`/devices/${deviceId}/uninstall-app`, { package: pkg });
                if (res.success) {
                    UI.createToast(`${pkg} desinstalado`, 'success');
                    await loadApps();
                } else {
                    UI.createToast(`${res.output || 'Falha'}`, 'error');
                }
            } catch (e) { UI.createToast(`${e.message}`, 'error'); }
        });
    }

    // ── Ações ──────────────────────────────────

    async function action(action) {
        try {
            const res = await API.post(`/devices/${deviceId}/${action}`, {});
            const msg = res.success !== false ? `${action} executado` : `Falha: ${res.error || res.output || ''}`;
            UI.createToast(msg, res.success !== false ? 'success' : 'error');
            refreshStatus();
        } catch (e) {
            UI.createToast(`Erro em ${action}: ${e.message}`, 'error');
        }
    }

    // ── Screenshot ──────────────────────────────

    async function captureScreenshot() {
        const btn = document.querySelector('[onclick*="captureScreenshot"]');
        if (btn) btn.disabled = true;

        try {
            const res = await API.post(`/devices/${deviceId}/screenshot`);
            if (res.success) {
                const img = document.getElementById('d-screenshot-src');
                const area = document.getElementById('d-screenshot-img');
                const status = document.getElementById('d-screenshot-area');
                if (img) img.src = API.authUrl(res.screenshot_url) + '&t=' + Date.now();
                if (area) area.style.display = 'block';
                if (status) status.style.display = 'none';
                UI.createToast(`Screenshot capturado (${(res.size_bytes / 1024).toFixed(1)} KB)`, 'success');
            } else {
                UI.createToast(`Erro: ${res.error}`, 'error');
            }
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
    }

    // ── Provision ───────────────────────────────

    async function provisionScripts() {
        const btn = document.querySelector('[onclick*="provisionScripts"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.post(`/devices/${deviceId}/provision`);
            UI.createToast(res.success ? `${res.scripts_count} scripts instalados` : `Erro: ${res.errors?.join(', ')}`,
                res.success ? 'success' : 'error');
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
    }

    // ── Delete ──────────────────────────────────

    async function deleteDevice() {
        UI.showModal(
            `Remover ${deviceId}`,
            `<p>Tem certeza? O YAML do dispositivo será deletado permanentemente.</p>`,
            async () => {
                try {
                    await API.del(`/devices/${deviceId}`);
                    UI.createToast('Dispositivo removido', 'success');
                    window.location.hash = '#/';
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    // ── Shell ───────────────────────────────────

    async function runShell() {
        const input = document.getElementById('d-shell-input');
        const output = document.getElementById('d-shell-out');
        if (!input || !output) return;

        const command = input.value.trim();
        if (!command) return;

        const prev = output.textContent;
        output.textContent = prev + `\n$ ${command}\nExecutando...`;

        try {
            const res = await API.post(`/devices/${deviceId}/shell`, { command });
            output.textContent = prev + `\n$ ${command}\n${res.output || '(sem output)'}\n━━━ exit: ${res.exit_code}`;
        } catch (e) {
            output.textContent = prev + `\n$ ${command}\nErro: ${e.message}`;
        }

        input.value = '';
        output.scrollTop = output.scrollHeight;
    }

    function clearShell() {
        const output = document.getElementById('d-shell-out');
        if (output) output.textContent = 'Shell limpo.';
    }

    return { render, destroy, switchTab, refreshStatus, action, captureScreenshot, installApp, loadApps, uninstallApp, provisionScripts, deleteDevice, runShell, clearShell };
})();
