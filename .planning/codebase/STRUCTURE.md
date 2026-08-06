# Structure

**Analysis Date:** 2026-08-06

## Top-Level Layout

```
Paniel/  (repo raiz — C:\Users\claudio.lima\Documents\TV Box\Paniel)
├── app/                    # Backend FastAPI
│   ├── main.py             # Entrypoint: app, lifespan, routers, middlewares, WebSockets, SPA catch-all
│   ├── api/                # Rotas REST + WebSocket handlers
│   ├── core/               # config singleton, auth, lifecycle, websocket hub, exceptions
│   ├── managers/           # Integrações: ADB, MediaMTX, player, scrcpy, watchdog, health, schedule, update, backup, log
│   ├── models/             # Schemas Pydantic: config, device, group
│   ├── services/           # Orquestração: command_queue, provision, recovery
│   └── utils/              # system (data dir/validações/métricas), yaml, metrics
├── static/                 # Frontend SPA (sem build, sem CDN)
│   ├── css/                # tokens.css, base, layout, components, motion + pages/*.css (11 páginas)
│   └── js/                 # 20 módulos: api, app, auth, ws, components, icons, motion, theme + pages
├── templates/
│   └── base.html           # Shell único da SPA (todas as rotas caem aqui)
├── config/                 # YAMLs locais (gitignored) + templates .example versionados
├── devices/                # devices/<id>.yml (gitignored) + README
├── groups/                 # groups/<id>.yml (gitignored) + README
├── scripts/
│   ├── android/            # Scripts enviados aos TV Boxes (capture, healthcheck, heartbeat, install_apk, restart_eth, restart_wifi, reverse_ping, start_stream, stop_stream, update)
│   └── gerar_relatorio_nobreaks.py  # (gitignored, utilitário local)
├── deploy/                 # install.sh (Debian — legacy), panel.service, mediamtx.service (systemd — legacy)
├── tests/                  # 111 testes pytest (um arquivo por módulo/feature)
├── docs/                   # Specs (00-ANALISE…10-IMPLEMENTACAO), LLM.md (referência técnica), HANDOFF.md, AUDITORIA.md
├── backups/                # (gitignored) backups exportados
├── logs/                   # (gitignored) logs do painel
├── scrcpy/                 # (gitignored) versões/downloads de scrcpy gerenciados pelo painel
├── pyproject.toml          # Metadados + dependências (sem empacotamento)
├── IDEA.md                 # Requisitos originais + regra absoluta (não inventar requisitos)
├── README.md               # Visão geral (contém seções Debian a atualizar)
└── reasonix.toml           # (gitignored) config local de ferramenta
```

## Key Locations

### Backend (`app/`)

| Caminho | Responsabilidade |
|---|---|
| `app/main.py` | Entrypoint: monta routers, middlewares, WebSockets, serve SPA; singleton `app.state.config` |
| `app/core/config.py` | `ConfigurationManager` — load/save de todos os YAMLs, wizard, geração `mediamtx.generated.yml` |
| `app/core/auth.py` | `require_auth` / `require_auth_ws` (token Bearer) |
| `app/core/lifecycle.py` | `startup()`/`shutdown()` (cria dirs, carrega config, inicia hubs/watchdog/scheduler) |
| `app/core/websocket.py` | Hub de broadcast de eventos (`/ws`) |
| `app/api/devices.py` | CRUD devices + start/stop-stream, provision, shell, reboot, apps, uninstall, screenshot, command, install-apk |
| `app/api/groups.py` | CRUD grupos + ações coletivas (start/stop-stream, reboot) |
| `app/api/heartbeat.py` | Endpoints device→servidor (liveness, commands, result) |
| `app/api/mediamtx.py` | Health/paths (proxy da API MediaMTX) |
| `app/api/scrcpy.py` | Status/check/install/activate/versions/diagnostics/start/stream/stop |
| `app/api/system.py` | wizard-status, config |
| `app/managers/adb.py` | `ADBManager` — execução segura de `adb` (locks, timeout, porta isolada, métricas) |
| `app/managers/scrcpy.py` | `ScrcpyManager` — versões, download via GitHub API, mirroring, streaming headless |
| `app/managers/player.py` | `PlayerManager` — intents VLC/MPV (shlex.quote) |
| `app/managers/mediamtx.py` | `MediaMTXManager` — cliente REST `/v3/paths/*` |
| `app/managers/watchdog.py` | `WatchdogManager` — loop de health check + gatilho de recovery |
| `app/managers/health.py` | Ping ICMP (cross-platform: `-n` no Windows, `-c` no Linux) + checks ADB-light |
| `app/managers/schedule.py` | Agendamento cron por device |
| `app/managers/update.py` | `UpdateManager` — git pull + relançamento |
| `app/managers/log.py` | Busca/rotação de logs (Windows-aware) |
| `app/services/recovery.py` | Cascata de recuperação (player retry → Wi-Fi → Ethernet → reboot) |
| `app/services/provision.py` | Provisionamento: envia scripts android, ajusta `\n` (evita `\r\n`), configura device |
| `app/services/command_queue.py` | Fila serial de comandos ADB |
| `app/models/device.py` | `DeviceConfig`, `DeviceState`, `DeviceCapabilities` |
| `app/models/config.py` | `SystemConfig`, `WatchdogConfig`, `PlayersConfig`, `MediaMTXConfig`, `PlayerDef` |

### Config (`config/`)

| Arquivo | Papel |
|---|---|
| `system.yml(.example)` | servidor, host ip, adb.binary/server_port, paths, mediamtx api, security (heartbeat_key), wizard_completed |
| `watchdog.yml(.example)` | check_interval, timeouts, recovery cascade limits |
| `players.yml(.example)` | Definições de players (vlc/mpv): package, activity, intent_template |
| `mediamtx.yml(.example)` | Config base do MediaMTX (portas, transports, api_allowed_network) |
| `mediamtx.generated.yml` | **Gerado** pelo painel (paths por device) — gitignored, consumido pelo serviço |
| `.panel_token` | Token de acesso (gitignored, gerado no 1º boot) |

### Scripts Android (`scripts/android/`)

Rodam NO TV Box (Android), enviados via provision: `capture.sh` (screenshot), `healthcheck.sh`, `heartbeat.sh` (liveness + comandos), `install_apk.sh`, `restart_eth.sh`, `restart_wifi.sh`, `reverse_ping.sh`, `start_stream.sh`, `stop_stream.sh`, `update.sh`.

### Frontend (`static/`)

- **JS modules:** `api.js` (fetch wrapper), `ws.js` (WebSocket reconnect), `app.js` (roteamento SPA), `auth.js`, `theme.js`, `motion.js`, `components.js`, `icons.js` + páginas: `dashboard.js`, `devices.js`, `device.js`, `groups.js`, `group.js`, `scrcpy.js`, `mediamtx.js`, `logs.js`, `backup.js`, `settings.js`, `wizard.js`, `shell.js`.
- **CSS:** design tokens (`tokens.css`) + base/layout/components/motion + `pages/*.css`.

## Naming Conventions

- **Files:** snake_case para Python (`app/managers/adb.py`), kebab-case CSS, camelCase JS modules (`dashboard.js`).
- **Classes:** `XManager` para integrações (`ADBManager`, `MediaMTXManager`, `PlayerManager`, `ScrcpyManager`, `WatchdogManager`, `ConfigurationManager`); `XService` para orquestração (`RecoveryService`, `ProvisionService`).
- **IDs de device/grupo:** slug lowercase `[a-z0-9][a-z0-9._-]{0,63}` (`is_safe_id`).
- **Config env:** prefixo `PANEL_` (`PANEL_DATA_DIR`, `PANEL_ADB_SERVER_PORT`, `PANEL_MEDIAMTX_CONFIG`).
- **Requirement IDs (docs):** `REQ-XX`, fases `Fase A–D` no histórico.

---

*Structure analysis: 2026-08-06*
