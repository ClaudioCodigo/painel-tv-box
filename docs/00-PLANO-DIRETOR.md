# Plano Diretor & Especificação Técnica
## Painel TV Box — Sistema de Gerenciamento de TV Boxes Android

---

## 1. Contexto do Sistema

Cada TV Box é um **dispositivo de propósito único** recebendo **exatamente UMA stream RTSP**.  
O design reflete essa arquitetura: o foco é **estabilidade da stream**, diagnóstico rápido e intervenção com 1 clique, não gerenciamento multimídia.

### Stack Tecnológica (define)

| Camada | Tecnologia | Observação |
|---|---|---|
| Backend | Python 3.11+ | FastAPI, asyncio |
| Frontend | HTML + CSS + Vanilla JS | SPA com hash routing, IIFE modules |
| Persistência | YAML | 1 arquivo por dispositivo |
| Tempo Real | WebSocket | Server push para todos os eventos |
| Deploy | Debian 13 | systemd, optional MediaMTX |
| Comunicação Device | ADB TCP | `adb connect` via rede |
| Stream Server | MediaMTX | API REST em `localhost:9997` |

### Stack Decidida (não negocia)

- **Sem frameworks JS** — HTML+CSS+JS puro, sem build steps, sem npm
- **Sem banco de dados** — Tudo YAML no disco
- **Sem autenticação** — Rede local apenas
- **Async estrito** — Nenhum bloqueio de I/O no backend

---

## 2. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (SPA)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │Dashboard │ │ Dev/Group│ │ Terminal │ │  Logs    │  ...      │
│  │ JS Module│ │ JS Module│ │ JS Module│ │ JS Module│          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │            │             │            │                │
│       └────────────┴──────┬──────┴────────────┘                │
│                           │ WS + REST                          │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                  FastAPI (Python asyncio)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ API REST │ │WebSocket │ │  Router  │ │  Static  │          │
│  │ /api/*   │ │ /ws      │ │  SPA     │ │  Files   │          │
│  └────┬─────┘ └────┬─────┘ └──────────┘ └──────────┘          │
│       │            │                                           │
│  ┌────┴────────────┴─────────────────────────────────────────┐│
│  │                    Managers Layer                          ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐   ││
│  │  │ ADB     │ │ MediaMTX│ │  Health │ │ Configuration  │   ││
│  │  │ Manager │ │ Manager │ │ Manager │ │   Manager      │   ││
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────────────────┘   ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐   ││
│  │  │Watchdog │ │ Player  │ │  Log    │ │  scrcpy        │   ││
│  │  │ Manager │ │ Manager │ │ Manager │ │  Manager       │   ││
│  │  └─────────┘ └─────────┘ └─────────┘ └────────────────┘   ││
│  │                    Services Layer                           ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────────────┐   ││
│  │  │Recovery │ │Provision│ │ Schedule│ │   Backup       │   ││
│  │  │ Service │ │ Service │ │ Manager │ │   Manager      │   ││
│  │  └─────────┘ └─────────┘ └─────────┘ └────────────────┘   ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌───────────────────────────────────┐                          │
│  │         ADB (TCP)                 │                          │
│  │  192.168.254.232:5555              │                          │
│  └───────────┬───────────────────────┘                          │
└───────────────┼─────────────────────────────────────────────────┘
                │ ADB TCP
    ┌───────────┴───────────┐
    │  TV Box Android       │
    │  - VLC / MPV          │
    │  - scrcpy server      │
    │  - panel scripts      │
    └───────────────────────┘
```

---

## 3. Matriz de Status (Health Check Matrix)

O sistema **nunca confia em um único indicador**. Combina múltiplas fontes:

| Ping | ADB | MediaMTX Readers | MediaMTX Path | Android Activity | **Status** |
|---|---|---|---|---|---|
| ✅ | ✅ | ✅ >0 | ✅ | — | **ONLINE** — "Stream ativa ✅" |
| ✅ | ✅ | 0 | ✅ | — | **DEGRADED** — "Sem stream ativa" |
| ✅ | ✅ | — | ❌ | ✅ | **DEGRADED** — "Player offline" |
| ✅ | ✅ | 0 | ❌ | ❌ | **DEGRADED** — "Sem stream ativa" |
| ❌ | ❌ (60s cache) | — | — | — | **DEGRADED** — grace period |
| ❌ | ❌ (>60s) | — | — | — | **OFFLINE** — "Desconectado" |

**Regra de Ouro:** MediaMTX Readers > 0 é a fonte primária de verdade para "stream ativa".

---

## 4. Módulos do Sistema

### 4.1 Core & ConfigurationManager

- Carrega/salva YAMLs de: `system.yml`, `watchdog.yml`, `players.yml`, `mediamtx.yml`
- Cada dispositivo: `devices/{device_id}.yml`
- Wizard 10 passos que gera todos YAMLs
- `slugify()` para device_id a partir do nome

### 4.2 ADBManager

- Comunicação TCP: `adb connect IP:PORT`
- Métodos: `connect`, `shell`, `push`, `pull`, `reboot`
- **Auto-connect** antes de qualquer operação
- Timeout configurável (padrão 10s, health check usa 5s)

### 4.3 HealthManager

- Health check multi-camada por dispositivo
- Ordem de checagem: Ping (informativo) → ADB (2 tentativas) → Activity → MediaMTX Path → Readers
- **Grace period 60s**: se ADB estava OK há <60s, mantém "degraded" em vez de "offline"
- Retorna `(status, motivo)` — motivo textual exibido no card

### 4.4 WatchdogManager

- **1 asyncio task por dispositivo**
- Health check a cada `check_interval` segundos (padrão 10s)
- **Cascata de recuperação** (apenas se status = "offline"):
  1. `player_retry`: 2 tentativas com 10s intervalo
  2. `wifi_restart`: ADB shell `svc wifi disable && sleep 5 && svc wifi enable`
  3. `eth_restart`: ADB shell `ip link set eth0 down && sleep 3 && ip link set eth0 up`
  4. `reboot`: `adb shell reboot`, aguarda 120s boot
  5. Se continuar falhando → alerta crítico
- **Cooldown**: 2 min entre recoveries
- **Não interfere com scrcpy**: se ADB está OK, não dispara recovery
- Re-lê device config do disco a cada ciclo (watchdog.refresh_interval)

### 4.5 MediaMTXManager

- Consome `http://localhost:9997/v3/paths/list`
- Retorna: paths, readers, publisher, bitrate, tracks, ready/online
- Health check do servidor: `GET /v3/paths/list` → status code

### 4.6 PlayerManager

- Monta URL RTSP: `rtsp://{host_ip}:8554/{rtsp_path}`
- Tenta script no TV Box primeiro: `sh /data/local/tmp/panel/start_stream.sh`
- Fallback para intent: `am start -a android.intent.action.VIEW -d rtsp_url`
- Players configuráveis (VLC, MPV) por dispositivo

### 4.7 ScrcpyManager

- Version manager: download, extract, activate, rollback, delete
- **Multi-plataforma**: win64 (zip), linux x86_64/aarch64 (tar.gz), macOS
- Mantém até 3 versões simultâneas, auto-cleanup
- **Flatten** dos arquivos extraídos (DLLs ficam ao lado do binário)
- Mirroring (janela) e Streaming (pipe → ffmpeg → RTMP → MediaMTX)

### 4.8 LogManager

- 6 fontes independentes: system, adb, mediamtx, watchdog, user, api
- **RotatingFileHandler**: 5 MB por arquivo, 3 backups
- Busca com filtros (source, level, device_id, texto, data)
- Tail (últimas N linhas), download individual ou completo

### 4.9 BackupManager

- Export: ZIP de `config/` + `devices/` + `groups/` + `manifest.json`
- Import: upload ZIP → valida → restaura
- List: lista backups disponíveis com data/tamanho
- Cleanup: remove backups além do limite configurável

### 4.10 UpdateManager

- `check()`: `git fetch` + compara HEAD com `origin/main`
- `apply()`: `git pull` + migração de configs + reinício do serviço
- Relatório de status (branch, commits ahead/behind, última verificação)

### 4.11 ScheduleManager

- CronParser: suporta `*`, `*/N`, `N,N`, `N-N`, dias da semana
- Loop assíncrono a cada 60s
- Ações: `start_stream`, `stop_stream`, `reboot` por device ou grupo

### 4.12 ProvisionService

- Push automático dos 8 scripts Android para `/data/local/tmp/panel/`
- Scripts: `start_stream.sh`, `stop_stream.sh`, `restart_wifi.sh`, `restart_eth.sh`, `capture.sh`, `healthcheck.sh`, `install_apk.sh`, `update.sh`
- Executado automaticamente no cadastro do dispositivo
- Pode ser re-executado manualmente

---

## 5. Estado Atual vs. Gaps

### 5.1 ✅ 100% Implementado

- [x] Core & ConfigurationManager (YAML assíncrono)
- [x] ADBManager (shell, push, pull, reboot, auto-connect)
- [x] HealthManager (multi-camada, grace 60s, motivo textual)
- [x] WatchdogManager (cascata, cooldown 2min, não interfere com scrcpy)
- [x] MediaMTXManager (paths, readers, tracks, health)
- [x] PlayerManager (script + intent fallback)
- [x] ScrcpyManager (version manager, multi-plataforma, flatten)
- [x] LogManager (6 fontes, RotatingFileHandler 5MB×3, busca)
- [x] BackupManager (ZIP export/import, list, cleanup)
- [x] UpdateManager (git check/apply)
- [x] ScheduleManager (CronParser, loop 60s)
- [x] ProvisionService (8 scripts Android)
- [x] CRUD Devices + Groups (API REST)
- [x] Ações coletivas (groups: start/stop/reboot)
- [x] Shell remoto (histórico ↑↓, screenshot inline)
- [x] APK Manager (listar, instalar, desinstalar)
- [x] Wizard re-executável (sidebar + botão)
- [x] Dashboard (cards, status com motivo, ID copiável, comandos)
- [x] Página de Gerenciamento de Dispositivos (adicionar, renomear, grupo, excluir)
- [x] 63 testes unitários passando
- [x] Cache-busting com `?v=N`
- [x] Botão "Limpar Cache" nas Configurações
- [x] ADB timeout 10s configurável
- [x] Deploy script (Debian 13, systemd, firewall, virtualenv)
- [x] Documentação (README + 7 guias)
- [x] Página scrcpy com checklist de argumentos

### 5.2 📋 Pendente — Refinamentos Futuros

| Módulo | O que fazer | Prioridade |
|---|---|---|
| **UI Refinamento** | Paleta exata da spec, glow halos, pulsação 2s | Média |
| **Sparklines métricas** | Micro-gráficos inline para CPU/RAM/Disk | Baixa |
| **Shell WebSocket** | Migrar de REST para WS (output em tempo real) | Baixa |
| **Testes de integração** | Watchdog + Health + ADB mock + Frontend | Baixa |

---

## 6. Estrutura de Diretórios

```
Paniel/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app + lifespan
│   ├── api/
│   │   ├── __init__.py
│   │   ├── devices.py           # CRUD + stream + shell + screenshot + apk + reboot
│   │   ├── groups.py            # CRUD + ações coletivas
│   │   ├── mediamtx.py          # Health + paths
│   │   ├── wizard.py            # Wizard finish + validate
│   │   ├── system.py            # Health + metrics + wizard-status
│   │   ├── logs.py              # Search + tail + sources + download
│   │   ├── backup.py            # Export + import + list + restore
│   │   ├── update.py            # Check + apply
│   │   └── scrcpy.py            # Status + check + install + activate + rollback + start/stop mirror
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py            # ConfigurationManager (YAML CRUD)
│   │   ├── lifecycle.py         # Startup/shutdown (watchdog, schedule, ws)
│   │   └── websocket.py         # WebSocketHub (broadcast)
│   ├── managers/
│   │   ├── __init__.py
│   │   ├── adb.py               # ADBManager
│   │   ├── health.py            # HealthManager
│   │   ├── watchdog.py          # WatchdogManager
│   │   ├── player.py            # PlayerManager
│   │   ├── mediamtx.py          # MediaMTXManager
│   │   ├── log.py               # LogManager
│   │   ├── scrcpy.py            # ScrcpyManager
│   │   ├── backup.py            # BackupManager
│   │   ├── update.py            # UpdateManager
│   │   └── schedule.py          # ScheduleManager + CronParser
│   ├── models/
│   │   ├── __init__.py
│   │   ├── device.py            # DeviceConfig, DeviceState
│   │   ├── config.py            # SystemConfig, PlayersConfig, WatchdogConfig
│   │   └── group.py             # GroupConfig
│   ├── services/
│   │   ├── __init__.py
│   │   ├── recovery.py          # RecoveryService
│   │   └── provision.py         # ProvisionService
│   └── utils/
│       └── system.py            # slugify, helpers
├── config/                      # YAMLs de configuração
│   ├── system.yml
│   ├── watchdog.yml
│   ├── players.yml
│   └── mediamtx.generated.yml
├── devices/                     # YAMLs por dispositivo
│   └── tv-box-pier.yml
├── scripts/
│   └── android/                 # 8 scripts .sh
├── static/
│   ├── css/
│   │   ├── main.css             # Layout, variáveis, tema escuro
│   │   ├── dashboard.css        # Dashboard
│   │   ├── wizard.css           # Wizard
│   │   ├── device.css           # Página de detalhe do device
│   │   ├── devices.css          # Página de gerenciamento + cards + terminal
│   │   ├── logs.css             # Logs table
│   │   ├── backup.css           # Backup + settings
│   │   ├── groups.css           # Group cards
│   │   ├── scrcpy.css           # scrcpy + arg checklist
│   │   ├── forms.css            # Form inputs (global)
│   │   └── apps.css             # APK manager
│   ├── js/
│   │   ├── app.js               # Router, init, sidebar
│   │   ├── ws.js                # WebSocket client
│   │   ├── api.js               # HTTP client (get/post/put/del)
│   │   ├── components.js        # UI helpers (toast, modal, card, badge)
│   │   ├── dashboard.js         # Dashboard
│   │   ├── wizard.js            # Wizard (10 steps)
│   │   ├── device.js            # Device detail
│   │   ├── devices.js           # Device manager (add, rename, group, delete)
│   │   ├── mediamtx.js          # MediaMTX page
│   │   ├── logs.js              # Logs page
│   │   ├── backup.js            # Backup page
│   │   ├── settings.js          # Settings + cache clear
│   │   ├── groups.js            # Groups page
│   │   ├── shell.js             # Shell remoto (terminal)
│   │   └── scrcpy.js            # scrcpy version manager
│   └── ...
├── templates/
│   ├── base.html                # Layout base + sidebar + scripts
│   └── wizard.html               # Wizard template
├── logs/                        # Logs rotacionados
├── backups/                     # Backups ZIP
├── scrcpy/                      # scrcpy manager
├── deploy/
│   ├── install.sh               # Instalação Debian 13
│   ├── panel.service            # systemd unit
│   └── mediamtx.service.link    # MediaMTX reference
├── docs/
│   ├── 00-ANALISE.md
│   ├── 01-ARQUITETURA.md
│   ├── 02-SPECS.md
│   ├── 03-PLANO.md
│   ├── 04-CORRECOES-FASE2.md
│   ├── 05-REVIEW.md
│   ├── 05-SCRCPY-SPEC.md
│   ├── 06-FASE12.md
│   ├── INSTALL.md
│   ├── ADDING_DEVICE.md
│   ├── GROUPS.md
│   ├── WATCHDOG.md
│   ├── CHANGING_PLAYER.md
│   ├── APK_INSTALL.md
│   ├── BACKUP.md
│   └── UPDATING.md
├── tests/
│   ├── test_config.py           (11)
│   ├── test_adb.py              (6)
│   ├── test_health.py           (8)
│   ├── test_api.py              (6)
│   ├── test_player.py           (7)
│   ├── test_schedule.py         (10)
│   ├── test_scrcpy.py           (6)
│   └── test_log.py              (9)
├── pyproject.toml
└── README.md
```

---

## 7. Fases de Refinamento Futuro

### Fase R1 — Refinamento Visual da UI  (1-2 dias)

**Objetivo:** Aplicar a paleta de cores e efeitos visuais da spec sem quebrar a funcionalidade existente.

**Tarefas:**
1. **Variáveis CSS**: Atualizar `--bg-primary: #0B0E14`, `--bg-secondary: #161B22`, `--border: #30363D`
2. **Cores de acento**: Cyan `#00F2FE` para ações primárias, Violet `#7C4DFF` para agrupamento
3. **Glow halos nos cards de status**: 
   - ONLINE: glow verde `#00E676` (box-shadow com animação pulse 2s)
   - DEGRADED: glow âmbar `#FFB300`
   - OFFLINE: glow vermelho `#FF5252`
4. **Fonte monospace**: JetBrains Mono nos terminais e logs (via Google Fonts)
5. **Glassmorphism**: `backdrop-filter: blur(8px)` nos modais e cards flutuantes
6. **Tipografia**: Inter/SF Pro para headings, Compact Sans para corpo

**Arquivos que serão modificados:**
- `static/css/main.css` — variáveis, glow, glassmorphism
- `static/css/dashboard.css` — cards com glow
- `static/css/devices.css` — cards com glow
- `static/css/apps.css` — refinamento
- `templates/base.html` — Google Fonts

### Fase R2 — Sparklines (Micro-gráficos) (1 dia)

**Objetivo:** Adicionar mini-gráficos nas métricas do servidor (CPU, RAM, Disco).

**Tarefas:**
1. **Coleta de histórico**: HealthManager armazena últimas 30 amostras por métrica
2. **API endpoint**: `GET /api/system/metrics/history` → retorna array de últimos 30 pontos
3. **Frontend**: Canvas 2D ou CSS-based sparkline inline no stat-card
4. **Hover**: Ao passar o mouse, expande o gráfico com tooltip

### Fase R3 — WebSocket Shell (Meio dia)

**Objetivo:** Migrar execução de comandos shell de REST para WebSocket para output em tempo real.

**Tarefas:**
1. **WS endpoint**: `/ws/shell/{device_id}` → stream de stdout/stderr em tempo real
2. **Backend**: `asyncio.create_subprocess_exec` com pipe de stdout → WS
3. **Frontend**: `shell.js` muda de `API.post()` para `WS.send()` + stream de chunks
4. **Fallback**: Mantém REST como fallback se WS falhar

### Fase R4 — Testes de Integração (2 dias)

**Objetivo:** Expandir cobertura de testes para cenários reais.

**Tarefas:**
1. **Mock ADB**: `AsyncMock` para simular connect/shell/push/pull
2. **Mock MediaMTX**: `httpx_mock` para simular API
3. **Testes de watchdog**: Recovery cascade, grace period, cooldown
4. **Testes de health**: Todas as combinações da matriz
5. **Testes de frontend**: Validação de renderização com Puppeteer ou similar

### Fase R5 — Single Stream como Destaque Primário (Meio dia)

**Objetivo:** Reformular os cards do dashboard para destacar "Stream Ativa" como âncora visual primária.

**Tarefas:**
1. **Card redesign**: O topo do card agora mostra o status do stream em destaque
2. **Glow duplo**: Halo externo para ADB/device status, badge interno para stream
3. **Tooltip**: Hover no status mostra detalhes (readers, tracks, codec)

---

## 8. Glossário de Termos

| Termo | Definição |
|---|---|
| **TV Box** | Dispositivo Android que reproduz stream RTSP via VLC/MPV |
| **MediaMTX** | Servidor RTSP/RTMP que distribui streams |
| **Stream** | Fluxo de vídeo/áudio RTSP, uma por TV Box |
| **ADB** | Android Debug Bridge — protocolo de comunicação |
| **Watchdog** | Sistema automático de monitoramento e recuperação |
| **Degraded** | Estado intermediário: ADB OK, mas algo não está funcionando |
| **Grace Period** | Janela de 60s antes de declarar offline |
| **scrcpy** | Ferramenta de espelhamento de tela Android |
| **Provision** | Instalação dos scripts .sh no TV Box |
| **Cascata** | Sequência de ações de recuperação (player → wifi → eth → reboot) |
