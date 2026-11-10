/**
 * Wizard — assistente de configuração inicial (2 passos).
 * Passo 1: Criar Administrador (credenciais e regras de validação em tempo real)
 * Passo 2: Cadastrar TV Boxes (formulário compacto, teste ADB e lista dinâmica)
 */
const WIZARD = (() => {
    let currentStep = 1;
    const TOTAL_STEPS = 2;

    // Estado client-side do assistente
    const state = {
        admin: {
            username: 'admin',
            password: '',
            confirmPassword: '',
        },
        devices: [],
    };

    // ── Renderização Principal ─────────────────────────────

    function render(el) {
        if (typeof UI !== 'undefined' && UI.setPageTitle) {
            UI.setPageTitle('Configuração Inicial');
        }
        el.innerHTML = `
            <div class="wizard-progress" id="wizard-progress"></div>
            <div class="wizard-step" id="wizard-step"></div>
        `;
        renderStep(currentStep);
    }

    function renderStep(step) {
        currentStep = step;

        const STEP_NAMES = ['Criar Administrador', 'Cadastrar TV Boxes'];
        let dots = '';
        for (let i = 1; i <= TOTAL_STEPS; i++) {
            const cls = i === step ? 'active' : (i < step ? 'done' : '');
            const label = STEP_NAMES[i - 1] || `Passo ${i}`;
            dots += `<span class="wizard-step-dot ${cls}" title="${label}">${i < step ? '✓' : i}</span>`;
        }
        const progHtml = `
            <div class="wizard-steps">${dots}</div>
            <span class="wizard-progress-text">${STEP_NAMES[step - 1]} · ${step} de ${TOTAL_STEPS}</span>
        `;

        const progEl = document.getElementById('wizard-progress');
        if (progEl) progEl.innerHTML = progHtml;

        const stepContainer = document.getElementById('wizard-step');
        if (!stepContainer) return;

        const html = STEP_RENDERERS[step]();
        let navHtml = '<div class="wizard-nav">';

        if (step > 1) {
            navHtml += `<button type="button" class="btn btn-secondary" onclick="WIZARD.goPrev()">← Voltar ao Passo 1</button>`;
        } else {
            navHtml += '<div></div>';
        }

        if (step === 1) {
            navHtml += `<button type="button" class="btn btn-primary" id="wizard-next-btn" onclick="WIZARD.goNext()" ${isStep1Valid() ? '' : 'disabled'}>Próximo →</button>`;
        } else {
            navHtml += `<button type="button" class="btn btn-primary" id="wizard-finish-btn" onclick="WIZARD.finish()" ${state.devices.length >= 1 ? '' : 'disabled'}>Finalizar Configuração</button>`;
        }

        navHtml += '</div>';
        stepContainer.innerHTML = html + navHtml;

        if (step === 1) {
            attachStep1Listeners();
        } else if (step === 2) {
            attachStep2Listeners();
        }
    }

    // ── Navegação ──────────────────────────────────────────

    function goPrev() {
        if (currentStep > 1) {
            renderStep(currentStep - 1);
        }
    }

    function goNext() {
        if (currentStep === 1) {
            saveStep1();
            if (!isStep1Valid()) {
                if (typeof UI !== 'undefined' && UI.createToast) {
                    UI.createToast('Verifique os requisitos das credenciais antes de prosseguir', 'warning');
                }
                return;
            }
            renderStep(2);
        }
    }

    // ── Validações Auxiliares ──────────────────────────────

    function hasControlChars(str) {
        return /[\x00-\x1F\x7F]/.test(str);
    }

    function isValidUsername(u) {
        const user = (u || '').trim();
        if (user.length < 2 || user.length > 64) return false;
        if (hasControlChars(user)) return false;
        return /^[A-Za-z0-9._@-]{2,64}$/.test(user);
    }

    function isValidPassword(p) {
        const pass = p || '';
        if (pass.length < 8 || pass.length > 256) return false;
        if (hasControlChars(pass)) return false;
        return true;
    }

    function isPasswordMatching(p, c) {
        return (p || '').length > 0 && p === c;
    }

    function isStep1Valid() {
        return (
            isValidUsername(state.admin.username) &&
            isValidPassword(state.admin.password) &&
            isPasswordMatching(state.admin.password, state.admin.confirmPassword)
        );
    }

    function isValidIpv4(ip) {
        if (!ip || typeof ip !== 'string') return false;
        const parts = ip.trim().split('.');
        if (parts.length !== 4) return false;
        for (const part of parts) {
            if (!/^\d{1,3}$/.test(part)) return false;
            const num = parseInt(part, 10);
            if (num < 0 || num > 255) return false;
        }
        return true;
    }

    // ── Passo 1: Criar Administrador ───────────────────────

    function saveStep1() {
        const uEl = document.getElementById('w-admin-user');
        const pEl = document.getElementById('w-admin-pass');
        const cEl = document.getElementById('w-admin-confirm');
        if (uEl) state.admin.username = uEl.value.trim();
        if (pEl) state.admin.password = pEl.value;
        if (cEl) state.admin.confirmPassword = cEl.value;
    }

    function attachStep1Listeners() {
        const uEl = document.getElementById('w-admin-user');
        const pEl = document.getElementById('w-admin-pass');
        const cEl = document.getElementById('w-admin-confirm');
        const nextBtn = document.getElementById('wizard-next-btn');

        function updateRealtime() {
            saveStep1();
            const u = state.admin.username;
            const p = state.admin.password;
            const c = state.admin.confirmPassword;

            const userOk = isValidUsername(u);
            const lenOk = p.length >= 8 && p.length <= 256;
            const ctrlOk = p.length > 0 && !hasControlChars(p);
            const matchOk = isPasswordMatching(p, c);

            _updateRule('rule-user', userOk, u.length > 0);
            _updateRule('rule-len', lenOk, p.length > 0);
            _updateRule('rule-ctrl', ctrlOk, p.length > 0);
            _updateRule('rule-match', matchOk, c.length > 0);

            if (nextBtn) {
                nextBtn.disabled = !(userOk && lenOk && ctrlOk && matchOk);
            }
        }

        if (uEl) uEl.addEventListener('input', updateRealtime);
        if (pEl) pEl.addEventListener('input', updateRealtime);
        if (cEl) cEl.addEventListener('input', updateRealtime);

        [uEl, pEl, cEl].forEach(input => {
            if (input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && isStep1Valid()) {
                        e.preventDefault();
                        goNext();
                    }
                });
            }
        });

        updateRealtime();
    }

    function _updateRule(id, ok, active) {
        const el = document.getElementById(id);
        if (!el) return;
        const icon = el.querySelector('.rule-icon');
        if (ok) {
            el.style.color = 'var(--text-primary)';
            if (icon) {
                icon.textContent = '✓';
                icon.style.fontWeight = '700';
            }
        } else if (active) {
            el.style.color = 'var(--text-muted)';
            if (icon) {
                icon.textContent = '✕';
                icon.style.fontWeight = 'normal';
            }
        } else {
            el.style.color = 'var(--text-muted)';
            if (icon) {
                icon.textContent = '○';
                icon.style.fontWeight = 'normal';
            }
        }
    }

    // ── Passo 2: Cadastrar TV Boxes ────────────────────────

    function attachStep2Listeners() {
        const formInputs = ['w-dev-name', 'w-dev-ip', 'w-dev-group', 'w-dev-loc', 'w-dev-adb'];
        formInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addDevice();
                    }
                });
            }
        });
    }

    function renderDevicesListHtml() {
        if (state.devices.length === 0) {
            return `
                <div class="text-muted text-sm" style="padding:16px;background:var(--bg-base);border:1px dashed var(--border-subtle);border-radius:var(--radius-sm);text-align:center;">
                    Nenhum TV Box adicionado ainda. Preencha o formulário acima e clique em "+ Adicionar Dispositivo".
                </div>
            `;
        }
        return state.devices.map((d, i) => `
            <div class="wizard-device-item">
                <div>
                    <div class="d-name">${escapeHtml(d.name)}</div>
                    <div class="d-ip">
                        ${escapeHtml(d.ip)}:${d.adb_port} · Player: ${escapeHtml((d.player || 'vlc').toUpperCase())}${d.group ? ` · Grupo: ${escapeHtml(d.group)}` : ''}${d.location ? ` · ${escapeHtml(d.location)}` : ''}
                    </div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm d-remove" onclick="WIZARD.removeDevice(${i})" title="Remover este TV Box">✕ Remover</button>
            </div>
        `).join('');
    }

    function updateDevicesView() {
        const listEl = document.getElementById('w-devices-list');
        const countEl = document.getElementById('w-dev-count');
        const finishBtn = document.getElementById('wizard-finish-btn');

        if (listEl) listEl.innerHTML = renderDevicesListHtml();
        if (countEl) countEl.textContent = String(state.devices.length);
        if (finishBtn) finishBtn.disabled = state.devices.length === 0;
    }

    function addDevice() {
        const ip = val('w-dev-ip');
        const name = val('w-dev-name');
        const port = parseInt(val('w-dev-adb'), 10) || 5555;
        const group = val('w-dev-group');
        const loc = val('w-dev-loc');
        const player = val('w-dev-player') || 'vlc';

        if (!name) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Nome de identificação é obrigatório', 'error');
            const el = document.getElementById('w-dev-name');
            if (el) el.focus();
            return;
        }
        if (!ip) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Endereço IP é obrigatório', 'error');
            const el = document.getElementById('w-dev-ip');
            if (el) el.focus();
            return;
        }
        if (!isValidIpv4(ip)) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Formato IPv4 inválido (ex: 192.168.1.100)', 'error');
            const el = document.getElementById('w-dev-ip');
            if (el) el.focus();
            return;
        }
        if (port < 1 || port > 65535) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Porta ADB deve ser entre 1 e 65535', 'error');
            return;
        }
        if (state.devices.some(d => d.ip === ip)) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Este endereço IP já foi adicionado', 'warning');
            return;
        }

        state.devices.push({
            name,
            ip,
            adb_port: port,
            group,
            location: loc,
            player,
        });

        // Limpa campos do formulário
        ['w-dev-ip', 'w-dev-name', 'w-dev-group', 'w-dev-loc'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const portEl = document.getElementById('w-dev-adb');
        if (portEl) portEl.value = '5555';
        const resEl = document.getElementById('w-dev-test-result');
        if (resEl) resEl.innerHTML = '';

        updateDevicesView();
        if (typeof UI !== 'undefined' && UI.createToast) {
            UI.createToast(`TV Box "${name}" adicionado com sucesso!`, 'success');
        }
    }

    function removeDevice(index) {
        if (index >= 0 && index < state.devices.length) {
            const removed = state.devices.splice(index, 1)[0];
            updateDevicesView();
            if (removed && typeof UI !== 'undefined' && UI.createToast) {
                UI.createToast(`TV Box "${removed.name}" removido`, 'info');
            }
        }
    }

    async function testDevice() {
        const ip = val('w-dev-ip');
        const port = parseInt(val('w-dev-adb'), 10) || 5555;

        if (!ip) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Informe o IP para testar a conexão', 'warning');
            const el = document.getElementById('w-dev-ip');
            if (el) el.focus();
            return;
        }
        if (!isValidIpv4(ip)) {
            if (typeof UI !== 'undefined' && UI.createToast) UI.createToast('Informe um endereço IPv4 válido (ex: 192.168.1.100)', 'error');
            const el = document.getElementById('w-dev-ip');
            if (el) el.focus();
            return;
        }

        const testBtn = document.getElementById('w-btn-test-adb');
        const resultDiv = document.getElementById('w-dev-test-result');
        if (testBtn) testBtn.disabled = true;
        if (resultDiv) {
            resultDiv.innerHTML = `<div class="test-result loading">Testando conexão ADB em ${escapeHtml(ip)}:${port}...</div>`;
        }

        try {
            const res = await API.post('/wizard/validate-device', { ip, adb_port: port });
            if (res && res.adb_connected) {
                const modelStr = res.model ? escapeHtml(res.model) : 'Dispositivo';
                const androidStr = res.android ? ` (Android ${escapeHtml(res.android)})` : '';
                const rootStr = res.root ? ' · Root ✅' : '';
                if (resultDiv) {
                    resultDiv.innerHTML = `
                        <div class="test-result success" style="display:flex;align-items:center;gap:8px;">
                            <span class="badge online">Conectado</span>
                            <span>ADB OK — ${modelStr}${androidStr}${rootStr}</span>
                        </div>
                    `;
                }
            } else {
                if (resultDiv) {
                    resultDiv.innerHTML = `
                        <div class="test-result error" style="display:flex;align-items:center;gap:8px;">
                            <span class="badge offline">Falha</span>
                            <span>Não foi possível conectar ao TV Box. Verifique se o aparelho está ligado e com o ADB TCP ativo na porta ${port}.</span>
                        </div>
                    `;
                }
            }
        } catch (err) {
            if (resultDiv) {
                resultDiv.innerHTML = `
                    <div class="test-result error" style="display:flex;align-items:center;gap:8px;">
                        <span class="badge offline">Erro</span>
                        <span>${escapeHtml(err.message || 'Erro ao conectar com o TV Box')}</span>
                    </div>
                `;
            }
        } finally {
            if (testBtn) testBtn.disabled = false;
        }
    }

    // ── Finalização (finish) ────────────────────────────────

    async function finish() {
        if (state.devices.length === 0) {
            if (typeof UI !== 'undefined' && UI.createToast) {
                UI.createToast('Cadastre pelo menos 1 TV Box para finalizar', 'warning');
            }
            return;
        }

        const finishBtn = document.getElementById('wizard-finish-btn');
        const statusDiv = document.getElementById('wizard-finish-status');
        if (finishBtn) finishBtn.disabled = true;
        if (statusDiv) {
            statusDiv.innerHTML = '<div class="test-result loading">Finalizando configuração e gerando sistema...</div>';
        }

        const payload = {
            admin: {
                username: state.admin.username,
                password: state.admin.password,
            },
            devices: state.devices.map(d => ({
                name: d.name,
                ip: d.ip,
                adb_port: parseInt(d.adb_port, 10) || 5555,
                group: d.group || '',
                location: d.location || '',
                player: d.player || 'vlc',
            })),
        };

        try {
            const res = await API.post('/wizard/finish', payload);

            if (res && res.session_token && typeof AUTH !== 'undefined') {
                AUTH.setToken(res.session_token);
            }

            window.dispatchEvent(new CustomEvent('auth:logged-in', {
                detail: { username: (res && res.username) || state.admin.username }
            }));

            if (typeof UI !== 'undefined' && UI.createToast) {
                UI.createToast('Painel configurado com sucesso! 🎉', 'success');
            }

            if (statusDiv) {
                statusDiv.innerHTML = '<div class="test-result success">Configuração concluída com sucesso! Redirecionando...</div>';
            }

            setTimeout(() => {
                window.location.hash = '#/';
            }, 500);
        } catch (err) {
            const msg = err.message || 'Falha ao finalizar o assistente';
            if (statusDiv) {
                statusDiv.innerHTML = `<div class="test-result error">Erro: ${escapeHtml(msg)}</div>`;
            }
            if (typeof UI !== 'undefined' && UI.createToast) {
                UI.createToast(msg, 'error');
            }
            if (finishBtn) finishBtn.disabled = false;
        }
    }

    // ── Renderizadores dos Passos ──────────────────────────

    const STEP_RENDERERS = {
        1: () => `
            <h2>Criar Administrador</h2>
            <p>Defina as credenciais para acessar e administrar o Painel TV Box com segurança.</p>

            <div class="settings-card" style="margin-top:16px;">
                <div class="section-title">🔐 Credenciais de Acesso</div>
                <p class="text-muted text-sm" style="margin-bottom:16px;">
                    O administrador gerencia os dispositivos, transmissões RTSP e configurações de recuperação do painel.
                </p>

                <div class="form-grid">
                    <div class="form-group full-width">
                        <label for="w-admin-user">Usuário Administrador *</label>
                        <input type="text" id="w-admin-user" value="${escapeHtml(state.admin.username)}" placeholder="admin" autocomplete="username">
                        <div class="form-hint">Mínimo 2 caracteres (letras, números, '.', '_', '@' e '-')</div>
                    </div>
                    <div class="form-group">
                        <label for="w-admin-pass">Senha *</label>
                        <input type="password" id="w-admin-pass" value="${escapeHtml(state.admin.password)}" placeholder="••••••••" autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label for="w-admin-confirm">Confirmar Senha *</label>
                        <input type="password" id="w-admin-confirm" value="${escapeHtml(state.admin.confirmPassword)}" placeholder="••••••••" autocomplete="new-password">
                    </div>
                </div>

                <div class="wizard-validation-box" style="margin-top:16px;padding:12px;background:var(--bg-raised);border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-size:0.85em;">
                    <div style="font-weight:600;margin-bottom:8px;color:var(--text-secondary);">Requisitos de segurança:</div>
                    <div id="rule-user" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--text-muted)">
                        <span class="rule-icon">○</span> Usuário válido (2 a 64 caracteres)
                    </div>
                    <div id="rule-len" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--text-muted)">
                        <span class="rule-icon">○</span> Mínimo de 8 caracteres na senha
                    </div>
                    <div id="rule-ctrl" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;color:var(--text-muted)">
                        <span class="rule-icon">○</span> Senha sem caracteres de controle
                    </div>
                    <div id="rule-match" style="display:flex;align-items:center;gap:6px;color:var(--text-muted)">
                        <span class="rule-icon">○</span> Confirmação coincidente
                    </div>
                </div>
            </div>
        `,

        2: () => `
            <h2>Cadastrar TV Boxes</h2>
            <p>Cadastre os aparelhos Android na rede local que reproduzirão as transmissões de vídeo.</p>

            <div class="settings-card" id="w-device-form-card" style="margin-top:16px;">
                <div class="section-title">📺 Novo TV Box</div>
                <div class="form-grid" style="margin-top:12px;">
                    <div class="form-group">
                        <label for="w-dev-ip">Endereço IP (IPv4) *</label>
                        <input type="text" id="w-dev-ip" placeholder="Ex: 192.168.1.100" autocomplete="off">
                        <div class="form-hint">IP do TV Box na rede local</div>
                    </div>
                    <div class="form-group">
                        <label for="w-dev-name">Nome de Identificação *</label>
                        <input type="text" id="w-dev-name" placeholder="Ex: TV Sala de Espera" autocomplete="off">
                        <div class="form-hint">Identificação amigável no painel</div>
                    </div>
                    <div class="form-group">
                        <label for="w-dev-adb">Porta ADB</label>
                        <input type="number" id="w-dev-adb" value="5555" min="1" max="65535">
                        <div class="form-hint">Padrão: 5555</div>
                    </div>
                    <div class="form-group">
                        <label for="w-dev-group">Grupo (opcional)</label>
                        <input type="text" id="w-dev-group" placeholder="Ex: Recepção">
                        <div class="form-hint">Para agrupamento e ações em lote</div>
                    </div>
                    <div class="form-group">
                        <label for="w-dev-loc">Localização (opcional)</label>
                        <input type="text" id="w-dev-loc" placeholder="Ex: Térreo Bloco A">
                    </div>
                    <div class="form-group">
                        <label for="w-dev-player">Player Padrão</label>
                        <select id="w-dev-player">
                            <option value="vlc" selected>VLC (Recomendado)</option>
                            <option value="mpv">MPV</option>
                        </select>
                    </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary" id="w-btn-test-adb" onclick="WIZARD.testDevice()">🔍 Testar Conexão ADB</button>
                    <button type="button" class="btn btn-primary" onclick="WIZARD.addDevice()">+ Adicionar Dispositivo</button>
                </div>
                <div id="w-dev-test-result" style="margin-top:12px;"></div>
            </div>

            <div class="settings-card" style="margin-top:20px;">
                <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>Dispositivos Adicionados (<span id="w-dev-count">${state.devices.length}</span>)</span>
                </div>
                <div id="w-devices-list" style="margin-top:12px;">
                    ${renderDevicesListHtml()}
                </div>
            </div>

            <div id="wizard-finish-status" style="margin-top:16px;"></div>
        `,
    };

    // ── Utilitários ────────────────────────────────────────

    function val(id) {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    return {
        render,
        goPrev,
        goNext,
        addDevice,
        removeDevice,
        testDevice,
        finish,
    };
})();
