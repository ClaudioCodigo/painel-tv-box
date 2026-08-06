# Painel TV Box — Guia técnico completo (contexto para LLM/agentes)

> Este documento é a referência única e **atual** do projeto (estado após a sessão de auditoria de 2026-07-31). Use-o como fonte de verdade ao trabalhar no código. Documentos em `docs/` podem estar desatualizados — confira aqui primeiro e depois no código.

---

## 1. O que é

Painel web para **gerenciamento e monitoramento de TV Boxes Android** que reproduzem streams RTSP vindos de um servidor **MediaMTX**. O painel controla os aparelhos via **ADB sobre TCP** (reboot, abrir/fechar stream no VLC/MPV, capturar screenshot, instalar APK, shell remoto) e mantém um **watchdog** que detecta quedas e tenta recuperação em cascata.

- **Backend:** Python 3.11+, FastAPI, Uvicorn, Pydantic v2, YAML (persistência), httpx, psutil
- **Frontend:** HTML + CSS + JavaScript puro (SPA com roteamento por hash, sem framework, sem build step, sem CDN)
- **Tempo real:** WebSocket (`/ws`)
- **Streaming:** OBS → RTMP → MediaMTX → RTSP → TV Box

```
OBS → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)
                          ↑
                    Painel Web (FastAPI + ADB)
```

---

## 2. Estrutura de diretórios

```
├── app/                     # Backend Python
│   ├── main.py              # Entrypoint FastAPI: app, routers, WebSockets, middlewares, catch-all SPA
│   ├── core/                # config.py (ConfigurationManager), auth.py (token), lifecycle.py, websocket.py, exceptions.py
│   ├── api/                 # Routers: devices, groups, system, wizard, mediamtx, logs, backup, update, scrcpy, auth
│   ├── managers/            # Lógica de domínio: adb, player, health, watchdog, schedule, log, backup, update, scrcpy, mediamtx
│   ├── models/              # Pydantic: config.py, device.py, group.py
│   ├── services/            # provision.py, recovery.py
│   └── utils/               # system.py (slugify/is_safe_id/get_metrics), yaml.py, metrics.py
├── static/
│   ├── css/                 # 12 folhas (main.css tem o overlay de login)
│   └── js/                  # 16 módulos (auth, api, ws, app, components + 1 por página)
├── templates/base.html      # Único HTML (SPA); login overlay + scripts com cache-busting ?v=N
├── config/                  # system.yml, watchdog.yml, players.yml, mediamtx.yml, mediamtx.generated.yml, .panel_token
├── devices/                 # Um YAML por TV Box
├── groups/                  # Um YAML por grupo
├── scripts/android/         # Shell scripts enviados para os TV Boxes via ADB
├── deploy/                  # install.ps1 (instalador Windows) + legacy/ (Linux arquivado)
├── backups/                 # Zips de backup + screenshots/ + apks/ (no data dir, fora do repo)
├── logs/                    # adb.log, system.log, watchdog.log... (no data dir, rotacionados, 5MB x3)
├── scrcpy/                  # Binários do scrcpy, versions/, downloads/, version.json
├── tests/                   # pytest (9 arquivos)
└── docs/                    # Documentação (parte desatualizada — ver §11)
```

---

## 3. Como rodar

### Dados em runtime (fora do repositório)

Backups, screenshots e APKs vivem em um **data dir** (`app/utils/system.py → get_data_dir()`), nunca no repo (git push/pull não mistura dados de máquinas):

| Fonte | Local |
|---|---|
| Env `PANEL_DATA_DIR` | qualquer (setado pelo serviço NSSM) |
| Windows (default) | `%LOCALAPPDATA%\PanelTVBox` |

> Plataforma: **Windows 10+ apenas** (Linux/macOS descartados).

### Desenvolvimento (Windows)

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r <none>  # use os nomes do pyproject.toml
# Na prática:
.venv/Scripts/python -m pip install "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" "pydantic>=2.0" "pyyaml>=6.0" "httpx>=0.27.0" "psutil>=6.0" "python-multipart>=0.0.9" "pytest>=8.0" "pytest-asyncio>=0.24"
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

> ⚠️ `pip install -e .` **falha** (pyproject.toml não tem `[build-system]`/empacotamento). Instale as dependências direto, como acima.

### Produção (Windows 10+)

**Duplo clique em `instalar.bat`** (na raiz) → executa `deploy/install.ps1`:

```powershell
# opções avançadas (opcional):
.\deploy\install.ps1 -AllowAdb       # abre ADB 5555 só na LAN + bloqueio em Public/Domain
.\deploy\install.ps1 -NoMediamtx     # sem MediaMTX
.\deploy\install.ps1 -SkipVenv       # reutiliza venv existente
.\deploy\install.ps1 -RepoUrl <url>  # origem alternativa (se a pasta não for git)
```

> O instalador baixa ffmpeg/ADB/MediaMTX/NSSM, copia para `C:\PanelTVBox` preservando `.git`, cria o venv, registra os serviços NSSM `panel-tvbox` + `mediamtx` (auto-restart) e abre o firewall só para a LAN (8080/8554/1935/9997; ADB 5555 fechado por default). Logs dos serviços em `%LOCALAPPDATA%\PanelTVBox\logs`. A porta 5038 (`PANEL_ADB_SERVER_PORT`) isola o ADB do painel do scrcpy (default 5037).

### Testes

```bash
.venv/Scripts/python -m pytest -q        # 111 testes
node --check static/js/*.js              # sintaxe de todo o JS
```

---

## 4. Autenticação (usuário/senha do administrador — D-05..D-08)

- **Modelo:** login com **usuário/senha do administrador** → **token de sessão** assinado (HMAC-SHA256, TTL 12h), não mais token compartilhado único.
- **Admin:** criado no **wizard** (1ª instalação, `POST /api/wizard/finish` com `admin: {username, password}`) ou em **Configurações → Segurança** (`POST /api/auth/set-admin`, exige sessão). Credenciais em `config/admin.json` (gitignored): hash **PBKDF2-SHA256** (200k iterações, salt aleatório), comparação em tempo constante; `config/.session_secret` (gitignored) assina os tokens.
- **Login:** `POST /api/auth/login` com `{"username", "password"}` → `{"success", "token", "username", "expires_in"}`. Sem admin configurado → **409 `admin_nao_configurado`**.
- **Envio:** header `Authorization: Bearer <token>` **ou** query `?token=` (necessário para `<img src>` e `window.open`, que não enviam headers).
- **Proteção:** `Depends(require_auth)` aplicado a todos os routers (`app/main.py`) **e** às rotas app-level `/api/system/metrics` e `/metrics/history` (gap corrigido); WebSockets `/ws` e `/ws/shell/{id}` validam `?token=` antes do `accept()` (sem token → fechado 403/4401).
- **Rotas públicas:** `/api/system/health`, `/api/auth/status`, `/api/auth/login`, e `/api/wizard/*` + `/api/system/wizard-status` **enquanto o wizard não estiver completo**.
- **Backward compat:** sem `admin.json`, o painel aceita o token legado `config/.panel_token` (instalações existentes/testes); **ao criar o admin, apenas sessões de login valem**.
- **Desligar:** `config/system.yml` → `security: {enabled: false}`. Sem config carregada (`app.main.config is None`) o comportamento é **fail-closed** (exige credencial).
- **Frontend:** `static/js/auth.js` (`AUTH`): token de sessão em `localStorage['panel_token']`; overlay de login (usuário/senha) em `base.html` (`#auth-overlay`) com hint "admin não configurado" via `GET /api/auth/status`; `api.js` injeta o header e chama `AUTH.requireLogin()` em 401; `ws.js` só conecta com token e reconecta em `auth:logged-in`; botão "Sair" no rodapé da sidebar; wizard cria o admin no passo 1 (auto-login via `session_token` no finish).
- **Helper para URLs no browser:** `API.authUrl(path)` → anexa `?token=` (usado em screenshots e download de backup).

---

## 5. Configuração (YAML)

> ⚠️ **Config, devices e groups são LOCAIS** (gitignored — `config/*.yml`, `devices/*.yml`, `groups/*.yml`): contêm IPs e a `heartbeat_key` de cada máquina e **não vão no git push** (outra máquina sem esses arquivos usaria os defaults/templates). O repositório mantém **templates `.example`** (`config/*.yml.example`) e o painel **cria os arquivos reais no 1º boot** a partir deles. Configs antigos que já estiveram no git **permanecem no histórico** — para purgar, use `git filter-repo`.

### `config/system.yml` — carregado em `SystemConfig` (`app/models/config.py`)

```yaml
server: {host: 0.0.0.0, port: 8080, workers: 1}
host: {ip: 192.168.254.102}          # IP do servidor (usado na URL RTSP)
adb: {binary: adb, default_port: 5555, connect_timeout: 10, command_delay: 0.5}
paths: {devices_dir: devices, groups_dir: groups, config_dir: config, logs_dir: logs, backups_dir: backups, scripts_dir: scripts/android, remote_scripts_dir: /data/local/tmp/panel}
mediamtx: {api_url: http://localhost:9997, timeout: 5}
security: {enabled: true, heartbeat_key: <auto-gerada>}   # heartbeat_key gerada no 1º boot
wizard_completed: true
```

> `security.heartbeat_key` é a chave dedicada do **heartbeat device→servidor** (`docs/09-HEARTBEAT-SPEC.md`) — NÃO é o token do painel; é enviada aos devices no provision.

### `config/watchdog.yml` → `WatchdogConfig`

`check_interval` (s), `heartbeat_timeout` (60s — heartbeat fresco = device na rede, watchdog pula ADB), `ping.{count,timeout_ms}`, `adb.timeout`, `activity_check`, `mediamtx_check`, `recovery.{...}`.

> ℹ️ Vários campos são **mortos** (nunca lidos no código): `activity_check`, `mediamtx_check`, `ping.*`, `command_delay`, `critical_alert_cooldown`. O cooldown de recovery real é 15s (`recovery.cooldown_seconds`) e o watchdog ainda tem `min_interval=120` hardcoded entre recoveries.

### `config/players.yml` → `PlayersConfig` (defaults embutidos no model)

Players `vlc`/`mpv`, cada um com `{package, activity, force_stop, intent_template}`. `intent_template` usa placeholders `{URL}`, `{PACKAGE}`, `{ACTIVITY}`. `PlayerManager` tem um `FALLBACK` duplicado no código (2 fontes de verdade — dívida conhecida).

### `config/mediamtx.yml` → `MediaMTXConfig`

`api.{url,timeout}`, `server.{rtsp_port:8554, rtmp_port:1935, api_port:9997, metrics_port:9998}`, `logLevel`, `writeQueueSize`, `readTimeout`, `writeTimeout`, `rtspTransports`, `hls`, `webrtc`, `metrics`, `api_allowed_network`.

**`config/mediamtx.generated.yml`** é o arquivo REAL do MediaMTX, gerado por `ConfigurationManager.generate_mediamtx_yml()` (um path por device com `rtsp_path`, `source: publisher`). ⚠️ **Só é regenerado no `finalize_wizard` e no `update.apply`** — adicionar/editar/remover device pela API não regenera (dívida conhecida).

### `devices/<id>.yml` → `DeviceConfig` (`app/models/device.py`)

```yaml
id: qa                     # slug seguro: ^[a-z0-9][a-z0-9._-]{0,63}$  (validado!)
name, ip, mac, adb_port: 5555, location, description, group,
rtsp_path: QA              # path no MediaMTX (um por device)
player: vlc|mpv, root: bool,
capabilities: {wifi_restart, ethernet_restart, reboot, root, install_apk, shell, screenshot, volume, mute},
player_extra_args, notes, watchdog_override (não implementado), schedule: [{action, cron}]
# `state` é em memória (não persiste): status, reason, last_seen, last_heartbeat, last_recovery_time, reboot_count, current_activity, screenshot_path
# ⚠️ Campos REMOVIDOS do DeviceState na Fase B (decisão do usuário — readicionar se precisar):
#    last_fail, last_recovery (duplicata de last_recovery_time), uptime_seconds, recovery_count
```

### `groups/<id>.yml` → `GroupConfig`

`id, name, description, color, schedule[], watchdog_override (não implementado)`.

---

## 6. API completa (contrato real — 2026-07-31)

> Prefixo `/api`. **Todas exigem auth** (exceto indicadas). Bodies JSON exceto onde indicado. IDs de device/grupo são slugs validados.

### Auth
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Pública. `{"username","password"}` → `{"success","token","username"}` (409 se não há admin) |
| POST | `/api/auth/set-admin` | Protegida. Cria/atualiza admin; devolve `token` na 1ª criação |
| GET | `/api/auth/status` | Pública. `{"admin_configured","wizard_completed","method"}` |
| POST | `/api/heartbeat/{device_id}` | **Chave dedicada** `X-Heartbeat-Key` (não o token). Registra `last_heartbeat` (+ activity) sem ADB; rate limit 5s; 204/401/404/429 |

### System
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/system/health` | Pública. `{"status","version","wizard_completed"}` |
| GET | `/api/system/wizard-status` | `{"completed","devices_count","groups_count"}` |
| GET | `/api/system/config` | Toda a config (sensível — exige auth) |
| GET | `/api/system/metrics` | `cpu/ram/disk_percent`, `uptime_seconds` (uptime REAL) |
| GET | `/api/system/metrics/history?last_n=30` | Séries para sparklines |

### Devices (`/api/devices`)
| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `""` | Listar / criar (id = slug se ausente; **auto-provision** ADB embutido; retorna `provision`) |
| GET/PUT/DELETE | `/{id}` | Ler / atualizar / deletar YAML |
| POST | `/{id}/start-stream` · `stop-stream` | Abre/fecha stream no TV Box (via `PlayerManager`) |
| GET | `/{id}/current-player` | Activity em foco |
| POST | `/{id}/provision` · GET `/{id}/provision/verify` | Envia/verifica scripts Android |
| GET | `/{id}/status` | `adb.is_reachable`: ping, adb_connected, root, model, android, device_ip |
| POST | `/{id}/shell` | `{"command"}` → `adb shell` (saída + exit_code) |
| POST | `/{id}/reboot` | Reboot |
| GET | `/{id}/apps` | `pm list packages -3` |
| POST | `/{id}/uninstall-app` | `{"package"}` → `pm uninstall` |
| POST | `/{id}/screenshot` | Captura (pull do device) e retorna `screenshot_url` |
| GET | `/{id}/screenshot` | PNG da última captura (`backups/screenshots/<id>.png`) |
| POST | `/{id}/install-apk` | multipart `file` (.apk) → push + `install_apk.sh` |

### Groups (`/api/groups`)
| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `""` | Listar (com devices) / criar |
| GET/PUT/DELETE | `/{id}` | CRUD |
| POST | `/{id}/start-stream` · `stop-stream` · `reboot` | Ação coletiva em todos os devices do grupo |

### Logs (`/api/logs`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `""` | Busca com filtros: `source, level, device_id, q, from, to, page, per_page` (datas corrigidas p/ datetime) |
| GET | `/tail?source=&n=` | Últimas N linhas |
| GET | `/sources` | Fontes disponíveis com contagem/tamanho |
| GET | `/download?source=` | Arquivo .log (source validado contra `LOG_SOURCES`) |

### Backup (`/api/backup`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/list` | Backups em `backups/backup-*.zip` |
| POST | `/export` | Gera zip e baixa (FileResponse) |
| POST | `/import` | multipart `.zip` → restaura (zip-slip bloqueado) |
| GET | `/download/{name}` | Baixa backup específico (nome validado) |
| POST | `/restore/{name}` | Restaura (valida path dentro de `backups/`) |
| POST | `/cleanup?keep_last=` | Remove backups antigos |

### MediaMTX (`/api/mediamtx`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Health da API do MediaMTX |
| GET | `/paths` · GET/POST/DELETE `/paths/{name}` | Consulta/cria/remove paths |

### scrcpy (`/api/scrcpy`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/status` · `/versions` · `/diagnostics` | Estado, versões instaladas, diagnóstico |
| POST | `/check` | Busca release no GitHub |
| POST | `/install` | Baixa + ativa versão (version validada!) |
| POST | `/activate/{version}` · `/rollback` | Troca versão ativa |
| DELETE | `/versions/{version}` | Remove versão (valida `^[0-9]+(\.[0-9]+){0,4}$`) |
| POST | `/start/{device_id}` · `/stream/{device_id}` · `/stop` | Mirroring / streaming ffmpeg→RTMP |

### Update (`/api/update`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/status` | Estado do último check |
| POST | `/check` | `git fetch` + compara HEAD vs origin/main (timeout 30s) |
| POST | `/apply` | `git stash` + `git pull` + reload config + regenera mediamtx (timeout 30s) |

### Wizard (`/api/wizard`)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/status` | (público enquanto pendente) |
| POST | `/finish` | Salva config, marca wizard completo, gera mediamtx |
| POST | `/validate-device` | `{"ip","adb_port"}` → tenta `adb connect` (probe de rede — SSRF potencial) |

### WebSockets (prefixo `/ws`)
| Rota | Descrição |
|---|---|
| `/ws` | Hub de eventos (`health`, `alert` do watchdog; ack de mensagens) — exige `?token=` |
| `/ws/shell/{device_id}` | Shell remoto interativo (`adb shell` com output em tempo real) — exige `?token=` |

### Catch-all
`GET /{path}` → serve `templates/` (anti traversal, 404 para `/api/*` inexistente) ou `base.html` (SPA).

---

## 7. Fluxos principais

### Heartbeat device→servidor (`docs/09-HEARTBEAT-SPEC.md`)
- `scripts/android/heartbeat.sh` no TV Box POSTa `/api/heartbeat/<device_id>` a cada 20s com a `heartbeat_key` (enviada no provision).
- O painel grava `state.last_heartbeat` (+ `current_activity` via `dumpsys`) **sem ADB**.
- **Regra ADB×scrcpy (§3.3):** se heartbeat fresco **ou** scrcpy ativo → healthcheck pula ADB (zero spam); com heartbeat expirado e sem scrcpy → fallback ADB completo. O heartbeat NUNCA é pausado.
- Frescura dos cards = `max(last_seen, last_heartbeat)`.

### Watchdog (`app/managers/watchdog.py` + `services/recovery.py`)
- Loop `asyncio` (`check_interval`, default 10s) criado **no startup** com a lista de devices daquele momento (⚠️ não é dinâmico — devices novos via API não são monitorados).
- `HealthManager.check()`: ping (subprocess `ping`), `adb.shell("echo ok")`, leitura de readers do MediaMTX → status `online | degraded | warning | offline | unknown` (online exige readers+path; senão degraded).
- Falha → `RecoveryService`: cascata **cooldown 15s → player_retry (2x) → wifi restart → eth restart → reboot (1x)**; eventos broadcast via WS (`health`/`alert`).
- O **cooldown ADB falso foi removido** — health checks agora refletem a realidade.

### Player (`app/managers/player.py`)
- `start_stream`: monta intent (`am start -a android.intent.action.VIEW -d "rtsp://HOST:8554/PATH" -n PKG/ACTIVITY`) e roda `start_stream.sh` no device; `stop_stream` força o stop. ⚠️ Injeção de comando não corrigida (ver §11).

### Schedule (`app/managers/schedule.py`)
- `ScheduleManager` roda no startup; parseia `cron` (5 campos) dos devices/groups e executa ações (`start-stream` etc.). `_last_triggered` cresce sem limite (vazamento lento).

### Provision (`app/services/provision.py`)
- Faz `adb push` de `scripts/android/*.sh` para `/data/local/tmp/panel/` + `chmod +x`.

### ADB (`app/managers/adb.py`)
- Wrapper de `asyncio.create_subprocess_exec` (nunca `shell=True`). `connect()` com cache `_connected` + lock por target; timeout 10s. `_run()` retorna `(output, code)`; `-1`=timeout, `-2`=binário ausente.

---

## 8. Frontend (SPA)

- **Design (redesign 2026-07-31, spec `docs/06-UI-REDESIGN-SPEC.md`):** identidade **monocromática** (preto & branco) com temas **claro/escuro** completos. Design tokens em CSS custom properties; páginas consomem **apenas** tokens semânticos (`--bg-base`, `--text-primary`, `--border-strong`, `--radius`, `--dur-base`...). Status comunicado por **ícone + rótulo + forma** (preenchido/tracejado/vazio) — nunca cor. Ícones SVG inline (`static/js/icons.js` + `UI.icon()`), sem emojis/siglas no chrome da UI.
- **Tema (`static/js/theme.js` + script anti-flash no `<head>` de `base.html`):** `data-theme="dark|light"` no `<html>`; `localStorage['panel_theme']` (`dark|light|system`); sincroniza entre abas (`storage` event); botão na sidebar e em Settings (`THEME.cycle()`).
- **Estrutura CSS (não há mais os 12 arquivos antigos):**
  ```
  static/css/
  ├── tokens.css     # escala de cinza + semânticos + temas + movimento
  ├── base.css       # reset, tipografia, scrollbars, utilidades, skeleton
  ├── layout.css     # shell: sidebar, header, main, grids, responsivo
  ├── components.css # botões, cards, badges, toasts, modais, forms, dropdowns, tabelas...
  ├── motion.css     # view transitions, micro-interações, prefers-reduced-motion
  └── pages/*.css    # um por página (dashboard, devices, device, groups, mediamtx, logs, shell, scrcpy, backup, settings, wizard, auth)
  ```
- **Animações (`static/js/motion.js`):** `MOTION.withTransition()` (View Transitions API com fallback) integrado ao router (`app.js`); micro-interações em `motion.css`; `prefers-reduced-motion` zera tudo.
- **Roteamento:** hash (`#/devices`, `#/device/{id}`, `#/groups`, `#/mediamtx`, `#/logs`, `#/shell`, `#/scrcpy`, `#/backup`, `#/settings`, `#/wizard`) → `app.js`.
- **Módulos (`static/js/`):**
  - `icons.js` — catálogo de ícones SVG (`ICONS.icon(name)` / `UI.icon`)
  - `theme.js` — tema claro/escuro/sistema
  - `motion.js` — `withTransition`
  - `auth.js` — login/logout/overlay/token (localStorage)
  - `api.js` — wrapper fetch com auth, `API.authUrl()`, tratamento de 401
  - `ws.js` — cliente WebSocket com auto-reconnect (conecta após login)
  - `components.js` — `UI`: toasts, modais, badges, `escapeHtml/escJs/escAttr` (anti-XSS), `icon`, `skeletons`
  - `app.js` — router + boot (theme, wizard check, `AUTH.init()`)
  - Por página: `dashboard, devices, device, groups, mediamtx, logs, shell, scrcpy, backup, settings, wizard`
- **Segurança:** todos os dados de API passam por escape antes de entrar em HTML; toast/modal escapam título/msg. CSP com `unsafe-inline` (handlers `onclick` existentes — migração para event delegation é trabalho futuro).
- **Skeletons:** `UI.skeletons('card'|'row'|'line', n)` nos carregamentos principais (dashboard, devices, logs, mediamtx).
- **Helpers compartilhados (Fase A):** `UI.timeAgo` (tempo relativo), `UI.stateView`/`UI.bindStateRetry` (estados vazio/erro padronizados), `UI.toolbarCounters` (chips total/online/degradado/offline), `UI.groupChip` (chip de grupo clicável → `#/group/{id}`).
- **Dashboard (Fase A):** toolbar de gestão (busca nome/IP + filtro grupo + sort nome/IP/status) e **feed de eventos ao vivo** (WS `health`/`recovery`/`alert`, ~30 itens, botões Baixar log / Ver logs / Limpar). Header (`#header-status`) vivo: servidor + WS.
- **Dispositivos (Fase B):** página de gestão no padrão V2 (status bar com reason, frescura, toolbar + WS em tempo real); clique no card → página do device. **Página do device com Tabs** (Visão geral | Stream | Apps | Shell | Screenshots), carregamento lazy por aba.
- **Convenção:** cache-busting `?v=N` em `base.html` — ao mudar JS/CSS, incremente o `v` (atual: 20).

---

## 9. Testes (70, `pytest`)

| Arquivo | Cobre |
|---|---|
| `test_adb.py` | ADBManager (mock do binário) |
| `test_api.py` | Endpoints HTTP via ASGITransport (agora com header de auth + teste 401) |
| `test_config.py` | ConfigurationManager, models, geração mediamtx |
| `test_health.py` | HealthManager (parte com `asyncio.sleep(2)` real — lento) |
| `test_log.py` | LogManager: setup, search, tail, download |
| `test_player.py` | PlayerManager (mocks) |
| `test_schedule.py` | CronParser |
| `test_scrcpy.py` | metadados + **1 teste com chamada real ao GitHub** (instável) |
| `test_watchdog_integration.py` | HealthManager com mocks |

**Lacunas:** backup/restore (zip-slip), update, wizard, groups API, mediamtx API, recovery em cascata, provision, CRUD de devices via API, WebSockets, lifecycle.

---

## 10. Convenções e dicas

- **Python:** async/await; subprocesso sempre via `asyncio.create_subprocess_exec` com lista de args; YAML com `safe_load/safe_dump` (`app/utils/yaml.py`); loggers por fonte (`system`, `adb`, `watchdog`...) com `logging.getLogger`.
- **Validação de IDs:** use `app.utils.system.is_safe_id()` / `slugify()` para qualquer id de device/grupo; nunca componha paths com input sem `resolve()` + `is_relative_to`.
- **Autenticação:** rotas novas = router com `dependencies=[Depends(require_auth)]`; WebSockets = `require_auth_ws`.
- **Frontend:** escape tudo que vem da API (`UI.escapeHtml`), nunca concatene dados em `onclick` sem `UI.escAttr`.
- **Windows:** arquivos de log abertos por 2 handlers quebram rotação (PermissionError) — não adicione um segundo handler para o mesmo arquivo.

### Security helpers (`app/utils/system.py`)
`is_safe_id`, `is_safe_package`, `is_valid_ipv4`, `is_safe_network_target` (bloqueia loopback/link-local/multicast), `is_safe_rtmp_url` (rtmp/rtmps p/ localhost/privado), `is_safe_http_url_local` — usados no wizard, mediamtx, scrcpy e uninstall-app (anti SSRF + injeção).

### Blocking I/O (stutter)
I/O síncrono pesado roda via `asyncio.to_thread`: logs (search/tail/sources/download), backup (export/import), scrcpy (extração), APK (escrita). `psutil.cpu_percent(interval=None)` não bloqueia o event loop.

---

## 11. Dívida técnica / pontos de atenção (não corrigidos)

1. ~~**Injeção de comando no shell do device**~~ — ✅ corrigido (Rodada 2): `shlex.quote` em `player.py`, `"$EXTRA"` no `start_stream.sh`, package validado no uninstall.
2. **Watchdog/schedule estáticos** — não reagem a devices adicionados/removidos via API.
3. **`mediamtx.generated.yml` não regenera no CRUD de devices**.
4. ~~**I/O síncrono pesado em endpoints async**~~ — ✅ corrigido (Rodada 2): `asyncio.to_thread` em logs/backup/scrcpy/APK; `psutil.cpu_percent(interval=None)`.
5. **Shutdown incompleto** — schedule, scrcpy, `httpx.AsyncClient` do MediaMTX não são encerrados.
6. ~~**SSRF**~~ — ✅ corrigido (Rodada 2): wizard IP, `mediamtx.api_url` e `scrcpy rtmp_url` validados p/ rede local/privada.
7. **DoS** — uploads limitados (APK 200MB, ZIP 50MB) ✅; WebSockets sem limite de conexões/rate-limit ainda pendente.
8. **19 instâncias de `ADBManager`** — conexões/estado não compartilhados; considerar singleton no `app.state`.
9. **Config morta** — `activity_check`, `mediamtx_check`, `command_delay`, `ping.*`, `critical_alert_cooldown`, `watchdog_override` (model existe, não implementado).
10. **Docs antigos** — `02-SPECS.md`/`ADDING_DEVICE.md`/`WATCHDOG.md`/`UPDATING.md`/`APK_INSTALL.md` divergem do código.
11. **`deploy/` (histórico)** — o install.sh/units systemd (agora em `deploy/legacy/`) abriam firewall sem restrição e rodavam como root; corrigido no instalador Windows (`install.ps1`): firewall `LocalSubnet`, serviços NSSM, data dir fora do repo.
12. **MediaMTX gerado sem auth** (`pass: ''`, `apiAllowOrigins: ['*']`).
13. **Sem lockfile** (pyproject com `>=`); sem cobertura configurada.

---

## 12. Histórico recente

**2026-07-31 — UI Redesign + UX Fases A/B (detalhes: `docs/10-IMPLEMENTACAO.md`)**
- Redesign monocromático completo (tokens, temas claro/escuro, ícones SVG, motion, skeletons).
- Fase A: feed de eventos ao vivo, header status vivo, toolbar + sort no dashboard, correção de leaks de intervalos, helpers `UI.*` compartilhados, nome real dos grupos.
- Fase B: página Dispositivos no padrão V2, página do device com Tabs, **heartbeat device→servidor** (chave dedicada, watchdog ADB-light, provision), `current_activity` real, campos mortos removidos do `DeviceState`.

**2026-07-31 — Auditoria (resumo):**
- Removido cooldown ADB falso; `connect_timeout` 10s; corrigido `device.js`, backup export/download, uptime, filtros de data de logs, rotação de log no Windows (handler duplicado removido).
- Adicionada **autenticação por token** completa (backend/WS/frontend), **headers de segurança**, **bloqueio de path traversal** (5 vetores), **escape XSS** no frontend, **timeouts de git** no update.
- Token GitHub removido do `.git/config` (revogar no GitHub).
- Ver detalhes em `docs/AUDITORIA.md`.
