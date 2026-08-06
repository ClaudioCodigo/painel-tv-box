# Registro de Implementação — UI Redesign + Fases A e B

> **Atualizado em:** 2026-08-03 · **Escopo:** redesign monocromático (spec `06`) + remodelagem UX (spec `08`, fases A e B) + heartbeat (spec `09`) + **Rodada 2** (deploy Debian 13, backup em data dir, threads, segurança restante). Estado real do código; docs `07` (plano) e `08` (spec) são os contratos.
>
> **Rodada 3 (refatoração Windows-only):** Linux descartado pelo cliente — painel roda **somente em Windows 10+**. `deploy/install.ps1` + `instalar.bat` (instalação por duplo clique, serviços NSSM, firewall LAN), deploy Linux arquivado em `deploy/legacy/`, código simplificado (`scrcpy` win64-only, `get_data_dir` só Windows), docs README/INSTALL/LLM reescritos. Ver `.planning/ROADMAP.md` e `.planning/phases/01-instalador-windows/`.

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

---

## 7. Rodada 2 (2026-08-03) — deploy, threads, backup, segurança

Detalhe completo (com severidades e verificação): `docs/AUDITORIA.md` → "Rodada 2".

| Área | O que foi feito |
|---|---|
| **Deploy Debian 13** | `deploy/install.sh` reescrito: usuários não-root (`panel`, `mediamtx`), `PANEL_DATA_DIR=/var/lib/panel-tvbox`, firewall restrito à LAN (`--lan`, `--allow-adb`), MediaMTX baixado do GitHub, hardening systemd, rsync sem `--delete`; `pyproject` com `[build-system]` (pip install . funciona) |
| **Backup em data dir** | `app/utils/system.py → get_data_dir()`: Windows `%LOCALAPPDATA%\PanelTVBox`, Linux `/var/lib/panel-tvbox` (env `PANEL_DATA_DIR`), macOS app support. Backups/screenshots/apks **fora do repo** — git não mistura dados de máquinas |
| **Threads/stutter** | `asyncio.to_thread` no I/O pesado (logs search/tail/sources/download, backup export/import, scrcpy extração, APK escrita); `psutil.cpu_percent(interval=None)` não bloqueia |
| **Segurança** | `shlex.quote` no player + `"$EXTRA"` no script (injeção de comando); package validado no uninstall; SSRF bloqueado (wizard IP, mediamtx api_url, scrcpy rtmp_url — incluindo link-local 169.254); uploads limitados (APK 200MB, ZIP 50MB) |
| **Verificação** | `pytest` 70 ✅ · `bash -n install.sh` ✅ · backup em `%LOCALAPPDATA%` ✅ · SSRF 400 ✅ · uninstall 400/200 ✅ · `pip install .` exit 0 ✅ |

## 8. Fases C e D (2026-08-03) — Grupos/MediaMTX + polimento (com testes)

Detalhe por seção: `docs/08-UX-CHANGE-SPEC.md` (marcado implementado). Estado: **Fases A–D completas**.

| Área | O que foi feito |
|---|---|
| **C1 Página de grupo** | `static/js/group.js` (novo): rota `#/group/{id}` real — contadores, ações coletivas (start/stop/reboot), cards V2 por device, refresh 15s, destroy; substitui o placeholder "em breve" |
| **C2 Cards de grupo** | Contadores de status (online/degradado/offline) por grupo; nome clicável → página do grupo |
| **C3 MediaMTX** | Contador "N paths · M ativas"; status do serviço e paths com forma (Fase A) |
| **D1 Logs** | Chips de nível (INFO/WARNING/ERROR); timestamps relativos (`UI.timeAgo`) com absoluto no title; toggle auto-refresh + destroy (Fase A) |
| **D2 Shell** | Prompt `device@painel$`; Reverse Ping substituído por "Heartbeat status"; histórico ↑/↓ já existia |
| **D3 scrcpy** | Badge de sessão (Parado/Espelhando); versão ativa destacada; confirmações em ativar/remover |
| **D4 Backup** | Datas relativas + tamanhos formatados; restore com resumo (pre-backup/escopo); empty state com ícone |
| **D5 Settings** | Seletor de tema explícito (Escuro/Claro/Sistema); server info com uptime + nº devices |
| **D6 Wizard** | Progresso com steps numerados (círculos 1..10 + nome do passo) |
| **Testes** | **+24 testes** (94 total): heartbeat endpoint, validadores de segurança (incl. link-local), injeção no player, backup (data dir/zip-slip), health ADB-light, API de grupos |

**Nota ADB×scrcpy:** regra §3.3 aplicada — heartbeat fresco ou scrcpy ativo → zero ADB automático. As **ações ADB manuais durante espelhamento** (start/stop, reboot, shell, APK) ainda NÃO têm o bloqueio 409 + "Parar scrcpy" da §4.4b — pendente de decisão (ver próxima sessão).

## 9. ADB × scrcpy — Ideias 3 e 4 implementadas (2026-08-03)

Solução para o problema "qualquer comando ADB derruba o scrcpy" (o gatilho era o healthcheck disparando ADB sozinho — já corrigido: watchdog pula ADB quando scrcpy ativo ou heartbeat fresco). Detalhes: `docs/09-HEARTBEAT-SPEC.md` §4.4c–4.4e.

| Ideia | Status | Entrega |
|---|---|---|
| **3 — Comandos via heartbeat** | ✅ | `POST /api/devices/{id}/command` (fila) → `GET /api/heartbeat/{id}/commands` (linhas `id<TAB>cmd`) → device executa localmente (`sh -c`, atualizado no `heartbeat.sh`) → `POST /result`. Módulo `app/services/command_queue.py`. Zero ADB painel→device |
| **4 — Servidor ADB isolado** | ✅ | `adb.server_port` (5038) no config → propagado para env → `ADBManager` injeta `ADB_SERVER_PORT`; scrcpy spawnado com env sem a porta (5037). Testado: `ADBManager().server_port == 5038` |
| **1 — Bloqueio 409** | 🟡 | Frontend `UI.confirmStopScrcpy` pronto e ligado; backend 409 pendente (menos crítico com 3+4) |

**Verificação:** fluxo validado ao vivo (enqueue → pull `am force-stop org.videolan.vlc` → result 200); `pytest` **100 passed** (+6 testes: fila de comandos, heartbeat commands/result, isolamento ADB).

## 10. Diagnóstico real ADB×scrcpy + correções (2026-08-03, com os TV boxes no ar)

Problema do usuário: scrcpy caía ~30s após iniciar; o painel continuava disparando ADB a cada ~15s. Diagnóstico e correções aplicadas:

| Achado | Correção |
|---|---|
| **`last_heartbeat=None`** — o `heartbeat.sh` não rodava: (a) o device **não tem curl/wget** (só `nc`/`toybox`, SDK 29); (b) o processo em background **morria ao fechar o `adb shell`**; (c) o `heartbeat.conf` tinha **CRLF** (temp file em modo texto no Windows → `INTERVAL=20\r` → `sleep: Unknown suffix`) | `heartbeat.sh` reescrito: HTTP via **`nc`** (parse de URL + headers), **`setsid sh "$0" _loop`** (sobrevive ao shell), conf escrito em **modo binário** (sem CRLF) |
| **Painel continuava com ADB mesmo sem scrcpy** — watchdog + página do device (`/status` a cada 15s) sondavam ADB | **Liveness por ICMP ping** no `health.check`: ping OK (ou heartbeat fresco, ou scrcpy ativo) → **zero ADB**. ICMP não é ADB → não derruba o scrcpy, mesmo com scrcpy externo |
| **`/api/devices/{id}/status` sempre via ADB** | Short-circuit ADB-light: scrcpy ativo OU heartbeat fresco → status derivado do estado (`source: heartbeat\|scrcpy`), sem ADB; refresh da página do device 15s→30s |
| Servidor ADB isolado (Ideia 4) | `adb.server_port: 5038` propagado do config para a env (`PANEL_ADB_SERVER_PORT`) |

**Verificação ao vivo:** após re-provision, `last_heartbeat` atualizando a cada ~20s nos 2 devices; **nenhum novo `ADB connected`** no log (watchdog pulando); `pytest` 104 ✅.

## 11. Recuperação de stream em degraded + toggle (2026-08-03)

**Problema:** player crashava mas o device ficava online → status `degraded` ("Sem stream ativa"/"Player offline") → o watchdog só agia em `offline`, então a stream nunca voltava.

**Solução implementada:**
- **Recuperação em degraded** (`watchdog.py` + `recovery.py`): se o motivo é stream/player E `device.recovery_enabled` → roda **só `player_retry`** (reabrir player, com cooldown 2min), sem wifi/reboot (device está online).
- **ADB-safe** (`RecoveryService._reopen_stream`): scrcpy ativo **ou** heartbeat fresco → enfileira via **canal de comandos** (device executa localmente, zero ADB → não derruba o scrcpy); senão → ADB direto (fallback).
- **Toggle por device** `recovery_enabled` (persistido no YAML, default true): UI na aba Stream da página do device — desativa a recuperação automática da stream (para streams fechadas de propósito, sem spam).
- `offline` → cascata completa continua como antes (wifi → eth → reboot).

**Testes:** +5 (stream_only não escala p/ wifi/reboot; heartbeat fresco → enfileira sem ADB; fallback ADB; `_is_stream_issue`) → **109 passed**.

## 12. scrcpy headless + streaming sem `--record=-` (2026-08-03)

Upstream: scrcpy 3.3+ removeu `--record=-` (stdout) e o mirroring exige DISPLAY. Correções:
- **`start_streaming` reescrito**: `adb exec-out screenrecord --output-format=h264 - | ffmpeg → RTMP → MediaMTX` — sem scrcpy, funciona headless. Sessões rastreadas em `_streams` (stop mata adb+ffmpeg). NOTA: screenrecord encerra em ~180s (limite AOSP) — documentado.
- **`start_mirroring`**: guarda `_is_headless()` — em servidor sem tela retorna erro claro apontando para o Streaming.
- **UI (scrcpy.js)**: botão "Streaming (sem tela)" + mostra a URL RTSP; hint de headless no card.
