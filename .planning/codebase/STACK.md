# Technology Stack

**Analysis Date:** 2026-08-06

## Languages

**Primary:**
- Python 3.11+ — Todo o backend (`app/`), configurado em `pyproject.toml` (`requires-python = ">=3.11"`); testado com 3.11 e 3.13 (artefatos `__pycache__` mostram ambos).

**Secondary:**
- JavaScript (ES2020+, sem transpile) — Frontend SPA puro em `static/js/` (20 módulos, sem framework, sem build step, sem CDN).
- HTML + CSS — `templates/base.html` (SPA shell) + `static/css/` (tokens, layout, components, pages).
- Bash — `scripts/android/*.sh` (rodam NOS TV Boxes Android, não no servidor).
- PowerShell (planejado) — `deploy/install.ps1` será o instalador Windows (substitui `deploy/install.sh`).
- YAML — Toda persistência (config, devices, groups) e geração de config do MediaMTX.

## Runtime

**Environment:**
- Python 3.11+ (venv local `.venv/` no dev; `C:\PanelTVBox\.venv` no deploy Windows planejado).
- Rodar: `.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080`.

**Package Manager:**
- pip + setuptools (`pyproject.toml`, `[build-system] setuptools>=68`).
- Sem lockfile; `pip install .` resolve de `[project].dependencies`.

## Frameworks

**Core:**
- FastAPI 0.115+ — servidor web, routers, WebSockets, static mount, middlewares.
- Uvicorn 0.30+ (standard) — ASGI server, 1 worker.
- Pydantic v2 — modelos de config/device/group (`app/models/`) e validação de payloads.

**Testing:**
- pytest 8+ — 111 testes em `tests/`.
- pytest-asyncio 0.24+ — testes async (managers, WebSocket, heartbeat).
- httpx 0.27+ — TestClient do FastAPI E cliente HTTP do `MediaMTXManager`.

**Dev tooling:**
- `node --check static/js/*.js` — validação de sintaxe JS (sem linter formal).

## Key Dependencies

**Critical:**
- fastapi / uvicorn — servidor web e WebSockets (núcleo do painel).
- pydantic v2 — models tipados para toda config e payloads (validação anti-injeção).
- pyyaml — persistência em YAML (`config/`, `devices/`, `groups/`, `mediamtx.generated.yml`).
- httpx — cliente async da API REST do MediaMTX (`app/managers/mediamtx.py`) e TestClient.
- psutil — métricas do host (CPU/RAM/disco/uptime) em `app/utils/system.py`.

**Infrastructure (externos, não-Python):**
- MediaMTX — servidor de mídia (RTSP 8554, RTMP 1935, API 9997); binário baixado no install.
- ADB (platform-tools) — controle dos TV Boxes via TCP (servidor ADB isolado na porta 5038).
- ffmpeg — usado no pipeline de streaming do scrcpy e (planejado) captura de tela Windows (gdigrab).
- scrcpy — mirroring/streaming; gerenciado pelo próprio painel (`ScrcpyManager` baixa versões).
- NSSM (planejado) — registro dos serviços Windows (painel + MediaMTX) com auto-restart.

## Configuration

**Environment:**
- Variáveis `PANEL_*`: `PANEL_DATA_DIR` (data dir em runtime), `PANEL_ADB_SERVER_PORT` (porta ADB isolada, default 5038), `PANEL_MEDIAMTX_CONFIG` (caminho do config gerado do MediaMTX usado pelo serviço).
- `config/*.yml` (gitignored) criados a partir de `*.yml.example` no 1º boot (`_ensure_default_config`).
- Token de acesso em `config/.panel_token` (gitignored, gerado no 1º boot); `security.heartbeat_key` gerada automaticamente em `system.yml`.

**Build:**
- `pyproject.toml` — sem empacotamento (`py-modules = []`); só instala dependências.

## Platform Requirements

**Development:**
- Windows 10+ (target oficial atual — decisão desta sessão; Linux descartado).
- Git instalado (usado pelo `UpdateManager` via `git pull`).
- Python 3.11+ no PATH (dev) ou instalado pelo install.ps1 (deploy).

**Production:**
- Windows 10+; instalação em `C:\PanelTVBox` (preservando `.git`).
- Serviços: painel (`panel-tvbox`) e MediaMTX (`mediamtx`) via NSSM, com `AppRestartDelay` (auto-restart).
- Data dir: `%LOCALAPPDATA%\PanelTVBox` (env `PANEL_DATA_DIR`).
- Firewall Windows liberado só para a LAN (8080, 8554, 1935, 9997; 5555/ADB opcional).
- Legacy: `deploy/install.sh` + systemd units (Debian 13) — a remover/arquivar (Tarefa 2 do HANDOFF).

---

*Stack analysis: 2026-08-06*
*Update after major dependency changes*
