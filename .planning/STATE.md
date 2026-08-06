---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-06)

**Core value:** Manter os TV Boxes transmitindo de forma confiável e acessível na rede local — agora rodando como serviço Windows estável (auto-restart) em vez de scripts Linux.
**Current focus:** Phase 1 — Instalador Windows

## Current Position

Phase: 1 of 3 (Instalador Windows)
Plan: 0 of 0 in current phase (plans TBD — definidos no plan-phase)
Status: Ready to plan
Last activity: 2026-08-06 — ROADMAP.md criado (3 fases, 16/16 requisitos mapeados)

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

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Out of scope | Captura de apps Office pelo painel (anti-feature em serviço Windows sem desktop) | Deferred | 2026-08-06 |
| Out of scope | Suporte Linux/macOS em produção (só Windows 10+) | Deferred | 2026-08-06 |
| Out of scope | `SERVICE_INTERACTIVE_PROCESS` (depreciado) e multi-worker uvicorn (quebra locks/estado) | Deferred | 2026-08-06 |

## Session Continuity

Last session: 2026-08-06 (resume no OpenCode)
Stopped at: Inicialização GSD concluída (PROJECT/config/research/REQUIREMENTS/ROADMAP/STATE/AGENTS.md commitados); próxima etapa é /gsd-discuss-phase 1
Resume file: .planning/.continue-here.md (atualizado — next = discuss-phase 1)
