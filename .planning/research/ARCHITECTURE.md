# Architecture Research

**Domain:** Deploy/operação Windows-only de painel FastAPI + MediaMTX
**Researched:** 2026-08-06
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Máquina Windows 10+ (servidor)              │
│                                                                 │
│  ┌─────────────────────┐        ┌──────────────────────────┐   │
│  │  Serviço NSSM       │        │  Serviço NSSM            │   │
│  │  "panel-tvbox"      │        │  "mediamtx"              │   │
│  │  uvicorn app.main   │  HTTP  │  mediamtx.exe            │   │
│  │  :8080              │───────▶│  :9997 (API)             │   │
│  │  PANEL_DATA_DIR     │        │  :8554 RTSP :1935 RTMP   │   │
│  │  PANEL_ADB_PORT=5038│        │  config gerada pelo      │   │
│  │  PANEL_MEDIAMTX_CFG │        │  painel (generated.yml)  │   │
│  └─────────┬───────────┘        └──────────┬───────────────┘   │
│            │ LAN (firewall LocalSubnet)     │ LAN               │
│            ▼                                ▼                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TV Boxes Android (VLC/MPV) — RTSP :8554/<path>          │   │
│  │  ADB TCP :5555 (painel, porta isolada 5038)              │   │
│  │  Heartbeat HTTP → painel (zero ADB)                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Publicadores externos (OBS/ffmpeg — ex.: captura de apps       │
│  Office na sessão do usuário) → RTMP :1935/office/<nome>        │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| `install.ps1` | Preflight (admin/Windows 10+), downloads (GitHub API + estáticos), venv, cópia repo preservando `.git`, extração binários, NSSM install/set/start, firewall, config inicial, resumo | Espelho da lógica do install.sh (resolver asset real do MediaMTX via API, flags `-NoMediamtx`, `-AllowAdb`, `-SkipVenv`, `-RepoUrl`, `-Help`) |
| `instalar.bat` | Launcher de duplo clique → `powershell -ExecutionPolicy Bypass -File deploy/install.ps1` | Cliente não-técnico |
| Serviço `panel-tvbox` (NSSM) | uvicorn, 1 worker; env vars `PANEL_*`; auto-restart 5s | `AppDirectory=C:\PanelTVBox`; args via `AppParameters` (caminho sem espaços) |
| Serviço `mediamtx` (NSSM) | MediaMTX com `config/mediamtx.generated.yml`; auto-restart 3s | Config gerada/sincronizada pelo painel (`PANEL_MEDIAMTX_CONFIG`) |
| Firewall | Liberar só LAN: 8080/8554/1935/9997; 5555 opcional (`-AllowAdb`) | `New-NetFirewallRule -RemoteAddress LocalSubnet`; nunca abrir para o mundo |
| `UpdateManager` | `git pull` em `C:\PanelTVBox` (`.git` preservado) | Atualização sem reinstalar |

### Data Flow

**Instalação:**
1. Usuário executa `instalar.bat` (duplo clique).
2. `install.ps1` eleva para admin, valida Windows 10+, baixa/extrai binários, cria venv, copia código (com `.git`), registra serviços NSSM, abre firewall LAN, inicia serviços.
3. Painel no 1º boot cria configs a partir de `.example` e gera `mediamtx.generated.yml`; wizard orienta adicionar TV Boxes.

**Operação (stream):**
1. OBS/ffmpeg (sessão do usuário) publica `rtmp://localhost:1935/office/<nome>` (ou o painel cria path via `/api/mediamtx/paths`).
2. Painel cria/consome paths via API MediaMTX (`MediaMTXManager`).
3. TV Box abre `rtsp://HOST:8554/<path>` via `PlayerManager` (ADB ou heartbeat commands).
4. Watchdog monitora e recupera quedas (player retry → Wi-Fi → Ethernet → reboot).

**Atualização:**
1. `UpdateManager` → `git pull` em `C:\PanelTVBox` (`.git` presente).
2. Relança o serviço (NSSM reinicia; `mediamtx.generated.yml` sincronizada).

**State Management:**
- Config/devices/groups: YAML local (gitignored) com templates `.example`.
- Device state: em memória (não persiste).
- Serviços: gerenciados pelo Windows Service Manager via NSSM (auto-restart com backoff 2s→4min; `AppRestartDelay`).

### Build Order

1. **Fase A — Instalador Windows** (`install.ps1` + `instalar.bat`): preflight → downloads → venv → cópia → NSSM → firewall → resumo. Sem isso nada roda em produção Windows.
2. **Fase B — Limpeza Linux**: arquivar `deploy/legacy/` (install.sh + units), atualizar `scrcpy.py`/`get_data_dir` p/ Windows-only, ajustar testes.
3. **Fase C — Docs**: README, `docs/INSTALL.md`, `docs/LLM.md` (Windows, 111 testes, sem Debian no caminho ativo).

**Dependência chave:** instalar primeiro (valida a base Windows), depois limpar/docs (evita dupla documentação).

---

*Architecture analysis: 2026-08-06*
