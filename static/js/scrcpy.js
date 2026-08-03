/**
 * Scrcpy Page — gestão de versões + mirroring com seletor de dispositivos.
 */
const SCRCPY = (() => {
    let refreshTimer = null;

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
        UI.setPageTitle('scrcpy');

        // 1. Buscar dispositivos cadastrados
        let devices = [];
        try {
            devices = await API.get('/devices') || [];
        } catch (e) {
            // Se falhar, a lista ficará vazia
        }

        const deviceOptions = devices.map(d =>
            `<option value="${d.id}">${d.name || d.id} (${d.ip})</option>`
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
 <div class="section-title">📱 scrcpy <span class="badge badge-warning">⚠️ BETA</span></div>
 <div class="settings-card" id="scrcpy-status-card"><div class="loading">Carregando...</div></div>

 <div class="settings-card full">
  <h3 style="margin-bottom:8px">🖥️ Mirroring</h3>
  <div class="form-group">
   <label class="form-label">Dispositivo</label>
   <select id="scrcpy-device" class="form-input">
     ${deviceOptions || '<option value="">Nenhum dispositivo</option>'}
   </select>
  </div>

  <details style="margin-top:8px">
   <summary style="cursor:pointer;font-weight:600;color:var(--text-primary)">Opções avançadas</summary>
   ${cb}
   <div class="form-group" style="margin-top:8px">
    <label class="form-label">Args extras (custom)</label>
    <input type="text" id="scrcpy-args" class="form-input" placeholder="--max-size=1024 --no-audio" value="--max-size=1024">
   </div>
  </details>

  <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
   <button class="btn btn-primary" onclick="SCRCPY.startMirroring()">${UI.icon('play')} Iniciar Mirror</button>
   <button class="btn btn-danger" onclick="SCRCPY.stopMirroring()">${UI.icon('stop')} Parar</button>
   <span class="live-badge" id="scrcpy-session"><span class="live-dot"></span> Parado</span>
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
        await loadStatus();
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

    function setSession(state) {
        const el = document.getElementById('scrcpy-session');
        if (!el) return;
        const active = state === 'mirroring';
        el.innerHTML = active
            ? '<span class="live-dot"></span> Espelhando'
            : '<span class="status-mini-dot" style="opacity:0.4"></span> Parado';
    }

    async function startMirroring() {
        const deviceId = document.getElementById('scrcpy-device')?.value;
        if (!deviceId) {
            UI.createToast('Selecione um dispositivo primeiro', 'warning');
            return;
        }
        const allArgs = buildArgs();
        UI.createToast(`Iniciando mirror ${deviceId}...`,'info');
        try {
            const res = await API.post(`/scrcpy/start/${deviceId}`, { extra_args: allArgs });
            if (res.success) { UI.createToast(`scrcpy rodando (PID ${res.pid})`,'success'); setSession('mirroring'); }
            else UI.createToast(`❌ ${res.error}`,'error');
        } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
    }

    async function stopMirroring() {
        try {
            await API.post('/scrcpy/stop');
            UI.createToast('scrcpy parado','success');
            setSession('stopped');
        } catch(e) { UI.createToast(`❌ ${e.message}`,'error'); }
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

    return { render, startMirroring, stopMirroring, checkUpdates, installLatest, activateVersion, deleteVersion };
})();
