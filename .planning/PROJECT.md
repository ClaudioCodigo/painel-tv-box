# Painel TV Box

## What This Is

Painel web (FastAPI + JS puro) para **gerenciar e monitorar TV Boxes Android** que reproduzem streams RTSP via MediaMTX: controle pela rede (streams, reboot, shell, screenshot, APK), watchdog com recuperação automática, heartbeat device→servidor e grupos. Está migrando de Debian 13 para **rodar somente em Windows 10+** — o cliente precisa transmitir a suíte Office para as TVs, o que não funciona bem no stack Linux (painel + OBS); a migração para Windows é o que viabiliza esse objetivo.

## Core Value

O painel precisa **manter os TV Boxes transmitindo de forma confiável e acessível na rede local** — abrir/fechar streams e recuperar quedas sozinho, agora rodando como **serviço Windows estável** (auto-restart) em vez de scripts Linux.

## Requirements

### Validated

- ✓ Gerenciamento de TV Boxes Android (CRUD, provision, shell remoto, reboot, screenshot, APK) — existente (`app/`, 111 testes pytest passando)
- ✓ Streaming RTSP via MediaMTX: paths por device (`source: publisher`), player VLC/MPV via intent ADB — existente
- ✓ Watchdog com recuperação em cascata (player retry → Wi-Fi → Ethernet → reboot) — existente
- ✓ Heartbeat device→servidor (zero ADB) com chave dedicada — existente
- ✓ Regra ADB×scrcpy: painel não derruba scrcpy (servidor ADB isolado porta 5038) — existente
- ✓ Dashboard tempo real via WebSocket + SPA monocromática (sem CDN/build) — existente
- ✓ Autenticação por token + validações de segurança (anti-SSRF, anti-injeção, anti-path-traversal) — existente
- ✓ Data dir fora do repositório (`PANEL_DATA_DIR` / `%LOCALAPPDATA%\PanelTVBox`) — existente

### Active

- [ ] **WIN-01**: Cliente instala o painel no Windows com um duplo clique (`instalar.bat` → `deploy/install.ps1`), sem depender de winget, baixando ffmpeg/ADB/MediaMTX/NSSM automaticamente
- [ ] **WIN-02**: Painel e MediaMTX rodam como serviços Windows via NSSM com auto-restart (serviço fica de pé a maior parte do tempo)
- [ ] **WIN-03**: Painel acessível às máquinas Windows da rede local (firewall libera só a LAN: 8080/8554/1935/9997)
- [ ] **WIN-04**: Deploy Linux removido do caminho principal — `install.sh`/systemd arquivados em `deploy/legacy/`
- [ ] **WIN-05**: Código simplificado para Windows-only (`_platform_info`/`_platform_binary_name`/mensagem ffmpeg em `scrcpy.py`, `get_data_dir`) com testes ajustados
- [ ] **WIN-06**: Documentação atualizada (README, docs/INSTALL.md, docs/LLM.md) — Windows, 111 testes, sem menções Debian/systemd no caminho ativo

### Out of Scope

- Captura de tela de apps Office pelo painel — o painel não faz captura; a transmissão da suíte Office é feita por apps externas (ex.: OBS/ffmpeg no Windows) e o painel continua gerenciando/distribuindo os streams como já faz
- Suporte a Linux/macOS em produção — descartado pelo cliente; só Windows 10+
- Novas funcionalidades de produto (ex.: integração Office dentro do painel) — esta fase é refatoração/robustez/migração, não features novas

## Context

- **Origem:** projeto real do cliente (rede 192.168.254.x, TV Boxes ADM). Documento de requisitos original: `IDEA.md`. Handoff da sessão anterior: `docs/HANDOFF.md`.
- **Estado atual:** `main` com 26+ commits, 111 testes pytest passando, Fases A–D do redesign completas. Frontend: 20 módulos JS validados com `node --check`.
- **Decisão da sessão anterior:** serviços Windows via **NSSM** (Opção A aprovada pelo usuário). Alternativas recusadas: Task Scheduler nativo, winSW, painel-gerencia-MediaMTX como subprocess.
- **Requisito do cliente (Office):** transmitir a suíte Office (PowerPoint/Excel) para as TVs; no Linux (painel + OBS) não funciona bem; a migração Windows-only é a resposta. Perguntas em aberto do HANDOFF §6 permanecem (qual app, janela vs fullscreen, áudio, simultaneidade) — não implementar antes de validar com o usuário (regra IDEA.md: não inventar requisitos).
- **Instalação alvo:** `C:\PanelTVBox` preservando `.git` (UpdateManager faz `git pull`); data dir `%LOCALAPPDATA%\PanelTVBox`; binários baixados pelo install.ps1 (zero fricção para cliente não-técnico).
- **Legado Linux:** `deploy/install.sh`, `panel.service`, `mediamtx.service` — usuário escolheu **arquivar em `deploy/legacy/`**. `scripts/android/*.sh` NÃO são Linux-server: rodam NOS TV Boxes e ficam.

## Constraints

- **Plataforma**: Windows 10+ somente — painel e MediaMTX como serviços NSSM com auto-restart — decisão do cliente
- **Compatibilidade**: binários baixados pelo install.ps1 (ffmpeg, platform-tools/ADB, MediaMTX, NSSM); não depender de winget (ausente em Windows 10 corporativos)
- **Stack**: Python 3.11+ / FastAPI / Pydantic v2 / YAML / JS puro sem CDN (manter)
- **Segurança**: firewall só LAN; ADB (5555) nunca aberto para o mundo; manter validações anti-SSRF/injeção existentes
- **Reprodutibilidade**: 111 testes pytest passando + `node --check` ao final de cada fase
- **Histórico**: docs históricos (AUDITORIA.md, specs, 10-IMPLEMENTACAO.md) não reescrever; arquivar Linux em vez de apagar sem rastro

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Windows-only (Linux descartado) | Cliente precisa transmitir suíte Office; Linux (painel+OBS) não atende | — Pending |
| Serviços via NSSM (Opção A) | Auto-restart de qualquer exe; alternativas recusadas (Task Scheduler, winSW, subprocess) | — Pending |
| Binários baixados pelo install.ps1 | Zero fricção p/ cliente não-técnico; não depender de winget | — Pending |
| Instalar em `C:\PanelTVBox` preservando `.git` | UpdateManager (`git pull`) precisa do `.git` no destino | — Pending |
| Data dir = `%LOCALAPPDATA%\PanelTVBox` | Default atual de `get_data_dir()`; fora do repo | — Pending |
| Launcher `instalar.bat` → `install.ps1 -ExecutionPolicy Bypass` | Duplo clique | — Pending |
| Deploy Linux arquivado em `deploy/legacy/` | Preserva histórico sem poluir o caminho ativo (escolha do usuário) | — Pending |
| Simplificar `_platform_info`/`get_data_dir` p/ Windows-only | Código morto de plataformas descartadas (escolha do usuário) | — Pending |
| Firewall só LAN (espelhar ufw do install.sh) | Painel acessível às máquinas da rede local, não à Internet | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-06 after initialization*
