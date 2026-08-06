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
        if (!user || !user.value.trim()) { if (status) status.innerHTML = '<span class="text-danger">Informe o usuário</span>'; return; }
        if (!pass || pass.value.length < 8) { if (status) status.innerHTML = '<span class="text-danger">Senha precisa ter pelo menos 8 caracteres</span>'; return; }
        try {
            const res = await API.post('/auth/set-admin', { username: user.value.trim(), password: pass.value });
            if (res && res.success) {
                if (status) status.innerHTML = '<span class="text-success">✅ Administrador salvo. Use usuário/senha no login da próxima vez.</span>';
                pass.value = '';
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
            const [health, metrics, devices] = await Promise.all([
                API.get('/system/health'),
                API.get('/system/metrics'),
                API.get('/devices').catch(() => []),
            ]);
            const uptime = fmtUptime(metrics.uptime_seconds || 0);
            const devCount = Array.isArray(devices) ? devices.length : 0;

            el.innerHTML = `
                <div class="info-row"><span class="info-key">Versão</span><span class="info-val">${UI.escapeHtml(health.version)}</span></div>
                <div class="info-row"><span class="info-key">Status</span><span class="info-val">${UI.escapeHtml(health.status)}</span></div>
                <div class="info-row"><span class="info-key">Wizard</span><span class="info-val">${health.wizard_completed ? 'Completo' : 'Pendente'}</span></div>
                <div class="info-row"><span class="info-key">Dispositivos</span><span class="info-val">${devCount}</span></div>
                <div class="info-row"><span class="info-key">Uptime</span><span class="info-val">${uptime}</span></div>
                <div class="info-row"><span class="info-key">CPU</span><span class="info-val">${metrics.cpu_percent}%</span></div>
                <div class="info-row"><span class="info-key">RAM</span><span class="info-val">${metrics.ram_used_gb}/${metrics.ram_total_gb} GB (${metrics.ram_percent}%)</span></div>
                <div class="info-row"><span class="info-key">Disco</span><span class="info-val">${metrics.disk_used_gb}/${metrics.disk_total_gb} GB (${metrics.disk_percent}%)</span></div>
            `;
        } catch (e) {
            el.innerHTML = `<span class="text-danger">Erro: ${UI.escapeHtml(e.message)}</span>`;
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

    async function checkUpdate() {
        const status = document.getElementById('update-status');
        const btn = document.getElementById('btn-apply');
        if (status) status.innerHTML = '<span class="settings-loading">Verificando...</span>';

        try {
            const res = await API.post('/update/check');
            if (res.has_update) {
                if (status) status.innerHTML = `<span class="text-warning">📦 Atualização disponível: ${UI.escapeHtml(res.current)} → ${UI.escapeHtml(res.remote)}</span>`;
                if (btn) btn.disabled = false;
            } else if (res.error) {
                if (status) status.innerHTML = `<span class="text-muted">${UI.escapeHtml(res.error)}</span>`;
            } else {
                if (status) status.innerHTML = `<span class="text-success">✅ Versão atual: ${UI.escapeHtml(res.current)}</span>`;
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
            `<p>Tem certeza? O painel será reiniciado após a atualização.</p>`,
            async () => {
                if (status) status.innerHTML = '<span class="settings-loading">Aplicando atualização...</span>';
                if (btn) btn.disabled = true;

                try {
                    const res = await API.post('/update/apply');
                    if (res.success) {
                        if (status) status.innerHTML = `<span class="text-success">✅ Atualização aplicada! ${UI.escapeHtml(res.migration || '')}</span>`;
                        UI.createToast('🔄 Reiniciando painel...', 'info', 5000);
                        setTimeout(() => location.reload(), 2000);
                    } else {
                        if (status) status.innerHTML = `<span class="text-danger">❌ ${res.error || 'Falha'}</span>`;
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

    return { render, checkUpdate, applyUpdate, clearCache, toggleTheme, setTheme, syncThemeRadios, saveAdmin };
})();
