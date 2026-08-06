# Stack Research

**Domain:** Deploy Windows-only de painel web Python/FastAPI + MediaMTX (streaming RTSP) + controle de TV Boxes Android
**Researched:** 2026-08-06
**Confidence:** HIGH

> Milestone **subsequent**: o stack de runtime já existe (Python 3.11+/FastAPI/Pydantic v2/YAML/JS puro). Esta pesquisa cobre o que falta: **empacotamento e operação no Windows**.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| NSSM (Non-Sucking Service Manager) | 2.24 (stable) | Registra uvicorn e MediaMTX como serviços Windows com auto-restart | Padrão da comunidade; monitora o processo real (se morre, reinicia); `AppRestartDelay` em ms; `AppEnvironmentExtra` preserva o ambiente do sistema e adiciona variáveis — decisão já aprovada pelo usuário (Opção A) |
| PowerShell 5.1+ (Windows 10 nativo) | — | Instalador `deploy/install.ps1` (preflight admin, downloads, extração, NSSM, firewall) | Nativo do Windows 10; `Invoke-RestMethod` resolve assets reais via API GitHub; `-ExecutionPolicy Bypass` via `instalar.bat` |
| winget | opcional | Instalar `Python.Python.3.12` e `Git.Git` | Conforto quando disponível; **fallback manual obrigatório** — winget ausente em vários Windows 10 corporativos (decisão registrada) |
| Python 3.11+ | >=3.11 | Runtime do painel | Já é o requisito do projeto (`pyproject.toml`); Python 3.12 é o alvo do install.ps1 |

### Supporting Libraries / Binários

| Component | Source | Purpose | When to Use |
|-----------|--------|---------|-------------|
| MediaMTX | `https://api.github.com/repos/bluenviron/mediamtx/releases/latest` → asset `windows_amd64` + `.zip` | Servidor RTSP/RTMP/API | Sempre (núcleo do streaming); não assumir nome fixo — resolver pela API (padrão do install.sh original) |
| ADB platform-tools | `https://dl.google.com/android/repository/platform-tools-latest-windows.zip` | Controle dos TV Boxes via TCP | Sempre; `adb.binary` → `C:\PanelTVBox\platform-tools\adb.exe` |
| ffmpeg (gyan.dev) | `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` | Captura/pipeline de stream (scrcpy streaming; futuro gdigrab p/ Office) | Sempre; builds exigem Windows 10+ (compatível); essentials é suficiente (ffmpeg/ffprobe/ffplay) |
| NSSM | `https://nssm.cc/download` → `nssm-2.24.zip` | Helper de serviço | Sempre (2 serviços: `panel-tvbox`, `mediamtx`) |
| scrcpy | gerenciado pelo painel (`ScrcpyManager`) | Mirroring/streaming | Já existente — nenhuma mudança no install |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `.venv` (venv nativo) | Isolar dependências em `C:\PanelTVBox\.venv` | `python -m venv` → `pip install .` (pyproject) |
| `node --check static/js/*.js` | Validar sintaxe JS | Sem build step no projeto |
| `pytest` | 111 testes | Gate de qualidade por fase |
| `powershell -File deploy/install.ps1 -Help` | Smoke-test do instalador | Não dá para testar instalação completa na dev sem risco (HANDOFF §4) |

## Installation

- **Preflight**: admin (elevar se preciso), Windows 10+ (`[Environment]::OSVersion.Version.Major -ge 10`), dirs.
- **Código**: copiar repo → `C:\PanelTVBox` **preservando `.git`** (excluir `.venv`, `__pycache__`, `logs`, `backups`, `scrcpy/*`, `.reasonix`); destino vazio + repo não local → `git clone`.
- **Serviços NSSM** (caminhos sem espaços; args via `AppParameters`):
  - `panel-tvbox`: `C:\PanelTVBox\.venv\Scripts\uvicorn.exe` + `app.main:app --host 0.0.0.0 --port 8080 --workers 1`; `AppDirectory=C:\PanelTVBox`; `AppEnvironmentExtra=PANEL_DATA_DIR=... PANEL_ADB_SERVER_PORT=5038 PANEL_MEDIAMTX_CONFIG=C:\PanelTVBox\config\mediamtx.generated.yml`; `AppRestartDelay=5000`.
  - `mediamtx`: `C:\PanelTVBox\mediamtx\mediamtx.exe` + config gerada; `AppRestartDelay=3000`.
- **Firewall**: `New-NetFirewallRule -RemoteAddress LocalSubnet` para 8080/8554/1935/9997; 5555 (ADB) opcional via flag.
- **Config inicial**: `config/*.yml.example` → `*.yml` se ausentes (o painel já faz no 1º boot); `mediamtx.generated.yml` gerada pelo wizard.

## What NOT to Use

- **Task Scheduler nativo** — sem auto-restart real, depende de sessão logada (recusado).
- **winSW** — equivalente ao NSSM sem vantagem para este caso (recusado).
- **Painel-gerencia-MediaMTX como subprocess** — muda a arquitetura; MediaMTX como serviço próprio é mais robusto (recusado).
- **`pip install` de ffmpeg/adb via winget/choco** — ausentes em Windows 10 corporativos; download direto com fallback é mais previsível.
- **`--workers > 1` / reload em produção** — 1 worker (locks em memória, fila de comandos); reload só em dev.

---

*Stack analysis: 2026-08-06*
