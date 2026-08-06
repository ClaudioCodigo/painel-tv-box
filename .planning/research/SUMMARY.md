# Project Research Summary

**Project:** Painel TV Box
**Domain:** Migração Windows-only + deploy robusto de painel FastAPI + MediaMTX
**Researched:** 2026-08-06
**Confidence:** HIGH

## Executive Summary

O Painel TV Box é um produto maduro (111 testes, Fases A–D completas). O milestone atual NÃO adiciona features: é a **migração de operação de Debian 13 para Windows 10+**, motivada pelo cliente precisar transmitir a suíte Office — o que o stack Linux (painel + OBS) não faz bem. A pesquisa confirmou o plano do HANDOFF: **NSSM 2.24** (estável, auto-restart com `AppRestartDelay`, `AppEnvironmentExtra` preserva o ambiente do sistema), **PowerShell** para o instalador com resolução de assets reais via API GitHub (padrão já usado pelo install.sh e ScrcpyManager), binários baixados (ffmpeg gyan.dev, platform-tools, MediaMTX, NSSM) sem depender de winget (ausente em Windows 10 corporativos).

Riscos-chave identificados e mitigados no desenho: caminhos com espaço no NSSM (mitigado por `C:\PanelTVBox` sem espaços + `AppParameters`), PATH do serviço sem ffmpeg/adb (mitigado por `AppEnvironmentExtra` — nunca `AppEnvironment`, que substituiria o ambiente), `.git` preservado na cópia (senão `git pull` do UpdateManager quebra), firewall restrito a `LocalSubnet`, e instalação que não pode ser testada na dev (mitigado por smoke-tests de sintaxe/downloads + UAT manual no cliente).

## Key Findings

### Recommended Stack

Deploy Windows: NSSM 2.24 para os serviços `panel-tvbox` (uvicorn, 1 worker) e `mediamtx`; PowerShell 5.1+ para `deploy/install.ps1`; Python 3.11+ (alvo 3.12 via winget com fallback manual); MediaMTX via `releases/latest` filtrando `windows_amd64`+`.zip`; ffmpeg gyan.dev essentials; platform-tools Google; NSSM nssm.cc.

**Core technologies:**
- NSSM 2.24: registro + auto-restart de serviços (decisão aprovada) — `AppRestartDelay`, `AppEnvironmentExtra`
- PowerShell: instalador idempotente com `Invoke-RestMethod` p/ assets dinâmicos
- Python 3.11+ / uvicorn: já existentes; 1 worker em produção
- MediaMTX Windows: binário standalone + config gerada pelo painel (`PANEL_MEDIAMTX_CONFIG`)

### Expected Features

**Must have (table stakes):**
- `instalar.bat` (duplo clique) → `install.ps1` com downloads automáticos dos 4 binários
- Serviços NSSM com auto-restart ("rodando boa parte do tempo" — requisito explícito)
- Firewall LAN (`LocalSubnet`): 8080/8554/1935/9997; 5555 via `-AllowAdb`
- Limpeza do caminho Linux (`deploy/legacy/`, código Windows-only, docs)
- `.git` preservado + data dir `%LOCALAPPDATA%\PanelTVBox`

**Should have (competitive):**
- Config MediaMTX sincronizada com o serviço (wizard/update sem cópia manual)
- Smoke-tests do instalador (`-Help`, downloads) + pytest/node check verdes

**Defer (v2+):**
- Captura de apps Office pelo painel — **anti-feature** (serviço não tem desktop); publicadores externos (OBS/ffmpeg) → RTMP, painel gerencia/distribui
- `SERVICE_INTERACTIVE_PROCESS` — quebrado/depreciado em Windows moderno
- Multi-worker uvicorn — quebra locks/estado em memória

### Architecture Approach

Duas unidades NSSM independentes (painel + MediaMTX) na máquina Windows, com firewall LAN restrito e publicadores externos publicando RTMP para o MediaMTX; o painel cria/consome paths via API e os TV Boxes consomem RTSP. Construir na ordem: **instalador primeiro** (valida a base Windows), depois limpeza Linux e docs (evita documentar duas vezes).

**Major components:**
1. `install.ps1` + `instalar.bat` — preflight, downloads, venv, cópia com `.git`, NSSM install/set/start, firewall, config inicial, resumo
2. Serviço `panel-tvbox` (NSSM) — uvicorn + env `PANEL_*` + PATH p/ ffmpeg/adb
3. Serviço `mediamtx` (NSSM) — MediaMTX + `mediamtx.generated.yml` sincronizada
4. Firewall LAN + flags (`-NoMediamtx`, `-AllowAdb`, `-SkipVenv`, `-RepoUrl`, `-Help`)

### Critical Pitfalls

1. Caminhos com espaço no NSSM → `C:\PanelTVBox` sem espaços + `AppParameters`
2. winget ausente → tentar com fallback manual claro (Python/Git)
3. PATH do serviço sem ffmpeg/adb → `AppEnvironmentExtra` (NUNCA `AppEnvironment` — substitui o ambiente do sistema)
4. Asset MediaMTX hardcoded → resolver via API GitHub
5. `.git` ausente no destino → `git pull` do UpdateManager quebra
6. Firewall sem escopo → exposição à Internet; ou perfil errado → inacessível
7. Config MediaMTX desatualizada no serviço → sincronizar via `PANEL_MEDIAMTX_CONFIG`
8. Docs/código Linux no caminho ativo → arquivar + simplificar + atualizar
9. Teste `test_platform_info_linux` quebra na refatoração → ajustar junto
10. Instalador não testável na dev → smoke-tests + UAT manual no cliente

## Implications for Roadmap

Fases propostas (granularidade coarse, MVP vertical — cada fase entrega capacidade ponta a ponta):

- **Fase 1 — Instalador Windows (Tarefa 1):** `deploy/install.ps1` + `instalar.bat` completos (downloads via API, venv, cópia com `.git`, NSSM com auto-restart, firewall LAN, config inicial) + smoke-tests (sintaxe, downloads, `node --check`, pytest verde).
- **Fase 2 — Refatoração Windows-only (Tarefa 2):** arquivar Linux em `deploy/legacy/`, simplificar `_platform_info`/`_platform_binary_name`/mensagem ffmpeg e `get_data_dir`, ajustar testes, remover menções Debian/systemd do caminho ativo.
- **Fase 3 — Documentação Windows (Tarefa 2 docs):** README, `docs/INSTALL.md`, `docs/LLM.md` atualizados (Windows, 111 testes, data dir, deploy/, flags).

Requisito Office permanece como contexto (transmissão da suíte Office viabilizada pela migração); implementação de captura fica fora de escopo desta fase (anti-feature em serviço Windows).

## Sources

- nssm.cc (usage: AppRestartDelay, AppEnvironmentExtra, restart throttling) — verificado 2026-08-06
- github.com/bluenviron/mediamtx/releases (asset `windows_amd64.zip`; v1.20.0 como referência; resolver latest via API) — verificado 2026-08-06
- gyan.dev/ffmpeg/builds (essentials; Windows 10+; `ffmpeg-release-essentials.zip`) — verificado 2026-08-06
- uvicorn.dev/settings (CLI args; workers) — verificado 2026-08-06
- HANDOFF.md §2-§6 (decisões: NSSM Opção A, binários via install.ps1, C:\PanelTVBox com .git, data dir, flags) — fonte primária do projeto
- docs/LLM.md, README.md, config/*.yml.example, deploy/install.sh (lógica a espelhar) — inspeção do codebase

---

*Research summary: 2026-08-06*
