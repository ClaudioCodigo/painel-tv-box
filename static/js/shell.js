/**
 * Shell Page — terminal remoto com seletor de device + screenshot inline.
 */
const SHELL_PAGE = (() => {
    let commandHistory = [];
    let historyIndex = -1;

    async function render(el) {
        UI.setPageTitle('Shell');

        let devices = [];
        try { devices = await API.get('/devices') || []; } catch (e) { /* ok */ }

        const deviceOptions = devices.map(d =>
            `<option value="${d.id}">${d.name || d.id} (${d.ip})</option>`
        ).join('');

        el.innerHTML = `
            <div class="shell-page">
                <div class="section-title">${UI.icon('terminal')} Terminal Remoto</div>
                <div class="shell-controls">
                    <div class="form-group" style="flex:1">
                        <label class="form-label">Dispositivo</label>
                        <select id="shell-device" class="form-input">
                            ${deviceOptions || '<option value="">Nenhum dispositivo</option>'}
                        </select>
                    </div>
                    <div class="form-group" style="flex:2">
                        <label class="form-label">Comando</label>
                        <div style="display:flex;gap:8px">
                            <input type="text" id="shell-cmd" class="form-input" placeholder="Ex: ls /data/local/tmp" style="flex:1">
                            <button class="btn btn-primary" id="shell-run-btn" onclick="SHELL_PAGE.run()">▶ Executar</button>
                        </div>
                    </div>
                </div>
                <div class="shell-quick-actions">
                    <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.quick('cat /proc/cpuinfo | head -5')">CPU Info</button>
                    <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.quick('cat /proc/meminfo | head -3')">Memória</button>
                    <button class="btn btn-sm btn-accent" onclick="SHELL_PAGE.captureScreenshot()">${UI.icon('camera')} Screenshot</button>
                    <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.quick('dumpsys battery')">Bateria</button>
                    <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.quick('sh /data/local/tmp/panel/heartbeat.sh status')">${UI.icon('wifi')} Heartbeat status</button>
                    <button class="btn btn-sm btn-primary" onclick="SHELL_PAGE.showInstallApk()">📦 Instalar APK</button>
                    <button class="btn btn-sm btn-danger" onclick="SHELL_PAGE.clear()">🗑️ Limpar</button>
                </div>
                <div id="shell-apps-list" class="shell-apps" style="margin-bottom:8px;display:none">
                    <div class="text-muted text-sm" id="shell-apps-status">Carregando apps...</div>
                </div>
                <div id="shell-output" class="shell-terminal">
                    <div class="shell-welcome">Bem-vindo ao terminal remoto. Selecione um dispositivo e execute um comando.</div>
                </div>
            </div>
        `;

        document.getElementById('shell-cmd')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { SHELL_PAGE.run(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); navigateHistory(-1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); navigateHistory(1); }
        });

        // Exibe screenshot se já existir
        const deviceId = deviceSelect()?.value;
        if (deviceId) showExistingScreenshot(deviceId);
    }

    function deviceSelect() { return document.getElementById('shell-device'); }
    function cmdInput() { return document.getElementById('shell-cmd'); }
    function output() { return document.getElementById('shell-output'); }

    function navigateHistory(dir) {
        const inp = cmdInput();
        if (!inp || !commandHistory.length) return;
        historyIndex += dir;
        if (historyIndex < 0) historyIndex = 0;
        if (historyIndex >= commandHistory.length) { historyIndex = commandHistory.length; inp.value = ''; return; }
        inp.value = commandHistory[historyIndex];
    }

    async function run() {
        const dev = deviceSelect(); const inp = cmdInput(); const out = output();
        const btn = document.getElementById('shell-run-btn');
        if (!dev?.value || !inp?.value?.trim()) { UI.createToast('Selecione um dispositivo e digite um comando', 'warning'); return; }

        const deviceId = dev.value;
        const command = inp.value.trim();

        if (commandHistory[commandHistory.length - 1] !== command) commandHistory.push(command);
        historyIndex = commandHistory.length;

        // Detecta comando de screenshot
        if (/screencap[\s-]/.test(command)) {
            inp.value = '';
            await captureScreenshotInternal(deviceId, out);
            return;
        }

        out.innerHTML += `<div class="shell-prompt"><span class="shell-user">${esc(deviceId)}@painel$</span> ${esc(command)}</div>`;
        out.innerHTML += `<div class="shell-loading">Executando...</div>`;
        out.scrollTop = out.scrollHeight;
        btn.disabled = true;

        // Tenta WS primeiro, fallback REST
        const wsUsed = await runViaWS(deviceId, command, out);
        if (!wsUsed) {
            await runViaREST(deviceId, command, out);
        }

        out.scrollTop = out.scrollHeight;
        btn.disabled = false;
        inp.value = '';
        inp.focus();
    }

    async function runViaWS(deviceId, command, outEl) {
        const loading = outEl.querySelector('.shell-loading');
        const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/shell/${deviceId}`;
        let connected = false;

        try {
            const ws = new WebSocket(wsUrl);
            await new Promise((resolve, reject) => {
                ws.onopen = resolve;
                ws.onerror = () => reject(new Error('WS connection failed'));
                setTimeout(() => reject(new Error('WS timeout')), 3000);
            });
            connected = true;

            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                if (loading) loading.remove();

                if (msg.type === 'stdout') {
                    outEl.innerHTML += `<div class="shell-line">${esc(msg.data)}</div>`;
                    outEl.scrollTop = outEl.scrollHeight;
                } else if (msg.type === 'stdin') {
                    // Command echo, already shown
                } else if (msg.type === 'exit') {
                    outEl.innerHTML += `<div class="shell-result">━━━ exit: ${msg.code} ${msg.stderr ? '· stderr: ' + esc(msg.stderr).slice(0,200) : ''}</div>`;
                    ws.close();
                } else if (msg.type === 'error') {
                    outEl.innerHTML += `<div class="shell-error">❌ ${esc(msg.message)}</div>`;
                    ws.close();
                }
            };

            // Envia comando
            ws.send(JSON.stringify({ command }));
            return true;
        } catch (e) {
            if (connected) {
                try { ws.close(); } catch(_) {}
            }
            return false; // fallback pra REST
        }
    }

    async function runViaREST(deviceId, command, outEl) {
        try {
            const res = await API.post(`/devices/${deviceId}/shell`, { command });
            const load = outEl.querySelector('.shell-loading'); if (load) load.remove();

            if (res.success) {
                outEl.innerHTML += `<div class="shell-result">${(res.output || '').split('\n').map(l => `<div class="shell-line">${esc(l)}</div>`).join('')}</div>`;
            } else {
                outEl.innerHTML += `<div class="shell-error">❌ exit=${res.exit_code}: ${esc(res.output || res.error || '')}</div>`;
            }
        } catch (e) {
            const load = outEl.querySelector('.shell-loading'); if (load) load.remove();
            outEl.innerHTML += `<div class="shell-error">❌ ${esc(e.message)}</div>`;
        }
    }

    // ── Screenshot ──────────────────────────────────

    async function captureScreenshot() {
        const dev = deviceSelect(); const out = output();
        if (!dev?.value) { UI.createToast('Selecione um dispositivo', 'warning'); return; }
        await captureScreenshotInternal(dev.value, out);
    }

    async function captureScreenshotInternal(deviceId, outEl) {
        outEl.innerHTML += `<div class="shell-prompt">Capturando screenshot de ${deviceId}...</div>`;
        try {
            const res = await API.post(`/devices/${deviceId}/screenshot`);
            if (res.success) {
                const url = API.authUrl(`/api/devices/${deviceId}/screenshot`) + '&t=' + Date.now();
                const kb = (res.size_bytes / 1024).toFixed(1);
                outEl.innerHTML += `
                    <div class="shell-result">
                        <div class="shell-line term-ok">${kb} KB — clique na imagem para ampliar</div>
                        <img src="${url}" style="max-width:100%;max-height:400px;cursor:pointer;border:1px solid var(--border-strong);border-radius:6px;margin-top:6px"
                             onclick="window.open('${url}')" onerror="this.nextElementSibling.style.display='block'">
                        <div style="display:none;color:var(--text-muted);margin-top:4px">🖼️ <a href="${url}" target="_blank">Abrir screenshot em nova aba</a></div>
                    </div>`;
            } else {
                outEl.innerHTML += `<div class="shell-error">❌ ${res.error || 'Falha ao capturar'}</div>`;
            }
        } catch (e) {
            outEl.innerHTML += `<div class="shell-error">❌ ${esc(e.message)}</div>`;
        }
        outEl.scrollTop = outEl.scrollHeight;
    }

    function showExistingScreenshot(deviceId) {
        const out = output();
        const url = API.authUrl(`/api/devices/${deviceId}/screenshot`) + '&t=' + Date.now();
        out.innerHTML += `
            <div class="shell-result" style="margin-top:12px">
                <div class="shell-line text-muted">Último screenshot:</div>
                <img src="${url}" style="max-width:100%;max-height:300px;cursor:pointer;border:1px solid var(--border-strong);border-radius:6px;margin-top:4px"
                     loading="lazy" onclick="window.open('${url}')">
            </div>`;
    }

    function quick(cmd) { const inp = cmdInput(); if (inp) { inp.value = cmd; run(); } }

    function clear() { output().innerHTML = '<div class="shell-welcome">Terminal limpo.</div>'; }

    // ── APK ──────────────────────────────────────

    async function showInstallApk() {
        const dev = deviceSelect();
        if (!dev?.value) { UI.createToast('Selecione um dispositivo', 'warning'); return; }

        const out = output();
        out.innerHTML += `<div class="shell-prompt">📦 Carregando apps instalados...</div>`;
        out.scrollTop = out.scrollHeight;

        const appsDiv = document.getElementById('shell-apps-list');
        if (appsDiv) appsDiv.style.display = 'block';

        try {
            const res = await API.get(`/devices/${dev.value}/apps`);
            const status = document.getElementById('shell-apps-status');
            if (!res.success || !res.packages || res.packages.length === 0) {
                if (status) status.innerHTML = '<div class="text-muted text-sm">Nenhum app de terceiros.</div>';
                out.innerHTML += `<div class="shell-result"><span class="shell-line">${res.count} apps encontrados</span></div>`;
                return;
            }

            let html = `<div class="text-sm" style="margin-bottom:6px;color:var(--text-secondary)">📦 <strong>${res.count}</strong> apps de terceiros</div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                            <input type="file" id="shell-apk-file" accept=".apk" style="display:none">
                            <button class="btn btn-sm btn-primary" onclick="document.getElementById('shell-apk-file').click()">📤 Instalar APK</button>
                            <span class="text-xs text-text-muted">Selecione um .apk para enviar e instalar</span>
                        </div>
                        <div style="max-height:200px;overflow-y:auto">`;
            res.packages.forEach(p => {
                html += `<div class="app-row" style="font-size:0.8em;padding:5px 8px;margin-bottom:2px">
                            <span class="app-name" style="min-width:100px">${p.name}</span>
                            <code class="app-pkg">${p.package}</code>
                            <button class="btn btn-sm btn-danger" style="font-size:0.75em;padding:2px 6px" onclick="SHELL_PAGE.uninstallApp('${p.package}')">🗑️</button>
                        </div>`;
            });
            html += '</div>';
            if (status) status.innerHTML = html;

            // Bind do file input — mostra resultado no terminal
            document.getElementById('shell-apk-file').onchange = async function(e) {
                const f = e.target.files[0];
                if (!f || !f.name.endsWith('.apk')) return;
                out.innerHTML += `<div class="shell-prompt">📤 Enviando ${esc(f.name)}...</div>`;
                out.scrollTop = out.scrollHeight;
                const form = new FormData();
                form.append('file', f);
                try {
                    const resp = await fetch(`/api/devices/${dev.value}/install-apk`, { method: 'POST', body: form });
                    let data = {};
                    try { data = await resp.json(); } catch (e) { /* corpo não-JSON */ }
                    if (!resp.ok) {
                        out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(data.detail || `Falha na instalação (HTTP ${resp.status})`)}</span></div>`;
                    } else if (data.success) {
                        out.innerHTML += `<div class="shell-result"><span class="shell-line term-ok">${esc(f.name)} instalado com sucesso</span></div>`;
                        showInstallApk(); // recarrega lista
                    } else {
                        out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(data.error || data.output || 'Falha na instalação')}</span></div>`;
                    }
                } catch (err) {
                    out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(err.message)}</span></div>`;
                }
                out.scrollTop = out.scrollHeight;
                e.target.value = '';
            };
        } catch (err) {
            document.getElementById('shell-apps-status').innerHTML = `<span class="term-err">Erro: ${esc(err.message)}</span>`;
            out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(err.message)}</span></div>`;
        }
    }

    async function uninstallApp(pkg) {
        const dev = deviceSelect();
        if (!dev?.value) return;
        UI.showModal(`Remover ${pkg}`, `<p>Desinstalar <strong>${pkg}</strong>?</p>`, async () => {
            const out = output();
            out.innerHTML += `<div class="shell-prompt">🗑️ Desinstalando ${esc(pkg)}...</div>`;
            try {
                const res = await API.post(`/devices/${dev.value}/uninstall-app`, { package: pkg });
                if (res.success) {
                    out.innerHTML += `<div class="shell-result"><span class="shell-line term-ok">${esc(pkg)} desinstalado (exit: ${res.exit_code})</span></div>`;
                    showInstallApk();
                } else {
                    out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(res.output || res.error || 'Falha')} (exit: ${res.exit_code})</span></div>`;
                }
            } catch (e) {
                out.innerHTML += `<div class="shell-result"><span class="shell-line term-err">${esc(e.message)}</span></div>`;
            }
            out.scrollTop = out.scrollHeight;
        });
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    return { render, run, quick, captureScreenshot, clear, showInstallApk, uninstallApp };
})();
