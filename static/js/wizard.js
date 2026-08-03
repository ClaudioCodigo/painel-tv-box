/**
 * Wizard — assistente de configuração inicial (10 steps).
 * Estado client-side, tudo enviado no finish.
 */
const WIZARD = (() => {
    let currentStep = 1;
    const TOTAL_STEPS = 10;

    // Estado completo do wizard (client-side)
    const data = {
        server: { host: '', port: 8080, ip: '' },
        mediamtx: { api_url: 'http://localhost:9997', rtsp_port: 8554, rtmp_port: 1935 },
        adb: { default_port: 5555, connect_timeout: 10 },
        players: null,
        watchdog: null,
        groups: [],
        devices: [],
    };

    // ── Render ─────────────────────────────────

    function render(el) {
        UI.setPageTitle('Configuração Inicial');
        el.innerHTML = `
            <div class="wizard-progress" id="wizard-progress"></div>
            <div class="wizard-step" id="wizard-step"></div>
        `;
        renderStep(currentStep);
    }

    function renderStep(step) {
        currentStep = step;

        // Progresso: steps numerados (D6)
        const STEP_NAMES = ['Boas-vindas', 'Servidor', 'MediaMTX', 'ADB', 'Players', 'Watchdog', 'Grupos', 'Dispositivos', 'Revisão', 'Finalizar'];
        let dots = '';
        for (let i = 1; i <= TOTAL_STEPS; i++) {
            const cls = i === step ? 'active' : (i < step ? 'done' : '');
            const label = STEP_NAMES[i - 1] || `Passo ${i}`;
            dots += `<span class="wizard-step-dot ${cls}" title="${label}">${i < step ? '✓' : i}</span>`;
        }
        const progHtml = `
            <div class="wizard-steps">${dots}</div>
            <span class="wizard-progress-text">${STEP_NAMES[step - 1] || `Passo ${step}`} · ${step} de ${TOTAL_STEPS}</span>
        `;
        document.getElementById('wizard-progress').innerHTML = progHtml;

        // Step content
        const html = STEP_RENDERERS[step]();
        let navHtml = '<div class="wizard-nav">';

        if (step > 1) {
            navHtml += `<button class="btn btn-secondary" onclick="WIZARD.goPrev()">← Anterior</button>`;
        } else {
            navHtml += '<div></div>';
        }

        if (step < TOTAL_STEPS) {
            navHtml += `<button class="btn btn-primary" id="wizard-next-btn" onclick="WIZARD.goNext()">Próximo →</button>`;
        } else {
            navHtml += `<button class="btn btn-success" id="wizard-finish-btn" onclick="WIZARD.finish()">Finalizar</button>`;
        }

        navHtml += '</div>';
        document.getElementById('wizard-step').innerHTML = html + navHtml;
    }

    // ── Navegação ──────────────────────────────

    function goPrev() {
        saveStepData();
        renderStep(currentStep - 1);
    }

    function goNext() {
        if (!validateStep()) return;
        saveStepData();
        renderStep(currentStep + 1);
    }

    function saveStepData() {
        switch (currentStep) {
            case 2: _saveServer(); break;
            case 3: _saveMediaMTX(); break;
            case 4: _saveADB(); break;
            case 5: _savePlayers(); break;
            case 6: _saveWatchdog(); break;
            case 7: break; // groups saved on add
            case 8: break; // devices saved on add
        }
    }

    function validateStep() {
        let valid = true;
        switch (currentStep) {
            case 2: valid = _validateServer(); break;
            case 3: valid = _validateMediaMTX(); break;
            case 8: valid = _validateDevices(); break;
        }
        return valid;
    }

    function skipStep() {
        saveStepData();
        switch (currentStep) {
            case 4: data.adb = { default_port: 5555, connect_timeout: 10 }; break;
            case 5: data.players = null; break;
            case 6: data.watchdog = null; break;
            case 7: data.groups = []; break;
        }
        renderStep(currentStep + 1);
    }

    // ── Steps (renderizadores) ─────────────────

    const STEP_RENDERERS = {
        1: () => `
            <h2>Boas-vindas!</h2>
            <p>Este assistente vai configurar o Painel TV Box para gerenciar seus TV Boxes Android.</p>
            <p>Você vai precisar de:</p>
            <ul style="color:var(--text-secondary);font-size:0.9em;line-height:1.8;margin-bottom:16px">
                <li><strong>IP do servidor</strong> onde o painel e MediaMTX rodam</li>
                <li><strong>Pelo menos 1 TV Box</strong> com ADB via TCP habilitado</li>
                <li>🔗 <strong>Configuração do MediaMTX</strong> (ou usar os defaults)</li>
            </ul>
            <p>O processo leva cerca de 2 minutos. Bora? 🚀</p>
        `,

        2: () => `
            <h2>Servidor</h2>
            <p>Configure o endereço do servidor onde o painel está rodando.</p>
            <div class="form-group">
                <label>IP do servidor</label>
                <input type="text" id="w-srv-ip" value="${data.server.ip}" placeholder="192.168.254.102">
                <div class="form-hint">Usado para montar URLs RTSP</div>
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Porta do Painel</label>
                    <input type="number" id="w-srv-port" value="${data.server.port}" placeholder="8080">
                </div>
                <div class="form-group">
                    <label>Host de escuta</label>
                    <input type="text" id="w-srv-host" value="${data.server.host}" placeholder="0.0.0.0">
                </div>
            </div>
        `,

        3: () => `
            <h2>MediaMTX</h2>
            <p>Configure o servidor de streaming MediaMTX.</p>
            <div class="form-group">
                <label>URL da API</label>
                <input type="text" id="w-mtx-api" value="${data.mediamtx.api_url}" placeholder="http://localhost:9997">
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Porta RTSP</label>
                    <input type="number" id="w-mtx-rtsp" value="${data.mediamtx.rtsp_port}" placeholder="8554">
                </div>
                <div class="form-group">
                    <label>Porta RTMP</label>
                    <input type="number" id="w-mtx-rtmp" value="${data.mediamtx.rtmp_port}" placeholder="1935">
                </div>
            </div>
        `,

        4: () => `
            <h2>ADB</h2>
            <p>Configuração da conexão ADB com os TV Boxes.</p>
            ${_skipButton(4, 'Usar ADB padrão (porta 5555, timeout 10s)')}
            <div class="form-grid">
                <div class="form-group">
                    <label>Porta ADB padrão</label>
                    <input type="number" id="w-adb-port" value="${data.adb.default_port}" placeholder="5555">
                </div>
                <div class="form-group">
                    <label>Timeout de conexão (s)</label>
                    <input type="number" id="w-adb-timeout" value="${data.adb.connect_timeout}" placeholder="10">
                </div>
            </div>
        `,

        5: () => `
            <h2>Players</h2>
            <p>Players de vídeo nos TV Boxes. Os valores abaixo já são os defaults recomendados.</p>
            ${_skipButton(5, 'Usar players padrão (VLC + MPV)')}
            <div class="form-grid">
                <div class="form-group">
                    <label>VLC — Package</label>
                    <input type="text" id="w-pl-vlc-pkg" value="${data.players?.vlc?.package || 'org.videolan.vlc'}">
                </div>
                <div class="form-group">
                    <label>VLC — Activity</label>
                    <input type="text" id="w-pl-vlc-act" value="${data.players?.vlc?.activity || 'org.videolan.vlc.gui.video.VideoPlayerActivity'}">
                </div>
                <div class="form-group">
                    <label>MPV — Package</label>
                    <input type="text" id="w-pl-mpv-pkg" value="${data.players?.mpv?.package || 'is.xyz.mpv'}">
                </div>
                <div class="form-group">
                    <label>MPV — Activity</label>
                    <input type="text" id="w-pl-mpv-act" value="${data.players?.mpv?.activity || 'is.xyz.mpv.MPVActivity'}">
                </div>
                <div class="form-group full-width">
                    <label>Player padrão</label>
                    <select id="w-pl-default">
                        <option value="vlc" ${(data.players?.default || 'vlc') === 'vlc' ? 'selected' : ''}>VLC</option>
                        <option value="mpv" ${(data.players?.default || '') === 'mpv' ? 'selected' : ''}>MPV</option>
                    </select>
                </div>
            </div>
        `,

        6: () => `
            <h2>Watchdog</h2>
            <p>Monitoramento automático e recuperação de falhas.</p>
            ${_skipButton(6, 'Usar configuração padrão do watchdog')}
            <div class="form-grid">
                <div class="form-group">
                    <label>Intervalo de verificação (s)</label>
                    <input type="number" id="w-wd-interval" value="${data.watchdog?.check_interval || '10'}">
                </div>
                <div class="form-group">
                    <label>Tentativas reabrir player</label>
                    <input type="number" id="w-wd-retry" value="${data.watchdog?.recovery?.player_retry_max || '2'}">
                </div>
                <div class="form-group">
                    <label>Timeout reboot (s)</label>
                    <input type="number" id="w-wd-boot" value="${data.watchdog?.recovery?.reboot_boot_timeout || '120'}">
                </div>
                <div class="form-group">
                    <label>Reboots máximos</label>
                    <input type="number" id="w-wd-reboot" value="${data.watchdog?.recovery?.reboot_max || '1'}">
                </div>
            </div>
        `,

        7: () => `
            <h2>Grupos (opcional)</h2>
            <p>Organize seus TV Boxes em grupos para ações em lote.</p>
            ${_skipButton(7, 'Nenhum grupo (criar depois)')}
            <div id="w-groups-list">
                ${data.groups.map((g, i) => `
                    <div class="wizard-device-item">
                        <div><span class="d-name">📁 ${g.name}</span> <span class="d-ip">${g.description || ''}</span></div>
                        <span class="d-remove" onclick="WIZARD.removeGroup(${i})">✕</span>
                    </div>
                `).join('') || '<div class="text-muted text-sm" style="margin-bottom:12px">Nenhum grupo ainda.</div>'}
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label>Nome do grupo</label>
                    <input type="text" id="w-grp-name" placeholder="Ex: Armazéns">
                </div>
                <div class="form-group">
                    <label>Descrição</label>
                    <input type="text" id="w-grp-desc" placeholder="Ex: TV Boxes dos armazéns">
                </div>
            </div>
            <button class="btn btn-ghost" onclick="WIZARD.addGroup()">+ Adicionar Grupo</button>
        `,

        8: () => `
            <h2>Dispositivos</h2>
            <p>Adicione pelo menos 1 TV Box para começar.</p>
            <div id="w-devices-list">
                ${data.devices.map((d, i) => `
                    <div class="wizard-device-item">
                        <div><span class="d-name">${d.name}</span> <span class="d-ip">${d.ip}</span></div>
                        <span class="d-remove" onclick="WIZARD.removeDevice(${i})">✕</span>
                    </div>
                `).join('') || '<div class="text-muted text-sm" style="margin-bottom:12px">Nenhum dispositivo ainda.</div>'}
            </div>
            <div id="w-device-form" class="form-grid">
                <div class="form-group">
                    <label>Nome *</label>
                    <input type="text" id="w-dev-name" placeholder="Ex: TV Box Armazém 1B">
                </div>
                <div class="form-group">
                    <label>IP *</label>
                    <input type="text" id="w-dev-ip" placeholder="192.168.254.XXX">
                </div>
                <div class="form-group">
                    <label>Localização</label>
                    <input type="text" id="w-dev-loc" placeholder="Ex: Armazém 1B">
                </div>
                <div class="form-group">
                    <label>Path RTSP</label>
                    <input type="text" id="w-dev-path" placeholder="TV_BOX_1">
                </div>
                <div class="form-group">
                    <label>Porta ADB</label>
                    <input type="number" id="w-dev-adb" value="5555">
                </div>
                <div class="form-group">
                    <label>Player</label>
                    <select id="w-dev-player">
                        <option value="vlc">VLC</option>
                        <option value="mpv">MPV</option>
                    </select>
                </div>
                <div class="form-group full-width" style="display:flex;gap:8px;align-items:center">
                    <label><input type="checkbox" id="w-dev-root"> Tem root</label>
                    <button class="btn btn-ghost" type="button" onclick="WIZARD.testDevice()">🔍 Testar ADB</button>
                    <button class="btn btn-primary" type="button" onclick="WIZARD.addDevice()">+ Adicionar</button>
                </div>
            </div>
            <div id="w-dev-test-result"></div>
        `,

        9: () => {
            const hasDevices = data.devices.length > 0;
            return `
                <h2>Revisão</h2>
                <p>Confira os dados antes de finalizar.</p>
                <div class="wizard-review">
                    <h3>🖥️ Servidor</h3>
                    <p>IP: ${data.server.ip || '(automático)'} — Porta: ${data.server.port}</p>
                    <h3>🔗 MediaMTX</h3>
                    <p>API: ${data.mediamtx.api_url} — RTSP: ${data.mediamtx.rtsp_port} — RTMP: ${data.mediamtx.rtmp_port}</p>
                    <h3>Dispositivos (${data.devices.length})</h3>
                    ${data.devices.map(d => `
                        <div class="review-device">${d.name} — ${d.ip} — Path: ${d.rtsp_path || '—'}</div>
                    `).join('')}
                    <h3>📁 Grupos (${data.groups.length})</h3>
                    ${data.groups.map(g => `<div class="review-device">📁 ${g.name}${g.description ? ': ' + g.description : ''}</div>`).join('') || '<p class="text-muted">Nenhum grupo</p>'}
                    <h3>📄 Arquivos que serão gerados</h3>
                    <ul>
                        <li>config/system.yml</li>
                        <li>config/watchdog.yml</li>
                        <li>config/players.yml</li>
                        <li>config/mediamtx.yml</li>
                        ${data.devices.map(d => `<li>devices/${slugify(d.name || d.id || 'tvbox')}.yml</li>`).join('')}
                        ${data.groups.map(g => `<li>groups/${slugify(g.name || g.id || 'grupo')}.yml</li>`).join('')}
                    </ul>
                </div>
            `;
        },

        10: () => `
            <h2>Finalizar!</h2>
            <p>Ao clicar em "Finalizar", o sistema vai:</p>
            <ol style="color:var(--text-secondary);font-size:0.9em;line-height:2;margin-bottom:16px">
                <li>✅ Criar todos os arquivos de configuração</li>
                <li>✅ Gerar o mediamtx.yml com os paths dos dispositivos</li>
                <li>✅ Salvar dispositivos e grupos</li>
                <li>🔄 Redirecionar para o Dashboard</li>
            </ol>
            <p>Tudo pronto para começar? 🚀</p>
            <div id="wizard-finish-status"></div>
        `,
    };

    function _skipButton(stepNum, msg) {
        return `<button class="btn btn-ghost" style="margin-bottom:12px" onclick="WIZARD.skipStep(${stepNum})">⏩ Pular — ${msg}</button>`;
    }

    // ── Save handlers ──────────────────────────

    function _saveServer() {
        data.server.ip = val('w-srv-ip');
        data.server.port = parseInt(val('w-srv-port')) || 8080;
        data.server.host = val('w-srv-host') || '0.0.0.0';
    }

    function _saveMediaMTX() {
        data.mediamtx.api_url = val('w-mtx-api') || 'http://localhost:9997';
        data.mediamtx.rtsp_port = parseInt(val('w-mtx-rtsp')) || 8554;
        data.mediamtx.rtmp_port = parseInt(val('w-mtx-rtmp')) || 1935;
    }

    function _saveADB() {
        data.adb.default_port = parseInt(val('w-adb-port')) || 5555;
        data.adb.connect_timeout = parseInt(val('w-adb-timeout')) || 10;
    }

    function _savePlayers() {
        const vlcPkg = val('w-pl-vlc-pkg');
        const vlcAct = val('w-pl-vlc-act');
        const mpvPkg = val('w-pl-mpv-pkg');
        const mpvAct = val('w-pl-mpv-act');
        const def = val('w-pl-default') || 'vlc';

        if (vlcPkg && vlcAct && mpvPkg && mpvAct) {
            data.players = {
                players: {
                    vlc: { package: vlcPkg, activity: vlcAct, force_stop: vlcPkg, intent_template: 'am start -a android.intent.action.VIEW -d "{URL}" -n {PACKAGE}/{ACTIVITY} --activity-clear-task' },
                    mpv: { package: mpvPkg, activity: mpvAct, force_stop: mpvPkg, intent_template: 'am start -a android.intent.action.VIEW -d "{URL}" -n {PACKAGE}/{ACTIVITY} --activity-clear-task' },
                },
                default: def,
            };
        } else {
            data.players = null;
        }
    }

    function _saveWatchdog() {
        data.watchdog = {
            check_interval: parseInt(val('w-wd-interval')) || 10,
            ping: { count: 1, timeout_ms: 800 },
            adb: { timeout: 5 },
            activity_check: true,
            mediamtx_check: true,
            recovery: {
                cooldown_seconds: 15,
                player_retry_max: parseInt(val('w-wd-retry')) || 2,
                player_retry_delay: 10,
                wifi_restart: true,
                wifi_reconnect_timeout: 30,
                eth_restart: true,
                eth_reconnect_timeout: 30,
                reboot_max: parseInt(val('w-wd-reboot')) || 1,
                reboot_boot_timeout: parseInt(val('w-wd-boot')) || 120,
                critical_alert_cooldown: 300,
            },
        };
    }

    // ── Validation ─────────────────────────────

    function _validateServer() {
        const ip = val('w-srv-ip');
        if (ip && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            UI.createToast('Formato de IP inválido', 'error');
            return false;
        }
        return true;
    }

    function _validateMediaMTX() {
        return true;
    }

    function _validateDevices() {
        if (data.devices.length === 0) {
            UI.createToast('Adicione pelo menos 1 dispositivo antes de prosseguir', 'warning');
            return false;
        }
        return true;
    }

    // ── Actions ────────────────────────────────

    function addGroup() {
        const name = val('w-grp-name');
        if (!name) { UI.createToast('Informe o nome do grupo', 'warning'); return; }
        data.groups.push({
            id: slugify(name),
            name,
            description: val('w-grp-desc') || '',
        });
        document.getElementById('w-grp-name').value = '';
        document.getElementById('w-grp-desc').value = '';
        renderStep(currentStep);
    }

    function removeGroup(index) {
        data.groups.splice(index, 1);
        renderStep(currentStep);
    }

    function addDevice() {
        const name = val('w-dev-name');
        const ip = val('w-dev-ip');

        if (!name || !ip) {
            UI.createToast('Nome e IP são obrigatórios', 'error');
            return;
        }
        if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            UI.createToast('Formato de IP inválido', 'error');
            return;
        }
        if (data.devices.some(d => d.ip === ip)) {
            UI.createToast('IP já adicionado', 'warning');
            return;
        }

        data.devices.push({
            name,
            ip,
            location: val('w-dev-loc') || '',
            rtsp_path: val('w-dev-path') || '',
            adb_port: parseInt(val('w-dev-adb')) || 5555,
            player: val('w-dev-player') || 'vlc',
            root: document.getElementById('w-dev-root')?.checked || false,
            capabilities: {
                wifi_restart: true,
                ethernet_restart: true,
                reboot: true,
                root: document.getElementById('w-dev-root')?.checked || false,
                install_apk: true,
                shell: true,
                screenshot: true,
            },
        });

        // Limpa form
        ['w-dev-name', 'w-dev-ip', 'w-dev-loc', 'w-dev-path'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('w-dev-root').checked = false;
        document.getElementById('w-dev-test-result').innerHTML = '';

        UI.createToast(`${name} adicionado!`, 'success');
        renderStep(currentStep);
    }

    function removeDevice(index) {
        data.devices.splice(index, 1);
        renderStep(currentStep);
    }

    async function testDevice() {
        const ip = val('w-dev-ip');
        const port = parseInt(val('w-dev-adb')) || 5555;

        if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
            UI.createToast('Informe um IP válido para testar', 'error');
            return;
        }

        const resultDiv = document.getElementById('w-dev-test-result');
        resultDiv.innerHTML = '<div class="test-result loading">Testando conexão ADB...</div>';

        try {
            const res = await API.post('/wizard/validate-device', { ip, adb_port: port });
            if (res.adb_connected) {
                resultDiv.innerHTML = `<div class="test-result success">✅ ADB OK — ${res.model || 'modelo desconhecido'} (Android ${res.android || '?'})${res.root ? ' — Root ✅' : ''}</div>`;
            } else {
                resultDiv.innerHTML = `<div class="test-result error">❌ ADB não conectou — Verifique se o TV Box está ligado e o ADB via TCP está habilitado</div>`;
            }
        } catch (e) {
            resultDiv.innerHTML = `<div class="test-result error">❌ Erro: ${e.message}</div>`;
        }
    }

    // ── Finish ─────────────────────────────────

    async function finish() {
        const btn = document.getElementById('wizard-finish-btn');
        const status = document.getElementById('wizard-finish-status');
        if (btn) btn.disabled = true;
        if (status) status.innerHTML = '<div class="test-result loading">Gerando configurações...</div>';

        try {
            // Build payload completo
            const payload = {
                server: {
                    ip: data.server.ip,
                    port: data.server.port,
                    host: data.server.host,
                },
                mediamtx: data.mediamtx,
                adb: data.adb,
                players: data.players,
                watchdog: data.watchdog,
                groups: data.groups.map(g => ({
                    id: slugify(g.name || 'grupo'),
                    name: g.name,
                    description: g.description || '',
                })),
                devices: data.devices.map(d => ({
                    id: slugify(d.name || 'tvbox'),
                    name: d.name,
                    ip: d.ip,
                    adb_port: d.adb_port,
                    location: d.location || '',
                    rtsp_path: d.rtsp_path || '',
                    player: d.player || 'vlc',
                    root: d.root || false,
                    capabilities: d.capabilities || {},
                })),
            };

            const res = await API.post('/wizard/finish', payload);

            if (res.success) {
                if (status) status.innerHTML = `<div class="test-result success">✅ Configuração concluída! (${res.files_created.devices} dispositivos, ${res.files_created.groups} grupos)</div>`;
                UI.createToast('Painel configurado! 🎉', 'success', 5000);
                setTimeout(() => { window.location.hash = '#/'; }, 500);
            } else {
                if (status) status.innerHTML = `<div class="test-result error">❌ Erro ao finalizar: ${res.detail || 'desconhecido'}</div>`;
                if (btn) btn.disabled = false;
            }
        } catch (e) {
            if (status) status.innerHTML = `<div class="test-result error">❌ ${e.message}</div>`;
            if (btn) btn.disabled = false;
        }
    }

    // ── Helpers ────────────────────────────────

    function val(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function slugify(text) {
        return text
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/[\s]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    // ── Expose pública ─────────────────────────

    return { render, goPrev, goNext, skipStep, addGroup, removeGroup, addDevice, removeDevice, testDevice, finish };
})();
