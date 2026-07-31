# Heartbeat device→servidor — Spec de Implementação
## Substitui o `reverse_ping.sh` e resolve o conflito ADB × scrcpy

> **Data:** 2026-07-31 · **Status:** DRAFT para revisão · **Origem:** observação do usuário no `docs/08-UX-CHANGE-SPEC.md` (decisão 6). Fase B do plano `07-UX-REMODEL-PLAN.md` (backend B6).

---

## 1. O problema

Não é possível manter a leitura da conexão do TV Box usando **ADB e scrcpy ao mesmo tempo**:

- O **healthcheck atual** (`app/managers/health.py`) sonda o device via **ADB** (`adb connect` + `adb shell echo ok` + ping) a cada `check_interval` (10s) **para todos os devices, sempre**.
- O **scrcpy** também usa o mesmo servidor ADB. Quando o ADB é "spammado" (healthcheck + ações + status), a conexão do scrcpy cai ou ele não abre.
- Resultado: monitorar a saúde do device via ADB **é a causa** da instabilidade do scrcpy.

> ⚠️ **OBSERVAÇÃO DO USUÁRIO (aprovada, regra de implementação):**
> **"QUALQUER COMANDO ADB DERRUBA A CONEXÃO COM O SCRCPY!"** — ou seja, não é só o healthcheck: **qualquer** comando ADB (start/stop de stream, reboot, shell, status, screenshot, install/uninstall de app, provision) derruba o scrcpy quando ele está espelhando. Consequência para o design:
> - Enquanto uma sessão scrcpy estiver **ativa** em um device, o painel **não deve executar ADB nesse device**;
> - A verificação de conexão "como um todo" precisa de **outra via que não o ADB** (§3.3).

O `reverse_ping.sh` atual tentou resolver com o device pingando o servidor — mas não funciona como esperado (ver §2).

---

## 2. Por que as duas implementações atuais NÃO resolvem

### 2.1 Healthcheck via ADB (server→device polling)
- **Causa o problema:** sonda ADB o tempo todo → conflito com scrcpy.
- **Só sabe do device quando o ADB responde** — se o ADB está ocupado/instável, marca offline mesmo com o device na rede.

### 2.2 `reverse_ping.sh` (ICMP device→server)
```sh
while true; do
    ping -c 1 -W 2 "$SERVER_IP" >/dev/null 2>&1   # ICMP unidirecional
    sleep "$INTERVAL"
done
```
- **O servidor NUNCA recebe nada.** O ping ICMP é unidirecional: prova que o device alcança o servidor por ICMP, mas o painel não é notificado — `device.state.last_seen` não muda, o watchdog não sabe de nada.
- Só efeito colateral: mantém o rádio/Wi-Fi "acordado".
- ICMP pode ser bloqueado por roteadores/firewalls; não é observável pelo painel nem vira log.

---

## 3. Solução: heartbeat HTTP (device → servidor)

Um script leve no TV Box envia um **POST HTTP ao painel** a cada N segundos:

```
TV Box                              Painel (FastAPI)
   │  POST /api/heartbeat/<device_id>  │
   │  headers: X-Heartbeat-Key: <key>  │
   │  body: { activity: "..." }        │
   ─────────────────────────────────▶  device.state.last_heartbeat = now
                                        device.state.current_activity = ...
                                        (sem NENHUMA chamada ADB)
```

O painel **realmente recebe e registra** a batida → sabe que o TV Box está na rede **sem tocar no ADB**.

### 3.1 Como isso resolve o conflito

1. **Healthcheck vira ADB-light:** se `last_heartbeat` está fresco (≤ `heartbeat_timeout`, default 2× intervalo), o watchdog **pula a sonda ADB de liveness** (e o ping) — considera o device alcançável pela rede. ADB passa a ser usado **sob demanda** (ações start/stop/reboot, `/status` manual, scrcpy) e no fallback quando o heartbeat expira.
2. **Sem ADB spam → scrcpy estável:** enquanto o device bate o coração, o painel não mexe no ADB dele.
3. **Observabilidade real:** `last_heartbeat` alimenta a **frescura** ("visto há Ns") que já criamos nos cards — o servidor sabe o device na rede.
4. **Debug em texto:** cada batida/queda de heartbeat vira linha em `logs/watchdog.log` (atende à decisão 1 do usuário: log para debug posterior).

### 3.2 Diferenças vs as duas propostas (resumo)

|                       | Healthcheck ADB (atual) | reverse_ping ICMP (atual) | **Heartbeat HTTP (novo)**     |
| --------------------- | ----------------------- | ------------------------- | ----------------------------- |
| Direção               | server→device (poll)    | device→server (ICMP)      | **device→server (HTTP POST)** |
| Servidor consome?     | sim (ADB)               | **não**                   | **sim (last_heartbeat)**      |
| Mexe no ADB?          | **sim — causa do bug**  | não                       | **não**                       |
| Compatível com scrcpy | ruim (spam)             | neutro                    | **bom (ADB livre)**           |
| Vira log/frescura?    | sim (mas via ADB)       | não                       | **sim (watchdog.log + UI)**   |
| Requer rede           | ADB 5555                | ICMP                      | **HTTP 8080 (já aberto)**     |

### 3.3 Regra central: ADB × scrcpy (observação do usuário)

**Enquanto uma sessão scrcpy estiver ativa em um device, o painel NÃO executa comandos ADB nesse device.** A verificação de conexão "como um todo" passa a usar **três fontes independentes que não tocam no ADB**:

| Fonte | O que verifica | Canal |
|---|---|---|
| **Heartbeat HTTP** | device na rede (última batida) | HTTP 8080 |
| **MediaMTX API** | stream ativa (readers/tracks do path) | HTTP local 9997 |
| **Estado do scrcpy** | sessão de espelhamento ativa/streamando | memória do painel |

**Comportamento concreto:**

1. **Watchdog:** se `scrcpy ativo` no device **ou** heartbeat fresco → **zero ADB** no device (pula `adb connect`/`shell`/ping). Se o heartbeat expira E não há scrcpy → fallback ADB completo (comportamento atual).
2. **Ações ADB manuais** (start/stop stream, reboot, shell, screenshot, install/uninstall, provision, `/status`): se scrcpy ativo no device → **bloquear com aviso claro** "⚠️ Esta ação usa ADB e vai derrubar o espelhamento do scrcpy" + opção **"Parar scrcpy e continuar"** (confirmação explícita) ou cancelar. Ações destrutivas (reboot, uninstall) **exigem** parar o scrcpy antes.
3. **`/status`:** enquanto scrcpy ativo, monta o status a partir de heartbeat + MediaMTX (+ estado da sessão), **sem ADB**.
4. **Início do scrcpy:** o `start` usa ADB (é o ponto de entrada) — OK; a partir daí, vale a regra.
5. **Fim da sessão:** `stop_mirroring` também usa ADB (`pkill` via adb shell) — aceito como ação explícita do usuário; após parar, ADB volta a ser liberado.

**O heartbeat NUNCA é pausado** — ele é justamente o canal que não usa ADB e mantém a observabilidade enquanto o ADB está "congelado" pelo scrcpy.

---

## 4. Backend

### 4.1 Model (`app/models/device.py`)
- `DeviceState`: adicionar `last_heartbeat: Optional[datetime] = None`.
- **Remover campos mortos** (decisão 4): `last_fail`, `last_recovery`, `uptime_seconds`, `recovery_count` (documentar no `docs/LLM.md`).

### 4.2 Chave de heartbeat (segurança)
- Nova `config/system.yml` → `security.heartbeat_key` (auto-gerada no 1º boot, estilo `.panel_token`; também em `config/.panel_heartbeat_key`? **decisão**: colocar em `system.yml` como `heartbeat_key` para o provision ler — mas system.yml é versionado? Não, system.yml é config local. OK).
- Endpoint valida `X-Heartbeat-Key` (ou `?key=`) com `hmac.compare_digest`; **não** usa o token do painel (evita expor o token full nos devices).
- Rate limit: mínimo 5s entre batidas por device (`429` se menor) — anti-spam/anti-burst.

### 4.3 Endpoint
```python
@router.post("/heartbeat/{device_id}")   # em app/api/devices.py ou router novo
async def device_heartbeat(device_id: str, body: HeartbeatBody, key: str = Header(...)):
    # 1. valida device existe (is_safe_id + config.get_device)
    # 2. valida key == heartbeat_key
    # 3. rate limit (>= 5s desde last_heartbeat)
    # 4. device.state.last_heartbeat = now
    #    device.state.current_activity = body.activity (opcional)
    # 5. log: logger.info("[heartbeat] %s ok", device.id)  → watchdog.log
    # 6. responde 204 (payload mínimo)
```
- **Público?** Não. Exige a heartbeat key — mas é uma rota "semi-pública" na LAN (não exige o token do painel). Não fica sob `Depends(require_auth)` (o script do device não tem o token do painel).
- Body opcional: `{ "activity": "org.videolan.vlc...", "uptime": 12345 }` (útil para a aba Stream sem ADB).

### 4.4 Watchdog ADB-light (`app/managers/health.py` + `watchdog.py`)
- No check: se `last_heartbeat` fresco **ou** `scrcpy ativo` no device (regra §3.3) → `adb_reachable = True` (inferido) e **pula** `adb.connect` + `adb.shell("echo ok")` + ping; continua com checagem de stream (MediaMTX readers) que é via HTTP local (não ADB).
- Se heartbeat expirado E sem scrcpy → **fallback** para o healthcheck ADB completo (para não perder devices sem o script).
- Status resultante usa `reason` novo: `"Heartbeat ok — sem stream"` etc.
- Config: `watchdog.yml` → `heartbeat_timeout: 60` (default 2× intervalo do script).

### 4.4b Bloqueio ADB quando scrcpy ativo (regra §3.3)
- `ScrcpyManager` expõe `is_active(device_id)` (fonte: sessões em memória).
- Endpoints que usam ADB (start/stop stream, reboot, shell, screenshot, install/uninstall, provision, `/status`) consultam `is_active` antes de executar:
  - scrcpy ativo → retornar `409` com `{ "error": "adb_busy_scrcpy", "message": "Esta ação usa ADB e vai derrubar o espelhamento do scrcpy. Pare o scrcpy ou confirme." }` + flag `scrcpy_active: true` para o frontend oferecer "Parar scrcpy e continuar".
  - Ações destrutivas (reboot, uninstall) exigem parar o scrcpy antes (sem atalho).
- `/status` com scrcpy ativo → monta resposta de heartbeat + MediaMTX + sessão, sem ADB.

### 4.5 Provision (`app/services/provision.py` + `scripts/android/`)
- Novo script `scripts/android/heartbeat.sh` (loop com cooldown, estilo do `reverse_ping.sh` mas com `curl`/`wget` POST ao painel).
- Provision gera `panel_heartbeat.conf` (URL do painel + device_id + heartbeat_key + intervalo) e faz `adb push` junto com os demais scripts; `chmod +x`.
- `reverse_ping.sh` **removido** (ou mantido como legacy documentado? — decisão: remover do provision; apagar o arquivo).

### 4.6 Script do device (`heartbeat.sh` sketch)
```sh
#!/system/bin/sh
# heartbeat.sh — envia batida HTTP ao painel
# config: /data/local/tmp/panel/heartbeat.conf (PANEL_URL, DEVICE_ID, KEY, INTERVAL)
while true; do
  ACTIVITY=$(dumpsys activity 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1 | sed 's/.*\/\([^}]*\)}/\1/' | awk '{print $1}')
  curl -s -o /dev/null -X POST "$PANEL_URL/api/heartbeat/$DEVICE_ID" \
       -H "X-Heartbeat-Key: $KEY" -H "Content-Type: application/json" \
       -d "{\"activity\":\"$ACTIVITY\"}"
  sleep "$INTERVAL"
done
```
- Fallback: se `curl` não existir, tentar `wget`. Se nenhum dos dois, manter o ICMP como fallback mínimo (documentado).

---

## 5. Frontend

- **Frescura** já lê `state.last_seen`; o heartbeat atualiza `last_heartbeat` → o card mostra "visto há Ns" mesmo sem ADB. (Na Fase B, unificar: frescura = `max(last_seen, last_heartbeat)`.)
- **Aba Stream** do device: mostra `current_activity` (agora real, via heartbeat) + "heartbeat há Ns".
- Badge/ícone "heartbeat" (opcional): dot pulsante discreto quando heartbeat ativo.

---

## 6. Segurança e edge cases

| Caso                                          | Tratamento                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Atacante fakes heartbeat (LAN)                | Impacto baixo (spoof de "na rede"); mitiga com chave dedicada + rate limit; não concede acesso ao painel |
| Device sem curl/wget                          | Fallback ICMP mantido como legacy, documentado                                                           |
| Heartbeat key vazada                          | Regenerar: editar `system.yml` + reprovisionar devices (documentar)                                      |
| Watchdog sem heartbeat (device sem script)    | Fallback ADB completo mantém comportamento atual — zero perda                                            |
| **scrcpy ativo + qualquer ADB (regra §3.3)**   | Bloqueado com 409 + aviso; frontend oferece "Parar scrcpy e continuar"; ações destrutivas exigem parar    |
| Heartbeat expirado com scrcpy ativo            | Sem ADB mesmo assim: status via MediaMTX + sessão; watchdog não sonda (evita derrubar o espelho)          |
| Muitos devices batendo junto                  | Intervalo ≥ 5s + `check_interval` do watchdog já espaça; endpoint leve (só grava timestamp)              |
| `current_activity` via dumpsys pode ser lento | Opcional no script (intervalo maior, ex. a cada 5ª batida)                                               |

---

## 7. Fases de implementação

| Passo | Escopo                                                                             |
| ----- | ---------------------------------------------------------------------------------- |
| 1     | Model: `last_heartbeat` + remoção dos campos mortos (B2)                           |
| 2     | `heartbeat_key` no config + endpoint `/api/heartbeat/{id}` + rate limit            |
| 3     | Watchdog ADB-light (pula sonda se heartbeat fresco; fallback ADB)                  |
| 4     | `heartbeat.sh` + provision (push conf + script; remover reverse_ping)              |
| 5     | Frontend: frescura = max(last_seen, last_heartbeat); aba Stream com activity       |
| 6     | QA: `node --check`, `pytest` (testes do endpoint + watchdog), revisão claro/escuro |

---

## 8. Critérios de aceite

1. Com o script instalado, **nenhuma chamada ADB** é feita pelo healthcheck enquanto o heartbeat está fresco (verificável no log `adb.log`).
2. scrcpy conecta/mantém com healthcheck ativo (teste manual).
3. Frescura dos cards reflete o heartbeat ("visto há Ns" sem ADB).
4. Sem o script (fallback), o watchdog se comporta como hoje (ADB).
5. Endpoint com rate limit + chave dedicada; `pytest` verde.
6. **Com scrcpy ativo, nenhum endpoint ADB executa sem confirmação explícita** (409 + aviso); `adb.log` sem chamadas automáticas nesse período (regra §3.3).



[OBSERVAÇÃO SOBRE A IMPLEMENTAÇÃO: *"QUALQUER COMANDO ADB DERRUBA A CONEXÃO COM O SCRCPY!" - OU É PAUSADO O HEARTBEAT OU FEITO OUTRA MANEIRA DE VERIFICAR A CONEXÃO COMO UM TODO*]