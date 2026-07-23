# Especificações Técnicas — Painel TV Box

---

## 1. Configurações YAML

### 1.1 `config/system.yml`

```yaml
# Configuração geral do sistema
server:
  host: "0.0.0.0"
  port: 8080
  workers: 1                     # uvicorn workers (1 porque WebSocket hub é em memória)

host:
  # IP do servidor onde o painel roda
  # Usado para gerar URLs RTSP e para o Wizard
  ip: "192.168.254.102"

adb:
  # Caminho do binário adb no servidor
  binary: "adb"
  # Porta padrão ADB dos TV Boxes
  default_port: 5555
  # Timeout para conectar (segundos)
  connect_timeout: 10
  # Tempo de espera entre comandos ADB (segundos)
  command_delay: 0.5

paths:
  devices_dir: "devices"
  groups_dir: "groups"
  config_dir: "config"
  logs_dir: "logs"
  backups_dir: "backups"
  scripts_dir: "scripts/android"
  # Caminho remoto no TV Box onde scripts são instalados
  remote_scripts_dir: "/data/local/tmp/panel"

wizard_completed: false
```

### 1.2 `config/watchdog.yml`

```yaml
# Configuração do watchdog (valores padrão — podem ser sobrescritos por dispositivo)

check_interval: 10          # segundos entre health checks
ping:
  count: 1
  timeout_ms: 800
adb:
  timeout: 5                # segundos
activity_check: true        # verificar Activity atual do player
mediamtx_check: true       # verificar path na API do MediaMTX

recovery:
  # Cooldown após detectar falha antes de agir
  cooldown_seconds: 15

  # Reabrir player
  player_retry_max: 2
  player_retry_delay: 10    # segundos entre tentativas

  # Reiniciar Wi-Fi
  wifi_restart: true
  wifi_reconnect_timeout: 30  # aguardar ADB reconectar após Wi-Fi

  # Reiniciar Ethernet
  eth_restart: true
  eth_reconnect_timeout: 30

  # Reboot Android
  reboot_max: 1             # máximo de reboots por ciclo
  reboot_boot_timeout: 120  # aguardar boot completar

  # Após esgotar tudo, alerta crítico
  critical_alert_cooldown: 300  # não repetir alerta por 5 min
```

### 1.3 `config/players.yml`

```yaml
# Definição de players suportados
# Novos players podem ser adicionados aqui sem alterar código

players:
  vlc:
    package: "org.videolan.vlc"
    activity: "org.videolan.vlc.gui.video.VideoPlayerActivity"
    force_stop: "org.videolan.vlc"
    # Argumentos extras passados via intent
    # Placeholders: {URL}, {TITLE}
    intent_template: >
      am start -a android.intent.action.VIEW
      -d "{URL}"
      -n {PACKAGE}/{ACTIVITY}
      --es "title" "{TITLE}"
      --activity-clear-task

  mpv:
    package: "is.xyz.mpv"
    activity: "is.xyz.mpv.MPVActivity"
    force_stop: "is.xyz.mpv"
    intent_template: >
      am start -a android.intent.action.VIEW
      -d "{URL}"
      -n {PACKAGE}/{ACTIVITY}
      --activity-clear-task

  # Exemplo de player adicional (futuro):
  # exoplayer:
  #   package: "com.google.android.exoplayer2.demo"
  #   activity: "com.google.android.exoplayer2.demo.MainActivity"
  #   force_stop: "com.google.android.exoplayer2.demo"
  #   intent_template: >
  #     am start -a android.intent.action.VIEW
  #     -d "{URL}"
  #     -n {PACKAGE}/{ACTIVITY}

# Player padrão (se dispositivo não especificar)
default: vlc
```

### 1.4 `config/mediamtx.yml`

```yaml
# Configuração MediaMTX do painel (NÃO é o mediamtx.yml do MediaMTX diretamente)
# O painel gera o mediamtx.yml real a partir destes valores + dispositivos cadastrados

api:
  url: "http://localhost:9997"
  timeout: 5

server:
  rtsp_port: 8554
  rtmp_port: 1935
  api_port: 9997
  metrics_port: 9998

# Valores que o painel injeta no mediamtx.yml gerado
mediamtx_config:
  logLevel: "warn"
  writeQueueSize: 2048
  readTimeout: "10s"
  writeTimeout: "10s"
  rtspTransports: ["udp", "tcp"]
  hls: false
  webrtc: false
  hlsVariant: "mpegts"
  metrics: false

# Autenticação (rede local — sem senha)
auth:
  enabled: false

# IP da rede local permitida na API
api_allowed_network: "192.168.254.0/24"

# Path do binário mediamtx (para restart via systemd)
binary: "mediamtx"
service_name: "mediamtx.service"
```

### 1.5 `devices/tvbox-{nome}.yml` (exemplo)

```yaml
# Dispositivo: TV Box Armazém 1B
# Um arquivo por TV Box. Nunca agrupar dispositivos.

id: "tvbox-armazem-1b"          # identificador único (slug)
name: "TV Box Armazém 1B"       # nome de exibição

# Rede
ip: "192.168.254.13"
mac: "AA:BB:CC:DD:EE:01"
adb_port: 5555

# Localização física
location: "Armazém 1B"
description: "TV Box na entrada do Armazém 1B"
group: "grupo-armazens"

# Stream
rtsp_path: "TV_BOX_3"           # path no MediaMTX (ex: rtsp://host:8554/TV_BOX_3)
player: "vlc"                   # referência a config/players.yml

# Root
root: true                      # dispositivo tem root via su

# Capabilities — o que este dispositivo suporta
capabilities:
  wifi_restart: true
  ethernet_restart: true
  reboot: true
  root: true
  install_apk: true
  shell: true
  screenshot: true
  volume: true
  mute: true

# Parâmetros extras do player (opcionais)
player_extra_args:
  # Exemplo: cache de rede para VLC
  # "--es \"network-caching=500\""

# Observações livres
notes: "TV Box comprada em 2024, 2GB RAM"

# Watchdog sobrescreve config/watchdog.yml (opcional)
watchdog_override:
  check_interval: 5          # este device precisa check mais rápido
  recovery:
    player_retry_max: 3

# Schedule (opcional — agendar ações)
schedule:
  # Abrir stream todo dia às 8h
  - action: "start_stream"
    cron: "0 8 * * *"
  # Fechar stream à noite
  - action: "stop_stream"
    cron: "0 22 * * *"

# Estado (gerenciado pelo painel — não editar manualmente)
state:
  status: "online"            # online | degraded | warning | offline
  last_seen: "2026-07-21T14:30:00"
  last_fail: null
  last_recovery: null
  uptime_seconds: 0
  recovery_count: 0
  current_activity: ""
  screenshot_path: null
```

### 1.6 `groups/grupo-{nome}.yml` (exemplo)

```yaml
# Grupo de dispositivos

id: "grupo-armazens"
name: "Armazéns"
description: "TV Boxes dos armazéns do Píer"
color: "#3fb950"                # cor para identificação visual no painel

# Schedule em grupo (opcional — aplica a todos devices do grupo)
schedule:
  - action: "start_stream"
    cron: "0 8 * * *"

# Watchdog override em grupo (opcional)
watchdog_override:
  check_interval: 15
```

---

## 2. API REST

### 2.1 Endpoints

| Método | Path | Descrição |
|---|---|---|
| **System** | | |
| GET | `/api/system/health` | Health do próprio painel |
| GET | `/api/system/metrics` | CPU/RAM/disk/uptime do host |
| GET | `/api/system/wizard-status` | Se wizard pendente |
| **Wizard** | | |
| POST | `/api/wizard/start` | Inicia wizard (retorna step atual) |
| POST | `/api/wizard/step/{n}` | Submete dados do step N |
| GET | `/api/wizard/preview` | Prévia dos YAMLs que serão gerados |
| POST | `/api/wizard/finish` | Finaliza e gera todos YAMLs |
| **Devices** | | |
| GET | `/api/devices` | Lista todos dispositivos |
| GET | `/api/devices/{id}` | Detalhe de um dispositivo |
| POST | `/api/devices` | Cria novo dispositivo |
| PUT | `/api/devices/{id}` | Atualiza dispositivo |
| DELETE | `/api/devices/{id}` | Remove dispositivo |
| POST | `/api/devices/{id}/start-stream` | Abre stream no device |
| POST | `/api/devices/{id}/stop-stream` | Fecha player no device |
| POST | `/api/devices/{id}/reboot` | Reboot do device |
| POST | `/api/devices/{id}/restart-wifi` | Reinicia Wi-Fi |
| POST | `/api/devices/{id}/restart-eth` | Reinicia Ethernet |
| POST | `/api/devices/{id}/screenshot` | Captura tela |
| GET | `/api/devices/{id}/screenshot` | Último screenshot |
| POST | `/api/devices/{id}/install-apk` | Instala APK (multipart upload) |
| POST | `/api/devices/{id}/provision` | Re-push scripts para o device |
| POST | `/api/devices/{id}/shell` | Executa comando shell |
| GET | `/api/devices/{id}/logs` | Logs do device |
| GET | `/api/devices/{id}/history` | Histórico de eventos do device |
| **Groups** | | |
| GET | `/api/groups` | Lista grupos |
| GET | `/api/groups/{id}` | Detalhe grupo |
| POST | `/api/groups` | Cria grupo |
| PUT | `/api/groups/{id}` | Atualiza grupo |
| DELETE | `/api/groups/{id}` | Remove grupo |
| POST | `/api/groups/{id}/start-stream` | Start stream em todos do grupo |
| POST | `/api/groups/{id}/reboot` | Reboot em todos do grupo |
| **MediaMTX** | | |
| GET | `/api/mediamtx/paths` | Lista paths (proxy MediaMTX API) |
| POST | `/api/mediamtx/paths` | Cria path |
| DELETE | `/api/mediamtx/paths/{name}` | Remove path |
| GET | `/api/mediamtx/health` | Status do MediaMTX |
| POST | `/api/mediamtx/restart` | Restart MediaMTX service |
| GET | `/api/mediamtx/config` | Config atual gerada |
| **Logs** | | |
| GET | `/api/logs` | Busca logs com filtros |
| GET | `/api/logs/download` | Download de log |
| GET | `/api/logs/sources` | Lista fontes de log |
| **Backup** | | |
| GET | `/api/backup/export` | Exporta ZIP com todos YAML |
| POST | `/api/backup/import` | Importa ZIP de YAMLs |
| POST | `/api/backup/restore` | Restore de backup |
| GET | `/api/backup/list` | Lista backups disponíveis |
| **Shell** | | |
| WS | `/ws/shell/{device_id}` | WebSocket para shell remoto |
| **Update** | | |
| POST | `/api/update/check` | Verifica updates via git |
| POST | `/api/update/apply` | git pull + migrate + restart |
| GET | `/api/update/status` | Status da última atualização |
| **Settings** | | |
| GET | `/api/settings` | Todas as configs |
| PUT | `/api/settings/{config_name}` | Atualiza config (system, watchdog, players, mediamtx) |

### 2.2 Convenções

- Todas as responses em JSON
- Erros seguem RFC 7807 (Problem Details): `{"type": "...", "title": "...", "detail": "...", "status": 400}`
- Paginação: `?page=1&per_page=20` → `{"items": [...], "total": 100, "page": 1, "per_page": 20}`
- OpenAPI docs em `/docs` (Swagger UI) e `/redoc`
- CORS desabilitado (mesma origem)

---

## 3. WebSocket

### 3.1 Endpoint único

```
ws://host:port/ws
```

 cliente conecta e recebe eventos. Cliente pode enviar mensagens para inscrever-se em tópicos.

### 3.2 Subscription

```json
// Cliente → Server
{"action": "subscribe", "topic": "health"}
{"action": "subscribe", "topic": "logs", "filters": {"level": "ERROR"}}
{"action": "subscribe", "topic": "shell", "device_id": "tvbox-armazem-1b"}

// Server → Cliente
{"type": "health", "device_id": "tvbox-armazem-1b", "status": "online", "checks": {...}}
{"type": "log", "level": "ERROR", "source": "watchdog", "message": "...", "timestamp": "..."}
{"type": "alert", "device_id": "...", "severity": "critical", "message": "..."}
{"type": "recovery", "device_id": "...", "step": "restart_wifi", "status": "success"}
{"type": "system_metrics", "cpu": 45.2, "ram": 62.1, "disk": 78.0, "uptime": "5d 3h"}
{"type": "mediamtx", "paths": [...]}
{"type": "shell_output", "device_id": "...", "line": "..."}
```

### 3.3 Tópicos

| Tópico | Eventos |
|---|---|
| `health` | Mudanças de status de dispositivos |
| `logs` | Logs em tempo real |
| `alerts` | Alertas críticos e warnings |
| `recovery` | Progresso de recuperação |
| `system_metrics` | Métricas do host (CPU/RAM/disk/uptime) |
| `mediamtx` | Estado das paths do MediaMTX |
| `shell/{device_id}` | Output de shell remoto |

---

## 4. Scripts Android

Scripts em `scripts/android/`. Recebem argumentos via environment variables ou argv.

### 4.1 `start_stream.sh`

```sh
#!/system/bin/sh
# Usage: start_stream.sh <RTSP_URL> <PACKAGE> <ACTIVITY> [EXTRA_ARGS]
# Enviado pelo painel via: adb shell sh /data/local/tmp/panel/start_stream.sh "$@"

RTSP_URL="$1"
PACKAGE="$2"
ACTIVITY="$3"
TITLE="${4:-Stream}"
EXTRA="${5:-}"

# Fecha player existente
am force-stop "$PACKAGE"
sleep 1

# Abre stream
if [ -n "$EXTRA" ]; then
  am start -a android.intent.action.VIEW \
    -d "$RTSP_URL" \
    -n "$PACKAGE/$ACTIVITY" \
    --es "title" "$TITLE" \
    --activity-clear-task \
    $EXTRA
else
  am start -a android.intent.action.VIEW \
    -d "$RTSP_URL" \
    -n "$PACKAGE/$ACTIVITY" \
    --es "title" "$TITLE" \
    --activity-clear-task
fi
```

### 4.2 `restart_wifi.sh`

```sh
#!/system/bin/sh
# Reinicia Wi-Fi. Usa nohup pois derruba ADB temporariamente.
# Usa su se disponível

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

nohup sh -c 'svc wifi disable && sleep 5 && svc wifi enable' >/dev/null 2>&1 &
echo "WiFi restart initiated"
```

### 4.3 `restart_eth.sh`

```sh
#!/system/bin/sh
# Reinicia Ethernet

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

nohup sh -c 'ip link set eth0 down && sleep 3 && ip link set eth0 up' >/dev/null 2>&1 &
echo "Ethernet restart initiated"
```

### 4.4 `capture.sh`

```sh
#!/system/bin/sh
# Captura screenshot. Requer root ou framebuffer access.
# Usage: capture.sh <OUTPUT_PATH>
# Output: PNG no path especificado

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

OUTPUT="${1:-/data/local/tmp/panel/screenshot.png}"

if [ -n "$SU" ]; then
  $SU "screencap -p $OUTPUT"
else
  screencap -p "$OUTPUT"
fi

echo "Screenshot saved to $OUTPUT"
```

### 4.5 `healthcheck.sh`

```sh
#!/system/bin/sh
# Health check executado no device. Retorna JSON para o painel.
# Usage: healthcheck.sh <EXPECTED_PACKAGE>

EXPECTED="${1:-}"

# Ping de resposta
echo '{"reachable": true}'

# Activity atual
CURRENT=$(dumpsys activity | grep -E 'mCurrentFocus|mFocusedApp' | head -1 | sed 's/.*\///' | awk '{print $1}')
echo "CURRENT_ACTIVITY: $CURRENT"

# Player rodando?
if [ -n "$EXPECTED" ]; then
  PID=$(pidof "$EXPECTED" 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "PLAYER_RUNNING: true"
    echo "PLAYER_PID: $PID"
  else
    echo "PLAYER_RUNNING: false"
    echo "PLAYER_PID: null"
  fi
fi

# Bateria
BATTERY=$(cat /sys/class/power_supply/battery/capacity 2>/dev/null || echo "unknown")
echo "BATTERY: $BATTERY"

# Temperatura
TEMP=$(cat /sys/class/power_supply/battery/temp 2>/dev/null || echo "unknown")
echo "TEMP: $TEMP"
```

### 4.6 `install_apk.sh`

```sh
#!/system/bin/sh
# Instala APK. O painel já faz adb push do APK antes.
# Usage: install_apk.sh <APK_PATH>
APK_PATH="$1"
pm install -r "$APK_PATH"
echo "INSTALL_RESULT: $?"
```

### 4.7 `update.sh`

```sh
#!/system/bin/sh
# Update dos scripts no device. O painel faz adb push dos novos scripts e chama isto.
echo "Scripts updated at $(date)"
```

---

## 5. Frontend

### 5.1 Páginas

| Rota (hash) | Página | Descrição |
|---|---|---|
| `#/` | Dashboard | Visão geral com cards e métricas |
| `#/wizard` | Wizard | Assistente de configuração inicial |
| `#/devices` | Lista devices | Grid de cards de dispositivos |
| `#/device/{id}` | Detalhe device | Página individual do TV Box |
| `#/groups` | Lista grupos | Gestão de grupos |
| `#/group/{id}` | Detalhe grupo | Dispositivos do grupo |
| `#/mediamtx` | MediaMTX | Paths, readers, publisher |
| `#/logs` | Logs | Pesquisa e filtros |
| `#/shell` | Shell | Terminal remoto (seleciona device) |
| `#/backup` | Backup | Export/import |
| `#/settings` | Settings | Editar configs do sistema |

### 5.2 Layout

```
┌─────────────────────────────────────────────────────────┐
│  [☰] Painel TV Box                    Status: ● 12/20  │  ← Header
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ Dashboard│           CONTEÚDO DA PÁGINA                  │
│ Devices  │                                              │
│ Groups   │           Cards / Tabelas / Forms             │
│ MediaMTX │                                              │
│ Logs     │                                              │
│ Shell    │                                              │
│ Backup   │                                              │
│ Settings │                                              │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

- Sidebar fixa à esquerda, colapsável
- Header com título da página e indicador de status global
- Conteúdo responsivo (grid de cards)
- Tema escuro (CasaOS-like)
- Toast notifications para feedback de operações
- Modal de confirmação para operações destrutivas

### 5.3 CSS Variables (design tokens)

```css
:root {
  --bg-primary: #0f1419;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --accent: #58a6ff;
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;
  --radius: 8px;
  --radius-sm: 4px;
  --sidebar-w: 240px;
  --sidebar-collapsed-w: 60px;
  --header-h: 56px;
  --font: 'Segoe UI', -apple-system, sans-serif;
  --transition: 0.2s ease;
}
```

### 5.4 JS Modules

- `ws.js` — WebSocket client com auto-reconnect + subscriber pattern
- `api.js` — fetch wrapper com error handling padrão
- `app.js` — router (hash-based), sidebar toggle, globals
- `components.js` — funções: `createCard()`, `createModal()`, `createToast()`, `createBadge()`, `createStatCard()`
- Páginas específicas (dashboard.js, device.js, etc.)

---

## 6. Health Check — Matriz de Status

| Ping | ADB | Activity | MediaMTX | Player | Status |
|---|---|---|---|---|---|
| ✅ | ✅ | ✅ | ✅ | ✅ | **online** |
| ✅ | ✅ | ❌ | ✅ | ✅ | **degraded** (player errado) |
| ✅ | ✅ | ✅ | ❌ | ✅ | **degraded** (stream indisponível) |
| ✅ | ✅ | ❌ | ❌ | ❌ | **warning** (player parado + sem stream) |
| ✅ | ❌ | ? | ? | ? | **warning** (ADB indisponível) |
| ❌ | ❌ | ? | ? | ? | **offline** |

Regra: se Ping falha → offline. Se Ping OK mas resto falha → degraded/warning conforme combinação.

---

## 7. Logs

### 7.1 Fontes

| Fonte | Arquivo | Conteúdo |
|---|---|---|
| `system` | `logs/system.log` | Backend, startup, config |
| `adb` | `logs/adb.log` | Comandos ADB, outputs |
| `mediamtx` | `logs/mediamtx.log` | API calls, paths, health |
| `watchdog` | `logs/watchdog.log` | Health checks, recovery |
| `user` | `logs/user.log` | Ações de usuário (start, stop, reboot, config) |
| `api` | `logs/api.log` | Requests HTTP |

### 7.2 Formato

```
[2026-07-21T14:30:00] [INFO] [watchdog] [tvbox-armazem-1b] Health check: online
[2026-07-21T14:30:00] [ERROR] [adb] [tvbox-portaria] Failed to connect: timeout
```

Formato: `[ISO timestamp] [LEVEL] [SOURCE] [DEVICE_ID] message`

### 7.3 Busca

API: `GET /api/logs?source=watchdog&level=ERROR&device_id=X&from=2026-07-21&to=2026-07-22&q=text&page=1`

---

## 8. systemd

### 8.1 `deploy/panel.service`

```ini
[Unit]
Description=Painel TV Box - Gerenciamento de TV Boxes
After=network.target mediamtx.service
Wants=mediamtx.service

[Service]
Type=simple
User=panel
WorkingDirectory=/opt/panel
ExecStart=/opt/panel/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 8.2 `deploy/mediamtx.service`

```ini
[Unit]
Description=MediaMTX Streaming Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mediamtx
WorkingDirectory=/opt/mediamtx
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

---

## 9. Backup

### 9.1 Formato

ZIP contendo:
```
backup-2026-07-21T14-30-00.zip
├── config/
│   ├── system.yml
│   ├── watchdog.yml
│   ├── players.yml
│   └── mediamtx.yml
├── devices/
│   ├── tvbox-armazem-1b.yml
│   └── ...
├── groups/
│   └── ...
└── backup_manifest.json      # metadados
```

### 9.2 Restore

Upload do ZIP → valida estrutura → backup atual → substitui arquivos → reload config → restart components

---

## 10. Update (git-based)

```
POST /api/update/apply
  1. git fetch origin
  2. git stash (se mudanças locais)
  3. git pull origin main
  4. MigrationService.run() — migra YAMLs se schema mudou
  5. pip install -r requirements.txt (se requirements mudou)
  6. systemctl restart panel
  7. Avisar usuário se mediamtx precisa restart
```

---

## 11. Dependências Python

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.0
pyyaml>=6.0
httpx>=0.27.0         # async HTTP client para MediaMTX API
psutil>=6.0           # CPU/RAM/disk metrics
python-multipart>=0.0.9  # upload de APK
```

Sem dependências desnecessárias. Sem ORMs, sem Celery, sem Redis.