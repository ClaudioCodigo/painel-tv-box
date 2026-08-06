# Requirements — Painel TV Box

**Milestone:** Migração Windows-only (install.ps1 + NSSM + docs)
**Scope status:** All v1 (approved by user)
**PROJECT_MODE:** mvp (vertical — decided by user)

## v1 Requirements

### INFRA — Instalação Windows (`instalar.bat` → `deploy/install.ps1`)

- [ ] **INFRA-01**: User installs the panel on Windows 10+ with a double-click launcher (`instalar.bat` → `deploy/install.ps1 -ExecutionPolicy Bypass`)
- [ ] **INFRA-02**: Installer downloads ffmpeg, ADB/platform-tools, MediaMTX, and NSSM automatically (resolving the real MediaMTX asset via GitHub API), without depending on winget
- [ ] **INFRA-03**: Installer copies the repo code to `C:\PanelTVBox` preserving `.git` (excluding `.venv`, `__pycache__`, `logs`, `backups`, `scrcpy/versions`, `scrcpy/downloads`)
- [ ] **INFRA-04**: Installer creates a Python venv at `C:\PanelTVBox\.venv` and installs dependencies (explicit pyproject deps as fallback)
- [ ] **INFRA-05**: Installer syncs initial config (`config/*.yml.example` → `*.yml` when absent)

### SVC — Serviços NSSM com auto-restart

- [ ] **SVC-01**: Panel (uvicorn) and MediaMTX run as Windows services via NSSM with auto-restart (`AppRestartDelay`)
- [ ] **SVC-02**: `panel-tvbox` service exposes ffmpeg/ADB on PATH and the `PANEL_*` env vars via `AppEnvironmentExtra` (never `AppEnvironment`)
- [ ] **SVC-03**: `mediamtx` service uses the panel-generated config (`PANEL_MEDIAMTX_CONFIG` → `mediamtx.generated.yml`)

### SEC — Firewall só LAN

- [ ] **SEC-01**: Windows Firewall opens only the local subnet (`LocalSubnet`) for ports 8080/8554/1935/9997
- [ ] **SEC-02**: ADB port 5555 is opened only via `-AllowAdb` flag, never by default

### CLEAN — Refatoração Windows-only

- [ ] **CLEAN-01**: Linux deploy (`deploy/install.sh`, `deploy/panel.service`, `deploy/mediamtx.service`) archived to `deploy/legacy/`
- [ ] **CLEAN-02**: Code simplified to Windows-only (`_platform_info`/`_platform_binary_name`/ffmpeg message in `app/managers/scrcpy.py`, `get_data_dir` in `app/utils/system.py`)
- [ ] **CLEAN-03**: Tests adjusted (`test_platform_info_linux`) — pytest green (111+), `node --check` passes

### DOC — Documentação

- [ ] **DOC-01**: `README.md` rewritten for Windows (no Debian/systemd in the active path)
- [ ] **DOC-02**: `docs/INSTALL.md` rewritten as step-by-step install.ps1 guide
- [ ] **DOC-03**: `docs/LLM.md` updated (Windows, data dir, deploy/, 111 tests, flags)

## v2 (deferred)

- (none identified — no deferred table stakes)

## Out of Scope

- Captura de apps da suíte Office pelo painel — anti-feature em serviço Windows sem desktop (sessão 0); publicadores externos (OBS/ffmpeg) → RTMP, painel gerencia/distribui
- Suporte Linux/macOS em produção — descartado pelo cliente; só Windows 10+
- Features novas de produto nesta fase — só migração/robustez/docs
- `SERVICE_INTERACTIVE_PROCESS` — quebrado/depreciado em Windows moderno
- Multi-worker uvicorn — quebra locks/estado em memória

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 1 | Pending |
| SVC-01 | Phase 1 | Pending |
| SVC-02 | Phase 1 | Pending |
| SVC-03 | Phase 1 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 1 | Pending |
| CLEAN-01 | Phase 2 | Pending |
| CLEAN-02 | Phase 2 | Pending |
| CLEAN-03 | Phase 2 | Pending |
| DOC-01 | Phase 3 | Pending |
| DOC-02 | Phase 3 | Pending |
| DOC-03 | Phase 3 | Pending |
