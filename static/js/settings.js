/**
 * Settings Page — configurações gerais, segurança, métricas do host e atualização do sistema.
 */
const SETTINGS = (() => {

    async function render(el) {
        UI.setPageTitle('Configurações');

        el.innerHTML = `
            <div class="settings-page">
                <div class="section-title">${UI.icon('refresh')} Atualização do Sistema</div>
                <div class="settings-card" id="update-section">
                    <p class="text-muted text-sm">Verifica e aplica atualizações do painel a partir do repositório Git com criação de backup e rollback automático em caso de falha.</p>
                    <div class="settings-actions">
                        <button class="btn btn-secondary btn-sm" id="btn-check-update" onclick="SETTINGS.checkUpdate()">${UI.icon('search')} Verificar Atualizações</button>
                        <button class="btn btn-primary btn-sm" onclick="SETTINGS.applyUpdate()" id="btn-apply" disabled>${UI.icon('refresh')} Aplicar Atualização</button>
                    </div>
                    <div id="update-status" class="settings-status"></div>
                </div>

                <div class="section-title mt-md">${UI.icon('server')} Servidor & Rede</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Informações em tempo real do host e configuração do endereço IP de anúncio aos TV Boxes.</p>
                    <div id="server-info">
                        ${UI.skeletons('line', 4)}
                    </div>
                    <div class="form-grid" style="margin-top:16px;border-top:1px solid var(--border-subtle);padding-top:16px">
                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label">Endereço IP do Servidor (Host)</label>
                            <div style="display:flex;gap:8px;align-items:center;max-width:480px">
                                <input type="text" id="server-ip" class="form-input mono" placeholder="192.168.1.100">
                                <button class="btn btn-primary btn-sm" onclick="SETTINGS.saveServerIp()">${UI.icon('check')} Salvar IP</button>
                            </div>
                            <span class="text-muted text-xs" style="margin-top:6px;display:block">
                                Ao alterar o IP, o painel reconfigura as rotas e re-sincroniza os TV boxes via heartbeat.
                            </span>
                        </div>
                    </div>
                    <div id="server-ip-status" class="settings-status"></div>
                </div>

                <div class="section-title mt-md">${UI.icon('lock')} Segurança & Autenticação</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Credenciais do administrador do painel. As senhas são protegidas por hash criptográfico e armazenadas localmente.</p>
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">Nome de Usuário</label>
                            <input type="text" id="sec-admin-user" class="form-input" placeholder="admin" autocomplete="username">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Senha Atual (se alterando)</label>
                            <input type="password" id="sec-admin-current-pass" class="form-input" placeholder="••••••••" autocomplete="current-password">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Nova Senha (mín. 8 caracteres)</label>
                            <input type="password" id="sec-admin-pass" class="form-input" placeholder="••••••••" autocomplete="new-password">
                        </div>
                    </div>
                    <div class="settings-actions" style="margin-top:14px">
                        <button class="btn btn-primary btn-sm" onclick="SETTINGS.saveAdmin()">${UI.icon('check')} Salvar Administrador</button>
                    </div>
                    <div id="sec-admin-status" class="settings-status"></div>
                </div>

                <div class="section-title mt-md">${UI.icon('sun')} Tema & Aparência</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Personalize o esquema de cores e o contraste do painel administrativo.</p>
                    <div class="theme-options">
                        <label class="theme-option"><input type="radio" name="theme" value="dark" onchange="SETTINGS.setTheme('dark')"> <span>${UI.icon('moon')} Modo Escuro</span></label>
                        <label class="theme-option"><input type="radio" name="theme" value="light" onchange="SETTINGS.setTheme('light')"> <span>${UI.icon('sun')} Modo Claro</span></label>
                        <label class="theme-option"><input type="radio" name="theme" value="system" onchange="SETTINGS.setTheme('system')"> <span>${UI.icon('monitor')} Automático (Sistema)</span></label>
                    </div>
                </div>

                <div class="section-title mt-md">${UI.icon('trash')} Manutenção & Cache</div>
                <div class="settings-card">
                    <p class="text-muted text-sm">Caso encontre comportamentos inesperados na interface após atualizações, limpe o cache do navegador.</p>
                    <div class="settings-actions">
                        <button class="btn btn-secondary btn-sm" onclick="SETTINGS.clearCache()">${UI.icon('trash')} Limpar Cache e Recarregar</button>
                    </div>
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
            const err = 'Usuário inválido — use 2 a 64 caracteres (letras, números, . _ @ -)';
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('alert')} ${err}</span>`;
            UI.createToast(err, 'warning');
            return;
        }

        if (!pass || pass.value.length < 8) {
            const err = 'A senha precisa ter pelo menos 8 caracteres.';
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('alert')} ${err}</span>`;
            UI.createToast(err, 'warning');
            return;
        }

        try {
            const payload = { username: uname, password: pass.value };
            if (currPass && currPass.value) {
                payload.current_password = currPass.value;
            }
            const res = await API.post('/auth/set-admin', payload);
            if (res && res.success) {
                const msg = 'Administrador salvo com sucesso! Use as novas credenciais no próximo login.';
                if (status) status.innerHTML = `<span class="text-success">${UI.icon('check')} ${msg}</span>`;
                UI.createToast(msg, 'success');
                pass.value = '';
                if (currPass) currPass.value = '';
                if (res.token && typeof AUTH !== 'undefined') AUTH.setToken(res.token);
            } else {
                const err = (res && res.detail) || 'Falha ao salvar credenciais.';
                if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} ${UI.escapeHtml(err)}</span>`;
                UI.createToast(err, 'error');
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} ${UI.escapeHtml(e.message)}</span>`;
            UI.createToast(e.message, 'error');
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
            const firstPath = (Array.isArray(devices) && devices[0] && devices[0].rtsp_path) || '';
            const streamPath = firstPath ? `/${firstPath}` : '';

            el.innerHTML = `
                <div class="server-metrics-grid">
                    <div class="server-metric-item">
                        <span class="metric-label">Versão do Painel</span>
                        <span class="metric-value mono">${UI.escapeHtml(health.version || '0.1.0')}</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Status do Sistema</span>
                        <span class="metric-value">${UI.stateBadge(health.status || 'ok')}</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">TV Boxes Cadastrados</span>
                        <span class="metric-value">${devCount}</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Tempo de Atividade</span>
                        <span class="metric-value">${uptime}</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Uso de CPU</span>
                        <span class="metric-value">${metrics.cpu_percent || 0}%</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Memória RAM</span>
                        <span class="metric-value">${metrics.ram_used_gb || 0} / ${metrics.ram_total_gb || 0} GB (${metrics.ram_percent || 0}%)</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Armazenamento em Disco</span>
                        <span class="metric-value">${metrics.disk_used_gb || 0} / ${metrics.disk_total_gb || 0} GB (${metrics.disk_percent || 0}%)</span>
                    </div>
                    <div class="server-metric-item">
                        <span class="metric-label">Wizard Inicial</span>
                        <span class="metric-value">${health.wizard_completed ? 'Completo' : 'Pendente'}</span>
                    </div>
                </div>

                <div class="server-urls-box">
                    <div class="info-row"><span class="info-key">Painel Web:</span><span class="info-val mono">http://${UI.escapeHtml(serverIp)}:8080</span></div>
                    <div class="info-row"><span class="info-key">Servidor RTSP:</span><span class="info-val mono">rtsp://${UI.escapeHtml(serverIp)}:8554${streamPath}</span></div>
                    <div class="info-row"><span class="info-key">Servidor RTMP:</span><span class="info-val mono">rtmp://${UI.escapeHtml(serverIp)}:1935${streamPath}</span></div>
                </div>
            `;
        } catch (e) {
            el.innerHTML = UI.stateView('error', `Falha ao obter status do servidor: ${e.message}`, { retry: true });
            UI.bindStateRetry(el, loadServerInfo);
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
        UI.createToast(`Tema alterado para: ${choice}`, 'info');
    }

    async function saveServerIp() {
        const input = document.getElementById('server-ip');
        const status = document.getElementById('server-ip-status');
        const ip = input ? input.value.trim() : '';

        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            const err = 'Formato de IP inválido. Utilize o formato padrão (ex: 192.168.1.100).';
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('alert')} ${err}</span>`;
            UI.createToast(err, 'warning');
            return;
        }

        try {
            const res = await API.put('/system/host-ip', { ip });
            if (res && res.success) {
                UI.showModal(
                    'Confirmar Novo IP e Reinício',
                    `<p>O endereço IP do servidor será alterado para <strong>${UI.escapeHtml(ip)}</strong>.</p>` +
                    `<p>O painel será reiniciado para reconfigurar as regras de rede e os TV boxes serão sincronizados automaticamente.</p>` +
                    `<p class="text-muted text-sm">Esta página recarregará automaticamente quando o serviço estiver disponível.</p>`,
                    async () => {
                        if (status) status.innerHTML = `<span class="text-success">${UI.icon('refresh')} IP salvo. Reiniciando o serviço do painel...</span>`;
                        UI.createToast('Reiniciando serviço do painel...', 'info', 8000);
                        setTimeout(async () => {
                            try { await API.post('/system/restart'); } catch (e) { /* desconexão esperada */ }
                            setTimeout(() => window.location.reload(), 8000);
                        }, 500);
                    }
                );
            } else {
                const err = (res && res.detail) || 'Falha ao salvar IP.';
                if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} ${UI.escapeHtml(err)}</span>`;
                UI.createToast(err, 'error');
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger">${UI.icon('x')} ${UI.escapeHtml(e.message)}</span>`;
            UI.createToast(e.message, 'error');
        }
    }

    async function checkUpdate() {
        const status = document.getElementById('update-status');
        const btnCheck = document.getElementById('btn-check-update');
        const btnApply = document.getElementById('btn-apply');

        if (status) {
            status.innerHTML = `
                <div style="margin-top:10px">
                    <span class="text-muted text-sm">${UI.icon('search')} Verificando repositório Git...</span>
                    ${UI.skeletons('line', 2)}
                </div>
            `;
        }
        if (btnCheck) btnCheck.disabled = true;

        try {
            const res = await API.post('/update/check');
            if (res.has_update) {
                let clHtml = '';
                if (Array.isArray(res.changelog) && res.changelog.length > 0) {
                    const items = res.changelog.map(c => `<li>${UI.escapeHtml(c)}</li>`).join('');
                    clHtml = `
                        <div class="update-changelog-box">
                            <div class="changelog-title">${UI.icon('file')} Commits a aplicar:</div>
                            <ul class="changelog-list">${items}</ul>
                        </div>
                    `;
                }
                if (status) {
                    status.innerHTML = `
                        <div class="update-available-banner">
                            <span class="text-warning font-semibold">${UI.icon('alert')} Nova versão disponível: <code>${UI.escapeHtml(res.current)}</code> → <code>${UI.escapeHtml(res.remote)}</code></span>
                            ${clHtml}
                        </div>
                    `;
                }
                if (btnApply) btnApply.disabled = false;
                UI.createToast(`Atualização disponível (${res.current} → ${res.remote})`, 'info');
            } else if (res.error) {
                if (status) status.innerHTML = `<span class="text-muted text-sm">${UI.icon('alert')} ${UI.escapeHtml(res.error)}</span>`;
                if (btnApply) btnApply.disabled = true;
                UI.createToast(res.error, 'warning');
            } else {
                if (status) status.innerHTML = `<span class="text-success text-sm font-semibold">${UI.icon('check')} O sistema está na versão mais recente (commit: <code>${UI.escapeHtml(res.current)}</code>)</span>`;
                if (btnApply) btnApply.disabled = true;
                UI.createToast('O painel já está atualizado.', 'success');
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="text-danger text-sm">${UI.icon('x')} Erro ao verificar atualizações: ${UI.escapeHtml(e.message)}</span>`;
            UI.createToast(`Erro: ${e.message}`, 'error');
        } finally {
            if (btnCheck) btnCheck.disabled = false;
        }
    }

    async function applyUpdate() {
        const status = document.getElementById('update-status');
        const btnApply = document.getElementById('btn-apply');
        const btnCheck = document.getElementById('btn-check-update');

        UI.showModal(
            'Confirmar Atualização do Painel',
            `<div class="modal-body-content">
                <p>O processo executará automaticamente:</p>
                <ol style="margin-left:20px;margin-bottom:12px;font-size:0.9em;line-height:1.6">
                    <li>Backup completo da configuração atual em <code>backups/</code></li>
                    <li>Sincronização com o repositório remoto (<code>git pull</code>)</li>
                    <li>Verificação de integridade dos arquivos e dependências</li>
                    <li>Reinício automático do serviço do painel</li>
                </ol>
                <p class="text-muted text-xs">Se ocorrer qualquer inconsistência, o rollback restaurará o estado anterior automaticamente.</p>
            </div>`,
            async () => {
                if (btnApply) btnApply.disabled = true;
                if (btnCheck) btnCheck.disabled = true;

                if (status) {
                    status.innerHTML = `
                        <div class="update-progress-container">
                            <div class="update-progress-header">
                                <span class="update-step-label" id="update-step">Iniciando processo de atualização...</span>
                                <span class="update-progress-pct" id="update-pct">15%</span>
                            </div>
                            <div class="update-progress-bar">
                                <div class="update-progress-fill" id="update-fill" style="width: 15%"></div>
                            </div>
                        </div>
                    `;
                }

                const updateUiProgress = (pct, step) => {
                    const fill = document.getElementById('update-fill');
                    const pctEl = document.getElementById('update-pct');
                    const stepEl = document.getElementById('update-step');
                    if (fill) fill.style.width = `${pct}%`;
                    if (pctEl) pctEl.textContent = `${pct}%`;
                    if (stepEl) stepEl.textContent = step;
                };

                setTimeout(() => updateUiProgress(35, 'Criando backup de segurança das configurações...'), 400);
                setTimeout(() => updateUiProgress(60, 'Baixando mudanças via git pull...'), 1200);

                try {
                    const res = await API.post('/update/apply');
                    if (res.success) {
                        updateUiProgress(90, 'Reiniciando o serviço do painel...');
                        UI.createToast('Atualização aplicada! Reiniciando painel...', 'info', 10000);

                        if (status) {
                            status.innerHTML = `
                                <div class="update-progress-container">
                                    <div class="update-progress-header">
                                        <span class="update-step-label text-success font-semibold">${UI.icon('check')} Atualização aplicada com sucesso!</span>
                                        <span class="update-progress-pct">100%</span>
                                    </div>
                                    <div class="update-progress-bar">
                                        <div class="update-progress-fill" style="width: 100%; background: var(--text-primary)"></div>
                                    </div>
                                    <div class="polling-indicator" id="restart-polling" style="margin-top:10px">
                                        <span class="spinner-sm"></span> Aguardando o serviço religar... (tentativa <span id="poll-attempt">1</span> de 30)
                                    </div>
                                </div>
                            `;
                        }

                        let attempts = 0;
                        const checkInterval = setInterval(async () => {
                            attempts++;
                            const attemptEl = document.getElementById('poll-attempt');
                            if (attemptEl) attemptEl.textContent = String(attempts);

                            try {
                                const h = await fetch('/api/system/health');
                                if (h.ok) {
                                    clearInterval(checkInterval);
                                    UI.createToast('Painel online e atualizado!', 'success');
                                    setTimeout(() => window.location.reload(), 1200);
                                }
                            } catch (e) {
                                if (attempts >= 30) {
                                    clearInterval(checkInterval);
                                    const pollBox = document.getElementById('restart-polling');
                                    if (pollBox) {
                                        pollBox.innerHTML = `<span class="text-warning">${UI.icon('alert')} O painel pode estar demorando a inicializar. Por favor, recarregue a página manualmente.</span>`;
                                    }
                                }
                            }
                        }, 2000);

                    } else {
                        const err = res.error || 'Falha na aplicação da atualização';
                        const rollbackNote = res.rolled_back ? ' (Rollback executado com sucesso)' : '';
                        if (status) {
                            status.innerHTML = `<div class="text-danger text-sm" style="margin-top:8px">${UI.icon('x')} ${UI.escapeHtml(err)}${rollbackNote}</div>`;
                        }
                        UI.createToast(`${err}${rollbackNote}`, 'error');
                        if (btnApply) btnApply.disabled = false;
                        if (btnCheck) btnCheck.disabled = false;
                    }
                } catch (e) {
                    if (status) {
                        status.innerHTML = `<div class="text-danger text-sm" style="margin-top:8px">${UI.icon('x')} Erro: ${UI.escapeHtml(e.message)}</div>`;
                    }
                    UI.createToast(e.message, 'error');
                    if (btnApply) btnApply.disabled = false;
                    if (btnCheck) btnCheck.disabled = false;
                }
            }
        );
    }

    function clearCache() {
        if ('caches' in window) {
            caches.keys().then(names => names.forEach(n => caches.delete(n)));
        }
        UI.createToast('Cache limpo. Recarregando a aplicação...', 'info');
        setTimeout(() => window.location.reload(true), 500);
    }

    function toggleTheme() {
        if (typeof THEME !== 'undefined') {
            const choice = THEME.cycle();
            syncThemeRadios();
            UI.createToast(`Tema: ${choice}`, 'success');
            return;
        }
        const isDark = !document.body.classList.contains('theme-light');
        document.body.classList.toggle('theme-light', isDark);
        document.body.classList.toggle('theme-dark', !isDark);
        localStorage.setItem('theme', isDark ? 'light' : 'dark');
        UI.createToast(`Tema ${isDark ? 'claro' : 'escuro'} ativado`, 'success');
    }

    return { render, checkUpdate, applyUpdate, clearCache, toggleTheme, setTheme, syncThemeRadios, saveAdmin, saveServerIp };
})();
