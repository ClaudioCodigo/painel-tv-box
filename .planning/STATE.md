---
gsd_state_version: '1.0'
status: in_progress
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 0
  completed_plans: 0
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-06)

**Core value:** Manter os TV Boxes transmitindo de forma confiável e acessível na rede local — agora rodando como serviço Windows estável (auto-restart) em vez de scripts Linux.
**Current focus:** Fases 1-3 executadas (instalador Windows, refatoracao Windows-only, docs) — commit/push pendente

## Current Position

Phase: 1-3 of 3 (todas concluidas — instalador, refatoracao, docs)
Plan: executado (install.ps1 + instalar.bat + refactor + docs)
Status: Done - aguardando commit/push
Last activity: 2026-08-31 - Resolved debug scrcpy-link-invalido: URI normalizada e instalador online descartável

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: Serviços Windows via NSSM 2.24 (Opção A aprovada; recusados Task Scheduler, winSW, subprocess)
- [Init]: Binários baixados pelo install.ps1 (ffmpeg, ADB, MediaMTX, NSSM) — sem winget (ausente em Win10 corporativo)
- [Init]: Instalar em `C:\PanelTVBox` preservando `.git` (UpdateManager faz git pull no destino)
- [Init]: Data dir `%LOCALAPPDATA%\PanelTVBox`; launcher `instalar.bat` → `install.ps1 -ExecutionPolicy Bypass`
- [Init]: Deploy Linux arquivado em `deploy/legacy/`; firewall só LAN (espelhar ufw do install.sh)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: Instalador não é testável na máquina de dev (migração Windows) — mitigar com smoke-tests de sintaxe/downloads + UAT manual no cliente (research PITFALLS #10)
- [Phase 1]: Caminhos com espaço no NSSM — `C:\PanelTVBox` sem espaços + `AppParameters` (PITFALLS #1)
- [Phase 1]: `AppEnvironment` substituiria o ambiente do sistema — usar `AppEnvironmentExtra` (PITFALLS #3)

## Quick Tasks Completed

| Date | Task | Commit | Status |
|------|------|--------|--------|
| 2026-08-12 | Mitigar rede que não sobe no boot em TV boxes Allwinner (netwatch/restart_eth) | `a4f5a05` | complete |
| 2026-08-31 | Matrícula scrcpy com chave ADB por estação, token descartável e Magisk | `2f2a200` | Verified |
| 2026-08-31 | Cliente scrcpy instalado uma vez, Start pelo painel e revogação visual | `5ecd9a5` | Verified |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Out of scope | Captura de apps Office pelo painel (anti-feature em serviço Windows sem desktop) | Deferred | 2026-08-06 |
| Out of scope | Suporte Linux/macOS em produção (só Windows 10+) | Deferred | 2026-08-06 |
| Out of scope | `SERVICE_INTERACTIVE_PROCESS` (depreciado) e multi-worker uvicorn (quebra locks/estado) | Deferred | 2026-08-06 |

## Session Continuity

Last session: 2026-08-06 (discuss-phase 1)
Stopped at: Phase 1 context gathered — next é /gsd-plan-phase 1
Resume file: .planning/phases/01-instalador-windows/01-CONTEXT.md
