# Auditoria do Projeto — Painel TV Box

> **Data:** 2026-07-31 · **Escopo:** código-fonte completo (backend `app/`, frontend `static/`+`templates/`, testes `tests/`, config `config/`+`devices/`+`groups/`, deploy `deploy/`, docs `docs/`) · **Método:** 4 auditorias paralelas (segurança, qualidade backend, frontend, testes/config) com verificação manual dos achados críticos + suíte de testes + validação HTTP do servidor em execução.

---

## Resumo executivo

O painel é uma aplicação FastAPI + JS puro funcional e bem organizada, com **69 testes passando** e código limpo em vários pontos (subprocessos sem `shell=True`, `yaml.safe_load`, sem CDN/scripts inline, sem segredos em YAMLs de devices/groups). Porém, antes desta sessão, ele sofria de **ausência total de autenticação** e de **bugs de funcionamento críticos** que desativavam o monitoramento real dos TV Boxes (um cooldown ADB de 2h retornava "sucesso" sem executar nada).

Todos os achados críticos de funcionamento e a maior parte dos de segurança foram **corrigidos nesta sessão** (ver [Correções aplicadas](#-correções-aplicadas-nesta-sessão)). Restam riscos residuais de segurança (injeção de comando no shell do device, firewall abrindo portas, SSRF) e dívidas técnicas (I/O síncrono em endpoints async, watchdog estático) — listados em [Riscos residuais](#-riscos-residuais-e-recomendações).

---

## Achados por severidade

Legenda de status: ✅ corrigido · 🟡 parcial (corrigido em parte) · ❌ pendente

### 🔴 Críticos

| # | Status | Achado | Detalhe | Onde |
|---|---|---|---|---|
| 1 | ✅ | **Zero autenticação** em todos os endpoints (shell remoto, reboot, APK, backup/restore, update) | Implementado token compartilhado: `POST /api/auth/login`, header `Authorization: Bearer` ou `?token=`, proteção em todos os routers e WebSockets, overlay de login no frontend. Exceções: `/api/system/health`, `/api/auth/login`, `/api/wizard/*` enquanto o wizard não estiver completo. Toggle `security.enabled` no `config/system.yml`. | `app/core/auth.py` (novo), `app/api/auth.py` (novo), `app/main.py` |
| 2 | ✅ | **Token GitHub (PAT) hardcoded** na URL do remote em `.git/config` | URL limpa (`https://github.com/...`). **Ação externa necessária: revogar o PAT no GitHub.** | `.git/config` |
| 3 | ✅ | **Cooldown ADB de 2h retornava `("ok (cooldown)", 0)`** sem executar nada → health check declarava device online mesmo offline; streams/reboot reportavam sucesso fictício; watchdog nunca disparava recovery | Cooldown removido; `shell()` sempre executa via ADB. | `app/managers/adb.py` |
| 4 | ✅ | **`connect_timeout: 7200` (2h)** — `adb connect` segurava o lock do device por até 2h | Default e config alinhados para **10s**. | `app/managers/adb.py`, `config/system.yml` |
| 5 | ✅ | **`static/js/device.js` com SyntaxError** (`await` fora de async) → página de detalhe do device 100% quebrada | `renderDevice()` marcada como `async` e bloco fechado. `node --check` OK em todos os 16 JS. | `static/js/device.js` |
| 6 | ✅ | **Path traversal (4 vetores + 1 extra)**: catch-all da SPA servia arquivos arbitrários (`..%2f`); zip-slip no restore de backup; `rmtree` com version não validado no scrcpy; `id` de device/grupo sem sanitização na escrita/deleção de YAML; `source` de logs sem allowlist | Catch-all resolve + `is_relative_to` e 404 para `/api/*`; backup valida `resolve().is_relative_to` + normaliza separadores; scrcpy valida versão (`^[0-9]+(\.[0-9]+){0,4}$`); ids validados por `is_safe_id` (regex `^[a-z0-9][a-z0-9._-]{0,63}$`) com `ValueError→400`; logs com allowlist `LOG_SOURCES`. | `app/main.py`, `app/managers/backup.py`, `app/managers/scrcpy.py`, `app/core/config.py`, `app/utils/system.py`, `app/api/logs.py`, `app/api/scrcpy.py`, `app/api/devices.py`, `app/api/groups.py` |
| 7 | ❌ | **Injeção de comando no shell do TV Box**: `rtsp_url`, `package`, `name`, `extra` interpolados em comandos `adb shell` sem escape; um `'` no nome do device executa comando arbitrário no Android | **Pendente.** Requer escape (`shlex.quote`/validação por regex) em `app/managers/player.py`, `scripts/android/start_stream.sh` e `app/api/devices.py` (uninstall). | `app/managers/player.py`, `scripts/android/start_stream.sh`, `app/api/devices.py:286-296` |
| 8 | ❌ | **Firewall abre portas para toda a rede**: `ufw allow 5555/tcp` (ADB direto!), `9997`, `8554`, `1935` sem restrição de origem; painel em `0.0.0.0:8080` sem TLS | **Pendente** (ação de deploy). Restringir por sub-rede, não expor 5555, usar VPN/TLS. | `deploy/install.sh` |

### 🟠 Altos

| # | Status | Achado | Onde |
|---|---|---|---|
| 9 | ✅ | **XSS persistente** no frontend (dados de API em `innerHTML`/`onclick` sem escape em dashboard, devices, groups, device page) | Helpers globais `UI.escapeHtml/escJs/escAttr` + escape aplicado em todos os sinks; toast e modal-title blindados. | `static/js/components.js`, `dashboard.js`, `devices.js`, `groups.js`, `device.js`, `logs.js`, `mediamtx.js`, `backup.js`, `settings.js`, `app.js` |
| 10 | ✅ | **Backup quebrado na UI**: export usava `GET` em endpoint `POST` (405); "download" apontava para o endpoint de **restore** (destrutivo) | Export via `fetch POST → blob`; novo endpoint dedicado `GET /api/backup/download/{name}` (com validação de nome). | `static/js/backup.js`, `app/api/backup.py` |
| 11 | 🟡 | **`mediamtx.generated.yml` nunca regenerado** ao adicionar/editar/remover device → RTSP paths novos não chegavam ao MediaMTX | ✅ Regenerado no `apply` do update; ❌ ainda **não** regenerado no CRUD de devices (`config.add/update/delete_device`). | `app/core/config.py`, `app/managers/update.py` |
| 12 | ❌ | **Watchdog congela a lista de devices do startup** — device criado/deletado via API nunca é (des)monitorado | **Pendente.** `WatchdogManager.add_device/remove_device` existem mas não são chamados no CRUD. | `app/core/lifecycle.py`, `app/api/devices.py` |
| 13 | ❌ | **I/O síncrono massivo em endpoints async** (leitura de logs de MBs, ZIP de backup, download/extração scrcpy ~70 MB, escrita de APK) trava o event loop | **Pendente.** Usar `asyncio.to_thread`/`aiofiles`. | `app/managers/log.py`, `app/managers/backup.py`, `app/managers/scrcpy.py`, `app/api/devices.py` |
| 14 | ✅ | **`uptime_seconds` retornava timestamp de boot** (epoch ~1,7e9) em vez de uptime | `int(time.time() - psutil.boot_time())`. | `app/utils/system.py` |
| 15 | ✅ | **Filtros de data dos logs quebrados** (comparação lexicográfica excluía o dia inteiro no `to_date`) | Parsing `datetime`; data sozinha vale o dia inteiro; linhas sem timestamp excluídas sob filtro. | `app/managers/log.py` |
| 16 | 🟡 | **Update frágil**: `git pull` sem timeout; sem restart do serviço; `stash` sem `pop` | ✅ Timeout de 30s em todos os comandos git (helper `_run_git`) + regenera `mediamtx.generated.yml`; ❌ restart do serviço não implementado no backend (frontend recarrega a página). | `app/managers/update.py` |
| 17 | ❌ | **Teste com rede real** (`test_scrcpy.py` chama api.github.com sem mock) | **Pendente.** | `tests/test_scrcpy.py` |
| 18 | ❌ | **Docs desatualizados**: endpoints inexistentes (`POST /api/devices/reload`, ~15 rotas no `02-SPECS.md`), comportamento divergente (WATCHDOG, UPDATING, APK_INSTALL, ADDING_DEVICE) | **Pendente.** Contrato real da API agora documentado em `docs/LLM.md`. | `docs/*.md` |
| 19 | ❌ | **MediaMTX gerado sem autenticação** (`pass: ''`, `apiAllowOrigins: ['*']`) | **Pendente.** Gerar credencial forte e restringir origens. | `app/core/config.py:257-263` |
| 20 | ✅ | **Headers de segurança ausentes** (CSP, X-Frame-Options, nosniff, Referrer-Policy) | Middleware adicionado em todas as respostas (CSP com `unsafe-inline` por causa dos handlers `onclick` existentes). | `app/main.py` |

### 🟡 Médios e baixos (resumo)

| Status | Item |
|---|---|
| ❌ | `start_streaming` do scrcpy deixa ffmpeg órfão; `stop_mirroring` mata scrcpy mas não o ffmpeg (`app/managers/scrcpy.py:462-534`) |
| ❌ | 19 instâncias de `ADBManager` (conexão/cooldown não compartilhados); config de players duplicada em 2 fontes de verdade |
| ❌ | Shutdown só encerra watchdog — schedule, scrcpy, tasks e `httpx.AsyncClient` do MediaMTX ficam vivos (`app/core/lifecycle.py`) |
| ❌ | Escrita de YAML sem atomicidade/lock; `load_yaml` engole erros de parse silenciosamente |
| ❌ | DoS: WebSockets sem limite de conexões/rate-limit; uploads sem limite de tamanho (APK/zip) |
| ❌ | SSRF: wizard aceita `ip`/`mediamtx.api_url` arbitrários (probe de rede); scrcpy aceita `rtmp_url` arbitrário (exfiltração de tela) |
| ❌ | Config morta: `activity_check`, `mediamtx_check`, `command_delay`, `ping.*`, `critical_alert_cooldown` nunca lidos; `watchdog_override` documentado mas não implementado |
| ❌ | `mediamtx.service` roda como root |
| ❌ | Intervalos JS vazando (logs 5s, mediamtx 10s, listeners WS acumulando) — `destroy()` incompleto |
| ✅ | Bugs funcionais já listados acima |
| ℹ️ | Sem lockfile (`>=` no pyproject); sem cobertura configurada; `.pytest_cache` desatualizado |

---

## Correções aplicadas nesta sessão

**Fase 1 — Bugs de funcionamento**
1. `ADBManager`: removido cooldown de 2h que retornava sucesso fictício.
2. `connect_timeout` 7200 → 10s (default + `config/system.yml`).
3. `device.js`: SyntaxError corrigido (página de device voltou a funcionar).
4. Backup: export corrigido (POST) e download com endpoint GET dedicado.
5. `uptime_seconds`: uptime real.
6. Filtros de data dos logs com `datetime`.

**Fase 2 — Segurança**
7. **Autenticação por token** (backend + WebSockets + frontend): `app/core/auth.py`, `app/api/auth.py`, `static/js/auth.js`; token gerado em `config/.panel_token` (gitignored); `security.enabled` no `system.yml`; fail-closed sem config.
8. **Path traversal** bloqueado em 5 vetores (catch-all, backup, scrcpy, ids, logs).
9. **Headers de segurança** (CSP, X-Frame-Options, nosniff, Referrer-Policy).
10. **XSS** mitigado com escaping centralizado no frontend.
11. Token GitHub removido do `.git/config`.
12. Update com timeouts de git + regenera `mediamtx.generated.yml`.

**Verificações**
- ✅ 70 testes passando (`pytest`)
- ✅ `node --check` em todos os 16 arquivos JS
- ✅ Validação HTTP: 401 sem token / 200 com token; login ok; 4 headers de segurança; `..%2f` → 404; `/api/nao-existe` → 404; WebSocket sem token rejeitado / com token conecta
- ✅ Startup limpo (sem `PermissionError` de rotação de log — corrigido ao remover o `FileHandler` duplicado de `system.log`)

---

## Riscos residuais e recomendações

Prioridade:

1. 🔴 **Revogar o PAT do GitHub** (token `ghp_...` que estava no remote) — ação externa, urgente.
2. 🔴 **Injeção de comando no shell do device** (#7): escapar/validar `rtsp_path`, `package`, `name`, `extra_args` em `player.py`, `scripts/android/*.sh` e `uninstall-app`. Isso exige um `'` no nome do device para RCE no Android — com auth já implementado o risco cai, mas permanece.
3. 🔴 **Firewall** (#8): restringir `deploy/install.sh` a sub-redes; não abrir 5555; TLS/VPN.
4. 🟠 **Watchdog dinâmico** (#12): chamar `add_device/remove_device` no CRUD para devices novos serem monitorados.
5. 🟠 **Regenerar `mediamtx.generated.yml` no CRUD de devices** (#11).
6. 🟠 **`asyncio.to_thread`** para I/O pesado de logs/backup/scrcpy (#13).
7. 🟠 **SSRF**: validar `ip`/`api_url`/`rtmp_url` no wizard e scrcpy.
8. 🟠 **Documentação** (#18): atualizar `02-SPECS.md`/`ADDING_DEVICE.md` etc. (o contrato real está em `docs/LLM.md`).

---

*Relatório gerado após a sessão de auditoria + correções. O estado atual do código é o que está documentado em `docs/LLM.md`.*
