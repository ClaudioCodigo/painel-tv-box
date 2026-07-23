/**
 * Device Page — detalhe e controle de um TV Box.
 */
const DEVICE_PAGE = (() => {
    let deviceId = null;
    let refreshTimer = null;

    async function render(el, id) {
        deviceId = id;
        UI.setPageTitle('Dispositivo');

        el.innerHTML = `<div class="device-detail"><div class="loading">Carregando ${id}...</div></div>`;

        try {
            const device = await API.get(`/devices/${deviceId}`);
            renderDevice(el, device);
            refreshStatus();
            startAutoRefresh();
        } catch (e) {
            el.innerHTML = `<div class="error-state">❌ ${e.message}</div>`;
        }
    }

    function renderDevice(el, device) {
        const status = device.state?.status || 'unknown';

        el.innerHTML = `
            <div class="device-detail">
                <div class="device-header">
                    <span class="device-icon">📺</span>
                    <div class="device-info">
                        <h2>${device.name || device.id}</h2>
                        <div class="device-location">${device.location || device.ip || ''}</div>
                        <span class="device-status-badge ${UI.statusClass(status)}">${status.toUpperCase()}</span>
                    </div>
                </div>

                <div class="device-actions">
                    <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.action('start-stream')">▶ Start</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.action('stop-stream')">⏹ Stop</button>
                    <button class="btn btn-warning btn-sm" onclick="DEVICE_PAGE.action('reboot')">🔄 Reboot</button>
                    <button class="btn btn-info btn-sm" onclick="DEVICE_PAGE.refreshStatus()">🔄 Atualizar</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.captureScreenshot()">📷 Capturar</button>
                    <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.provisionScripts()">📦 Scripts</button>
                    <button class="btn btn-danger btn-sm" onclick="DEVICE_PAGE.deleteDevice()">🗑️ Remover</button>
                </div>

                <div class="device-grid">
                    <div class="device-info-card">
                        <h3>🔗 Rede</h3>
                        <div class="info-row"><span class="info-key">IP</span><span class="info-val">${device.ip || '--'}</span></div>
                        <div class="info-row"><span class="info-key">ADB</span><span class="info-val" id="d-adb">Verificando...</span></div>
                        <div class="info-row"><span class="info-key">MAC</span><span class="info-val">${device.mac || '--'}</span></div>
                        <div class="info-row"><span class="info-key">Grupo</span><span class="info-val">${device.group || '--'}</span></div>
                    </div>
                    <div class="device-info-card">
                        <h3>📺 Stream</h3>
                        <div class="info-row"><span class="info-key">Path RTSP</span><span class="info-val">${device.rtsp_path || '--'}</span></div>
                        <div class="info-row"><span class="info-key">Player</span><span class="info-val">${device.player || 'vlc'}</span></div>
                        <div class="info-row"><span class="info-key">Root</span><span class="info-val" id="d-root">--</span></div>
                        <div class="info-row"><span class="info-key">Modelo</span><span class="info-val" id="d-model">--</span></div>
                    </div>
                </div>

                <div class="device-grid">
                    <!-- Screenshot -->
                    <div class="device-info-card full">
                        <h3>📷 Screenshot</h3>
                        <div id="d-screenshot-area">
                            <div class="text-muted text-sm">Clique em "Capturar" para obter screenshot</div>
                        </div>
                        <div id="d-screenshot-img" class="device-screenshot" style="display:none">
                            <img id="d-screenshot-src" src="" alt="Screenshot" onclick="window.open(this.src, '_blank')">
                        </div>
                    </div>
                </div>

                <div class="device-info-card full">
                    <h3>📦 APK — Gerenciar Apps</h3>
                    <div style="display:flex;gap:8px;margin-bottom:10px">
                        <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.installApp()">📤 Instalar APK</button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.loadApps()">🔄 Recarregar Lista</button>
                        <span class="text-muted text-sm" id="d-apk-status" style="margin-left:4px;align-self:center"></span>
                    </div>
                    <input type="file" id="d-apk-file" accept=".apk" style="display:none">
                    <div id="d-apps-list" class="apps-list">
                        <div class="text-muted text-sm">Carregando apps instalados...</div>
                    </div>
                </div>

                <div class="device-info-card full">
                    <h3>🖥️ Shell Remoto</h3>
                    <div class="device-shell-output" id="d-shell-out">Conecte para ver output...</div>
                    <div class="device-shell-input">
                        <input type="text" id="d-shell-input" placeholder="Digite um comando (ex: getprop ro.build.version.release)" onkeydown="if(event.key==='Enter')DEVICE_PAGE.runShell()">
                        <button class="btn btn-primary btn-sm" onclick="DEVICE_PAGE.runShell()">Executar</button>
                        <button class="btn btn-secondary btn-sm" onclick="DEVICE_PAGE.clearShell()">Limpar</button>
                    </div>
                </div>
            </div>
        `;
        await refreshStatus();
        await loadApps();

    // ── Status ─────────────────────────────────

    async function refreshStatus() {
        try {
            const st = await API.get(`/devices/${deviceId}/status`);
            document.getElementById('d-adb').textContent = st.adb_connected ? '✅ Conectado' : '❌ Offline';
            document.getElementById('d-model').textContent = st.model || '--';
            document.getElementById('d-root').textContent = st.root ? '✅ Sim' : '❌ Não';

            const statusEl = document.querySelector('.device-status-badge');
            if (statusEl) {
                const newStatus = st.adb_connected ? 'online' : 'offline';
                statusEl.textContent = newStatus.toUpperCase();
                statusEl.className = `device-status-badge ${UI.statusClass(newStatus)}`;
            }
        } catch (e) {
            console.warn('Status refresh:', e.message);
        }
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshStatus, 15000);
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
                        <span class="app-name">${p.name}</span>
                        <code class="app-pkg">${p.package}</code>
                        <button class="btn btn-sm btn-danger" onclick="DEVICE_PAGE.uninstallApp('${p.package}')">🗑️</button>
                    </div>`;
            });
            el.innerHTML = html;
            if (status) status.textContent = '';
        } catch (e) {
            el.innerHTML = `<div class="text-danger">Erro: ${e.message}</div>`;
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
            UI.createToast(`📤 Enviando ${f.name}...`, 'info', 3000);

            try {
                const form = new FormData();
                form.append('file', f);
                const res = await fetch(`/api/devices/${deviceId}/install-apk`, { method: 'POST', body: form });
                const data = await res.json();
                if (data.success) {
                    UI.createToast(`✅ ${f.name} instalado`, 'success');
                    await loadApps();
                } else {
                    UI.createToast(`❌ ${data.error || 'Falha na instalação'}`, 'error');
                }
            } catch (e) {
                UI.createToast(`❌ ${e.message}`, 'error');
            }
            if (status) status.textContent = '';
            input.value = '';
        };
        input.click();
    }

    async function uninstallApp(pkg) {
        UI.showModal(`Remover ${pkg}`, `<p>Desinstalar <strong>${pkg}</strong>?</p>`, async () => {
            try {
                const res = await API.post(`/devices/${deviceId}/uninstall-app`, { package: pkg });
                if (res.success) {
                    UI.createToast(`✅ ${pkg} desinstalado`, 'success');
                    await loadApps();
                } else {
                    UI.createToast(`❌ ${res.output || 'Falha'}`, 'error');
                }
            } catch (e) { UI.createToast(`❌ ${e.message}`, 'error'); }
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
                if (img) img.src = res.screenshot_url + '?t=' + Date.now();
                if (area) area.style.display = 'block';
                if (status) status.style.display = 'none';
                UI.createToast(`📷 Screenshot capturado (${(res.size_bytes / 1024).toFixed(1)} KB)`, 'success');
            } else {
                UI.createToast(`Erro: ${res.error}`, 'error');
            }
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
        if (btn) btn.disabled = false;
    }

    // ── APK ─────────────────────────────────────

    async function installApk(file) {
        if (!file) return;

        const statusEl = document.getElementById('d-apk-status');
        if (statusEl) statusEl.textContent = `Enviando ${file.name}...`;

        try {
            const res = await API.upload(`/devices/${deviceId}/install-apk`, file, 'file');
            if (res.success) {
                UI.createToast(`✅ ${file.name} instalado com sucesso!`, 'success');
                if (statusEl) statusEl.textContent = `✅ Instalado: ${file.name}`;
            } else {
                UI.createToast(`❌ Falha: ${res.output || 'erro desconhecido'}`, 'error');
                if (statusEl) statusEl.textContent = `❌ ${res.output || 'erro'}`;
            }
        } catch (e) {
            UI.createToast(`❌ ${e.message}`, 'error');
            if (statusEl) statusEl.textContent = `❌ ${e.message}`;
        }
    }

    // ── Provision ───────────────────────────────

    async function provisionScripts() {
        const btn = document.querySelector('[onclick*="provisionScripts"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.post(`/devices/${deviceId}/provision`);
            UI.createToast(res.success ? `📦 ${res.scripts_count} scripts instalados` : `Erro: ${res.errors?.join(', ')}`,
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
            output.textContent = prev + `\n$ ${command}\n❌ Erro: ${e.message}`;
        }

        input.value = '';
        output.scrollTop = output.scrollHeight;
    }

    function clearShell() {
        const output = document.getElementById('d-shell-out');
        if (output) output.textContent = 'Shell limpo.';
    }

    return { render, refreshStatus, action, captureScreenshot, installApp, loadApps, uninstallApp, provisionScripts, deleteDevice, runShell, clearShell };
})();
