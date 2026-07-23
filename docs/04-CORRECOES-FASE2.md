# Plano de Correção — Fase 2 (Wizard)

Cada problema listado abaixo com:
- **Raiz** (por que existe)
- **Impacto** (o que quebra se não corrigir)
- **Mitigação** (como resolver antes/durante a implementação)
- **Implementação** (o que codificar)

---

## 🔴 Problema 1 — Estado do Wizard entre steps

**Raiz:** O spec original propõe `POST /api/wizard/step/{n}` — cada step manda dados parciais. Mas não há mecanismo para acumular estado entre chamadas (sem session/cookie/token).

**Impacto:** Se o backend não acumular, cada step sobrescreve o anterior. Se acumular em memória, crash do servidor perde tudo. Ambas as opções são frágeis.

**Mitigação:**
> Não acumular estado no servidor. O frontend guarda um objeto `wizardData` em memória e só envia tudo de uma vez no step final.

**Implementação:**
```javascript
// wizard.js — estado client-side
const wizardData = {
  server: { host: '', port: 8080 },
  mediamtx: { api_url: 'http://localhost:9997', rtsp_port: 8554, rtmp_port: 1935 },
  adb: { default_port: 5555, connect_timeout: 10 },
  players: null,        // null = usar defaults do players.yml
  watchdog: null,       // null = usar defaults do watchdog.yml
  groups: [],
  devices: [],
};

function nextStep() {
  // Lê campos do step atual → wizardData
  // Avança step visual
}

function prevStep() {
  // Volta step visual (dados preservados no wizardData)
}

async function finish() {
  // POST /api/wizard/finish com wizardData completo
  const res = await API.post('/wizard/finish', wizardData);
  if (res.ok) window.location.hash = '#/';
}
```

**API:**
```
POST /api/wizard/finish
Body: { server: {...}, mediamtx: {...}, adb: {...}, players: {...}, watchdog: {...}, groups: [...], devices: [...] }
Response: { success: true, files_created: [...] }
```

**Por que isso resolve:** Estado vive no navegador. Refresh perde tudo (aceitável pra Wizard de 3 minutos). Sem complexidade de sessão no backend. Se o usuário recarregar, recomeça — wizard leva 2 minutos, não é crítico.

---

## 🔴 Problema 2 — Bloqueio do Wizard via middleware HTTP

**Raiz:** O spec sugere middleware 302 no FastAPI redirecionando toda rota para `/wizard`. Mas o app é SPA — o frontend nunca navega para `/wizard` diretamente; ele usa `#/wizard`.

**Impacto:** Se implementarmos middleware 302 no servidor, `GET /` retorna redirect → o navegador vai pra `/wizard` → que é servido pelo catch-all como `base.html` → loop infinito ou página quebrada. Além disso, `fetch('/api/devices')` também seria redirecionado, quebrando o JS.

**Mitigação:**
> Não usar middleware HTTP. O frontend é responsável por checar `wizard_completed` e redirecionar.

**Implementação:**
```javascript
// app.js — boot check
async function checkWizard() {
  try {
    const { completed } = await API.get('/system/wizard-status');
    const hash = window.location.hash.replace('#', '') || '/';

    if (!completed && hash !== '/wizard') {
      window.location.hash = '#/wizard';
    }
    if (completed && hash === '/wizard') {
      window.location.hash = '#/';
    }
  } catch (e) {
    console.error('Wizard check failed:', e);
  }
}

// No DOMContentLoaded:
checkWizard().then(() => navigate());
```

**API (já existe):**
```
GET /api/system/wizard-status → { completed: false, devices_count: 0, groups_count: 0 }
```

**Por que isso resolve:** O redirecionamento é client-side, não afeta chamadas de API, não precisa de middleware, não quebra o SPA. O backend só precisa garantir que a flag `wizard_completed` esteja correta no `system.yml`.

---

## 🔴 Problema 3 — MediaMTX paths não sincronizados

**Raiz:** O `ConfigurationManager` gerencia `config/mediamtx.yml` (config do painel), mas o MediaMTX lê seu próprio `mediamtx.yml` (em `/opt/mediamtx/mediamtx.yml` ou similar). Criar devices com `rtsp_path: "TV_BOX_1"` não adiciona esse path no arquivo que o MediaMTX usa.

**Impacto:** O OBS publica em `rtmp://host:1935/TV_BOX_1`, mas o path não existe na config do MediaMTX → stream rejeitado → TV Box não consegue ler.

**Mitigação:**
> O `ConfigurationManager` gera o `mediamtx.yml` real a partir do template em `config/mediamtx.yml` + devices cadastrados. O caminho do arquivo de saída é configurável em `system.yml`. Após gerar, reinicia o serviço MediaMTX (ou o MediaMTX faz hot-reload).

**Implementação:**
```python
# app/core/config.py — novo método
def generate_mediamtx_yml(self, output_path: Path = None):
    """Gera mediamtx.yml real para o MediaMTX ler."""
    if output_path is None:
        output_path = self.config_dir / "mediamtx.generated.yml"
    
    # Base: valores do config/mediamtx.yml
    base = self.mediamtx.model_dump() if self.mediamtx else {}
    
    # Paths: um por device com rtsp_path definido
    paths = {}
    for device in self.devices:
        if device.rtsp_path:
            paths[device.rtsp_path] = {
                "source": "publisher",
                "maxReaders": 1,
            }
    
    config = {
        "logLevel": base.get("logLevel", "warn"),
        "writeQueueSize": base.get("writeQueueSize", 2048),
        "readTimeout": base.get("readTimeout", "10s"),
        "writeTimeout": base.get("writeTimeout", "10s"),
        "rtsp": True,
        "rtspAddress": f":{base.get('server', {}).get('rtsp_port', 8554)}",
        "rtspTransports": base.get("rtspTransports", ["udp", "tcp"]),
        "rtmp": True,
        "rtmpAddress": f":{base.get('server', {}).get('rtmp_port', 1935)}",
        "hls": base.get("hls", False),
        "webrtc": base.get("webrtc", False),
        "api": True,
        "apiAddress": f":{base.get('server', {}).get('api_port', 9997)}",
        "paths": paths,
    }
    
    import yaml
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        yaml.safe_dump(config, f, default_flow_style=False)
    
    return output_path
```

**No `finalize_wizard()`:**
```python
def finalize_wizard(self):
    self.save_system()
    self.save_watchdog()
    self.save_players()
    self.save_mediamtx()
    self.generate_mediamtx_yml()
    self.wizard_completed = True
    self.save_system()
```

**system.yml — adicionar campo:**
```yaml
mediamtx:
  api_url: "http://localhost:9997"
  generated_config_path: "/opt/mediamtx/mediamtx.yml"  # onde o MediaMTX lê
  service_name: "mediamtx.service"                      # pra restart
```

**Por que isso resolve:** Cada device com `rtsp_path` vira um path no `mediamtx.yml`. Quando o OBS publica em `TV_BOX_1`, o MediaMTX reconhece o path e aceita o stream. O arquivo gerado é o que o MediaMTX usa. Hot-reload automático na maioria das versões do MediaMTX — senão, restart via systemd.

---

## 🟡 Problema 4 — Wizard Step "Players" frágil

**Raiz:** Pedir para o usuário digitar `org.videolan.vlc` e `org.videolan.vlc.gui.video.VideoPlayerActivity` manualmente é propenso a erro de digitação. A maioria dos usuários não sabe esses valores.

**Impacto:** Se o usuário errar o package name, o player nunca abre. Frustração.

**Mitigação:**
> O Wizard carrega os defaults de `players.yml` e mostra os campos **preenchidos**. O usuário só edita se precisar (ex: versão diferente do VLC, player alternativo).

**Implementação:**
```javascript
// wizard.js — step Players
async function renderPlayersStep() {
  // Busca defaults atuais
  let defaults;
  try {
    const cfg = await API.get('/system/config');
    defaults = cfg.players?.players || {};
  } catch {
    defaults = {};
  }

  const vlcPkg = wizardData.players?.vlc?.package || defaults.vlc?.package || 'org.videolan.vlc';
  const vlcAct = wizardData.players?.vlc?.activity || defaults.vlc?.activity || 'org.videolan.vlc.gui.video.VideoPlayerActivity';
  const mpvPkg = wizardData.players?.mpv?.package || defaults.mpv?.package || 'is.xyz.mpv';
  const mpvAct = wizardData.players?.mpv?.activity || defaults.mpv?.activity || 'is.xyz.mpv.MPVActivity';

  // Renderiza inputs com valores preenchidos
  // Cada input tem label claro: "VLC — Package Name", "VLC — Activity"
  // Abaixo de cada input, texto pequeno: "Default: org.videolan.vlc"
}
```

**players.yml default (já criado na Fase 1):**
```yaml
players:
  vlc:
    package: "org.videolan.vlc"
    activity: "org.videolan.vlc.gui.video.VideoPlayerActivity"
    force_stop: "org.videolan.vlc"
    intent_template: "am start -a android.intent.action.VIEW -d \"{URL}\" -n {PACKAGE}/{ACTIVITY} --activity-clear-task"
  mpv:
    package: "is.xyz.mpv"
    activity: "is.xyz.mpv.MPVActivity"
    force_stop: "is.xyz.mpv"
    intent_template: "am start -a android.intent.action.VIEW -d \"{URL}\" -n {PACKAGE}/{ACTIVITY} --activity-clear-task"
default: vlc
```

**Por que isso resolve:** 95% dos usuários clicam "Próximo" sem digitar nada. Os defaults funcionam. Quem tem configuração diferente edita. Zero frustração.

---

## 🟡 Problema 5 — Falta validação no step "Dispositivos"

**Raiz:** O step 8 aceita IP inválido, IP duplicado, ou IP inacessível. O Wizard finaliza e depois nada funciona.

**Impacto:** Usuário termina Wizard, vê dispositivo OFFLINE, não sabe por quê. Precisa editar YAML manualmente ou refazer Wizard.

**Mitigação:**
> Validação em duas camadas: (1) client-side imediata (regex IP, IP duplicado, nome obrigatório) e (2) botão opcional "Testar Conexão" que chama endpoint de validação.

**Implementação:**
```javascript
// wizard.js — validação client-side
function validateDevice(device, existingDevices) {
  const errors = [];

  // IP obrigatório
  if (!device.ip) errors.push('IP é obrigatório');

  // Formato IP
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (device.ip && !ipRegex.test(device.ip)) errors.push('Formato de IP inválido');

  // IP duplicado
  if (existingDevices.some(d => d.ip === device.ip)) errors.push('IP já cadastrado');

  // Nome obrigatório
  if (!device.name) errors.push('Nome é obrigatório');

  return errors;
}

// Botão opcional "Testar Conexão"
async function testDeviceConnection(device) {
  try {
    const res = await API.post('/wizard/validate-device', { ip: device.ip, adb_port: device.adb_port || 5555 });
    return { ok: res.adb_connected, model: res.model, android: res.android };
  } catch {
    return { ok: false, error: 'Falha na validação' };
  }
}
```

**API:**
```
POST /api/wizard/validate-device
Body: { ip: "192.168.254.232", adb_port: 5555 }
Response: { reachable: true, adb_connected: true, model: "TV BOX", android: "11.1" }
```

**Por que isso resolve:** O usuário vê erros antes de finalizar. O botão "Testar" confirma que o TV Box está acessível. Sem surpresas depois.

---

## 🟡 Problema 6 — Preview endpoint complexo desnecessário

**Raiz:** O spec define `GET /api/wizard/preview` que reconstrói YAMLs parciais no backend. Mas a lógica de preview é idêntica à do `finish` — duplicação de código.

**Impacto:** Manter duas funções que fazem a mesma coisa. Risco de preview mostrar algo diferente do que `finish` gera.

**Mitigação:**
> Preview é client-side. O frontend já tem `wizardData` — mostra os dados em formato de tabela/resumo antes de submeter. Zero backend.

**Implementação:**
```javascript
// wizard.js — step Revisão (step 9)
function renderReviewStep() {
  let html = '<div class="wizard-review">';

  html += '<h3>Servidor</h3>';
  html += `<p>IP: ${wizardData.server.host || '(automático)'}:${wizardData.server.port}</p>`;

  html += '<h3>MediaMTX</h3>';
  html += `<p>API: ${wizardData.mediamtx.api_url}</p>`;
  html += `<p>RTSP: porta ${wizardData.mediamtx.rtsp_port}, RTMP: porta ${wizardData.mediamtx.rtmp_port}</p>`;

  html += '<h3>Dispositivos</h3>';
  wizardData.devices.forEach(d => {
    html += `<div class="review-item">
      <strong>${d.name}</strong> — ${d.ip}:${d.adb_port || 5555} — Path: ${d.rtsp_path} — Player: ${d.player || 'vlc'}
    </div>`;
  });

  html += '<h3>Arquivos que serão criados</h3>';
  html += '<ul>';
  html += '<li>config/system.yml</li>';
  html += '<li>config/watchdog.yml</li>';
  html += '<li>config/players.yml</li>';
  html += '<li>config/mediamtx.yml</li>';
  wizardData.devices.forEach(d => {
    html += `<li>devices/${d.id || slugify(d.name)}.yml</li>`;
  });
  wizardData.groups.forEach(g => {
    html += `<li>groups/${g.id || slugify(g.name)}.yml</li>`;
  });
  html += '</ul>';

  html += '</div>';
  return html;
}
```

**API removida:** `GET /api/wizard/preview` — não será implementada.

**Por que isso resolve:** Sem duplicação. O que o usuário vê na revisão é exatamente o que está em `wizardData`. E o `finish` recebe `wizardData` como payload. Consistência garantida.

---

## 🟢 Problema 7 — Navegação entre steps (Anterior/Próximo)

**Raiz:** O spec não detalha a UI do Wizard. Sem botão "Anterior", o usuário não pode corrigir steps anteriores.

**Impacto:** Frustração — se errar no step 8, precisa recomeçar do step 1.

**Mitigação:**
> Cada step tem botões [Anterior] [Próximo] (step 1 só tem [Próximo], step 10 tem [Anterior] [Finalizar]). Dados de cada step são salvos no `wizardData` ao clicar Próximo. Ao clicar Anterior, os campos são preenchidos com os dados já salvos.

**Implementação:**
```javascript
// wizard.js
let currentStep = 1;
const TOTAL_STEPS = 10;

function renderStep(step) {
  currentStep = step;

  // 1. Salva dados do step atual no wizardData
  saveCurrentStepData();

  // 2. Renderiza HTML do step
  const html = STEP_RENDERERS[step]();

  // 3. Adiciona botões de navegação
  let navHtml = '<div class="wizard-nav">';
  if (step > 1) {
    navHtml += `<button class="btn btn-secondary" onclick="prevStep()">← Anterior</button>`;
  }
  if (step < TOTAL_STEPS) {
    navHtml += `<button class="btn btn-primary" onclick="nextStep()">Próximo →</button>`;
  } else {
    navHtml += `<button class="btn btn-success" onclick="finishWizard()">✅ Finalizar</button>`;
  }
  navHtml += '</div>';

  // 4. Barra de progresso
  const progressHtml = `
    <div class="wizard-progress">
      <div class="wizard-progress-bar" style="width: ${(step / TOTAL_STEPS) * 100}%"></div>
      <span class="wizard-progress-text">Passo ${step} de ${TOTAL_STEPS}</span>
    </div>
  `;

  document.getElementById('view-container').innerHTML = progressHtml + html + navHtml;
}

function prevStep() {
  if (currentStep > 1) renderStep(currentStep - 1);
}

function nextStep() {
  saveCurrentStepData();
  if (currentStep < TOTAL_STEPS) renderStep(currentStep + 1);
}
```

**Por que isso resolve:** Navegação fluida. Dados persistem ao voltar. Progresso visível.

---

## 🟢 Problema 8 — Steps obrigatórios que deveriam ser opcionais

**Raiz:** Watchdog, Grupos e Dispositivos Avançados podem não ser relevantes no primeiro uso. O Wizard força o usuário a preencher tudo.

**Impacto:** Usuário quer testar rápido com 1 TV Box, mas é forçado a configurar Watchdog, criar grupos, etc. Abandona o Wizard.

**Mitigação:**
> Steps que não são críticos têm valores default razoáveis + botão "Usar Padrões" ou "Pular". Apenas **Servidor** (step 2), **MediaMTX** (step 3) e **pelo menos 1 dispositivo** (step 8) são obrigatórios.

**Implementação:**
```javascript
const STEP_CONFIG = {
  2: { title: 'Servidor', required: true },
  3: { title: 'MediaMTX', required: true },
  4: { title: 'ADB', required: false, defaultMessage: 'Usar porta 5555 e timeout 10s' },
  5: { title: 'Players', required: false, defaultMessage: 'Usar VLC e MPV com configurações padrão' },
  6: { title: 'Watchdog', required: false, defaultMessage: 'Health check a cada 10s, recovery automático' },
  7: { title: 'Grupos', required: false, defaultMessage: 'Nenhum grupo (criar depois)' },
  8: { title: 'Dispositivos', required: true, minItems: 1 },
};

function renderSkipButton(stepNum) {
  const cfg = STEP_CONFIG[stepNum];
  if (cfg.required) return '';

  return `
    <button class="btn btn-ghost" onclick="skipStep()">
      Pular (${cfg.defaultMessage})
    </button>
  `;
}

function skipStep() {
  // Marca wizardData com valores default
  if (currentStep === 4) wizardData.adb = { default_port: 5555, connect_timeout: 10 };
  if (currentStep === 5) wizardData.players = null; // null = usar defaults
  if (currentStep === 6) wizardData.watchdog = null;
  if (currentStep === 7) wizardData.groups = [];

  nextStep();
}
```

**No backend (`finish`):**
```python
@router.post("/wizard/finish")
async def wizard_finish(data: dict):
    config = _get_config()

    # Players: se vier null, usa defaults
    if data.get("players") is None:
        config.players = PlayersConfig()  # defaults

    # Watchdog: se vier null, usa defaults
    if data.get("watchdog") is None:
        config.watchdog = WatchdogConfig()

    # Groups: se vier array vazio, ok
    for g in data.get("groups", []):
        config.add_group(GroupConfig(**g))

    # Devices: obrigatório pelo menos 1
    devices = data.get("devices", [])
    if len(devices) == 0:
        raise HTTPException(400, "Pelo menos 1 dispositivo é obrigatório")

    for d in devices:
        if not d.get("id"):
            d["id"] = slugify(d.get("name", "tvbox"))
        config.add_device(DeviceConfig(**d))

    config.finalize_wizard()
    return {"success": True, "devices_created": len(devices)}
```

**Por que isso resolve:** Wizard rápido pra quem quer testar. Quem precisa de config avançada preenche os steps opcionais. Ninguém abandona.

---

## Resumo das Mudanças

| Problema | Ação | Backend | Frontend |
|---|---|---|---|
| 1. Estado do Wizard | Estado client-side, `finish` único | Simplificar API: só `POST /wizard/finish` | `wizardData` em memória, envia tudo no final |
| 2. Bloqueio middleware | Redirecionamento client-side | Remover middleware 302 | `checkWizard()` no boot do `app.js` |
| 3. MediaMTX paths | Gerar `mediamtx.yml` com paths dos devices | `generate_mediamtx_yml()` no ConfigManager | — |
| 4. Players frágil | Campos preenchidos com defaults | `players.yml` já tem defaults | Inputs preenchidos, botão "Usar padrões" |
| 5. Validação devices | Regex IP + botão Testar opcional | `POST /wizard/validate-device` | Validação client-side + botão "Testar Conexão" |
| 6. Preview complexo | Preview client-side | Remover `GET /wizard/preview` | `renderReviewStep()` mostra `wizardData` |
| 7. Navegação | Anterior/Próximo + barra de progresso | — | `prevStep()`, `nextStep()`, progress bar |
| 8. Steps opcionais | Pular com defaults | Aceitar `null` nos campos opcionais | Botão "Pular (usa padrão)" em steps 4-7 |

## API Final da Fase 2

```
GET  /api/system/wizard-status          (já existe — Fase 1)
POST /api/wizard/finish                 (NOVO — recebe payload completo)
POST /api/wizard/validate-device        (NOVO — testa ADB de um IP)
```

3 endpoints. Simples. O resto é frontend.
