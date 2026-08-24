/**
 * Settings Page — configurações gerais + update.
 */
const SETTINGS = (() => {

    async function render(el) {
        UI.setPageTitle('Configurações');

        el.innerHTML = `
            <div class="settings-page">
                <div class="section-title">${UI.icon('refresh')} Atualização</div>
                <div class="settings-card" id="update-section">
                    <p class="text-muted text-sm">Verifica e aplica atualizações via git pull.</p>
                    <div class="settings-actions">
                        <button class="btn btn-primary btn-sm" onclick="SETTINGS.checkUpdate()">🔍 Verificar</button>
                        <button class="btn btn-warning btn-sm" onclick="SETTINGS.applyUpdate()" id="btn-apply" disabled>🔄 Aplicar</button>
                    </div>
                    <div id="update-status" class="settings-status"></div>
                </div>

                <div class="section-title mt-md">${UI.icon('lock')} Segurança</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Usuário e senha do administrador do painel. Credenciais ficam só nesta máquina (gitignored).</p>
                    <div class="form-grid" style="margin-bottom:8px">
                        <div class="form-group">
                            <label>Usuário</label>
                            <input type="text" id="sec-admin-user" class="form-input" placeholder="admin" autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label>Senha atual (se alterando)</label>
                            <input type="password" id="sec-admin-current-pass" class="form-input" placeholder="••••••••" autocomplete="current-password">
                        </div>
                        <div class="form-group">
                            <label>Nova senha (mín. 8 caracteres)</label>
                            <input type="password" id="sec-admin-pass" class="form-input" placeholder="••••••••" autocomplete="new-password">
                        </div>
                    </div>
                    <div class="settings-actions">
                        <button class="btn btn-primary btn-sm" onclick="SETTINGS.saveAdmin()">${UI.icon('check')} Salvar administrador</button>
                    </div>
                    <div id="sec-admin-status" class="settings-status"></div>
                </div>

                <div class="section-title mt-md">${UI.icon('trash')} Cache</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Se a interface não atualizar após mudanças, limpe o cache.</p>
                    <button class="btn btn-secondary btn-sm" onclick="SETTINGS.clearCache()">${UI.icon('trash')} Limpar Cache e Recarregar</button>
                </div>

                <div class="section-title mt-md">${UI.icon('sun')} Tema</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Escolha o tema do painel.</p>
                    <div class="theme-options">
                        <label class="theme-option"><input type="radio" name="theme" value="dark" onchange="SETTINGS.setTheme('dark')"> <span>${UI.icon('moon')} Escuro</span></label>
                        <label class="theme-option"><input type="radio" name="theme" value="light" onchange="SETTINGS.setTheme('light')"> <span>${UI.icon('sun')} Claro</span></label>
                        <label class="theme-option"><input type="radio" name="theme" value="system" onchange="SETTINGS.setTheme('system')"> <span>${UI.icon('monitor')} Sistema</span></label>
                    </div>
                </div>

                <div class="section-title mt-md">${UI.icon('server')} Servidor</div>
                <div class="settings-card">
                    <div id="server-info" class="loading">Carregando...</div>
                    <div class="form-group" style="margin-top:12px">
                        <label class="form-label">IP do servidor (host)</label>
                        <div style="display:flex;gap:8px">
                            <input type="text" id="server-ip" class="form-input" style="flex:1" placeholder="192.168.254.219">
                            <button class="btn btn-primary" onclick="SETTINGS.saveServerIp()">${UI.icon('check')} Salvar</button>
                        </div>
                        <p class="text-muted text-sm" style="margin-top:6px">Ao salvar, o painel reinicia e re-sincroniza os TV boxes automaticamente.</p>
                    </div>
                    <div id="server-ip-status" class="settings-status"></div>
                </div>
            </div>
        `;

        await loadServerInfo();
        syncThemeRadios();
    }

    async function saveAdmin() {
        const status = document.getElementById('sec-admin-status');
        const user = document.getElementById('sec-admin-user');
        const pass = document.getElementById('sec-admin-pass');
        const currPass = document.getElementById('sec-admin-current-pass');
        const uname = user ? user.value.trim() : '';
        if (!/^[A-Za-z0-9._@-]{2,64}$/.test(uname)) {
            if (status) status.innerHTML = '<span class="text-danger">Usuário inválido — use 2-64 caracteres: letras, números, . _ @ - (sem espaços)</span>';
            return;
        }
        if (!pass || pass.value.length < 8) { if (status) status.innerHTML = '<span class="text-danger">Senha precisa ter pelo menos 8 caracteres</span>'; return; }
        try {
            const payload = { username: uname, password: pass.value };
            if (currPass && currPass.value) {
                payload.current_password = currPass.value;
            }
            const res = await API.post('/auth/set-admin', payload);
            if (res && res.success) {
                if (status) status.innerHTML = '<span class="text-success">✅ Administrador salvo. Use usuário/senha no login da próxima vez.</span>';
                pass.value = '';
                if (currPass) currPass.value = '';
                // se criou agora, já autentica a sessão atual
                if (res.token && typeof AUTH !== 'undefined') AUTH.setToken(res.token);
            } else {
                if (status) status.innerHTML = `<span class="text-danger">❌ ${(res && res.detail) || 'Falha'}</span>`;
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger">❌ ${UI.escapeHtml(e.message)}</span>`;
        }
    }

    async function loadServerInfo() {
        const el = document.getElementById('server-info');
        if (!el) return;

        try {
            const [health, metrics, devices, cfg] = await Promise.all([
                API.get('/system/health'),
                API.get('/system/metrics'),
                API.get('/devices').catch(() => []),
                API.get('/system/config').catch(() => null),
            ]);
            const serverIp = (cfg && cfg.system && cfg.system.host && cfg.system.host.ip) || '';
            const ipInput = document.getElementById('server-ip');
            if (ipInput && serverIp) ipInput.value = serverIp;

            const uptime = fmtUptime(metrics.uptime_seconds || 0);
            const devCount = Array.isArray(devices) ? devices.length : 0;
            // Exemplo de path de stream (usa o rtsp_path do 1º device, se houver)
            const firstPath = (Array.isArray(devices) && devices[0] && devices[0].rtsp_path) || '';
            const streamPath = firstPath ? `/${firstPath}` : '';

            el.innerHTML = `
                <div class="info-row"><span class="info-key">Versão</span><span class="info-val">${UI.escapeHtml(health.version)}</span></div>
                <div class="info-row"><span class="info-key">Status</span><span class="info-val">${UI.escapeHtml(health.status)}</span></div>
                <div class="info-row"><span class="info-key">Wizard</span><span class="info-val">${health.wizard_completed ? 'Completo' : 'Pendente'}</span></div>
                <div class="info-row"><span class="info-key">Dispositivos</span><span class="info-val">${devCount}</span></div>
                <div class="info-row"><span class="info-key">Uptime</span><span class="info-val">${uptime}</span></div>
                <div class="info-row"><span class="info-key">CPU</span><span class="info-val">${metrics.cpu_percent}%</span></div>
                <div class="info-row"><span class="info-key">RAM</span><span class="info-val">${metrics.ram_used_gb}/${metrics.ram_total_gb} GB (${metrics.ram_percent}%)</span></div>
                <div class="info-row"><span class="info-key">Disco</span><span class="info-val">${metrics.disk_used_gb}/${metrics.disk_total_gb} GB (${metrics.disk_percent}%)</span></div>
                <div class="info-row"><span class="info-key">IP do servidor</span><span class="info-val mono">${UI.escapeHtml(serverIp)}</span></div>
                <div class="info-row"><span class="info-key">Painel</span><span class="info-val mono">http://${UI.escapeHtml(serverIp)}:8080</span></div>
                <div class="info-row"><span class="info-key">RTSP</span><span class="info-val mono">rtsp://${UI.escapeHtml(serverIp)}:8554${streamPath}</span></div>
                <div class="info-row"><span class="info-key">RTMP</span><span class="info-val mono">rtmp://${UI.escapeHtml(serverIp)}:1935${streamPath}</span></div>
            `;
            el.classList.remove('loading');
        } catch (e) {
            el.innerHTML = `<span class="text-danger">Erro: ${UI.escapeHtml(e.message)}</span>`;
            el.classList.remove('loading');
        }
    }

    function fmtUptime(sec) {
        if (!sec || sec <= 0) return '—';
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}min`;
    }

    function syncThemeRadios() {
        if (typeof THEME === 'undefined') return;
        const choice = THEME.getStored();
        document.querySelectorAll('input[name="theme"]').forEach(r => {
            r.checked = r.value === choice;
        });
    }

    function setTheme(choice) {
        if (typeof THEME !== 'undefined') THEME.apply(choice);
        UI.createToast(`Tema: ${choice}`, 'success');
    }

    async function saveServerIp() {
        const input = document.getElementById('server-ip');
        const status = document.getElementById('server-ip-status');
        const ip = input ? input.value.trim() : '';
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            if (status) status.innerHTML = '<span class="text-danger">IP invalido</span>';
            return;
        }
        try {
            const res = await API.put('/system/host-ip', { ip });
            if (res && res.success) {
                UI.showModal(
                    'IP salvo - reiniciar painel',
                    '<p>O painel vai reiniciar e ficar fora do ar por <strong>~2 minutos</strong>.</p>' +
                    '<p>Durante o reinicio, os TV boxes serao re-sincronizados automaticamente (scripts + heartbeat com o novo IP).</p>' +
                    '<p>Nao feche esta pagina - ela recarrega sozinha.</p>',
                    async () => {
                        if (status) status.innerHTML = '<span class="text-success">IP salvo - reiniciando o painel...</span>';
                        UI.createToast('Reiniciando painel...', 'info', 5000);
                        setTimeout(async () => {
                            try { await API.post('/system/restart'); } catch (e) { /* conexao caiu - esperado */ }
                            setTimeout(() => window.location.reload(), 9000);
                        }, 500);
                    }
                );
            } else {
                if (status) status.innerHTML = `<span class="text-danger">${UI.escapeHtml((res && res.detail) || 'Falha')}</span>`;
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger">${UI.escapeHtml(e.message)}</span>`;
        }
    }
    async function checkUpdate() {
        const status = document.getElementById('update-status');
        const btn = document.getElementById('btn-apply');
        if (status) status.innerHTML = '<span class="settings-loading">Verificando atualizações no git...</span>';

        try {
            const res = await API.post('/update/check');
            if (res.has_update) {
                let clHtml = '';
                if (Array.isArray(res.changelog) && res.changelog.length > 0) {
                    const items = res.changelog.map(c => `<li>${UI.escapeHtml(c)}</li>`).join('');
                    clHtml = `<div style="margin-top:8px;padding:8px;background:var(--bg-secondary,#1e293b);border-radius:6px;max-height:140px;overflow-y:auto">
                        <strong style="font-size:12px;color:var(--text-muted)">Commits a aplicar:</strong>
                        <ul style="margin:4px 0 0 16px;padding:0;font-family:monospace;font-size:11px">${items}</ul>
                    </div>`;
                }
                if (status) {
                    status.innerHTML = `<span class="text-warning">📦 Atualização disponível: <strong>${UI.escapeHtml(res.current)}</strong> → <strong>${UI.escapeHtml(res.remote)}</strong></span>${clHtml}`;
                }
                if (btn) btn.disabled = false;
            } else if (res.error) {
                if (status) status.innerHTML = `<span class="text-muted">${UI.escapeHtml(res.error)}</span>`;
            } else {
                if (status) status.innerHTML = `<span class="text-success">✅ Painel atualizado (versão: ${UI.escapeHtml(res.current)})</span>`;
                if (btn) btn.disabled = true;
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger">❌ ${UI.escapeHtml(e.message)}</span>`;
        }
    }

    async function applyUpdate() {
        const status = document.getElementById('update-status');
        const btn = document.getElementById('btn-apply');

        UI.showModal(
            'Aplicar Atualização',
            `<p>O painel fará <strong>backup automático das configurações</strong>, aplicará as mudanças via <code>git pull</code> e reiniciará o serviço.</p><p>Deseja continuar?</p>`,
            async () => {
                if (status) status.innerHTML = '<span class="settings-loading">Baixando e validando atualização...</span>';
                if (btn) btn.disabled = true;

                try {
                    const res = await API.post('/update/apply');
                    if (res.success) {
                        const restartMsg = res.restart || 'Reiniciando painel...';
                        if (status) {
                            status.innerHTML = `<span class="text-success">✅ Atualização aplicada! Backup: <code>${UI.escapeHtml(res.backup || '')}</code></span><br><span class="text-muted text-sm">${UI.escapeHtml(restartMsg)}</span>`;
                        }
                        UI.createToast('🔄 Reiniciando painel...', 'info', 10000);
                        
                        // Polling de reconexão
                        let attempts = 0;
                        const checkInterval = setInterval(async () => {
                            attempts++;
                            try {
                                const h = await fetch('/api/system/health');
                                if (h.ok) {
                                    clearInterval(checkInterval);
                                    UI.createToast('✅ Painel online!', 'success');
                                    setTimeout(() => window.location.reload(), 1000);
                                }
                            } catch (e) {
                                if (attempts > 30) {
                                    clearInterval(checkInterval);
                                    if (status) status.innerHTML += '<br><span class="text-warning">Recarregue a página manualmente.</span>';
                                }
                            }
                        }, 2000);

                    } else {
                        if (status) status.innerHTML = `<span class="text-danger">❌ ${UI.escapeHtml(res.error || 'Falha')} ${res.rolled_back ? '(Rollback executado)' : ''}</span>`;
                        if (btn) btn.disabled = false;
                    }
                } catch (e) {
                    if (status) status.innerHTML = `<span class="text-danger">❌ ${UI.escapeHtml(e.message)}</span>`;
                    if (btn) btn.disabled = false;
                }
            }
        );
    }

    function clearCache() {
        if ('caches' in window) {
            caches.keys().then(names => names.forEach(n => caches.delete(n)));
        }
        window.location.reload(true);
    }

    function toggleTheme() {
        if (typeof THEME !== 'undefined') {
            const choice = THEME.cycle();
            syncThemeRadios();
            UI.createToast(`Tema: ${choice}`, 'success');
            return;
        }
        // Fallback legado
        const isDark = !document.body.classList.contains('theme-light');
        document.body.classList.toggle('theme-light', isDark);
        document.body.classList.toggle('theme-dark', !isDark);
        localStorage.setItem('theme', isDark ? 'light' : 'dark');
        UI.createToast(`Tema ${isDark ? 'claro' : 'escuro'} ativado`, 'success');
    }

    return { render, checkUpdate, applyUpdate, clearCache, toggleTheme, setTheme, syncThemeRadios, saveAdmin, saveServerIp };
})();
