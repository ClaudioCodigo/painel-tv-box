# Testing

**Analysis Date:** 2026-08-06

## Framework & Setup

- **Framework:** pytest 8+ com `pytest-asyncio` (dev extras em `pyproject.toml`).
- **Client HTTP:** `httpx` `TestClient` do FastAPI (também usado em runtime pelo `MediaMTXManager`).
- **Rodar:** `.venv/Scripts/python -m pytest -q` — **111 testes passando** no estado atual (HANDOFF/README; README cita "104" — desatualizado, corrigir para 111).
- **JS:** `node --check static/js/*.js` — 20 módulos, validação de sintaxe.

## Structure

Um arquivo de teste por módulo/feature em `tests/`:

| Arquivo | Cobre |
|---|---|
| `test_api.py` | Rotas REST gerais, autenticação, erros |
| `test_auth.py`* | (se existir) fluxos de login/token |
| `test_adb.py` | `ADBManager` — execução, locks, timeouts, porta isolada |
| `test_config.py` | `ConfigurationManager` — load/save, templates `.example`, wizard |
| `test_devices_api.py`* / `test_groups_api.py` | CRUD devices/grupos e validações |
| `test_health.py`, `test_health_heartbeat.py`, `test_heartbeat.py` | Health checks e fluxo heartbeat device→servidor |
| `test_log.py` | Busca/rotação de logs |
| `test_player.py`, `test_player_injection.py` | Intents de player e anti-injeção (shlex.quote) |
| `test_provision.py` | Provisionamento de devices (scripts, `\n` vs `\r\n`) |
| `test_recovery_stream.py` | Cascata de recuperação do watchdog |
| `test_schedule.py` | Agendamento cron |
| `test_scrcpy.py` | `ScrcpyManager` — versões, download, mirroring/streaming headless |
| `test_security.py` | Validações de segurança (ids, URLs, SSRF, injeção) |
| `test_command_queue.py` | Fila serial de comandos |
| `test_watchdog_integration.py` | Watchdog + recovery end-to-end (mockado) |

\* nomes conforme presente em `tests/` (17 arquivos .py no total).

## Patterns

- **Mocks de binários externos:** `monkeypatch`/`unittest.mock` para `adb`, `ffmpeg`, `ping`, `git` — os testes não dependem de ferramentas instaladas.
- **Isolamento de FS:** fixtures criam dirs temporários (config/devices/groups) e setam `PANEL_DATA_DIR` via env.
- **TestClient:** `with TestClient(app) as client` para exercitar lifespan (startup/shutdown).
- **WebSocket:** testes de `/ws` e `/ws/shell/{id}` via TestClient websocket connect (ex.: `test_health_heartbeat.py`, testes de shell).
- **Injeção:** `test_player_injection.py` valida que aspas/`$()` são neutralizadas em argumentos de player.
- **Anti-regressão:** `test_scrcpy.py::test_platform_info_linux` cobre o branch linux de `_platform_info` — se a simplificação Windows-only (HANDOFF Tarefa 2) remover o branch, o teste precisa ser ajustado/removido.

## Coverage Notes

- Backend cobre API, managers, services e utils; frontend não tem testes automatizados além de `node --check`.
- Testes de integração com MediaMTX real NÃO existem (mockados via httpx ou não exercitados) — a config `mediamtx.generated.yml` é validada por testes de `ConfigurationManager.generate_mediamtx_yml`.
- Deploy Windows (`deploy/install.ps1`): validação planejada = `powershell -File ... -Help` (sintaxe) + teste do fluxo de download dos 4 assets + `node --check` + pytest; instalação completa não testável na máquina dev sem risco (HANDOFF §4).

## Commands

```bash
# Suíte completa
.venv/Scripts/python -m pytest -q

# Arquivo específico
.venv/Scripts/python -m pytest tests/test_scrcpy.py -q

# Sintaxe JS
node --check static/js/*.js
```

---

*Testing analysis: 2026-08-06*
