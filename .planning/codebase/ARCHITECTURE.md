# Architecture

**Analysis Date:** 2026-08-06

## Pattern Overview

**Overall:** Monolithic FastAPI application (backend) + SPA sem build (frontend), com managers externos (MediaMTX, ADB, scrcpy) e comunicação com dispositivos via ADB TCP + heartbeat HTTP.

**Key Characteristics:**
- Backend em camadas: API → Core (config/auth) → Managers (lógica de integração) → Models (Pydantic) → Services (orquestração) → Utils.
- Frontend vanilla JS (20 módulos), sem framework/build/CDN; comunicação via REST + WebSocket.
- Persistência em YAML local (um arquivo por device/grupo), sem banco de dados.
- Estado de runtime em memória (device state, locks, hubs) — não persiste.
- Stream pipeline: `ffmpeg/ADB exec-out screenrecord → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)`.

## Layers

**API Layer (`app/api/`):**
- Purpose: rotas REST + WebSocket; validação de payloads; resposta JSON.
- Contains: routers `devices.py`, `groups.py`, `system.py`, `mediamtx.py`, `scrcpy.py`, `logs.py`, `backup.py`, `update.py`, `wizard.py`, `auth.py`, `heartbeat.py`.
- Depends on: `app/core/config.py` (singleton), `app/core/auth.py`, managers, services.
- Used by: frontend JS (`static/js/api.js`), devices (heartbeat), testes (`tests/test_api.py` etc.).

**Core (`app/core/`):**
- Purpose: ciclo de vida do app, config singleton, autenticação, exceções, WebSocket hub.
- Contains: `config.py` (ConfigurationManager — carrega/valida/salva YAML), `auth.py` (require_auth, require_auth_ws), `lifecycle.py` (startup/shutdown), `websocket.py` (hub), `exceptions.py`.
- Depends on: models, utils.
- Used by: toda a API e main.py.

**Managers (`app/managers/`):**
- Purpose: lógica de integração com sistemas externos e dispositivos (cada um encapsula uma "ferramenta").
- Contains: `adb.py` (ADB TCP com locks/timeouts/metrics), `mediamtx.py` (API REST do MediaMTX), `player.py` (intents VLC/MPV nos devices), `scrcpy.py` (versões, mirroring, streaming headless), `health.py` (ping/ADB-light), `watchdog.py` (monitoramento + recuperação), `schedule.py` (agendamento por cron), `update.py` (git pull), `backup.py`, `log.py` (rotação de logs).
- Depends on: models, utils, subprocess/httpx externos.
- Used by: API layer, services, testes.

**Models (`app/models/`):**
- Purpose: schemas Pydantic v2 para toda configuração e estado.
- Contains: `config.py` (SystemConfig, WatchdogConfig, PlayersConfig, MediaMTXConfig), `device.py` (DeviceConfig/DeviceState/DeviceCapabilities), `group.py` (GroupConfig).
- Depends on: pydantic.
- Used by: core, managers, API, testes.

**Services (`app/services/`):**
- Purpose: orquestração de fluxos multi-etapas.
- Contains: `command_queue.py` (fila de comandos ADB), `provision.py` (provisionamento de devices: envia scripts/android, seta configs), `recovery.py` (cascata de recuperação do watchdog: player retry → Wi-Fi → Ethernet → reboot).
- Depends on: managers, models, utils.
- Used by: API layer, watchdog.

**Utils (`app/utils/`):**
- Purpose: helpers reutilizáveis sem dependência de domínio.
- Contains: `system.py` (data dir, validações anti-injeção/SSRF, métricas psutil), `yaml.py` (load/dump YAML), `metrics.py` (histórico de métricas).
- Depends on: stdlib, psutil.
- Used by: todas as camadas.

**Frontend (`static/`, `templates/`):**
- Purpose: SPA monocromática com temas claro/escuro/sistema.
- Contains: `templates/base.html` (shell único), `static/js/` (20 módulos: api, app, auth, ws, dashboard, devices, device, groups, group, scrcpy, mediamtx, logs, backup, settings, wizard, shell, theme, motion, icons, components), `static/css/` (tokens + layout + components + pages).
- Depends on: REST API + WebSocket (`/ws`, `/ws/shell/{id}`).
- Used by: usuário final (navegador).

## Data Flow

**HTTP Request (ex.: abrir stream):**
1. Usuário clica em "abrir stream" na SPA → `static/js/devices.js` → `POST /api/devices/{id}/start-stream`.
2. `require_auth` valida token (header `Authorization: Bearer`).
3. `devices.py` router valida payload, resolve device via `ConfigurationManager.get_device`.
4. `PlayerManager.start_stream` monta intent (shlex.quote anti-injeção) → `ADBManager` executa `am start -d rtsp://HOST:8554/<path>` via `adb -s IP:5555 shell`.
5. Resposta JSON de sucesso/erro → SPA atualiza card via feed WebSocket.

**Heartbeat (device→servidor):**
1. TV Box faz `POST /api/heartbeat/{id}` com `heartbeat_key`.
2. Router atualiza `DeviceState.last_heartbeat`/`current_activity`; envia evento ao hub WebSocket.
3. Device faz polling de `GET /api/heartbeat/{id}/commands` e reporta resultados em `/result`.
4. Painel não executa ADB enquanto device ativo por heartbeat (regra ADB×scrcpy).

**Watchdog/recovery (ciclo):**
1. `WatchdogManager` (loop) avalia devices por `check_interval`.
2. Health check ADB-light: ping ICMP / heartbeat / activity / MediaMTX path.
3. Se degradado/offline → `RecoveryService` cascata: player retry → Wi-Fi → Ethernet → reboot (respeitando cooldowns e max por etapa).

**Stream pipeline:**
1. `ScrcpyManager.start_streaming`: `adb exec-out screenrecord | ffmpeg → RTMP → MediaMTX` (headless, sem `--record=-`).
2. Path criada no MediaMTX (publisher); TV Box abre `rtsp://HOST:8554/<path>` via PlayerManager.
3. Stop = matar processo + remover path (opcional).

**State Management:**
- Config e devices/groups: YAML em disco (gitignored), carregados no startup e salvos em cada mutação.
- Device `state` (status, last_seen, reason, reboot_count...): somente em memória (`model_dump_safe` exclui `state` ao persistir).
- Locks por target ADB (`asyncio.Lock`), fila de comandos (`command_queue.py`), hub WebSocket em `app.state.ws_hub`.
- Métricas: histórico amostrado em `app.state.metrics_history` (sparklines).

## Key Abstractions

**ConfigurationManager (singleton):**
- Carrega tudo no startup (`app.state.config`); `wizard_completed` sinaliza onboarding.
- Padrão `.example` → real no 1º boot; gera `mediamtx.generated.yml` e sincroniza com o serviço.

**Managers com interface async:**
- Cada manager encapsula um externo (ADB, MediaMTX, scrcpy); retornam dicts `{"success": bool, ...}` ou lançam exceções tratadas na API.

**Validações de segurança (utils/system.py):**
- `is_safe_id` (device/group ids), `is_safe_package` (pm uninstall), `is_safe_network_target` (anti-SSRF), `is_safe_rtmp_url` (anti-exfiltração de tela), `is_safe_http_url_local` (anti-SSRF).

**Event hub WebSocket (`app/core/websocket.py`):**
- `app.state.ws_hub` — broadcast de eventos (status, feed, watchdog) para a SPA.

**Entry points:**
- `app/main.py` — app FastAPI, lifespan (startup/shutdown), routers, middlewares (security headers, static cache), catch-all SPA, WebSockets `/ws` e `/ws/shell/{id}`.

---

*Architecture analysis: 2026-08-06*
