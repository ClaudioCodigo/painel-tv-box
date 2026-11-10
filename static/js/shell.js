/**
 * Shell Page — terminal interativo ADB, histórico navegável (↑/↓), status do device e comandos 1-clique.
 */
const SHELL_PAGE = (() => {
    let commandHistory = [];
    let historyIndex = -1;
    let currentDraft = '';
    let devicesCache = [];

    async function render(el) {
        UI.setPageTitle('Shell');

        let devices = [];
        try {
            devices = await API.get('/devices') || [];
        } catch (e) {
            /* ok */
        }
        devicesCache = Array.isArray(devices) ? devices : [];

        const deviceOptions = devicesCache.map(d =>
            `<option value="${UI.escapeHtml(d.id)}">${UI.escapeHtml(d.name || d.id)} (${UI.escapeHtml(d.ip || '')})</option>`
        ).join('');

        el.innerHTML = `
            <div class="shell-page">
                <div class="shell-header-card">
                    <div class="shell-device-bar">
                        <div class="form-group" style="flex:1;min-width:240px;margin:0">
                            <label class="form-label text-xs">Dispositivo Alvo</label>
                            <div style="display:flex;gap:10px;align-items:center">
                                <select id="shell-device" class="form-input font-medium" style="flex:1" onchange="SHELL_PAGE.onDeviceChange()">
                                    ${deviceOptions || '<option value="">Nenhum dispositivo encontrado</option>'}
                                </select>
                                <div id="shell-device-status-badge"></div>
                            </div>
                        </div>

                        <div class="shell-header-actions">
                            <span class="shell-busy-indicator hidden" id="shell-busy-indicator">
                                <span class="spinner-sm"></span> Executando...
                            </span>
                            <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.copyOutput()" title="Copiar saída do terminal" aria-label="Copiar saída do terminal">
                                ${UI.icon('copy')} Copiar Saída
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.clear()" title="Limpar histórico da tela" aria-label="Limpar histórico da tela">
                                ${UI.icon('trash')} Limpar
                            </button>
                        </div>
                    </div>

                    <div class="shell-quick-commands-bar">
                        <span class="quick-cmd-label">Comandos sugeridos:</span>
                        <div class="quick-cmd-chips">
                            <button class="quick-chip" onclick="SHELL_PAGE.promptReboot()" title="Reiniciar TV Box">${UI.icon('refresh')} reboot</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('getprop ro.build.version.release')" title="Versão do Android">getprop</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('pm list packages -3')" title="Listar aplicativos de terceiros">pm list packages</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('dumpsys battery')" title="Status de energia e bateria">dumpsys battery</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('cat /proc/meminfo | head -5')" title="Uso de memória">meminfo</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('cat /proc/cpuinfo | head -5')" title="Processador">cpuinfo</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.quick('sh /data/local/tmp/panel/heartbeat.sh status')" title="Status do serviço de heartbeat">heartbeat status</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.captureScreenshot()" title="Capturar tela instantânea">${UI.icon('camera')} screenshot</button>
                            <button class="quick-chip" onclick="SHELL_PAGE.showInstallApk()" title="Gerenciador de aplicativos">📦 Apps & APK</button>
                        </div>
                    </div>
                </div>

                <div id="shell-apps-list" class="shell-apps-panel" style="display:none">
                    <div id="shell-apps-status" class="text-muted text-sm">Carregando pacotes instalados...</div>
                </div>

                <div class="shell-terminal-wrapper">
                    <div class="shell-terminal-toolbar">
                        <span class="shell-term-title">Console ADB Interativo</span>
                        <span class="text-muted text-xs font-mono" id="shell-prompt-preview">device@painel$</span>
                    </div>

                    <div id="shell-output" class="shell-terminal" role="log" aria-live="polite" aria-atomic="false">
                        <div class="shell-welcome">
                            Painel TV Box — Shell ADB Remoto conectado.<br>
                            Selecione um dispositivo e digite o comando abaixo (use as teclas <kbd>↑</kbd> e <kbd>↓</kbd> para navegar no histórico).
                        </div>
                    </div>

                    <div class="shell-input-bar">
                        <span class="shell-input-prefix" id="shell-input-prefix">$</span>
                        <input type="text" id="shell-cmd" class="shell-input form-input font-mono" placeholder="Digite um comando shell (ex: ls -l /sdcard)..." autocomplete="off" spellcheck="false">
                        <button class="btn btn-primary btn-sm" id="shell-run-btn" onclick="SHELL_PAGE.run()" aria-label="Executar comando">
                            ${UI.icon('play')} Executar
                        </button>
                    </div>
                </div>
            </div>
        `;

        const cmdInp = document.getElementById('shell-cmd');
        if (cmdInp) {
            cmdInp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    SHELL_PAGE.run();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateHistory(-1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateHistory(1);
                }
            });
        }

        onDeviceChange();
    }

    function deviceSelect() { return document.getElementById('shell-device'); }
    function cmdInput() { return document.getElementById('shell-cmd'); }
    function output() { return document.getElementById('shell-output'); }

    function onDeviceChange() {
        const devId = deviceSelect()?.value;
        const dev = devicesCache.find(d => d.id === devId);
        const statusBadge = document.getElementById('shell-device-status-badge');
        const promptPrev = document.getElementById('shell-prompt-preview');
        const prefix = document.getElementById('shell-input-prefix');

        if (statusBadge) {
            if (dev) {
                const st = dev.state?.status || 'unknown';
                statusBadge.innerHTML = `
                    <div style="display:flex;align-items:center;gap:6px">
                        ${UI.stateBadge(st)}
                        <span class="badge font-mono">${UI.escapeHtml(dev.ip || '')}:${dev.adb_port || 5555}</span>
                    </div>
                `;
            } else {
                statusBadge.innerHTML = '<span class="badge">Nenhum</span>';
            }
        }

        const devLabel = dev ? (dev.name || dev.id) : 'desconectado';
        if (promptPrev) promptPrev.textContent = `${devLabel}@painel$`;
        if (prefix) prefix.textContent = `${devLabel}$`;
    }

    function navigateHistory(dir) {
        const inp = cmdInput();
        if (!inp || commandHistory.length === 0) return;

        if (historyIndex === -1 || historyIndex === commandHistory.length) {
            currentDraft = inp.value;
        }

        historyIndex += dir;

        if (historyIndex < 0) {
            historyIndex = 0;
        } else if (historyIndex >= commandHistory.length) {
            historyIndex = commandHistory.length;
            inp.value = currentDraft;
            return;
        }

        inp.value = commandHistory[historyIndex] || '';
    }

    function setBusy(isBusy) {
        const ind = document.getElementById('shell-busy-indicator');
        const btn = document.getElementById('shell-run-btn');
        if (ind) ind.classList.toggle('hidden', !isBusy);
        if (btn) btn.disabled = isBusy;
    }

    async function run() {
        const dev = deviceSelect();
        const inp = cmdInput();
        const out = output();

        if (!dev?.value) {
            UI.createToast('Selecione um dispositivo para executar o comando', 'warning');
            return;
        }

        const command = inp?.value?.trim();
        if (!command) return;

        const deviceId = dev.value;
        const devObj = devicesCache.find(d => d.id === deviceId);
        const devName = devObj ? (devObj.name || devObj.id) : deviceId;

        // Gerenciamento do histórico
        if (commandHistory[commandHistory.length - 1] !== command) {
            commandHistory.push(command);
        }
        historyIndex = commandHistory.length;
        currentDraft = '';

        // Intercepta comando de captura de tela
        if (/^screencap\b/.test(command)) {
            inp.value = '';
            await captureScreenshotInternal(deviceId, out);
            return;
        }

        out.innerHTML += `
            <div class="shell-command-entry">
                <span class="shell-user font-mono">${UI.escapeHtml(devName)}@painel$</span>
                <span class="shell-cmd-text font-mono">${UI.escapeHtml(command)}</span>
            </div>
            <div class="shell-loading" id="shell-current-exec">
                <span class="spinner-sm"></span> Processando comando no TV Box...
            </div>
        `;
        out.scrollTop = out.scrollHeight;

        setBusy(true);

        const wsUsed = await runViaWS(deviceId, command, out);
        if (!wsUsed) {
            await runViaREST(deviceId, command, out);
        }

        const loadingIndicator = document.getElementById('shell-current-exec');
        if (loadingIndicator) loadingIndicator.remove();

        setBusy(false);
        out.scrollTop = out.scrollHeight;
        if (inp) {
            inp.value = '';
            inp.focus();
        }
    }

    async function runViaWS(deviceId, command, outEl) {
        const token = (typeof AUTH !== 'undefined') ? AUTH.getToken() : '';
        const q = token ? `?token=${encodeURIComponent(token)}` : '';
        const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/shell/${encodeURIComponent(deviceId)}${q}`;
        let connected = false;

        try {
            const ws = new WebSocket(wsUrl);
            await new Promise((resolve, reject) => {
                ws.onopen = resolve;
                ws.onerror = () => reject(new Error('WS connection failed'));
                setTimeout(() => reject(new Error('WS timeout')), 3000);
            });
            connected = true;

            return await new Promise((resolve) => {
                let stdoutReceived = false;

                ws.onmessage = (event) => {
                    const msg = JSON.parse(event.data);
                    const load = document.getElementById('shell-current-exec');
                    if (load) load.remove();

                    if (msg.type === 'stdout') {
                        stdoutReceived = true;
                        outEl.innerHTML += `<div class="shell-line font-mono">${UI.escapeHtml(msg.data)}</div>`;
                        outEl.scrollTop = outEl.scrollHeight;
                    } else if (msg.type === 'exit') {
                        const exitClass = msg.code === 0 ? 'text-success' : 'text-danger';
                        const stderrHtml = msg.stderr ? ` · stderr: ${UI.escapeHtml(msg.stderr).slice(0, 300)}` : '';
                        outEl.innerHTML += `<div class="shell-result ${exitClass} font-mono">━━━ exit: ${msg.code}${stderrHtml}</div>`;
                        ws.close();
                        resolve(true);
                    } else if (msg.type === 'error') {
                        outEl.innerHTML += `<div class="shell-error font-mono">${UI.icon('x')} ${UI.escapeHtml(msg.message)}</div>`;
                        ws.close();
                        resolve(true);
                    }
                };

                ws.onerror = () => {
                    ws.close();
                    resolve(stdoutReceived);
                };

                ws.send(JSON.stringify({ command }));
            });
        } catch (e) {
            if (connected) {
                try { ws.close(); } catch (_) {}
            }
            return false;
        }
    }

    async function runViaREST(deviceId, command, outEl) {
        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/shell`, { command });
            const load = document.getElementById('shell-current-exec');
            if (load) load.remove();

            if (res.success) {
                const lines = (res.output || '').split('\n').map(l =>
                    `<div class="shell-line font-mono">${UI.escapeHtml(l)}</div>`
                ).join('');
                outEl.innerHTML += `<div class="shell-result">${lines}</div>`;
            } else {
                outEl.innerHTML += `
                    <div class="shell-error font-mono">
                        ${UI.icon('x')} exit=${res.exit_code}: ${UI.escapeHtml(res.output || res.error || 'Erro na execução')}
                    </div>
                `;
            }
        } catch (e) {
            const load = document.getElementById('shell-current-exec');
            if (load) load.remove();
            outEl.innerHTML += `<div class="shell-error font-mono">${UI.icon('x')} ${UI.escapeHtml(e.message)}</div>`;
        }
    }

    function quick(cmd) {
        const inp = cmdInput();
        if (inp) {
            inp.value = cmd;
            run();
        }
    }

    function promptReboot() {
        const dev = deviceSelect();
        if (!dev?.value) {
            UI.createToast('Selecione um dispositivo', 'warning');
            return;
        }
        const devId = dev.value;
        const devObj = devicesCache.find(d => d.id === devId);
        const name = devObj ? (devObj.name || devObj.id) : devId;

        UI.showModal(
            'Confirmar Reboot do TV Box',
            `<p>Tem certeza de que deseja enviar o sinal de reinicialização para <strong>${UI.escapeHtml(name)}</strong>?</p>
             <p class="text-muted text-xs">O dispositivo reiniciará o Android e reconectará via heartbeat.</p>`,
            async () => {
                quick('reboot');
            }
        );
    }

    function clear() {
        const out = output();
        if (out) {
            out.innerHTML = '<div class="shell-welcome">Terminal limpo. Digite um comando para começar.</div>';
        }
        UI.createToast('Console limpo', 'info');
    }

    function copyOutput() {
        const out = output();
        if (!out) return;
        const text = out.innerText || out.textContent || '';
        if (!text.trim()) {
            UI.createToast('Nada para copiar no terminal', 'warning');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            UI.createToast('Saída do terminal copiada para a área de transferência!', 'success');
        }).catch(err => {
            UI.createToast(`Falha ao copiar: ${err.message}`, 'error');
        });
    }

    // ── Screenshot inline sem window.open ───────────

    async function captureScreenshot() {
        const dev = deviceSelect();
        const out = output();
        if (!dev?.value) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        await captureScreenshotInternal(dev.value, out);
    }

    async function captureScreenshotInternal(deviceId, outEl) {
        outEl.innerHTML += `<div class="shell-loading" id="shell-shot-loading"><span class="spinner-sm"></span> Capturando screenshot do dispositivo ${UI.escapeHtml(deviceId)}...</div>`;
        outEl.scrollTop = outEl.scrollHeight;

        try {
            const res = await API.post(`/devices/${encodeURIComponent(deviceId)}/screenshot`);
            const load = document.getElementById('shell-shot-loading');
            if (load) load.remove();

            if (res.success) {
                const blobUrl = await API.fetchBlobUrl(`/devices/${encodeURIComponent(deviceId)}/screenshot?t=${Date.now()}`);
                const kb = (res.size_bytes / 1024).toFixed(1);
                const shotId = `shot-${Date.now()}`;

                outEl.innerHTML += `
                    <div class="shell-result shell-shot-box font-mono">
                        <div class="shell-line text-success font-semibold" style="margin-bottom:6px">
                            ${UI.icon('camera')} Screenshot capturado (${kb} KB)
                        </div>
                        <img id="${shotId}" src="${blobUrl}" class="shell-shot-preview" alt="Screenshot de ${UI.escapeHtml(deviceId)}" title="Clique para expandir o screenshot">
                        <div class="shell-shot-actions" style="margin-top:6px">
                            <button class="btn btn-sm btn-secondary" onclick="SHELL_PAGE.previewScreenshot('${blobUrl}', '${UI.escAttr(deviceId)}')">
                                ${UI.icon('search')} Visualizar Tela
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="API.download('/devices/${encodeURIComponent(deviceId)}/screenshot', 'screenshot-${deviceId}.png')">
                                ${UI.icon('download')} Baixar Imagem
                            </button>
                        </div>
                    </div>
                `;
                const imgEl = document.getElementById(shotId);
                if (imgEl) {
                    imgEl.onclick = () => SHELL_PAGE.previewScreenshot(blobUrl, deviceId);
                }
            } else {
                outEl.innerHTML += `<div class="shell-error font-mono">${UI.icon('x')} ${UI.escapeHtml(res.error || 'Falha na captura')}</div>`;
            }
        } catch (e) {
            const load = document.getElementById('shell-shot-loading');
            if (load) load.remove();
            outEl.innerHTML += `<div class="shell-error font-mono">${UI.icon('x')} ${UI.escapeHtml(e.message)}</div>`;
        }
        outEl.scrollTop = outEl.scrollHeight;
    }

    function previewScreenshot(blobUrl, deviceId) {
        UI.showModal(
            `Screenshot — ${deviceId}`,
            `<div style="text-align:center;overflow:auto;max-height:75vh">
                <img src="${blobUrl}" style="max-width:100%;height:auto;border-radius:var(--radius-sm);border:1px solid var(--border-strong)" alt="Tela do TV Box">
             </div>`
        );
    }

    // ── Apps & APK ──────────────────────────────────

    async function showInstallApk() {
        const dev = deviceSelect();
        if (!dev?.value) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }

        const out = output();
        out.innerHTML += `<div class="shell-command-entry"><span class="shell-user font-mono">${UI.escapeHtml(dev.value)}@painel$</span> <span class="shell-cmd-text font-mono">Listando aplicativos de terceiros...</span></div>`;
        out.scrollTop = out.scrollHeight;

        const appsDiv = document.getElementById('shell-apps-list');
        if (appsDiv) appsDiv.style.display = 'block';

        try {
            const res = await API.get(`/devices/${encodeURIComponent(dev.value)}/apps`);
            const status = document.getElementById('shell-apps-status');

            if (!res.success || !res.packages || res.packages.length === 0) {
                if (status) status.innerHTML = '<div class="text-muted text-sm">Nenhum aplicativo de terceiros instalado.</div>';
                out.innerHTML += `<div class="shell-result font-mono"><span class="shell-line text-muted">0 pacotes de terceiros encontrados</span></div>`;
                return;
            }

            let html = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <span class="text-sm font-semibold">${UI.icon('archive')} <strong>${res.count}</strong> aplicativos de terceiros encontrados</span>
                    <button class="btn btn-sm btn-secondary" onclick="document.getElementById('shell-apk-file').click()">
                        ${UI.icon('upload')} Instalar Novo APK
                    </button>
                    <input type="file" id="shell-apk-file" accept=".apk" style="display:none">
                </div>
                <div class="shell-apps-table-wrapper" style="max-height:220px;overflow-y:auto">
            `;

            res.packages.forEach(p => {
                html += `
                    <div class="app-row" style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border-subtle)">
                        <div>
                            <span class="app-name font-semibold" style="margin-right:8px">${UI.escapeHtml(p.name)}</span>
                            <code class="app-pkg mono text-xs text-muted">${UI.escapeHtml(p.package)}</code>
                        </div>
                        <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:0.75rem" onclick="SHELL_PAGE.uninstallApp('${UI.escAttr(p.package)}')">
                            ${UI.icon('trash')} Desinstalar
                        </button>
                    </div>
                `;
            });
            html += '</div>';

            if (status) status.innerHTML = html;

            const apkInput = document.getElementById('shell-apk-file');
            if (apkInput) {
                apkInput.onchange = async function(e) {
                    const f = e.target.files[0];
                    if (!f || !f.name.endsWith('.apk')) return;

                    out.innerHTML += `<div class="shell-loading" id="shell-apk-loading"><span class="spinner-sm"></span> Enviando e instalando ${UI.escapeHtml(f.name)}...</div>`;
                    out.scrollTop = out.scrollHeight;

                    try {
                        const data = await API.upload(`/devices/${encodeURIComponent(dev.value)}/install-apk`, f, 'file');
                        const apkLoad = document.getElementById('shell-apk-loading');
                        if (apkLoad) apkLoad.remove();

                        if (data.success) {
                            out.innerHTML += `<div class="shell-result font-mono text-success">${UI.icon('check')} ${UI.escapeHtml(f.name)} instalado com sucesso!</div>`;
                            UI.createToast(`APK ${f.name} instalado!`, 'success');
                            showInstallApk();
                        } else {
                            out.innerHTML += `<div class="shell-result font-mono text-danger">${UI.icon('x')} ${UI.escapeHtml(data.error || data.output || 'Falha na instalação')}</div>`;
                            UI.createToast('Falha na instalação do APK', 'error');
                        }
                    } catch (err) {
                        const apkLoad = document.getElementById('shell-apk-loading');
                        if (apkLoad) apkLoad.remove();
                        out.innerHTML += `<div class="shell-result font-mono text-danger">${UI.icon('x')} ${UI.escapeHtml(err.message)}</div>`;
                        UI.createToast(`Erro: ${err.message}`, 'error');
                    }
                    out.scrollTop = out.scrollHeight;
                    e.target.value = '';
                };
            }
        } catch (err) {
            const status = document.getElementById('shell-apps-status');
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} Erro: ${UI.escapeHtml(err.message)}</span>`;
            out.innerHTML += `<div class="shell-result font-mono text-danger">${UI.icon('x')} ${UI.escapeHtml(err.message)}</div>`;
        }
    }

    async function uninstallApp(pkg) {
        const dev = deviceSelect();
        if (!dev?.value) return;

        UI.showModal(
            `Desinstalar Aplicativo`,
            `<p>Deseja realmente desinstalar o pacote <strong>${UI.escapeHtml(pkg)}</strong> do TV Box?</p>`,
            async () => {
                const out = output();
                out.innerHTML += `<div class="shell-loading" id="shell-uninst-loading"><span class="spinner-sm"></span> Desinstalando ${UI.escapeHtml(pkg)}...</div>`;
                try {
                    const res = await API.post(`/devices/${encodeURIComponent(dev.value)}/uninstall-app`, { package: pkg });
                    const load = document.getElementById('shell-uninst-loading');
                    if (load) load.remove();

                    if (res.success) {
                        out.innerHTML += `<div class="shell-result font-mono text-success">${UI.icon('check')} ${UI.escapeHtml(pkg)} desinstalado com sucesso.</div>`;
                        UI.createToast(`Pacote ${pkg} desinstalado!`, 'success');
                        showInstallApk();
                    } else {
                        out.innerHTML += `<div class="shell-result font-mono text-danger">${UI.icon('x')} Falha ao desinstalar: ${UI.escapeHtml(res.output || res.error || '')}</div>`;
                        UI.createToast(`Falha na desinstalação: ${res.error || ''}`, 'error');
                    }
                } catch (e) {
                    const load = document.getElementById('shell-uninst-loading');
                    if (load) load.remove();
                    out.innerHTML += `<div class="shell-result font-mono text-danger">${UI.icon('x')} ${UI.escapeHtml(e.message)}</div>`;
                    UI.createToast(e.message, 'error');
                }
                out.scrollTop = out.scrollHeight;
            }
        );
    }

    return {
        render,
        run,
        quick,
        promptReboot,
        clear,
        copyOutput,
        captureScreenshot,
        previewScreenshot,
        showInstallApk,
        uninstallApp,
        onDeviceChange
    };
})();
