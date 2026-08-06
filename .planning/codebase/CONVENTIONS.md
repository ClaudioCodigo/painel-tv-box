# Conventions

**Analysis Date:** 2026-08-06

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
  - `is_safe_id` — ids device/group (slug regex, sem `/` ou `..`).
  - `is_safe_package` — package Android (anti-injeção em `pm uninstall`).
  - `is_safe_network_target` — IPv4 fora de loopback/link-local/multicast (anti-SSRF).
  - `is_safe_rtmp_url` — RTMP só para localhost/rede privada (anti-exfiltração de tela).
  - `is_safe_http_url_local` — URL http(s) local/privada (anti-SSRF).
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

---

*Conventions analysis: 2026-08-06*
