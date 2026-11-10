/**
 * Scrcpy Page — gestão de versões, controle remoto, downloads 1-clique e tabela de sessões ativas.
 */
const SCRCPY = (() => {
    let deviceNames = new Map();
    let devicesList = [];
    let enrollmentClients = [];
    let activeSessionsCache = [];

    const PRESET_ARGS = [
        { id: 'arg-br', label: 'Limitar bitrate', desc: '--video-bit-rate=2M', cmd: '--video-bit-rate=2M', grp: 'rede' },
        { id: 'arg-fps', label: 'Limitar FPS 30', desc: '--max-fps=30', cmd: '--max-fps=30', grp: 'rede' },
        { id: 'arg-h264', label: 'Codec H.264 (leve)', desc: '--video-codec=h264', cmd: '--video-codec=h264', grp: 'codec' },
        { id: 'arg-h265', label: 'Codec H.265 (melhor)', desc: '--video-codec=h265', cmd: '--video-codec=h265', grp: 'codec' },
        { id: 'arg-noaudio', label: 'Sem áudio', desc: '--no-audio', cmd: '--no-audio', grp: 'audio' },
        { id: 'arg-nowin', label: 'Headless (sem janela)', desc: '--no-window', cmd: '--no-window', grp: 'exib' },
        { id: 'arg-off', label: 'Desligar tela', desc: '--turn-screen-off', cmd: '--turn-screen-off', grp: 'exib' },
        { id: 'arg-awake', label: 'Manter acordado', desc: '--stay-awake', cmd: '--stay-awake', grp: 'exib' },
    ];

    const GRP = {
        rede: { icon: '⚡', lbl: 'Rede & Desempenho' },
        codec: { icon: '🎞️', lbl: 'Codec de Vídeo' },
        audio: { icon: '🔇', lbl: 'Áudio' },
        exib: { icon: '🖥️', lbl: 'Modo de Exibição' }
    };

    function buildArgs() {
        const checks = PRESET_ARGS.filter(a => document.getElementById(a.id)?.checked).map(a => a.cmd);
        const extra = (document.getElementById('scrcpy-args')?.value || '').trim();
        if (extra) checks.push(extra);
        return checks.join(' ');
    }

    async function render(el) {
        UI.setPageTitle('Telas & Sessões');

        let devices = [];
        try {
            devices = await API.get('/devices') || [];
        } catch (e) {
            /* lista vazia */
        }
        devicesList = Array.isArray(devices) ? devices : [];
        deviceNames = new Map(devicesList.map(d => [d.id, d.name || d.id]));

        const deviceOptions = devicesList.map(d =>
            `<option value="${UI.escapeHtml(d.id)}">${UI.escapeHtml(d.name || d.id)} (${UI.escapeHtml(d.ip || '')})</option>`
        ).join('');

        let cb = '';
        for (const [k, g] of Object.entries(GRP)) {
            const items = PRESET_ARGS.filter(a => a.grp === k);
            cb += `
                <div class="scrcpy-arg-grp">
                    <div class="scrcpy-arg-title">${g.icon} ${g.lbl}</div>
                    <div class="scrcpy-arg-grid">
            `;
            cb += items.map(a =>
                `<label class="scrcpy-arg-item">
                    <input type="checkbox" id="${a.id}"><span>${a.label}</span><code>${a.desc}</code>
                 </label>`
            ).join('');
            cb += '</div></div>';
        }

        el.innerHTML = `
            <div class="scrcpy-page">
                <!-- SEÇÃO DESTACADA 1-CLIQUE (HERO CARD) -->
                <div class="scrcpy-hero-card">
                    <div class="hero-top-bar">
                        <div>
                            <h2 class="hero-title">${UI.icon('monitor')} Acesso Remoto aos TV Boxes</h2>
                            <p class="hero-desc">Espelhe e controle qualquer TV Box em tempo real. Escolha se deseja abrir direto neste computador ou no desktop do servidor.</p>
                        </div>
                        <div class="hero-status-pill" id="scrcpy-session-pill">
                            <span class="status-mini-dot"></span> <span id="scrcpy-session-text">Nenhuma sessão ativa</span>
                        </div>
                    </div>

                    <div class="hero-device-selector-box">
                        <label class="form-label font-semibold">Selecione o TV Box Alvo:</label>
                        <select id="scrcpy-device" class="form-input hero-select">
                            ${deviceOptions || '<option value="">Nenhum dispositivo cadastrado</option>'}
                        </select>
                    </div>

                    <div class="hero-actions-container">
                        <!-- Botão Principal 1-Clique (Proeminente) -->
                        <button class="btn btn-primary scrcpy-hero-btn" onclick="SCRCPY.startLocal()">
                            ${UI.icon('play', 20)}
                            <div class="hero-btn-text">
                                <span class="hero-btn-main">Abrir neste Computador (1-Clique)</span>
                                <span class="hero-btn-sub">Inicia janela nativa ultra-responsiva via protocolo seguro</span>
                            </div>
                        </button>

                        <!-- Grade de Botões Operacionais (40px) -->
                        <div class="scrcpy-ops-grid">
                            <button class="btn btn-secondary scrcpy-op-btn" onclick="SCRCPY.downloadStationBundle()" title="Baixar instalador sem senha de administrador">
                                <span class="op-btn-icon">${UI.icon('download', 18)}</span>
                                <div class="op-btn-content">
                                    <span class="op-btn-title">Instalador Rápido (.cmd)</span>
                                    <span class="op-btn-sub">Configura o 1-clique neste PC</span>
                                </div>
                            </button>

                            <button class="btn btn-secondary scrcpy-op-btn" onclick="SCRCPY.downloadStationZip()" title="Pacote ZIP portátil completo">
                                <span class="op-btn-icon">${UI.icon('archive', 18)}</span>
                                <div class="op-btn-content">
                                    <span class="op-btn-title">Pacote Portátil (.zip)</span>
                                    <span class="op-btn-sub">Scrcpy portátil + atalhos de rede</span>
                                </div>
                            </button>

                            <button class="btn btn-secondary scrcpy-op-btn" onclick="SCRCPY.downloadLauncher()" title="Baixar atalho .BAT exclusivo deste TV Box">
                                <span class="op-btn-icon">${UI.icon('file', 18)}</span>
                                <div class="op-btn-content">
                                    <span class="op-btn-title">Atalho .BAT deste Box</span>
                                    <span class="op-btn-sub">Conecta sem abrir o navegador</span>
                                </div>
                            </button>

                            <button class="btn btn-secondary scrcpy-op-btn" onclick="SCRCPY.startHost()" title="Abre janela de visualização na tela do servidor">
                                <span class="op-btn-icon">${UI.icon('monitor', 18)}</span>
                                <div class="op-btn-content">
                                    <span class="op-btn-title">Abrir no Servidor Host</span>
                                    <span class="op-btn-sub">Exibe no desktop do computador host</span>
                                </div>
                            </button>

                            <button class="btn btn-danger scrcpy-op-btn" onclick="SCRCPY.stopMirroring()" title="Encerra todas as janelas do scrcpy no host">
                                <span class="op-btn-icon">${UI.icon('stop', 18)}</span>
                                <div class="op-btn-content">
                                    <span class="op-btn-title">Fechar Janelas</span>
                                    <span class="op-btn-sub">Encerra processos de espelhamento</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    <!-- Bloco colapsável com opções avançadas -->
                    <details class="scrcpy-options-details">
                        <summary>${UI.icon('sliders')} Opções Avançadas do Espelhamento (Bitrate, FPS, Codec)</summary>
                        <div class="scrcpy-details-content">
                            ${cb}
                            <div class="form-group" style="margin-top:10px">
                                <label class="text-muted text-xs">Argumentos Adicionais da Linha de Comando:</label>
                                <input type="text" id="scrcpy-args" class="form-input text-xs mono" placeholder="ex: --max-size=1280 --stay-awake">
                            </div>
                        </div>
                    </details>
                </div>

                <!-- TABELA DENSA DE SESSÕES ATIVAS -->
                <div class="section-title mt-md" style="display:flex;justify-content:space-between;align-items:center">
                    <span>${UI.icon('layers')} Sessões de Espelhamento Ativas</span>
                    <button class="btn btn-secondary btn-sm" onclick="SCRCPY.loadSessions()">${UI.icon('refresh')} Atualizar</button>
                </div>
                <div id="scrcpy-sessions-table-box" class="settings-card">
                    ${UI.skeletons('row', 2)}
                </div>

                <!-- CONTROLE REMOTO VIRTUAL & TELA AO VIVO -->
                <div class="scrcpy-two-col-grid">
                    <div class="settings-card">
                        <div class="section-title" style="margin-bottom:8px">${UI.icon('sliders')} Controle Virtual ADB</div>
                        <p class="text-muted text-xs">Envie comandos direcionais e texto diretamente ao TV Box sem necessidade de abrir uma janela.</p>
                        
                        <div class="dpad-container" style="margin-top:12px">
                            <div class="dpad" role="group" aria-label="Controle direcional">
                                <span></span><button type="button" class="btn-dpad" title="Cima" aria-label="Cima" onclick="SCRCPY.sendKey(19)">▲</button><span></span>
                                <button type="button" class="btn-dpad" title="Esquerda" aria-label="Esquerda" onclick="SCRCPY.sendKey(21)">◀</button>
                                <button type="button" class="btn-dpad btn-dpad-center" title="OK / Enter" aria-label="OK / Enter" onclick="SCRCPY.sendKey(66)">●</button>
                                <button type="button" class="btn-dpad" title="Direita" aria-label="Direita" onclick="SCRCPY.sendKey(22)">▶</button>
                                <span></span><button type="button" class="btn-dpad" title="Baixo" aria-label="Baixo" onclick="SCRCPY.sendKey(20)">▼</button><span></span>
                            </div>
                            <div class="dpad-shortcuts">
                                <button type="button" class="btn btn-sm btn-secondary" onclick="SCRCPY.sendKey(4)">↩ Voltar</button>
                                <button type="button" class="btn btn-sm btn-secondary" onclick="SCRCPY.sendKey(3)">⌂ Home</button>
                                <button type="button" class="btn btn-sm btn-secondary" onclick="SCRCPY.sendKey(131)">↻ F5</button>
                            </div>
                        </div>

                        <div style="margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:12px">
                            <label class="text-xs text-muted font-semibold">Digitar Texto Remoto:</label>
                            <div style="display:flex;gap:6px;margin-top:6px">
                                <input type="text" id="scrcpy-inject-text" class="form-input text-xs" placeholder="Texto para injetar no campo..." onkeydown="if(event.key==='Enter')SCRCPY.sendInputText()">
                                <button type="button" class="btn btn-sm btn-primary" onclick="SCRCPY.sendInputText()">Enviar</button>
                            </div>
                        </div>
                    </div>

                    <div class="settings-card">
                        <div class="section-title" style="margin-bottom:8px">${UI.icon('camera')} Pré-visualização Inline</div>
                        <p class="text-muted text-xs">Captura periódica da tela do TV Box para visualização direto no navegador web.</p>
                        
                        <div style="display:flex;gap:8px;margin:10px 0;align-items:center">
                            <button class="btn btn-sm btn-primary" onclick="SCRCPY.startLive()">${UI.icon('play')} Iniciar Prévia</button>
                            <button class="btn btn-sm btn-secondary" onclick="SCRCPY.stopLive()">${UI.icon('stop')} Parar</button>
                            <span class="text-muted text-xs" id="scrcpy-live-status"></span>
                        </div>

                        <div id="scrcpy-live-box" style="display:none;text-align:center">
                            <img id="scrcpy-live-img" alt="Tela do dispositivo" class="scrcpy-live-preview">
                        </div>
                    </div>
                </div>

                <!-- STREAMING HEADLESS (RTSP) -->
                <div class="settings-card">
                    <div class="section-title" style="margin-bottom:8px">${UI.icon('video')} Streaming Server Headless (RTSP / RTMP)</div>
                    <p class="text-muted text-sm">Captura a tela do TV Box em segundo plano via <code>screenrecord → ffmpeg → RTMP → MediaMTX</code> para transmissão na rede sem abrir janelas no host.</p>
                    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
                        <button class="btn btn-primary btn-sm" onclick="SCRCPY.startStreaming()">${UI.icon('play')} Iniciar Streaming RTSP</button>
                        <button class="btn btn-secondary btn-sm" onclick="SCRCPY.stopMirroring()">${UI.icon('stop')} Parar Streaming</button>
                    </div>
                    <div id="scrcpy-stream-url" style="margin-top:8px"></div>
                </div>

                <!-- ESTAÇÕES AUTORIZADAS (ENROLLMENTS) -->
                <div class="settings-card">
                    <div class="scrcpy-enrollment-heading">
                        <div>
                            <div class="section-title" style="margin:0">${UI.icon('lock')} Estações de Trabalho Autorizadas</div>
                            <p class="text-muted text-xs" style="margin-top:4px">Computadores que possuem chaves criptográficas ADB autorizadas para acessar os TV Boxes.</p>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="SCRCPY.loadEnrollments()">${UI.icon('refresh')} Atualizar</button>
                    </div>
                    <div id="scrcpy-enrollments" style="margin-top:10px">
                        ${UI.skeletons('row', 2)}
                    </div>
                </div>

                <!-- VERSÕES DO BINÁRIO SCRCPY -->
                <div class="section-title mt-md">${UI.icon('archive')} Versões do Binário Scrcpy</div>
                <div class="settings-card" id="scrcpy-status-card">
                    ${UI.skeletons('line', 3)}
                </div>

                <div class="settings-card">
                    <div style="display:flex;gap:8px;margin-bottom:12px">
                        <button class="btn btn-secondary btn-sm" onclick="SCRCPY.checkUpdates()">${UI.icon('search')} Verificar Versões no GitHub</button>
                        <button class="btn btn-primary btn-sm" onclick="SCRCPY.installLatest()">${UI.icon('download')} Instalar Versão Mais Recente</button>
                    </div>
                    <div id="scrcpy-versions">
                        ${UI.skeletons('row', 2)}
                    </div>
                </div>
            </div>
        `;

        await Promise.all([
            loadStatus(),
            loadEnrollments(),
            loadSessions()
        ]);
    }

    async function loadSessions() {
        const box = document.getElementById('scrcpy-sessions-table-box');
        if (!box) return;

        try {
            const diag = await API.get('/scrcpy/diagnostics').catch(() => null);
            const activeSessions = (diag && Array.isArray(diag.active_sessions)) ? diag.active_sessions : [];
            activeSessionsCache = activeSessions;

            const pill = document.getElementById('scrcpy-session-pill');
            const pillText = document.getElementById('scrcpy-session-text');
            if (pill && pillText) {
                if (activeSessions.length > 0) {
                    pill.classList.add('active');
                    pillText.textContent = `${activeSessions.length} sessão(ões) ativa(s)`;
                } else {
                    pill.classList.remove('active');
                    pillText.textContent = 'Nenhuma sessão ativa';
                }
            }

            if (activeSessions.length === 0) {
                box.innerHTML = UI.stateView(
                    'empty',
                    'Nenhuma janela de espelhamento ou streaming RTSP em execução no momento.',
                    { icon: 'monitor', title: 'Sem sessões ativas' }
                );
                return;
            }

            const rows = activeSessions.map((s, idx) => {
                const targetName = deviceNames.get(s.target) || s.target;
                return {
                    id: `session-${idx}-${s.target}`,
                    target: s.target,
                    targetName,
                    type: s.type === 'streaming' ? 'Streaming RTSP' : 'Espelhamento Host',
                    pid: s.pid ? `PID ${s.pid}` : '—',
                    uptime: s.uptime_seconds ? `${s.uptime_seconds}s` : (s.started_at ? UI.timeAgo(s.started_at) : 'ativo'),
                    status: s.running ? 'online' : 'offline',
                };
            });

            const columns = [
                {
                    key: 'targetName',
                    label: 'Dispositivo / Destino',
                    sortable: true,
                    render: (val, row) => `
                        <div>
                            <span class="font-semibold">${UI.escapeHtml(val)}</span>
                            <span class="text-muted text-xs font-mono" style="display:block">${UI.escapeHtml(row.target)}</span>
                        </div>
                    `
                },
                {
                    key: 'type',
                    label: 'Tipo de Sessão',
                    render: (val) => `<span class="badge font-medium">${UI.escapeHtml(val)}</span>`
                },
                {
                    key: 'pid',
                    label: 'Processo',
                    render: (val) => `<code class="mono text-xs">${UI.escapeHtml(val)}</code>`
                },
                {
                    key: 'uptime',
                    label: 'Duração',
                    render: (val) => `<span class="text-muted text-xs">${UI.escapeHtml(val)}</span>`
                },
                {
                    key: 'status',
                    label: 'Status',
                    render: (val) => UI.stateBadge(val, { label: 'ATIVO' })
                },
                {
                    key: 'actions',
                    label: 'Ações',
                    align: 'right',
                    render: () => `
                        <button class="btn btn-sm btn-danger" onclick="SCRCPY.stopMirroring()" title="Encerrar sessão">
                            ${UI.icon('stop')} Encerrar
                        </button>
                    `
                }
            ];

            box.innerHTML = UI.dataTable({
                id: 'scrcpy-sessions-table',
                columns,
                rows,
                emptyMessage: 'Nenhuma sessão em execução'
            });

        } catch (e) {
            box.innerHTML = UI.stateView('error', `Falha ao carregar sessões: ${e.message}`, { retry: true });
            UI.bindStateRetry(box, loadSessions);
        }
    }

    async function loadStatus() {
        try {
            const [status, vr] = await Promise.all([
                API.get('/scrcpy/status'),
                API.get('/scrcpy/versions'),
            ]);
            const card = document.getElementById('scrcpy-status-card');
            if (card) {
                card.innerHTML = `
                    <div class="info-row"><span class="info-key">Versão Ativa no Servidor:</span><span class="info-val font-semibold">${UI.escapeHtml(status.current_version || 'Nenhuma versão ativada')}</span></div>
                    <div class="info-row"><span class="info-key">Binário Instalado:</span><span class="info-val">${status.binary_exists ? UI.stateBadge('online', { label: 'DISPONÍVEL' }) : UI.stateBadge('offline', { label: 'AUSENTE' })}</span></div>
                    <div class="info-row"><span class="info-key">Caminho do Binário:</span><span class="info-val mono text-xs">${UI.escapeHtml(status.binary_path || '—')}</span></div>
                    <div class="info-row"><span class="info-key">Versões Arquivadas:</span><span class="info-val">${status.versions_count || 0}</span></div>
                `;
            }
            const el = document.getElementById('scrcpy-versions');
            if (!el) return;
            const vv = vr.versions || [];
            if (!vv.length) {
                el.innerHTML = UI.stateView('empty', 'Nenhuma versão do scrcpy baixada.', { icon: 'archive', title: 'Sem versões' });
                return;
            }
            el.innerHTML = vv.map(v => `
                <div class="scrcpy-version-item ${v.current ? 'active' : ''}">
                    <div>
                        <div class="scrcpy-version-name">v${UI.escapeHtml(v.version)} ${v.current ? '<span class="badge badge-success">ativo</span>' : ''}</div>
                        <div class="scrcpy-version-meta font-mono">${(v.size_bytes / 1048576).toFixed(1)} MB</div>
                    </div>
                    <div class="scrcpy-version-actions">
                        ${!v.current ? `<button class="btn btn-sm btn-secondary" onclick="SCRCPY.activateVersion('${UI.escAttr(v.version)}')">Ativar</button>` : ''}
                        <button class="btn btn-sm btn-danger" onclick="SCRCPY.deleteVersion('${UI.escAttr(v.version)}')" title="Excluir versão v${UI.escAttr(v.version)}" aria-label="Excluir versão v${UI.escAttr(v.version)}">${UI.icon('trash')}</button>
                    </div>
                </div>`).join('');
        } catch (e) {
            /* ok */
        }
    }

    async function startStreaming() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast(`Iniciando streaming RTSP para ${deviceId}...`, 'info');
        try {
            const res = await API.post(`/scrcpy/stream/${encodeURIComponent(deviceId)}`);
            if (res.success) {
                setSession('streaming');
                const box = document.getElementById('scrcpy-stream-url');
                if (box) {
                    box.innerHTML = `
                        <div class="server-urls-box">
                            <div class="info-row"><span class="info-key">Stream RTSP Ativo:</span><span class="info-val mono font-semibold">${UI.escapeHtml(res.rtsp_url || '')}</span></div>
                        </div>
                    `;
                }
                UI.createToast(`Streaming ativo (PID ffmpeg ${res.ffmpeg_pid})!`, 'success');
                await loadSessions();
            } else {
                UI.createToast(`${res.error || 'Falha no streaming'}`, 'error');
            }
        } catch (e) {
            UI.createToast(`${e.message}`, 'error');
        }
    }

    function setSession(state) {
        const pill = document.getElementById('scrcpy-session-pill');
        const text = document.getElementById('scrcpy-session-text');
        if (!pill || !text) return;
        const active = state === 'mirroring' || state === 'streaming';
        if (active) {
            pill.classList.add('active');
            text.textContent = state === 'mirroring' ? 'Espelhamento ativo' : 'Streaming RTSP ativo';
        } else {
            pill.classList.remove('active');
            text.textContent = 'Nenhuma sessão ativa';
        }
    }

    async function downloadBundle() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast('Gerando pacote scrcpy + atalhos...', 'info');
        try {
            await API.download(`/scrcpy/client/bundle/${encodeURIComponent(deviceId)}`, `scrcpy-${deviceId}.zip`);
            UI.createToast('Pacote scrcpy baixado com sucesso!', 'success');
        } catch (e) {
            UI.createToast(`Falha ao baixar pacote: ${e.message}`, 'error');
        }
    }

    async function downloadStationBundle() {
        UI.createToast('Preparando instalador rápido do cliente (.cmd)...', 'info');
        try {
            await API.download('/scrcpy/client/installer', 'instalar-scrcpy.cmd');
            UI.createToast('Instalador rápido baixado! Execute-o para habilitar o 1-clique neste PC.', 'success');
        } catch (e) {
            UI.createToast(`Falha ao baixar instalador: ${e.message}`, 'error');
        }
    }

    async function startHost() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        const devName = deviceNames.get(deviceId) || deviceId;
        UI.createToast(`Iniciando scrcpy no desktop do host para ${devName}...`, 'info');
        try {
            const extra = buildArgs();
            const res = await API.post(`/scrcpy/start/${encodeURIComponent(deviceId)}`, { extra_args: extra });
            if (res.success) {
                setSession('mirroring');
                UI.createToast(`Janela do scrcpy aberta na área de trabalho do servidor (PID ${res.pid})!`, 'success');
                await loadSessions();
            } else {
                UI.createToast(res.error || 'Falha ao iniciar scrcpy no host', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao comunicar com o servidor', 'error');
        }
    }

    async function downloadStationZip() {
        UI.createToast('Baixando pacote portátil do cliente (.zip)...', 'info');
        try {
            await API.download('/scrcpy/client/station-bundle', 'PainelTVBox-Scrcpy-Cliente.zip');
            UI.createToast('Pacote portátil baixado!', 'success');
        } catch (e) {
            UI.createToast(`Falha ao baixar pacote portátil: ${e.message}`, 'error');
        }
    }

    async function startLocal() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um TV Box primeiro', 'warning');
            return;
        }
        const dev = devicesList.find(d => d.id === deviceId);
        if (dev && dev.ip) {
            UI.launchScrcpy(dev);
            return;
        }
        try {
            const result = await API.post(`/scrcpy/client/launch-ticket/${encodeURIComponent(deviceId)}`);
            UI.createToast('Abrindo o cliente scrcpy via protocolo local...', 'info');
            window.location.href = result.protocol_url;
        } catch (e) {
            UI.createToast(e.message || 'Falha ao iniciar cliente local', 'error');
        }
    }

    async function loadEnrollments() {
        const box = document.getElementById('scrcpy-enrollments');
        if (!box) return;
        try {
            const result = await API.get('/scrcpy/client/enrollments');
            enrollmentClients = result.clients || [];
            if (!enrollmentClients.length) {
                box.innerHTML = UI.stateView('empty', 'Nenhuma estação externa autorizada.', { icon: 'lock', title: 'Sem autorizações' });
                return;
            }
            box.innerHTML = enrollmentClients.map(client => {
                const devices = (client.devices || []).map(deviceId => `
                    <div class="scrcpy-enrollment-device">
                        <span class="font-semibold">${UI.escapeHtml(deviceNames.get(deviceId) || deviceId)}</span>
                        <button class="btn btn-danger btn-sm" onclick="SCRCPY.revokeEnrollment('${UI.escAttr(client.id)}','${UI.escAttr(deviceId)}')">Revogar</button>
                    </div>`).join('');
                const created = client.created_at ? new Date(client.created_at).toLocaleString('pt-BR') : '—';
                return `
                    <div class="scrcpy-enrollment-item">
                        <div class="scrcpy-enrollment-summary">
                            <div>
                                <strong style="font-size:0.95rem">${UI.escapeHtml(client.name || client.id)}</strong>
                                <div class="text-muted text-xs mono" style="margin-top:2px">${UI.escapeHtml(client.fingerprint || '')}</div>
                                <div class="text-muted text-xs">Autorizado desde ${UI.escapeHtml(created)}</div>
                            </div>
                            <button class="btn btn-danger btn-sm" onclick="SCRCPY.revokeAll('${UI.escAttr(client.id)}')">Revogar de Todos</button>
                        </div>
                        <div class="scrcpy-enrollment-devices">${devices}</div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            box.innerHTML = UI.stateView('error', `Falha ao carregar autorizações: ${e.message}`, { retry: true });
            UI.bindStateRetry(box, loadEnrollments);
        }
    }

    function revokeEnrollment(clientId, deviceId) {
        const deviceName = deviceNames.get(deviceId) || deviceId;
        UI.showModal('Revogar Acesso', `<p>Remover a autorização desta estação no TV Box <strong>${UI.escapeHtml(deviceName)}</strong>?</p>`, async () => {
            try {
                await API.del(`/scrcpy/client/enrollments/${encodeURIComponent(clientId)}/${encodeURIComponent(deviceId)}`);
                UI.createToast('Autorização revogada com sucesso', 'success');
                await loadEnrollments();
            } catch (e) {
                UI.createToast(e.message || 'Falha ao revogar', 'error');
            }
        });
    }

    function revokeAll(clientId) {
        const client = enrollmentClients.find(item => item.id === clientId);
        if (!client) return;
        UI.showModal('Revogar Estação Completa', `<p>Remover a estação <strong>${UI.escapeHtml(client.name || client.id)}</strong> de todos os TV Boxes cadastrados?</p>`, async () => {
            let failures = 0;
            for (const deviceId of client.devices || []) {
                try {
                    await API.del(`/scrcpy/client/enrollments/${encodeURIComponent(clientId)}/${encodeURIComponent(deviceId)}`);
                } catch {
                    failures += 1;
                }
            }
            UI.createToast(failures ? `${failures} revogações falharam` : 'Estação revogada de todos os boxes com sucesso', failures ? 'warning' : 'success');
            await loadEnrollments();
        });
    }

    async function downloadLauncher() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast('Baixando atalho executável .BAT...', 'info');
        try {
            await API.download(`/scrcpy/client/launcher/${encodeURIComponent(deviceId)}`, `iniciar-${deviceId}.bat`);
            UI.createToast('Atalho .BAT baixado com sucesso!', 'success');
        } catch (e) {
            UI.createToast(`Falha ao baixar launcher: ${e.message}`, 'error');
        }
    }

    async function startMirroring() {
        return downloadBundle();
    }

    async function stopMirroring() {
        try {
            await API.post('/scrcpy/stop');
            UI.createToast('Processos de espelhamento e streaming encerrados', 'success');
            setSession('stopped');
            await loadSessions();
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
    }

    let liveTimer = null;
    let liveDeviceId = '';
    let liveBusy = false;

    function stopLiveTimer() {
        if (liveTimer) {
            clearInterval(liveTimer);
            liveTimer = null;
        }
    }

    function stopLive() {
        stopLiveTimer();
        liveDeviceId = '';
        liveBusy = false;
        const status = document.getElementById('scrcpy-live-status');
        if (status) status.textContent = 'Parado';
        const box = document.getElementById('scrcpy-live-box');
        if (box) box.style.display = 'none';
        UI.createToast('Pré-visualização ao vivo interrompida', 'info');
    }

    async function startLive() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um TV Box primeiro', 'warning');
            return;
        }
        liveDeviceId = deviceId;
        const box = document.getElementById('scrcpy-live-box');
        const status = document.getElementById('scrcpy-live-status');
        if (box) box.style.display = 'block';
        if (status) status.textContent = 'Iniciando captura...';
        stopLiveTimer();
        liveTimer = setInterval(refreshLiveShot, 3000);
        await refreshLiveShot();
        UI.createToast('Pré-visualização periódica iniciada', 'info');
    }

    async function refreshLiveShot() {
        if (!liveDeviceId || liveBusy) return;
        liveBusy = true;
        const img = document.getElementById('scrcpy-live-img');
        const status = document.getElementById('scrcpy-live-status');
        try {
            const cap = await API.post(`/devices/${encodeURIComponent(liveDeviceId)}/screenshot`);
            if (!cap.success) {
                if (status) status.textContent = cap.error || 'Falha na captura';
                return;
            }
            if (img) {
                if (img._blobUrl) {
                    URL.revokeObjectURL(img._blobUrl);
                }
                const blobUrl = await API.fetchBlobUrl(`/devices/${encodeURIComponent(liveDeviceId)}/screenshot?t=${Date.now()}`);
                img._blobUrl = blobUrl;
                img.src = blobUrl;
            }
            if (status) status.textContent = 'Atualizado às ' + new Date().toLocaleTimeString();
        } catch (e) {
            if (status) status.textContent = e.message || 'Falha';
        } finally {
            liveBusy = false;
        }
    }

    async function checkUpdates() {
        UI.createToast('Buscando versões do scrcpy no GitHub...', 'info');
        try {
            const r = await API.post('/scrcpy/check');
            if (r.error) {
                UI.createToast(`Erro: ${r.error}`, 'error');
                return;
            }
            UI.createToast(r.has_update ? `Nova versão v${r.latest_version} disponível!` : 'O scrcpy já está na versão mais recente', 'success');
        } catch (e) {
            UI.createToast(`Erro: ${e.message}`, 'error');
        }
    }

    async function installLatest() {
        UI.createToast('Baixando e compilando binário mais recente...', 'info', 6000);
        try {
            const res = await API.post('/scrcpy/install');
            if (res.success) {
                UI.createToast(`scrcpy v${res.version} instalado e ativado!`, 'success');
            } else {
                UI.createToast(`Falha: ${res.error}`, 'error');
            }
            await loadStatus();
        } catch (e) {
            UI.createToast(`Erro na instalação: ${e.message}`, 'error');
        }
    }

    async function activateVersion(version) {
        UI.showModal(
            `Ativar scrcpy v${version}`,
            `<p>Deseja definir a versão <strong>v${UI.escapeHtml(version)}</strong> como ativa para novas conexões?</p>`,
            async () => {
                try {
                    const res = await API.post(`/scrcpy/activate/${encodeURIComponent(version)}`);
                    UI.createToast(res.success ? `v${version} ativada com sucesso!` : `Falha: ${res.error}`, res.success ? 'success' : 'error');
                    await loadStatus();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function deleteVersion(version) {
        UI.showModal(
            `Remover v${version}`,
            `<p>Excluir permanentemente os binários do scrcpy versão <strong>v${UI.escapeHtml(version)}</strong>?</p>`,
            async () => {
                try {
                    await API.del(`/scrcpy/versions/${encodeURIComponent(version)}`);
                    UI.createToast(`Versão v${version} removida com sucesso`, 'success');
                    await loadStatus();
                } catch (e) {
                    UI.createToast(`Erro: ${e.message}`, 'error');
                }
            }
        );
    }

    async function sendKey(keycode) {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um TV Box primeiro', 'warning');
            return;
        }
        try {
            await API.post(`/devices/${encodeURIComponent(deviceId)}/shell`, { command: `input keyevent ${keycode}` });
        } catch (e) {
            UI.createToast(`Erro ao enviar comando: ${e.message}`, 'error');
        }
    }

    async function sendInputText() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        const input = document.getElementById('scrcpy-inject-text');
        const text = input?.value || '';
        if (!deviceId) {
            UI.createToast('Selecione um TV Box primeiro', 'warning');
            return;
        }
        if (!text.trim()) return;
        try {
            const escaped = text.replace(/'/g, "\\'");
            await API.post(`/devices/${encodeURIComponent(deviceId)}/shell`, { command: `input text '${escaped}'` });
            UI.createToast('Texto enviado ao TV Box!', 'success');
            if (input) input.value = '';
        } catch (e) {
            UI.createToast(`Erro ao enviar texto: ${e.message}`, 'error');
        }
    }

    return {
        render,
        startHost,
        downloadBundle,
        downloadLauncher,
        downloadStationBundle,
        downloadStationZip,
        startLocal,
        loadEnrollments,
        revokeEnrollment,
        revokeAll,
        startMirroring,
        startStreaming,
        stopMirroring,
        startLive,
        stopLive,
        checkUpdates,
        installLatest,
        activateVersion,
        deleteVersion,
        sendKey,
        sendInputText,
        loadStatus,
        loadSessions
    };
})();
