# Integrations

**Analysis Date:** 2026-08-06

## External Services & Systems

### MediaMTX (REST API local)

- **Interface:** HTTP REST em `http://localhost:9997` (porta configurável em `config/mediamtx.yml` → `api.url`).
- **Endpoints usados** (`app/managers/mediamtx.py`): `GET /v3/paths/list`, `GET /v3/paths/get/{name}`, `POST /v3/paths/add/{name}`, `DELETE /v3/paths/delete/{name}`.
- **Mídia:** RTSP na porta 8554 (consumido pelos players VLC/MPV nos TV Boxes), RTMP na 1935 (publicadores OBS/ffmpeg), HLS/WebRTC desligados por default (`config/mediamtx.yml`).
- **Config runtime:** o painel gera `config/mediamtx.generated.yml` (`ConfigurationManager.generate_mediamtx_yml`) com uma path `source: publisher, maxReaders: 1` por device com `rtsp_path`. Se `PANEL_MEDIAMTX_CONFIG` estiver setada, sincroniza para o serviço em execução.
- **Auth:** `authMethod: internal`; user `any` com permissões publish/read local, e API restrita a `127.0.0.1`/`::1` + `api_allowed_network` (default `192.168.254.0/24`).

### ADB (Android Debug Bridge)

- **Binário:** `adb` (dev) / `C:\PanelTVBox\platform-tools\adb.exe` (deploy Windows planejado, setado em `config/system.yml → adb.binary`).
- **Transporte:** conexão TCP `device.ip:5555` (`adb_port` por device).
- **Servidor isolado:** painel usa porta própria `PANEL_ADB_SERVER_PORT` (default 5038) via env `ADB_SERVER_PORT`, separada do servidor default do scrcpy (5037) — regra central ADB×scrcpy (docs/09-HEARTBEAT-SPEC.md §3.3).
- **Uso:** shell remoto, start/stop de players (intents), screenshot, reboot, instalar/remover APK, comandos arbitrários — tudo com timeout e locks por target (`app/managers/adb.py`).

### Heartbeat device→servidor (HTTP)

- **Direção:** TV Box → painel, zero ADB (só HTTP).
- **Interface:** `POST /api/heartbeat/{device_id}` (liveness + activity em foco), `GET /api/heartbeat/{device_id}/commands` (polling de comandos), `POST /api/heartbeat/{device_id}/result` (resultado de comando local).
- **Auth:** chave dedicada `security.heartbeat_key` (não o token do painel).
- **Comandos locais:** start/stop stream, reboot — executados pelo próprio device, sem derrubar o scrcpy.

### GitHub Releases API (downloads)

- **scrcpy:** `ScrcpyManager.download` resolve o asset real `scrcpy-win64-v{version}.zip` pela API `https://api.github.com/repos/...` (padrão: resolver por API, não assumir nome — ver `app/managers/scrcpy.py`).
- **MediaMTX (install.ps1 planejado):** `https://api.github.com/repos/bluenviron/mediamtx/releases/latest`, filtrar asset `windows_amd64` + `.zip` (mesmo padrão do `deploy/install.sh`).

### Downloads estáticos (deploy Windows planejado)

- **NSSM:** `https://nssm.cc/download` → `nssm-2.24.zip`.
- **platform-tools:** `https://dl.google.com/android/repository/platform-tools-latest-windows.zip`.
- **ffmpeg:** `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` (inclui `bin/ffmpeg.exe`).
- **winget:** tentativa de instalar `Python.Python.3.12` e `Git.Git`; fallback manual (não depender de winget — ausente em vários Windows 10 corporativos).

### Windows (deploy planejado)

- **NSSM:** serviços `panel-tvbox` (uvicorn) e `mediamtx`, com `AppRestartDelay` e `AppEnvironmentExtra` (`PANEL_DATA_DIR`, `PANEL_ADB_SERVER_PORT`, `PANEL_MEDIAMTX_CONFIG`).
- **Windows Firewall:** `New-NetFirewallRule` liberando só `LocalSubnet` para 8080/8554/1935/9997; 5555 (ADB) opcional via flag `-AllowAdb`.

### Git (atualização do painel)

- **UpdateManager** (`app/managers/update.py`): `git pull` no `project_root`. Por isso o deploy Windows preserva `.git` em `C:\PanelTVBox` (decisão registrada no HANDOFF).

## Data Stores

- **Persistência local YAML** (não há banco de dados):
  - `config/system.yml`, `config/watchdog.yml`, `config/players.yml`, `config/mediamtx.yml` (+ `mediamtx.generated.yml` gerado).
  - `devices/<id>.yml` (um por TV Box), `groups/<id>.yml` (um por grupo).
  - Gitignored (templates `.example` versionados); `state` dos devices é em memória (não persiste).
- **Data dir runtime** (`PANEL_DATA_DIR` / `%LOCALAPPDATA%\PanelTVBox`): backups, screenshots, APKs, logs — fora do repositório.

## Auth Providers

- **Token compartilhado** gerado em `config/.panel_token` (1º boot); login via `POST /api/auth/login`, header `Authorization: Bearer <token>` ou `?token=` (downloads/imagens).
- Rotas públicas: `/api/system/health`, `/api/auth/login`, wizard (antes de concluir).
- `security.enabled: false` desliga autenticação (config local).

---

*Integrations analysis: 2026-08-06*
