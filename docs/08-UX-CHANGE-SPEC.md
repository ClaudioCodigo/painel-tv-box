# Spec de Alterações UX/UI — Painel TV Box
## Esboço detalhado para revisão (Fases A–D do `docs/07-UX-REMODEL-PLAN.md`)

> **Status:** ✅ Fases A, B, C e D **implementadas** (ver `docs/10-IMPLEMENTACAO.md`). Ressalva: o item D3 "bloqueio 409 + Parar scrcpy" (§3.3/§4.4b) está documentado e aguarda a decisão de arquitetura ADB×scrcpy (Ideias 1–4 apresentadas). **Data:** 2026-08-03 · **Base:** `06-UI-REDESIGN-SPEC.md` (design system) + plano `07-UX-REMODEL-PLAN.md` + pesquisa de cards.
>
> **Como revisar:** leia e aponte ajustes — vou atualizar este doc e só então implementamos em sequência (A→B→C→D). Decisões abertas estão marcadas com **[AJUSTE]**.

---

## 0. Vocabulário visual compartilhado

- **Status bar V2** (reutilizada em cards e páginas): `[forma] RÓTULO [reason truncado]` — forma = preenchido(online)/tracejado(degraded)/com-linha(warning)/vazio+X(offline)/cinza(unknown); rótulo textual sempre presente; reason só quando anômalo.
- **Frescura:** "visto há Ns/min/h/d" via `UI.timeAgo(ts)` (novo helper). Nenhum dado em tempo real sem frescura.
- **Chip de grupo:** `[nome do grupo]` (resolvido via `GET /groups`, id→name), clicável → página do grupo.
- **`UI.stateView(kind, msg, onRetry)`** (novo helper): empty/error padronizado (ícone grande stroke + título + ação retry quando aplicável).
- **`UI.timeAgo(ts)`** (novo helper): timestamp relativo + `title` com absoluto.
- Toolbar de gestão: contadores + busca + filtro + sort — sempre acima da coleção.

---

# FASE A — Transversais P0

## A1. Dashboard — feed de eventos ao vivo
**Hoje:** `#event-list` é placeholder morto ("Aguardando...").

**Estrutura:**
```
EVENTOS (section-title + botão limpar)
┌──────────────────────────────────────┐
│ ● qa → OFFLINE · Desconectado · 2min │   ← health (mudança de status)
│ ↻ tv-box-adm-01 → player_retry 3min  │   ← recovery (evento da cascata)
│ ! samsung → alerta crítico · 10min   │   ← alert (recuperação falhou)
└──────────────────────────────────────┘
```
**Comportamento:**
- Escuta WS `health` (só mudanças de status), `recovery` (evento da cascata), `alert`.
- **Sem persistência** (feed = recentes apenas, ~30 itens no topo); botão "Limpar"; item com ícone por tipo (mudança de status = forma do status; recovery = refresh; alert = alert), device id, mensagem curta, `UI.timeAgo`.
- **Log em texto para debug posterior** (decisão do usuário): botão "Baixar log" → `GET /api/logs/download?source=watchdog` (os eventos já são gravados em `logs/watchdog.log` pelo backend) e link "Ver logs" → rota `/logs` filtrada por `source=watchdog`.
- `aria-live="polite"` no container (anúncio discreto).

## A2. Header — status vivo
**Hoje:** `#header-status` morto.

**Estrutura:** `[dot] Servidor OK · WS conectado` / `[dot tracejado] Servidor OK · WS offline`.

**Comportamento:** dot+texto via `ws.js` eventos `connected`/`disconnected`; texto do servidor de `GET /api/system/health` (1x no boot + re-check a cada 30s). Tooltip com versão.

## A3. Dashboard — toolbar de gestão
**Hoje:** nenhuma.

**Estrutura:**
```
[ 12 total | 8 online | 2 degradado | 2 offline ]   ← contadores (chips)
[ 🔍 busca nome/IP ] [ filtro: todos os grupos ▾ ] [ sort: nome ▾ ]
```
**Comportamento:** filtra o grid em memória (sem nova chamada); **sort por nome/IP/status** (decisão do usuário: incluir); contadores derivados do payload `/devices`.

## A4. Leaks e destrutores
**Hoje:** logs (5s), mediamtx (10s), devices (15s), dashboard (15s) criam `setInterval`; `destroy()` incompleto/inexistente.

**Proposta:** todos os módulos expõem `destroy()` que limpa intervalos e (futuro) listeners; `app.js` já chama `destroy()` na troca de rota. Corrigir race no logs (guarda de requisição em andamento).

## A5. Helpers novos (`components.js` → `UI`)
- `UI.timeAgo(ts)` · `UI.stateView(kind, msg, onRetry)` · `UI.toolbarCounters(devices)` · `UI.groupChip(name)`.
- Nome real do grupo nos chips do dashboard (mapa id→name via `GET /groups`).

---

# FASE B — Dispositivos

## B1. Página Dispositivos (gestão) — padrão V2
**Hoje:** card com badge por classe; sem reason/frescura/WS/toolbar.

**Estrutura (card):**
```
┌────────────────────────────────────────┐
│ ◉ nome                    [grupo]  ⋮  │
│ ● ONLINE · reason truncado            │   ← status bar compacta (forma+rótulo+reason)
│ IP 192.168.254.102 · vlc · há 12s     │   ← meta + frescura
│ [✏️] [📂] [🗑️]                        │   ← ações (ícones + tooltip)
└────────────────────────────────────────┘
```
**Toolbar:** mesma do dashboard (contadores + busca + filtro grupo + sort).
**Comportamento:** `WS.on('health')` atualiza status bar + frescura em tempo real; refresh 15s mantido com destroy; empty state com ícone + CTA "Novo TV Box".

## B2. Página do device — Tabs
**Hoje:** tudo empilhado; `current_activity` genérico; sem frescura/última recuperação.

**Estrutura:**
```
┌────────────────────────────────────────────┐
│ ◉ Nome                       [grupo]  ⋮   │
│ ● ONLINE · Stream ativa ✅ · visto há 8s   │   ← status bar V2 + frescura
│────────────────────────────────────────────│
│ [ Visão geral | Stream | Apps | Shell | Screenshots ]   ← tabs
│────────────────────────────────────────────│
│ (conteúdo da aba ativa)                    │
└────────────────────────────────────────────┘
```
**Tabs:** (decisão do usuário: manter a proposta de tabs)
- **Visão geral:** meta completa (IP, MAC, porta ADB, local, grupo, player, root, path RTSP, notas) + linha de vida (última recuperação, reboot count) + schedule se houver.
- **Stream:** status do stream (readers/tracks via MediaMTX), ações start/stop, player atual (`current_activity` real), extra args.
- **Apps:** lista de apps (atual) com busca.
- **Shell:** terminal (mesmo componente do shell page, mas restrito ao device).
- **Screenshots:** galeria de screenshots capturadas (thumbnails + abrir).

**Estados:** skeleton por aba; erro com retry; "sem dados" com ícone.
**Backend (B2/B4/B6):** remover campos mortos do `DeviceState` (decisão do usuário — documentar no `docs/LLM.md` caso precise readicionar); preencher `current_activity` real no `/status`; a atividade em foco também chega passivamente via **heartbeat** (ver `docs/09-HEARTBEAT-SPEC.md`).

---

# FASE C — Grupos + MediaMTX

## C1. Página do grupo (substitui "em breve")
**Hoje:** `/group/{id}` renderiza placeholder.

**Estrutura:**
```
[voltar] GRUPO: Administração · descrição
[ 4 devices | 3 online | 1 degradado ]   ← contadores
[ ▶ Start todos ] [ ⏹ Stop todos ] [ 🔄 Reboot ]   ← ações coletivas
┌────────────────────────────────────────┐
│ ◉ device 1          ● ONLINE · há 5s   │   ← cards V2 compactos
│ ◉ device 2          ● DEGRADADO · ... │
└────────────────────────────────────────┘
```
**Comportamento:** rota `#/group/{id}` renderiza via `GET /groups/{id}` + `GET /devices` filtrado; ações coletivas confirmam (reboot) e reportam resultado por device (toast); chip de grupo em qualquer card navega para cá.

## C2. Cards de grupo — resumos
**Hoje:** só count. **Proposta:** chips de contadores (online/degradado/offline) por grupo, com forma; expandir/collapse dos devices do grupo (hoje sempre visível).

## C3. MediaMTX
**Estrutura:**
```
[ ● Serviço OK · api 9997 · rtsp 8554 ]   ← status do serviço (health)
PATHS (toolbar: contagem + refresh)
┌─────────────┬────────┬────────┬─────────┐
│ path        │ estado │ readers│  tracks │   ← estado com forma (ready/offline)
│ QA          │ ● OK   │  1     │  1      │
└─────────────┴────────┴────────┴─────────┘
```
**Comportamento:** guarda no refresh (10s, sem overlap), destroy(); empty/erro com `UI.stateView`; path clicável → detalhe (readers/tracks, bytes, source).

---

# FASE D — Polimento

## D1. Logs
- Chips de nível (INFO/WARN/ERROR) clicáveis; botão "limpar filtros".
- Guarda de refresh + `destroy()`; toggle auto-refresh (pausa/retoma).
- Timestamps relativos (`UI.timeAgo`) com absoluto no title; zebra/hover mantidos.

## D2. Shell
- Histórico de comandos ↑/↓ da sessão.
- Prompt `device@painel$` + dot de conexão (WS/shell conectado?).
- **"Reverse Ping" substituído pelo heartbeat** — ver `docs/09-HEARTBEAT-SPEC.md` (o modelo antigo era ICMP unidirecional que o servidor não consome; a observação do usuário está detalhada lá).

## D3. scrcpy
- Badge de estado da sessão (parado / espelhando / streamando) com forma.
- Versão ativa destacada (pill invertida); confirmação para delete/rollback.
- **Regra ADB × scrcpy (§3.3 do `docs/09-HEARTBEAT-SPEC.md`):** enquanto espelhando, ações ADB no device são bloqueadas com aviso + opção "Parar scrcpy e continuar"; destrutivas exigem parar antes. Frontend mostra o aviso a partir do `409 { error: adb_busy_scrcpy }`.

## D4. Backup
- `UI.timeAgo` + tamanho formatado (KB/MB).
- Restore: modal com resumo (arquivos + pre-backup) antes de confirmar.
- Empty state com ícone.

## D5. Settings
- Seletor de tema explícito (Escuro/Claro/Sistema) — radio via `THEME` (hoje botão que cicla).
- Update: linha com branch/commit atual + resultado do apply legível.
- Server info: tabela (uptime real, disco, versão, nº devices).

## D6. Wizard
- Progresso com indicadores numerados (1·2·3·4·5·6·7) em vez de barra só.
- Validação inline por campo (estado erro no campo + mensagem).
- Teste de conexão com estados (testando/ok/falha + motivo).

---

# Backend (mínimo)

| # | Mudança | Risco | Status |
|---|---|---|---|
| B1 | `reason` no topo do evento WS `health` | Baixo | ✅ feito |
| B2 | **Remover** campos mortos do `DeviceState`: `last_fail`, `last_recovery`, `uptime_seconds`, `recovery_count` (documentado no `docs/LLM.md`) | Baixo | a fazer (Fase B) |
| B4 | `current_activity` real no `/status` (dumpsys activity top) — também via heartbeat | Baixo | a fazer (Fase B) |
| B5 | ~~rotate token~~ — **fora desta rodada** (decisão do usuário) | — | ❌ adiado |
| B6 | **Heartbeat device→servidor** (substitui reverse_ping) — ver `docs/09-HEARTBEAT-SPEC.md` | Médio | a fazer (Fase B) |

---

# Ordem de entrega e critérios de aceite

- Implementar **A → B → C → D** em sequência; cada fase: `node --check` + `pytest -q` verdes, revisão claro+escuro, sem hex cromático novo, cache-busting `?v=` incrementado, `docs/LLM.md` sincronizado.
- **Critérios:** glanceable em ≤1s; frescura em todo dado em tempo real; zero leak de intervalo; estados completos; a11y (`aria-live`, foco, teclado).

---

# Decisões abertas — RESOLVIDAS

1. **Feed de eventos:** ❌ não reter/persistir; ✅ gerar **log em texto** para debug posterior (botão baixar `watchdog.log`).
2. **Toolbar do dashboard:** ✅ incluir **sort** (nome/IP/status) além de busca + filtro de grupo.
3. **Página do device:** ✅ manter a proposta de **Tabs**.
4. **Campos mortos:** ✅ **remover** do model (`last_fail`, `last_recovery`, `uptime_seconds`, `recovery_count`) e documentar no `docs/LLM.md` caso precise readicionar.
5. **B5 rotate token:** ❌ **fora desta rodada**.
6. **Reverse Ping:** ⚠️ é uma **má interpretação do modelo original** — substituir por **heartbeat HTTP device→servidor** (`docs/09-HEARTBEAT-SPEC.md`).

---

## Observação do usuário (transcrita)

> Sobre o reverse ping: a ideia original é mitigar um problema onde não se consegue manter a leitura da conexão do TV BOX usando ADB e o scrcpy ao mesmo tempo — o scrcpy não abre ou cai quando executado ou spammado por ADB (vide o healthcheck que vê se o dispositivo está online). A solução pensada foi um script enviado ao TV box via ADB que executa em loop com cooldown para fazer um ping até o servidor; o servidor receberia e saberia que o TV box está na rede.

> **Resposta:** o heartbeat HTTP (docs/09) resolve exatamente esse objetivo, com a diferença de que o servidor **realmente recebe** a batida (o `reverse_ping.sh` atual faz ICMP unidirecional que o servidor não consome) e o healthcheck deixa de spammar ADB (causa do conflito com o scrcpy).
