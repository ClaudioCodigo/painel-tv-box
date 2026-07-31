# Registro de Implementação — UI Redesign + Fases A e B

> **Atualizado em:** 2026-07-31 · **Escopo:** redesign monocromático (spec `06`) + remodelagem UX (spec `08`, fases A e B) + heartbeat (spec `09`). Estado real do código; docs `07` (plano) e `08` (spec) são os contratos.

---

## 1. Redesign monocromático (spec `docs/06-UI-REDESIGN-SPEC.md`) — ✅ completo

- `static/css/tokens.css` — escala de cinza + tokens semânticos por tema (dark/light) + movimento.
- `static/js/theme.js` + script anti-flash no `base.html` — `data-theme`, `localStorage['panel_theme']`, sync entre abas.
- `base.css` / `layout.css` / `components.css` / `motion.css` + `pages/*.css` (12 páginas) — substituíram os 12 CSS antigos.
- `static/js/icons.js` (catálogo SVG) + `UI.icon`/`statusIcon` monocromáticos; emojis do chrome removidos.
- View transitions no router + `prefers-reduced-motion` respeitado; skeletons nos carregamentos.

## 2. Fase A — Transversais P0 (spec `08`) — ✅ completo

| Item | O que foi feito |
|---|---|
| **A1 Feed de eventos** | Dashboard "Eventos" ao vivo via WS (`health`/`recovery`/`alert`); ~30 itens; botões Baixar log (watchdog.log) / Ver logs / Limpar; `aria-live` |
| **A2 Header status** | `#header-status` vivo: servidor (health a cada 30s) + WS conectado/offline |
| **A3 Toolbar dashboard** | Contadores + busca nome/IP + filtro grupo + sort (nome/IP/status), filtro em memória |
| **A4 Leaks** | `destroy()` em logs (com guarda anti-race + toggle auto-refresh), mediamtx e device; router limpa na troca de rota |
| **A5 Helpers** | `UI.timeAgo`, `UI.stateView`/`bindStateRetry`, `UI.toolbarCounters`, `UI.groupChip`, `UI.statusBar` |
| **T4 Grupo real** | Chips e linhas "Grupo" com nome real (id→name) e link para `#/group/{id}` |

## 3. Fase B — Dispositivos + Heartbeat (specs `08` + `09`) — ✅ completo

### Backend
| Item | O que foi feito |
|---|---|
| **B2 Campos mortos** | `DeviceState` sem `last_fail`, `last_recovery`, `uptime_seconds`, `recovery_count` (documentado no `LLM.md` §5) |
| **B4 Activity real** | `/api/devices/{id}/status` busca a activity em foco via `dumpsys` (mantém a do heartbeat se scrcpy ativo) |
| **B6 Heartbeat** | `security.heartbeat_key` auto-gerada; `POST /api/heartbeat/{id}` (chave dedicada, rate limit 5s, grava `last_heartbeat`+activity sem ADB); `watchdog.yml → heartbeat_timeout` (60s) |
| **Watchdog ADB-light** | `health.py`: heartbeat fresco **ou** scrcpy ativo → **zero ADB** no device (regra §3.3); fallback ADB quando heartbeat expira sem scrcpy |
| **Provision** | `scripts/android/heartbeat.sh` + `heartbeat.conf` (URL+id+key+20s) enviados e iniciados no device |

### Frontend
| Item | O que foi feito |
|---|---|
| **B1 Dispositivos V2** | Status bar (forma+rótulo+reason), frescura (max last_seen/heartbeat), chip de grupo real, toolbar (contadores+busca+filtro+sort), WS em tempo real, clique no card → detalhe |
| **B2 Device com Tabs** | Visão geral (rede, config stream, linha de vida) · Stream (activity real + controle) · Apps · Shell · Screenshots — carregamento lazy |
| **Acesso** | Dashboard: título do card é link para `#/device/{id}` (rota antes inalcançável por clique) |

## 4. Verificação (Fases A e B)

- ✅ `pytest` — **70 passed** em todas as fases
- ✅ `node --check static/js/*.js` — **19 arquivos OK**
- ✅ Heartbeat validado ao vivo: **204** válido / **401** chave errada / **404** id inexistente / **429** spam; `state.last_heartbeat` + `current_activity` gravados
- ✅ Payload `/api/devices` sem campos mortos; `last_heartbeat` presente
- ✅ Paleta CSS 100% escala de cinza (13 hex neutros)
- ✅ Cache-busting `?v=20`; servidor reiniciado e respondendo

## 5. Pendente (próximas fases do plano `07`)

- **Fase C — Grupos + MediaMTX:** página de grupo real (rota `#/group/{id}` ainda placeholder "em breve"), resumos de status por grupo, MediaMTX com status do serviço e paths com forma.
- **Fase D — Polimento:** Logs (chips de nível), Shell (histórico ↑/↓), scrcpy (badge de sessão + bloqueio ADB quando espelhando — regra §3.3 no frontend), Backup (datas/tamanhos legíveis), Settings (seletor de tema explícito, server info), Wizard (steps numerados).
- **Dívidas técnicas** (ver `LLM.md` §11): injeção de comando no shell do device, watchdog dinâmico, `mediamtx.generated.yml` no CRUD, I/O síncrono em async, SSRF, firewall do deploy.

## 6. Como o heartbeat resolve o conflito ADB × scrcpy (resumo)

O healthcheck **não sonda mais ADB** enquanto o device está "vivo" (heartbeat fresco ou scrcpy ativo). O scrcpy fica com o ADB livre; a observabilidade vem de 3 fontes sem ADB: **heartbeat HTTP** (rede) + **MediaMTX API** (stream) + **estado do scrcpy** (sessão). Detalhes e a regra de bloqueio de ações ADB durante espelhamento: `docs/09-HEARTBEAT-SPEC.md` §3.3.
