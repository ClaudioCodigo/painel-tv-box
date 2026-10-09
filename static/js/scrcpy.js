/**
 * Scrcpy Page — gestão de versões + mirroring com seletor de dispositivos.
 */
const SCRCPY = (() => {
    let refreshTimer = null;
    let deviceNames = new Map();
    let devicesList = [];
    let enrollmentClients = [];

    const PRESET_ARGS = [
        {id:'arg-br',label:'Limitar bitrate',desc:'--video-bit-rate=2M',cmd:'--video-bit-rate=2M',grp:'rede'},
        {id:'arg-fps',label:'Limitar FPS 30',desc:'--max-fps=30',cmd:'--max-fps=30',grp:'rede'},
        {id:'arg-h264',label:'Codec H.264 (leve)',desc:'--video-codec=h264',cmd:'--video-codec=h264',grp:'codec'},
        {id:'arg-h265',label:'Codec H.265 (melhor)',desc:'--video-codec=h265',cmd:'--video-codec=h265',grp:'codec'},
        {id:'arg-noaudio',label:'Sem áudio',desc:'--no-audio',cmd:'--no-audio',grp:'audio'},
        {id:'arg-nowin',label:'Headless (sem janela)',desc:'--no-window',cmd:'--no-window',grp:'exib'},
        {id:'arg-off',label:'Desligar tela',desc:'--turn-screen-off',cmd:'--turn-screen-off',grp:'exib'},
        {id:'arg-awake',label:'Manter acordado',desc:'--stay-awake',cmd:'--stay-awake',grp:'exib'},
    ];

    const GRP = {
        rede:{icon:'⚡',lbl:'Rede / Desempenho'},
        codec:{icon:'🎞️',lbl:'Codec'},
        audio:{icon:'🔇',lbl:'Áudio'},
        exib:{icon:'🖥️',lbl:'Exibição'}
    };

    function buildArgs() {
        const checks = PRESET_ARGS.filter(a => document.getElementById(a.id)?.checked).map(a => a.cmd);
        const extra = (document.getElementById('scrcpy-args')?.value || '').trim();
        if (extra) checks.push(extra);
        return checks.join(' ');
    }

    // Renderização principal (agora async para carregar dispositivos)
    async function render(el) {
        UI.setPageTitle('Telas & Sessões');

        // 1. Buscar dispositivos cadastrados
        let devices = [];
        try {
            devices = await API.get('/devices') || [];
        } catch (e) {
            // Se falhar, a lista ficará vazia
        }
        devicesList = devices;
        deviceNames = new Map(devices.map(d => [d.id, d.name || d.id]));

        const deviceOptions = devices.map(d =>
            `<option value="${UI.escapeHtml(d.id)}">${UI.escapeHtml(d.name || d.id)} (${UI.escapeHtml(d.ip || '')})</option>`
        ).join('');

        // 2. Construir checkboxes de args
        let cb = '';
        for (const [k,g] of Object.entries(GRP)) {
            const items = PRESET_ARGS.filter(a => a.grp === k);
            cb += `<div class="scrcpy-arg-grp">
                     <div class="scrcpy-arg-title">${g.icon} ${g.lbl}</div>
                     <div class="scrcpy-arg-grid">`;
            cb += items.map(a =>
                `<label class="scrcpy-arg-item">
                    <input type="checkbox" id="${a.id}"><span>${a.label}</span><code>${a.desc}</code>
                 </label>`
            ).join('');
            cb += '</div></div>';
        }

        // 3. Montar HTML completo com <select> em vez de <input>
        el.innerHTML = `
<div class="scrcpy-page">
 <div class="section-title">🖥️ Telas & Sessões (scrcpy)</div>
 <div class="settings-card" id="scrcpy-status-card"><div class="loading">Carregando...</div></div>

 <div class="settings-card full">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <h3 style="margin:0">🖥️ Espelhamento e Controle (scrcpy)</h3>
    <span class="live-badge" id="scrcpy-session"><span class="status-mini-dot"></span> Parado</span>
  </div>
  <p class="text-muted text-sm">
    Abra uma janela nativa do scrcpy no desktop deste computador ou em qualquer estação de trabalho na rede.
  </p>
  <div class="form-group" style="margin-top:12px">
   <label class="form-label">Selecione o TV Box</label>
   <select id="scrcpy-device" class="form-input">
     ${deviceOptions || '<option value="">Nenhum dispositivo</option>'}
   </select>
  </div>

  <details style="margin-top:12px;background:var(--bg-inset);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px">
    <summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--text-secondary)">⚙️ Opções avançadas do scrcpy (Bitrate, FPS, Codec)</summary>
    <div style="margin-top:10px">
      ${cb}
      <div style="margin-top:8px">
        <label class="text-muted text-sm" style="display:block;margin-bottom:4px">Argumentos adicionais:</label>
        <input type="text" id="scrcpy-args" class="form-input text-sm mono" placeholder="ex: --max-size=1280 --stay-awake">
      </div>
    </div>
  </details>

  <details style="margin-top:10px;background:var(--bg-inset);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px">
    <summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--text-secondary)">🎮 Mini Controle Remoto Virtual (sem abrir janela)</summary>
    <div style="margin-top:12px;display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <div>
        <div class="dpad" role="group" aria-label="Controle direcional">
          <span></span><button type="button" title="Cima" onclick="SCRCPY.sendKey(19)">▲</button><span></span>
          <button type="button" title="Esquerda" onclick="SCRCPY.sendKey(21)">◀</button><button type="button" title="OK / Enter" onclick="SCRCPY.sendKey(66)">●</button><button type="button" title="Direita" onclick="SCRCPY.sendKey(22)">▶</button>
          <span></span><button type="button" title="Baixo" onclick="SCRCPY.sendKey(20)">▼</button><span></span>
        </div>
        <div class="dpad-row">
          <button type="button" title="Voltar" onclick="SCRCPY.sendKey(4)">↩ Voltar</button>
          <button type="button" title="Home" onclick="SCRCPY.sendKey(3)">⌂ Home</button>
          <button type="button" title="Atualizar página" onclick="SCRCPY.sendKey(131)">↻ F5</button>
        </div>
      </div>
      <div style="flex:1;min-width:240px">
        <label class="text-muted text-sm" style="display:block;margin-bottom:4px">Digitar texto direto no TV Box:</label>
        <div style="display:flex;gap:6px">
          <input type="text" id="scrcpy-inject-text" class="form-input text-sm" placeholder="Texto para digitar..." onkeydown="if(event.key==='Enter')SCRCPY.sendInputText()">
          <button type="button" class="btn btn-sm btn-primary" onclick="SCRCPY.sendInputText()">Enviar</button>
        </div>
        <small class="text-muted" style="display:block;margin-top:4px">Injeta texto no campo atualmente focado no TV Box via ADB.</small>
      </div>
    </div>
  </details>

  <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center">
   <button class="btn btn-primary" onclick="SCRCPY.startLocal()">${UI.icon('monitor')} 🚀 Abrir neste PC (1-Clique)</button>
   <button class="btn btn-secondary" onclick="SCRCPY.downloadStationZip()">${UI.icon('download')} 📥 Baixar Pacote Portátil (.zip)</button>
   <button class="btn btn-secondary" onclick="SCRCPY.downloadStationBundle()">${UI.icon('download')} ⚡ Instalador Rápido (.cmd)</button>
   <button class="btn btn-secondary" onclick="SCRCPY.downloadLauncher()">${UI.icon('download')} 📄 Atalho .BAT deste Box</button>
   <button class="btn btn-secondary" onclick="SCRCPY.startHost()">${UI.icon('play')} Abrir no Servidor</button>
   <button class="btn btn-danger" onclick="SCRCPY.stopMirroring()">${UI.icon('stop')} Fechar Janela</button>
  </div>

  <div class="scrcpy-help">
    <div class="scrcpy-help-title">💡 Como usar o Acesso Remoto</div>
    <p class="scrcpy-help-lead">
      A tela do TV Box é uma só: ela abre em <strong>um lugar por vez</strong>. Escolha abaixo onde ela deve aparecer.
    </p>

    <div class="scrcpy-help-group">
      <div class="scrcpy-help-group-title">1ª vez em cada computador <span class="scrcpy-help-tag">sem senha de administrador</span></div>
      <ul class="scrcpy-help-list">
        <li>
          <strong>⚡ Instalador Rápido (.cmd)</strong> <span class="scrcpy-help-rec">recomendado</span><br>
          Baixe e dê duplo-clique — não precisa extrair nada. Ele baixa o Scrcpy, cria a chave ADB
          deste PC e registra o protocolo <code>paineltvbox://</code> sozinho. É o que faz o botão
          <strong>Abrir neste PC</strong> passar a funcionar.
        </li>
        <li>
          <strong>📥 Baixar Pacote Portátil (.zip)</strong><br>
          A mesma instalação, feita à mão: extraia o ZIP e execute <code>INSTALAR-1-CLIQUE.bat</code>.
          Use quando o navegador ou o antivírus bloquear o <code>.cmd</code>. O pacote também traz um
          atalho de duplo-clique para cada TV Box cadastrado.
        </li>
      </ul>
    </div>

    <div class="scrcpy-help-group">
      <div class="scrcpy-help-group-title">No dia a dia</div>
      <ul class="scrcpy-help-list">
        <li>
          <strong>🚀 Abrir neste PC (1-Clique)</strong><br>
          Abre a tela do TV Box no monitor <strong>deste</strong> computador, pelo protocolo
          <code>paineltvbox://</code>. Requer o cliente instalado aqui uma vez (passo acima).
        </li>
        <li>
          <strong>🖥️ Abrir no Servidor</strong><br>
          Abre a janela no desktop do <strong>próprio servidor</strong> do painel e não instala nada na
          sua máquina. É a opção de quem já está no PC host ou precisa ver a tela sem instalar o cliente.
        </li>
        <li>
          <strong>📄 Atalho .BAT deste Box</strong><br>
          Baixa um <code>.bat</code> que conecta direto no TV Box selecionado, sem passar pelo navegador.
          Guarde-o dentro da pasta extraída do Pacote Portátil, ao lado de <code>scrcpy\</code> e
          <code>credencial\</code>.
        </li>
        <li>
          <strong>⏹ Fechar Janela</strong><br>
          Encerra a sessão de scrcpy aberta no servidor (a janela aberta no seu PC fecha no próprio PC).
        </li>
      </ul>
    </div>

    <p class="scrcpy-help-note">
      ⚠️ Clicou em <strong>Abrir neste PC</strong> e nada abriu? O cliente ainda não está instalado nesta
      máquina: rode o <strong>Instalador Rápido (.cmd)</strong> uma única vez e clique de novo.
    </p>
  </div>
 </div>

 <div class="settings-card full">
  <div class="scrcpy-enrollment-heading">
   <div><h3>🔑 Estações autorizadas</h3><p class="text-muted text-sm">Computadores que podem abrir o scrcpy nos TV Boxes.</p></div>
   <button class="btn btn-secondary btn-sm" onclick="SCRCPY.loadEnrollments()">Atualizar</button>
  </div>
  <div id="scrcpy-enrollments"><div class="loading">Carregando...</div></div>
 </div>

 <div class="settings-card full">
  <h3 style="margin-bottom:8px">📡 Streaming Server (sem tela)</h3>
  <p class="text-muted text-sm">Captura a tela direto no servidor via <code>screenrecord → ffmpeg → RTSP</code> — útil para monitoramento remoto.</p>
  <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
   <button class="btn btn-success" onclick="SCRCPY.startStreaming()">${UI.icon('monitor')} Iniciar Streaming</button>
   <button class="btn btn-danger" onclick="SCRCPY.stopMirroring()">${UI.icon('stop')} Parar</button>
   <span class="live-badge" id="scrcpy-session"><span class="live-dot"></span> Parado</span>
  </div>
  <div id="scrcpy-stream-url" style="margin-top:8px"></div>
 </div>

 <div class="settings-card full">
  <h3 style="margin-bottom:8px">Tela ao vivo (navegador)</h3>
  <p class="text-muted text-sm">Captura a tela do box a cada ~3s e mostra aqui no browser - nao depende do scrcpy.</p>
  <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
   <button class="btn btn-success" onclick="SCRCPY.startLive()">${UI.icon('play')} Ver tela</button>
   <button class="btn btn-danger" onclick="SCRCPY.stopLive()">${UI.icon('stop')} Parar</button>
   <span class="text-muted text-sm" id="scrcpy-live-status"></span>
  </div>
  <div id="scrcpy-live-box" style="display:none">
   <img id="scrcpy-live-img" alt="Tela do dispositivo" style="width:100%;max-width:960px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:#000">
  </div>
 </div>
 <div class="section-title mt-md">${UI.icon('archive')} Versões</div>
 <div class="settings-card">
  <div style="display:flex;gap:8px;margin-bottom:12px">
   <button class="btn btn-primary btn-sm" onclick="SCRCPY.checkUpdates()">🔍 Verificar</button>
   <button class="btn btn-success btn-sm" onclick="SCRCPY.installLatest()">${UI.icon('download')} Instalar</button>
  </div>
  <div id="scrcpy-versions"><div class="loading">Carregando...</div></div>
 </div>
 <div id="scrcpy-update-info"></div>
</div>`;
        // 4. Carregar status de versões após o HTML estar pronto
        await Promise.all([loadStatus(), loadEnrollments()]);
    }

    async function loadStatus() {
        try {
            const [status, vr] = await Promise.all([
                API.get('/scrcpy/status'),
                API.get('/scrcpy/versions'),
            ]);
            const card = document.getElementById('scrcpy-status-card');
            if (card) card.innerHTML = `
                <div class="info-row"><span class="info-key">Versão Ativa</span><span class="info-val">${status.current_version||'nenhuma'}</span></div>
                <div class="info-row"><span class="info-key">Binário</span><span class="info-val">${status.binary_exists?'✅':'❌'}</span></div>
                <div class="info-row"><span class="info-key">Versões</span><span class="info-val">${status.versions_count}</span></div>`;
            const el = document.getElementById('scrcpy-versions');
            if (!el) return;
            const vv = vr.versions || [];
            if (!vv.length) { el.innerHTML = '<div class="empty-state">Nenhuma versão instalada</div>'; return; }
            el.innerHTML = vv.map(v => `
                <div class="scrcpy-version-item ${v.current ? 'active' : ''}">
                    <div>
                        <div class="scrcpy-version-name">v${v.version} ${v.current ? '<span class="badge">ativo</span>' : ''}</div>
                        <div class="scrcpy-version-meta">${(v.size_bytes/1048576).toFixed(1)} MB</div>
                    </div>
                    <div class="scrcpy-version-actions">
                        ${!v.current?`<button class="btn btn-sm btn-secondary" onclick="SCRCPY.activateVersion('${v.version}')">Ativar</button>`:''}
                        <button class="btn btn-sm btn-danger" onclick="SCRCPY.deleteVersion('${v.version}')">${UI.icon('trash')}</button>
                    </div>
                </div>`).join('');
        } catch(e) { /* */ }
    }

    async function startStreaming() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast(`Iniciando streaming ${deviceId}...`, 'info');
        try {
            const res = await API.post(`/scrcpy/stream/${deviceId}`);
            if (res.success) {
                setSession('streaming');
                const box = document.getElementById('scrcpy-stream-url');
                if (box) {
                    box.innerHTML = `<div class="info-row"><span class="info-key">RTSP</span><span class="info-val mono">${UI.escapeHtml(res.rtsp_url || '')}</span></div>`;
                }
                UI.createToast(`Streaming ativo (ffmpeg PID ${res.ffmpeg_pid})`, 'success');
            } else {
                UI.createToast(`${res.error || 'Falha no streaming'}`, 'error');
            }
        } catch (e) {
            UI.createToast(`${e.message}`, 'error');
        }
    }

    function setSession(state) {
        const el = document.getElementById('scrcpy-session');
        if (!el) return;
        const active = state === 'mirroring' || state === 'streaming';
        el.innerHTML = active
            ? '<span class="live-dot"></span> ' + (state === 'mirroring' ? 'Espelhando' : 'Streamando')
            : '<span class="status-mini-dot" style="opacity:0.4"></span> Parado';
    }

    async function downloadBundle() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast('Gerando pacote scrcpy + launcher...', 'info');
        const url = API.authUrl(`/scrcpy/client/bundle/${encodeURIComponent(deviceId)}`);
        const a = document.createElement('a');
        a.href = `/api${url}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function downloadStationBundle() {
        UI.createToast('Preparando instalador do cliente...', 'info');
        const url = API.authUrl('/scrcpy/client/installer');
        const a = document.createElement('a');
        a.href = `/api${url}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function startHost() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        const devName = deviceNames.get(deviceId) || deviceId;
        UI.createToast(`Iniciando scrcpy para ${devName}...`, 'info');
        try {
            const extra = buildArgs();
            const res = await API.post(`/scrcpy/start/${encodeURIComponent(deviceId)}`, { extra_args: extra });
            if (res.success) {
                setSession('mirroring');
                UI.createToast(`Janela do scrcpy aberta no desktop (PID ${res.pid})!`, 'success');
            } else {
                UI.createToast(res.error || 'Falha ao iniciar scrcpy', 'error');
            }
        } catch (e) {
            UI.createToast(e.message || 'Erro ao comunicar com o servidor', 'error');
        }
    }

    function downloadStationZip() {
        UI.createToast('Baixando pacote portátil do cliente (.zip)...', 'info');
        const url = API.authUrl('/scrcpy/client/station-bundle');
        const a = document.createElement('a');
        a.href = `/api${url}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function startLocal() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) { UI.createToast('Selecione um dispositivo primeiro', 'warning'); return; }
        const dev = devicesList.find(d => d.id === deviceId);
        if (dev && dev.ip) {
            UI.launchScrcpy(dev);
            return;
        }
        try {
            const result = await API.post(`/scrcpy/client/launch-ticket/${encodeURIComponent(deviceId)}`);
            UI.createToast('Abrindo o cliente scrcpy...', 'info');
            window.location.href = result.protocol_url;
        } catch (e) {
            UI.createToast(e.message || 'Falha ao abrir o cliente', 'error');
        }
    }

    async function loadEnrollments() {
        const box = document.getElementById('scrcpy-enrollments');
        if (!box) return;
        try {
            const result = await API.get('/scrcpy/client/enrollments');
            enrollmentClients = result.clients || [];
            if (!enrollmentClients.length) {
                box.innerHTML = '<div class="empty-state">Nenhuma estação autorizada</div>';
                return;
            }
            box.innerHTML = enrollmentClients.map(client => {
                const devices = (client.devices || []).map(deviceId => `
                    <div class="scrcpy-enrollment-device">
                     <span>${UI.escapeHtml(deviceNames.get(deviceId) || deviceId)}</span>
                     <button class="btn btn-danger btn-sm" onclick="SCRCPY.revokeEnrollment('${UI.escAttr(client.id)}','${UI.escAttr(deviceId)}')">Revogar</button>
                    </div>`).join('');
                const created = client.created_at ? new Date(client.created_at).toLocaleString() : '—';
                return `<div class="scrcpy-enrollment-item">
                  <div class="scrcpy-enrollment-summary">
                   <div><strong>${UI.escapeHtml(client.name || client.id)}</strong><div class="text-muted text-sm mono">${UI.escapeHtml(client.fingerprint || '')}</div><div class="text-muted text-sm">Desde ${UI.escapeHtml(created)}</div></div>
                   <button class="btn btn-danger btn-sm" onclick="SCRCPY.revokeAll('${UI.escAttr(client.id)}')">Revogar todos</button>
                  </div>
                  <div class="scrcpy-enrollment-devices">${devices}</div>
                 </div>`;
            }).join('');
        } catch (e) {
            box.innerHTML = `<div class="empty-state">${UI.escapeHtml(e.message || 'Falha ao carregar')}</div>`;
        }
    }

    function revokeEnrollment(clientId, deviceId) {
        const deviceName = deviceNames.get(deviceId) || deviceId;
        UI.showModal('Revogar acesso', `<p>Remover esta estação de <strong>${UI.escapeHtml(deviceName)}</strong>?</p>`, async () => {
            try {
                await API.del(`/scrcpy/client/enrollments/${encodeURIComponent(clientId)}/${encodeURIComponent(deviceId)}`);
                UI.createToast('Acesso revogado', 'success');
                await loadEnrollments();
            } catch (e) { UI.createToast(e.message || 'Falha ao revogar', 'error'); }
        });
    }

    function revokeAll(clientId) {
        const client = enrollmentClients.find(item => item.id === clientId);
        if (!client) return;
        UI.showModal('Revogar estação', `<p>Remover <strong>${UI.escapeHtml(client.name || client.id)}</strong> de todos os TV Boxes?</p>`, async () => {
            let failures = 0;
            for (const deviceId of client.devices || []) {
                try { await API.del(`/scrcpy/client/enrollments/${encodeURIComponent(clientId)}/${encodeURIComponent(deviceId)}`); }
                catch { failures += 1; }
            }
            UI.createToast(failures ? `${failures} revogação(ões) falharam` : 'Estação revogada de todos os boxes', failures ? 'warning' : 'success');
            await loadEnrollments();
        });
    }

    async function downloadLauncher() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        UI.createToast('Baixando launcher...', 'info');
        const url = API.authUrl(`/scrcpy/client/launcher/${encodeURIComponent(deviceId)}`);
        const a = document.createElement('a');
        a.href = `/api${url}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function startMirroring() {
        // Legado / compatibilidade interna
        return downloadBundle();
    }

    async function stopMirroring() {
        try {
            await API.post('/scrcpy/stop');
            UI.createToast('scrcpy parado','success');
            setSession('stopped');
        } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
    }

    let liveTimer = null;
    let liveDeviceId = '';
    let liveBusy = false;

    function stopLiveTimer() {
        if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    }

    function stopLive() {
        stopLiveTimer();
        liveDeviceId = '';
        liveBusy = false;
        const status = document.getElementById('scrcpy-live-status');
        if (status) status.textContent = '';
    }

    async function startLive() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) { UI.createToast('Selecione um dispositivo primeiro', 'warning'); return; }
        liveDeviceId = deviceId;
        const box = document.getElementById('scrcpy-live-box');
        const status = document.getElementById('scrcpy-live-status');
        if (box) box.style.display = 'block';
        if (status) status.textContent = 'Capturando...';
        stopLiveTimer();
        liveTimer = setInterval(refreshLiveShot, 3000);
        await refreshLiveShot();
    }

    async function refreshLiveShot() {
        if (!liveDeviceId || liveBusy) return;
        liveBusy = true;
        const img = document.getElementById('scrcpy-live-img');
        const status = document.getElementById('scrcpy-live-status');
        try {
            const cap = await API.post(`/devices/${liveDeviceId}/screenshot`);
            if (!cap.success) {
                if (status) status.textContent = cap.error || 'Falha na captura';
                return;
            }
            if (img) img.src = API.authUrl(`/devices/${liveDeviceId}/screenshot?t=${Date.now()}`);
            if (status) status.textContent = 'Atualizado ' + new Date().toLocaleTimeString();
        } catch (e) {
            if (status) status.textContent = e.message || 'Falha';
        } finally {
            liveBusy = false;
        }
    }
    async function checkUpdates() {
        try {
            const r = await API.post('/scrcpy/check');
            if (r.error) { UI.createToast(`❌ ${r.error}`,'error'); return; }
            UI.createToast(r.has_update ? `📦 v${r.latest_version} disponível!` : '✅ Já está atualizado','success');
        } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
    }

    async function installLatest() {
        UI.createToast('⬇ Instalando...','info',5000);
        try {
            const res = await API.post('/scrcpy/install');
            if (res.success) UI.createToast(`✅ scrcpy v${res.version} instalado`,'success');
            else UI.createToast(`❌ ${res.error}`,'error');
            await loadStatus();
        } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
    }

    async function activateVersion(version) {
        UI.showModal(
            `Ativar scrcpy v${version}`,
            `<p>Trocar a versão ativa do scrcpy para <strong>v${version}</strong>?</p>`,
            async () => {
                try {
                    const res = await API.post(`/scrcpy/activate/${version}`);
                    UI.createToast(res.success ? `v${version} ativada` : `❌ ${res.error}`, res.success ? 'success' : 'error');
                    await loadStatus();
                } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
            }
        );
    }

    async function deleteVersion(version) {
        UI.showModal(`Remover v${version}`, `<p>Remover scrcpy v${version}?</p>`, async () => {
            try {
                await API.del(`/scrcpy/versions/${encodeURIComponent(version)}`);
                UI.createToast(`✅ v${version} removida`,'success');
                await loadStatus();
            } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
        });
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

    return { render, startHost, downloadBundle, downloadLauncher, downloadStationBundle, downloadStationZip, startLocal, loadEnrollments, revokeEnrollment, revokeAll, startMirroring, startStreaming, stopMirroring, startLive, stopLive, checkUpdates, installLatest, activateVersion, deleteVersion, sendKey, sendInputText };
})();
