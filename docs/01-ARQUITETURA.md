# Arquitetura do Sistema — Painel TV Box

## Visão Geral

```
                         ┌──────────────────────────────────────────────┐
                         │              Navegador (Cliente)              │
                         │   HTML + CSS + JS puro · WebSocket Client     │
                         └───────────┬──────────────────┬──────────────┘
                                     │ HTTP/REST        │ WebSocket (WS)
                                     ▼                  ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         Servidor (Debian 13 — 1 máquina)                   │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                            FastAPI Backend                            │  │
│  │                        (uvicorn · porta configurável)                │  │
│  │                                                                        │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │  │
│  │  │ API      │  │ WebSocket     │  │ Wizard     │  │ Static      │  │
│  │  │ Router   │  │ Hub           │  │ Endpoint   │  │ Files       │  │
│  │  │ (REST)   │  │ (broadcast)   │  │            │  │ (templates/)│  │
│  │  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  └─────────────┘  │  │
│  │       │               │                 │                           │  │
│  │       ▼               ▼                 ▼                           │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │                      Managers (core/managers/)               │  │  │
│  │  │                                                                  │  │
│  │  │  ConfigurationManager  DeviceManager    WatchdogManager       │  │
│  │  │       │                      │                    │             │  │
│  │  │       ├── ADBManager ────────┤                    │             │  │
│  │  │       ├── MediaMTXManager    ├── PlayerManager     │             │  │
│  │  │       ├── HealthManager ─────┤                    │             │  │
│  │  │       ├── LogManager ────────┤                    │             │  │
│  │  │       ├── BackupManager      ├── UpdateManager     │             │  │
│  │  │       └── ScheduleManager    └                    │             │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  │                                                    │                  │  │
│  └────────────────────────────────────────────────────┼──────────────────┘
│                                                       │                    │
└───────────────────────────────────────────────────────┼────────────────────┘
                                                        │
                              ┌─────────────────────────┼─────────────────┐
                              │                         │                 │
                              ▼                         ▼                 ▼
                    ┌────────────────┐        ┌────────────────┐  ┌──────────────┐
                    │   MediaMTX      │        │   ADB Server   │  │  TV Boxes    │
                    │   (RTSP/RTMP)   │        │   (porta 5555) │  │  (Android)   │
                    │   API: :9997    │        │                │  │              │
                    └────────┬────────┘        └───────┬────────┘  │  /data/local/ │
                             │                         │           │  tmp/panel/  │
                             │ RTMP publish            │ ADB TCP    │  *.sh scripts │
                             │                         │            └──────────────┘
                    ┌────────┴────────┐                │
                    │      OBS        │                │
                    │  (Multi RTMP)   │────────────────┘
                    └─────────────────┘
```

---

## Princípios Arquiteturais

1. **Configuração sobre código** — Todo valor é YAML, inject, ou definido no Wizard. Zero hardcodes para IPs, portas, paths, nomes de pacotes, activity names, ou timeouts.

2. **Um arquivo YAML por dispositivo** — `devices/tvbox-armazem.yml`, `devices/tvbox-portaria.yml`, etc. Nunca `devices.yml` monolítico.

3. **Capabilities-driven** — Cada dispositivo declara `capabilities: [wifi_restart, reboot, shell, screenshot, ...]`. O backend e frontend usam capabilities para habilitar/desabilitar ações. Sem `if device_model == "X"`.

4. **Managers independentes** — Cada Manager é uma classe que recebe dependências via construtor. Managers não chamam uns aos outros diretamente; services orquestram.

5. **Services orquestram Managers** — Services implementam fluxos de trabalho (ex: `RecoveryService` coordena ADBManager + PlayerManager + WatchdogManager).

6. **Scripts no TV Box** — O painel não envia comandos longos via ADB shell. Faz `adb push` de scripts para `/data/local/tmp/panel/` uma vez, depois só executa `adb shell sh /data/local/tmp/panel/start_stream.sh`.

7. **WebSocket para tudo** — Dashboard, dispositivo individual, logs — todos recebem updates via WS. O cliente nunca precisa fazer polling.

8. **Frontend sem framework** — HTML + CSS + JS puro. Sem build step, sem npm, sem webpack. Vanilla JS modules com `import`.

---

## Estrutura de Diretórios

```
panel/                              # raiz do projeto
├── app/
│   ├── __init__.py
│   ├── main.py                     # entrypoint FastAPI (sempre atende / e /ws; Wizard fallback se não inicializado)
│   ├── api/                        # routers REST
│   │   ├── __init__.py
│   │   ├── devices.py              # CRUD dispositivos
│   │   ├── groups.py              # CRUD grupos
│   │   ├── mediamtx.py           # proxy MediaMTX API
│   │   ├── system.py             # health, metrics, updates
│   │   ├── backup.py            # export/import YAML
│   │   ├── wizard.py            # wizard endpoints
│   │   ├── logs.py             # busca/filtro/download
│   │   └── shell.py           # terminal remoto ADB
│   ├── core/                        # núcleo do backend
│   │   ├── __init__.py
│   │   ├── config.py              # ConfigurationManager — carrega/valida/salva YAML
│   │   ├── websocket.py          # WebSocket hub — pub/sub broadcast
│   │   ├── lifecycle.py          # startup/shutdown hooks
│   │   └── exceptions.py         # exceções tipadas
│   ├── managers/                    # gestão de subsistemas
│   │   ├── __init__.py
│   │   ├── adb.py                # ADBManager — abstração total de ADB
│   │   ├── mediamtx.py           # MediaMTXManager — REST API
│   │   ├── device.py             # DeviceManager — estado e CRUD em memória
│   │   ├── watchdog.py           # WatchdogManager — loop de health check + recovery
│   │   ├── player.py             # PlayerManager — abrir/fechar streams
│   │   ├── health.py             # HealthManager — combinador multi-camada
│   │   ├── log.py                # LogManager — log estruturado + busca
│   │   ├── backup.py             # BackupManager — export/import YAML
│   │   ├── update.py             # UpdateManager — git pull + migrate + restart
│   │   └── schedule.py           # ScheduleManager — agendamentos (cron-like)
│   ├── models/                     # dataclasses Pydantic
│   │   ├── __init__.py
│   │   ├── device.py
│   │   ├── group.py
│   │   ├── config.py
│   │   ├── health.py
│   │   └── events.py             # eventos WebSocket
│   ├── services/                   # orquestração de managers
│   │   ├── __init__.py
│   │   ├── recovery.py           # RecoveryService — fluxo do watchdog
│   │   ├── provision.py          # ProvisionService — instala scripts no TV Box
│   │   └── migration.py         # MigrationService — migra YAML entre versões
│   └── utils/
│       ├── __init__.py
│       ├── yaml.py               # helpers YAML (load/dump preservando comentários)
│       ├── network.py            # ping, TCP check, get_local_ip
│       └── system.py            # CPU/RAM/disk/uptime do host
├── config/                         # YAML de configuração do sistema
│   ├── system.yml
│   ├── watchdog.yml
│   ├── players.yml
│   └── mediamtx.yml
├── devices/                        # YAML por TV Box
│   ├── tvbox-armazem-1b.yml
│   └── ...
├── groups/                         # YAML por grupo
│   ├── grupo-armazens.yml
│   └── ...
├── scripts/
│   └── android/                    # scripts .sh para push no TV Box
│       ├── start_stream.sh
│       ├── stop_stream.sh
│       ├── restart_wifi.sh
│       ├── restart_eth.sh
│       ├── capture.sh
│       ├── install_apk.sh
│       ├── healthcheck.sh
│       └── update.sh
├── templates/                      # HTML do frontend
│   ├── base.html                  # layout com sidebar + header
│   ├── wizard.html
│   ├── dashboard.html
│   ├── device.html
│   ├── group.html
│   ├── mediamtx.html
│   ├── logs.html
│   ├── shell.html
│   ├── backup.html
│   └── settings.html
├── static/
│   ├── css/
│   │   ├── main.css               # variables, layout, sidebar, header
│   │   ├── dashboard.css
│   │   ├── device.css
│   │   └── wizard.css
│   └── js/
│       ├── app.js                 # router client-side, WebSocket client, event bus
│       ├── api.js                # helper REST (fetch wrapper)
│       ├── ws.js                 # WebSocket client + reconnect
│       ├── wizard.js
│       ├── dashboard.js
│       ├── device.js
│       ├── mediamtx.js
│       ├── logs.js
│       ├── shell.js
│       └── components.js          # cards, modals, toasts, badges reutilizáveis
├── logs/                           # logs do painel (não do TV Box)
│   ├── system.log
│   ├── adb.log
│   ├── mediamtx.log
│   ├── watchdog.log
│   ├── api.log
│   └── user.log
├── backups/                        # exports de backup
├── tests/
│   ├── test_config.py
│   ├── test_adb.py
│   ├── test_health.py
│   ├── test_watchdog.py
│   ├── test_api.py
│   └── ...
├── deploy/
│   ├── panel.service             # systemd unit
│   ├── install.sh                # script de instalação Debian 13
│   └── mediamtx.service
├── docs/
│   ├── 00-ANALISE.md
│   ├── 01-ARQUITETURA.md
│   ├── 02-SPECS.md
│   ├── 03-PLANO.md
│   ├── README.md
│   └── ...
├── pyproject.toml                 # dependências (ou requirements.txt)
├── .gitignore
└── README.md
```

---

## Fluxo de Dados

### Startup

```
1. uvicorn app.main:app
2. app.core.lifecycle startup:
   a. ConfigurationManager.load()
      - Se config/ vazio → flag wizard_pending = True
      - Se config/ populado → carrega system.yml, watchdog.yml, players.yml, mediamtx.yml
      - Carrega todos devices/*.yml
      - Carrega todos groups/*.yml
   b. DeviceManager.populate(configs) → estado em memória
   c. ADBManager.start() → adb start-server
   d. MediaMTXManager.start() → health check API
   e. WatchdogManager.start() → asyncio task per-device
   f. WebSocketHub.start()
3. Servidor pronto. Rotas disponíveis.
   Se wizard_pending → toda rota exceto /wizard/* e /api/wizard/* retorna 302 → /wizard
   Se OK → servindo templates + static
```

### Health Check (per-device, WatchdogManager)

```
A cada interval (ex: 10s, configurável):
  1. Ping (ICMP)
  2. ADB connect + adb shell echo ok
  3. adb shell dumpsys activity | grep mCurrentFocus → verifica player
  4. MediaMTX API: GET /v3/paths/list → verifica path do device
  5. HealthManager.combine(results) → status: online | degraded | warning | offline
  6. Se status != online → RecoveryService.run(device)
  7. WebSocket broadcast: {type: "health", device: id, status: ..., checks: {...}}
```

### Recovery (RecoveryService)

```
Flow (todos os valores configuráveis):
  1. Detecta falha
  2. Aguarda cooldown (ex: 15s)
  3. Reabrir Player (adb shell sh /data/local/tmp/panel/start_stream.sh)
  4. Testar health
  5. Se falhou: Reabrir Player novamente (retry_count)
  6. Testar health
  7. Se falhou: Reiniciar Wi-Fi (nohup sh /data/local/tmp/panel/restart_wifi.sh)
  8. Aguardar reconexão ADB (timeout configurável)
  9. Testar health
 10. Se falhou: Reiniciar Ethernet (nohup sh /data/local/tmp/panel/restart_eth.sh)
 11. Aguardar reconexão ADB
 12. Testar health
 13. Se falhou: Reboot Android (adb reboot)
 14. Aguardar boot (timeout configurável, ex: 120s)
 15. Abrir stream
 16. Testar health
 17. Se falhou: Alerta crítico via WebSocket + log
 18. Resetar contador se recuperado
```

### WebSocket Event Types

| Type | Direction | Payload |
|---|---|---|
| `health` | server→client | `{device_id, status, checks, timestamp}` |
| `device_list` | server→client | `{devices: [...]}` |
| `mediamtx_paths` | server→client | `{paths: [...]}` |
| `system_metrics` | server→client | `{cpu, ram, disk, uptime}` |
| `log` | server→client | `{level, source, message, timestamp}` |
| `alert` | server→client | `{device_id, severity, message}` |
| `recovery` | server→client | `{device_id, step, status}` |
| `shell_output` | server→client | `{device_id, line}` |

---

## Decisões Arquiteturais Justificadas

### Async (asyncio) síncrono → asyncio

FastAPI é async por natureza. Health checks envolvem I/O (subprocess para ADB, HTTP para MediaMTX). `asyncio` permite monitorar 20 devices concorrentemente sem bloquear.

**Decisão:** Todo o backend é async. Subprocesses usam `asyncio.create_subprocess_exec`.

### Sem banco de dados

IDEA.md exige persistência em YAML. Para 20 dispositivos, YAML é suficiente e legível. Dados voláteis (estado em memória, logs em arquivo de texto).

**Decisão:** YAML para configuração. Log files para histórico. Zero SQLite/PostgreSQL.

### Script push strategy

Em vez de enviar comandos longos via `adb shell`, o painel faz `adb push` dos scripts .sh para `/data/local/tmp/panel/` no cadastro. Operações subsequentes só executam `adb shell sh /data/local/tmp/panel/X.sh`.

**Vantagens:**
- Scripts são versionados no repo
- Commands são auditáveis
- TV Box não precisa de binários
- Manutenção simples (atualizar script = re-push)

**Decisão:** Scripts em `scripts/android/` com templates Jinja2-free (são shell scripts puros que recebem argumentos do ADBManager). O `ProvisionService` faz push no cadastro e pode re-push via botão.

### Templates: Jinja2 vs HTML puro servido por JS

FastAPI funciona com Jinja2, mas o IDEA.md pede frontend em JS puro. Podemos:
- **A:** Jinja2 apenas para template base (sidebar, header) e JS renderiza conteúdo
- **B:** HTML totalmente estático, JS faz everything via API + DOM

**Decisão:** Opção B. HTML é estático (servido como static files). JS puro busca dados via REST e WebSocket. Templates são HTML vazios com divs de montagem. Sem Jinja2. Simples,CACHEÁvel, e cumpre "JavaScript puro".

### Por que não framework de frontend

IDEA.md diz "JavaScript puro". Sem React, Vue, etc.

**Decisão:** Vanilla JS. Components via funções que criam elementos DOM. Event bus simples. WebSocket client com auto-reconnect. Roteamento client-side via `window.location.hash`.

### Pydantic para models

IDEA.md pede "fortemente tipado". Pydantic v2 fornece validação, serialização JSON automática, e schemas para OpenAPI docs.

**Decisão:** Pydantic v2 para todos os models. FastAPI usa nativamente.

### Log estruturado

IDEA.md pede logs separados por categoria (Sistema, ADB, MediaMTX, Watchdog, Usuário, API).

**Decisão:** `LogManager` mantém múltiplos `logging.Logger` com handlers分离 para arquivos distintos em `logs/`. WebSocket tail para tempo real. Busca via leitura de arquivos com filtros (level, source, date range, text search).

### ScheduleManager (cron-like)

IDEA.md menciona "interface preparada para integração futura" com OBS. O ScheduleManager permite agendar ações (ex: abrir stream às 8h, fechar às 22h). É genérico o suficiente para futura integração com OBS.

**Decisão:** ScheduleManager simples baseado em YAML. Suporta schedule por dispositivo, grupo, ou global.

---

## Segurança

- Sem autenticação (rede local, conforme IDEA.md)
- MediaMTX já configurado com `authInternalUsers` permitindo publish/read sem senha e API para `192.168.254.0/24` (mantido)
- ADB shell remoto disponível no painel, mas operações destrutivas exigem confirmação dupla na UI
- Root no TV Box é opcional por dispositivo (field `root: true/false` no YAML)