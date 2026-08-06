# Roadmap: Painel TV Box

## Overview

O Painel TV Box (FastAPI + JS puro) gerencia TV Boxes Android na rede local: streams RTSP via MediaMTX, watchdog com recuperação em cascata, heartbeat device→servidor, dashboard via WebSocket e validações de segurança — tudo já validado (111 testes pytest, Fases A–D completas). Este milestone entrega a **migração de operação de Debian 13 para Windows 10+**: o cliente precisa transmitir a suíte Office para as TVs, o que o stack Linux (painel + OBS) não faz bem. A jornada é: (1) instalar o painel no Windows com duplo clique (`instalar.bat` → `deploy/install.ps1`), rodando painel e MediaMTX como serviços NSSM com auto-restart e firewall restrito à LAN; (2) limpar o caminho Linux (arquivar em `deploy/legacy/` e simplificar o código para Windows-only); (3) documentar o estado Windows-only (README, docs/INSTALL.md, docs/LLM.md). O requisito Office permanece como contexto viabilizado pela migração — captura de apps Office pelo painel é anti-feature (serviço Windows sem desktop) e fica fora de escopo.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Instalador Windows** - Duplo clique instala painel + MediaMTX como serviços NSSM (auto-restart) com firewall só LAN
- [ ] **Phase 2: Refatoração Windows-only** - Linux arquivado em `deploy/legacy/`, código simplificado, testes ajustados
- [ ] **Phase 3: Documentação Windows** - README, docs/INSTALL.md e docs/LLM.md atualizados para Windows-only

## Phase Details

### Phase 1: Instalador Windows
**Goal**: O cliente instala o painel no Windows com duplo clique e ele roda como serviço estável, acessível na LAN
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, SVC-01, SVC-02, SVC-03, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. Usuário dá duplo clique em `instalar.bat` em Windows 10+ e a instalação completa sozinha: ffmpeg, ADB, MediaMTX e NSSM baixados automaticamente (sem winget), código copiado para `C:\PanelTVBox` preservando `.git`, venv criada com dependências e configs iniciais sincronizadas
  2. Painel (uvicorn) e MediaMTX rodam como serviços Windows via NSSM com auto-restart — interromper o processo de qualquer um dos dois o traz de volta automaticamente, sem intervenção manual
  3. Ações do painel que dependem de ffmpeg/ADB (screenshot, shell remoto, instalar APK) funcionam a partir do serviço em execução (PATH e env `PANEL_*` disponíveis via `AppEnvironmentExtra`)
  4. Streams RTSP reproduzem via MediaMTX com a config gerada pelo painel (`PANEL_MEDIAMTX_CONFIG`) — o path de um device abre em VLC/MPV
  5. Painel acessível de outra máquina Windows da LAN em `http://<host>:8080` (firewall `LocalSubnet` para 8080/8554/1935/9997); porta ADB 5555 permanece fechada a menos que a instalação tenha usado `-AllowAdb`
**Plans**: TBD

### Phase 2: Refatoração Windows-only
**Goal**: O caminho ativo do projeto é 100% Windows-only — Linux arquivado sem rastro, código e testes ajustados
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. `deploy/` no caminho ativo contém apenas artefatos Windows — `install.sh`, `panel.service` e `mediamtx.service` arquivados em `deploy/legacy/`, com referências apontando para lá ou removidas
  2. `app/` não contém ramos Linux-only — `_platform_info`/`_platform_binary_name`/mensagem ffmpeg em `app/managers/scrcpy.py` e `get_data_dir` em `app/utils/system.py` simplificados para Windows-only
  3. `pytest` roda verde com 111+ testes (incluindo `test_platform_info_linux` ajustado) e `node --check` passa em todos os módulos JS
  4. Busca por referências Debian/systemd no código ativo (`app/`, `deploy/` fora de `deploy/legacy/`) não retorna resultados
**Plans**: TBD

### Phase 3: Documentação Windows
**Goal**: A documentação reflete o estado Windows-only — um usuário não-técnico instala o painel seguindo o guia
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. `README.md` apresenta o projeto como Windows 10+-only — instalação, execução e arquitetura sem Debian/systemd no caminho ativo
  2. Um usuário não-técnico instala o painel em um Windows 10+ limpo seguindo apenas `docs/INSTALL.md` — do duplo clique ao painel acessível na LAN
  3. `docs/LLM.md` reflete o estado atual: Windows-only, data dir `%LOCALAPPDATA%\PanelTVBox`, layout de `deploy/` (install.ps1 + legacy/), 111+ testes pytest e flags do instalador (`-NoMediamtx`, `-AllowAdb`, `-SkipVenv`, `-RepoUrl`, `-Help`)
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Instalador Windows | 0/0 | Not started | - |
| 2. Refatoração Windows-only | 0/0 | Not started | - |
| 3. Documentação Windows | 0/0 | Not started | - |
