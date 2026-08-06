<!-- GSD:project-start source:PROJECT.md -->

## Project

**Painel TV Box**

Painel web (FastAPI + JS puro) para **gerenciar e monitorar TV Boxes Android** que reproduzem streams RTSP via MediaMTX: controle pela rede (streams, reboot, shell, screenshot, APK), watchdog com recuperação automática, heartbeat device→servidor e grupos. Está migrando de Debian 13 para **rodar somente em Windows 10+** — o cliente precisa transmitir a suíte Office para as TVs, o que não funciona bem no stack Linux (painel + OBS); a migração para Windows é o que viabiliza esse objetivo.

**Core Value:** O painel precisa **manter os TV Boxes transmitindo de forma confiável e acessível na rede local** — abrir/fechar streams e recuperar quedas sozinho, agora rodando como **serviço Windows estável** (auto-restart) em vez de scripts Linux.

### Constraints

- **Plataforma**: Windows 10+ somente — painel e MediaMTX como serviços NSSM com auto-restart — decisão do cliente
- **Compatibilidade**: binários baixados pelo install.ps1 (ffmpeg, platform-tools/ADB, MediaMTX, NSSM); não depender de winget (ausente em Windows 10 corporativos)
- **Stack**: Python 3.11+ / FastAPI / Pydantic v2 / YAML / JS puro sem CDN (manter)
- **Segurança**: firewall só LAN; ADB (5555) nunca aberto para o mundo; manter validações anti-SSRF/injeção existentes
- **Reprodutibilidade**: 111 testes pytest passando + `node --check` ao final de cada fase
- **Histórico**: docs históricos (AUDITORIA.md, specs, 10-IMPLEMENTACAO.md) não reescrever; arquivar Linux em vez de apagar sem rastro

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Python 3.11+ — Todo o backend (`app/`), configurado em `pyproject.toml` (`requires-python = ">=3.11"`); testado com 3.11 e 3.13 (artefatos `__pycache__` mostram ambos).
- JavaScript (ES2020+, sem transpile) — Frontend SPA puro em `static/js/` (20 módulos, sem framework, sem build step, sem CDN).
- HTML + CSS — `templates/base.html` (SPA shell) + `static/css/` (tokens, layout, components, pages).
- Bash — `scripts/android/*.sh` (rodam NOS TV Boxes Android, não no servidor).
- PowerShell (planejado) — `deploy/install.ps1` será o instalador Windows (substitui `deploy/install.sh`).
- YAML — Toda persistência (config, devices, groups) e geração de config do MediaMTX.

## Runtime

- Python 3.11+ (venv local `.venv/` no dev; `C:\PanelTVBox\.venv` no deploy Windows planejado).
- Rodar: `.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080`.
- pip + setuptools (`pyproject.toml`, `[build-system] setuptools>=68`).
- Sem lockfile; `pip install .` resolve de `[project].dependencies`.

## Frameworks

- FastAPI 0.115+ — servidor web, routers, WebSockets, static mount, middlewares.
- Uvicorn 0.30+ (standard) — ASGI server, 1 worker.
- Pydantic v2 — modelos de config/device/group (`app/models/`) e validação de payloads.
- pytest 8+ — 111 testes em `tests/`.
- pytest-asyncio 0.24+ — testes async (managers, WebSocket, heartbeat).
- httpx 0.27+ — TestClient do FastAPI E cliente HTTP do `MediaMTXManager`.
- `node --check static/js/*.js` — validação de sintaxe JS (sem linter formal).

## Key Dependencies

- fastapi / uvicorn — servidor web e WebSockets (núcleo do painel).
- pydantic v2 — models tipados para toda config e payloads (validação anti-injeção).
- pyyaml — persistência em YAML (`config/`, `devices/`, `groups/`, `mediamtx.generated.yml`).
- httpx — cliente async da API REST do MediaMTX (`app/managers/mediamtx.py`) e TestClient.
- psutil — métricas do host (CPU/RAM/disco/uptime) em `app/utils/system.py`.
- MediaMTX — servidor de mídia (RTSP 8554, RTMP 1935, API 9997); binário baixado no install.
- ADB (platform-tools) — controle dos TV Boxes via TCP (servidor ADB isolado na porta 5038).
- ffmpeg — usado no pipeline de streaming do scrcpy e (planejado) captura de tela Windows (gdigrab).
- scrcpy — mirroring/streaming; gerenciado pelo próprio painel (`ScrcpyManager` baixa versões).
- NSSM (planejado) — registro dos serviços Windows (painel + MediaMTX) com auto-restart.

## Configuration

- Variáveis `PANEL_*`: `PANEL_DATA_DIR` (data dir em runtime), `PANEL_ADB_SERVER_PORT` (porta ADB isolada, default 5038), `PANEL_MEDIAMTX_CONFIG` (caminho do config gerado do MediaMTX usado pelo serviço).
- `config/*.yml` (gitignored) criados a partir de `*.yml.example` no 1º boot (`_ensure_default_config`).
- Token de acesso em `config/.panel_token` (gitignored, gerado no 1º boot); `security.heartbeat_key` gerada automaticamente em `system.yml`.
- `pyproject.toml` — sem empacotamento (`py-modules = []`); só instala dependências.

## Platform Requirements

- Windows 10+ (target oficial atual — decisão desta sessão; Linux descartado).
- Git instalado (usado pelo `UpdateManager` via `git pull`).
- Python 3.11+ no PATH (dev) ou instalado pelo install.ps1 (deploy).
- Windows 10+; instalação em `C:\PanelTVBox` (preservando `.git`).
- Serviços: painel (`panel-tvbox`) e MediaMTX (`mediamtx`) via NSSM, com `AppRestartDelay` (auto-restart).
- Data dir: `%LOCALAPPDATA%\PanelTVBox` (env `PANEL_DATA_DIR`).
- Firewall Windows liberado só para a LAN (8080, 8554, 1935, 9997; 5555/ADB opcional).
- Legacy: `deploy/install.sh` + systemd units (Debian 13) — a remover/arquivar (Tarefa 2 do HANDOFF).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Code Style

- **Língua:** docstrings e comentários em **português** (projeto BR); código (identificadores, mensagens técnicas) em inglês.
- **Python:** PEP 8-ish, type hints em todo o backend; `Optional[X]` (stdlib typing) em vez de `X | None` na maioria dos módulos.
- **JS:** ES2020+, sem framework; módulos IIFE/padrão de página com escopo próprio; `node --check` para validação de sintaxe (sem linter).
- **Frontend:** SPA sem build step, sem CDN, sem framework — CSS com design tokens (`static/css/tokens.css`), temas claro/escuro/sistema, monocromático.

## Naming Patterns

- **Managers:** classe `XManager` encapsula uma integração externa (ADB, MediaMTX, player, scrcpy, watchdog, health, schedule, update, log, backup).
- **Services:** classe `XService` para orquestração multi-etapas (`RecoveryService`, `ProvisionService`).
- **Routers:** `router = APIRouter(...)`; handlers async; prefixos `/api/<area>`.
- **Config models:** Pydantic `BaseModel` com `Field(default_factory=...)` para objetos aninhados; campos opcionais `Optional[...]`.
- **Env vars:** prefixo `PANEL_` (ex.: `PANEL_DATA_DIR`, `PANEL_ADB_SERVER_PORT`, `PANEL_MEDIAMTX_CONFIG`).

## Patterns

- **Singleton de config:** `app.state.config` (ConfigurationManager) criado no startup; routers o acessam via `import app.main as main` → `main.config`.
- **Managers retornam dicts** `{"success": bool, ...}` em vez de lançar exceções em caminhos de integração; a API converte em HTTP responses.
- **Execução de subprocessos:** `asyncio.create_subprocess_exec` com `asyncio.wait_for` timeout; locks por target (`asyncio.Lock` em `ADBManager._locks`).
- **Persistência YAML:** `load_yaml`/`dump_yaml` (utils); `dump_yaml_simple` para o `mediamtx.generated.yml`; `model_dump()` para salvar, `model_dump_safe()` excluindo `state` de devices.
- **Config `.example` → real:** `_ensure_default_config` copia template no 1º boot; gerados são gitignored.
- **Heartbeat:** chave dedicada (`security.heartbeat_key`), comandos via polling; painel NÃO roda ADB em device ativo por heartbeat/ping (regra ADB×scrcpy — docs/09-HEARTBEAT-SPEC.md §3.3).

## Error Handling

- **API:** exceções → `HTTPException` com `detail`; rotas de integração retornam dicts de erro com mensagens curtas.
- **Validadores de segurança em `app/utils/system.py`** (usados em todo input não confiável):
- **Anti-injeção de comando:** `shlex.quote` em todo argumento enviado ao shell do device (`app/managers/player.py`); packages validados por regex; payloads de heartbeat validados no router.
- **Logging:** `logging.getLogger("<módulo>")` (ex.: `"config"`, `"adb"`, `"mediamtx"`, `"scrcpy"`); eventos de device via hub WebSocket.

## Platform-Specific Code (Windows-first)

- `app/utils/system.py::get_data_dir` — Windows-first: `PANEL_DATA_DIR` → `%LOCALAPPDATA%\PanelTVBox` (docstring: "O painel roda apenas em Windows").
- `app/managers/health.py` — ping cross-platform: `os.name == "nt"` → `-n 1 -w 1000` (✅ sem mudança necessária).
- `app/managers/log.py` — rotação de logs ciente do Windows (comentário: arquivos abertos quebram rotação no Windows).
- `app/managers/scrcpy.py` — branches `os.name == "nt"` para binário (`scrcpy.exe`), `taskkill` vs `pkill`, e branches linux/macos em `_platform_info`/`_platform_binary_name` (candidatos a simplificação — HANDOFF Tarefa 2).
- **Legado Linux a remover/arquivar** (HANDOFF Tarefa 2): `deploy/install.sh`, `deploy/panel.service`, `deploy/mediamtx.service`, seções Debian de README/docs.

## Testing Conventions

- **pytest:** um arquivo por módulo/feature em `tests/` (ex.: `test_adb.py`, `test_scrcpy.py`, `test_health_heartbeat.py`, `test_watchdog_integration.py`, `test_security.py`).
- **Async:** `pytest-asyncio` (markers/auto mode); `TestClient` (httpx) para a API.
- **Mocks:** binários externos mockados (adb, ffmpeg, ping); `monkeypatch` para env/dirs.
- **JS:** `node --check static/js/*.js` (sintaxe).
- Rodar: `.venv/Scripts/python -m pytest -q` (111 testes no estado atual).

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Pattern Overview

- Backend em camadas: API → Core (config/auth) → Managers (lógica de integração) → Models (Pydantic) → Services (orquestração) → Utils.
- Frontend vanilla JS (20 módulos), sem framework/build/CDN; comunicação via REST + WebSocket.
- Persistência em YAML local (um arquivo por device/grupo), sem banco de dados.
- Estado de runtime em memória (device state, locks, hubs) — não persiste.
- Stream pipeline: `ffmpeg/ADB exec-out screenrecord → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)`.

## Layers

- Purpose: rotas REST + WebSocket; validação de payloads; resposta JSON.
- Contains: routers `devices.py`, `groups.py`, `system.py`, `mediamtx.py`, `scrcpy.py`, `logs.py`, `backup.py`, `update.py`, `wizard.py`, `auth.py`, `heartbeat.py`.
- Depends on: `app/core/config.py` (singleton), `app/core/auth.py`, managers, services.
- Used by: frontend JS (`static/js/api.js`), devices (heartbeat), testes (`tests/test_api.py` etc.).
- Purpose: ciclo de vida do app, config singleton, autenticação, exceções, WebSocket hub.
- Contains: `config.py` (ConfigurationManager — carrega/valida/salva YAML), `auth.py` (require_auth, require_auth_ws), `lifecycle.py` (startup/shutdown), `websocket.py` (hub), `exceptions.py`.
- Depends on: models, utils.
- Used by: toda a API e main.py.
- Purpose: lógica de integração com sistemas externos e dispositivos (cada um encapsula uma "ferramenta").
- Contains: `adb.py` (ADB TCP com locks/timeouts/metrics), `mediamtx.py` (API REST do MediaMTX), `player.py` (intents VLC/MPV nos devices), `scrcpy.py` (versões, mirroring, streaming headless), `health.py` (ping/ADB-light), `watchdog.py` (monitoramento + recuperação), `schedule.py` (agendamento por cron), `update.py` (git pull), `backup.py`, `log.py` (rotação de logs).
- Depends on: models, utils, subprocess/httpx externos.
- Used by: API layer, services, testes.
- Purpose: schemas Pydantic v2 para toda configuração e estado.
- Contains: `config.py` (SystemConfig, WatchdogConfig, PlayersConfig, MediaMTXConfig), `device.py` (DeviceConfig/DeviceState/DeviceCapabilities), `group.py` (GroupConfig).
- Depends on: pydantic.
- Used by: core, managers, API, testes.
- Purpose: orquestração de fluxos multi-etapas.
- Contains: `command_queue.py` (fila de comandos ADB), `provision.py` (provisionamento de devices: envia scripts/android, seta configs), `recovery.py` (cascata de recuperação do watchdog: player retry → Wi-Fi → Ethernet → reboot).
- Depends on: managers, models, utils.
- Used by: API layer, watchdog.
- Purpose: helpers reutilizáveis sem dependência de domínio.
- Contains: `system.py` (data dir, validações anti-injeção/SSRF, métricas psutil), `yaml.py` (load/dump YAML), `metrics.py` (histórico de métricas).
- Depends on: stdlib, psutil.
- Used by: todas as camadas.
- Purpose: SPA monocromática com temas claro/escuro/sistema.
- Contains: `templates/base.html` (shell único), `static/js/` (20 módulos: api, app, auth, ws, dashboard, devices, device, groups, group, scrcpy, mediamtx, logs, backup, settings, wizard, shell, theme, motion, icons, components), `static/css/` (tokens + layout + components + pages).
- Depends on: REST API + WebSocket (`/ws`, `/ws/shell/{id}`).
- Used by: usuário final (navegador).

## Data Flow

- Config e devices/groups: YAML em disco (gitignored), carregados no startup e salvos em cada mutação.
- Device `state` (status, last_seen, reason, reboot_count...): somente em memória (`model_dump_safe` exclui `state` ao persistir).
- Locks por target ADB (`asyncio.Lock`), fila de comandos (`command_queue.py`), hub WebSocket em `app.state.ws_hub`.
- Métricas: histórico amostrado em `app.state.metrics_history` (sparklines).

## Key Abstractions

- Carrega tudo no startup (`app.state.config`); `wizard_completed` sinaliza onboarding.
- Padrão `.example` → real no 1º boot; gera `mediamtx.generated.yml` e sincroniza com o serviço.
- Cada manager encapsula um externo (ADB, MediaMTX, scrcpy); retornam dicts `{"success": bool, ...}` ou lançam exceções tratadas na API.
- `is_safe_id` (device/group ids), `is_safe_package` (pm uninstall), `is_safe_network_target` (anti-SSRF), `is_safe_rtmp_url` (anti-exfiltração de tela), `is_safe_http_url_local` (anti-SSRF).
- `app.state.ws_hub` — broadcast de eventos (status, feed, watchdog) para a SPA.
- `app/main.py` — app FastAPI, lifespan (startup/shutdown), routers, middlewares (security headers, static cache), catch-all SPA, WebSockets `/ws` e `/ws/shell/{id}`.

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
