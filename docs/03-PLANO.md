# Plano de Implementação — Painel TV Box

---

## Visão Geral do Plano

| Fase | Duração est. | Entregável | Dependências |
|---|---|---|---|
| **Fase 0** | Scaffold + infra base | Projeto roda (uvicorn serve HTML vazio) | — |
| **Fase 1** | ConfigurationManager + YAML | Carrega/salva YAML, modelos validados | Fase 0 |
| **Fase 2** | Wizard frontend + backend | Primeira execução gera YAMLs | Fase 1 |
| **Fase 3** | ADBManager + DeviceManager | Conecta, lista, executa shell em TV Box | Fase 1 |
| **Fase 4** | Dashboard + WebSocket | Painel funcional com status em tempo real | Fase 3 |
| **Fase 5** | PlayerManager + MediaMTXManager | Abrir/fechar streams, ver paths | Fase 3 |
| **Fase 6** | Watchdog + Health + Recovery | Monitoramento e recuperação automática | Fase 5 |
| **Fase 7** | Scripts Android + Provision | Push de scripts, cadastro automático | Fase 3 |
| **Fase 8** | Screenshot + APK + Shell | Operações avançadas | Fase 3 |
| **Fase 9** | Logs + Backup + Update | Operações de admin | Fase 1 |
| **Fase 10** | Grupos + Schedule | Gestão coletiva | Fase 5 |
| **Fase 11** | systemd + deploy + docs | Produção | Todas |
| **Fase 12** | Tests + polimento | Qualidade | Todas |

---

## Fase 0 — Scaffold + Infraestrutura Base

**Objetivo:** Projeto roda, uvicorn serve HTML vazio, estrutura de diretórios criada.

### Tarefas
1. Criar estrutura completa de diretórios (conforme 01-ARQUITETURA.md)
2. `pyproject.toml` com dependências
3. `app/main.py` — FastAPI app mínimo com startup/shutdown
4. `app/core/lifecycle.py` — lifespan startup/shutdown hooks
5. Static files serving (templates/ e static/)
6. `templates/base.html` — layout com sidebar e header
7. `static/css/main.css` — design tokens, reset, layout
8. `static/js/app.js` — router hash, sidebar toggle, import map
9. `static/js/ws.js` — WebSocket client com reconnect
10. `.gitignore`
11. `deploy/panel.service`

### Verificação
- `uvicorn app.main:app --reload` inicia sem erro
- `http://localhost:8080` mostra layout com sidebar
- Console sem erros

---

## Fase 1 — ConfigurationManager + DeviceManager + Modelos

**Objetivo:** Sistema carrega YAML de configuração, dispositivos e grupos. Validação Pydantic. Se config vazio, marca wizard_pending.

### Tarefas
1. `app/models/config.py` — Pydantic models: SystemConfig, WatchdogConfig, PlayersConfig, MediaMTXConfig
2. `app/models/device.py` — DeviceConfig, DeviceState, DeviceCapabilities
3. `app/models/group.py` — GroupConfig
4. `app/core/config.py` — ConfigurationManager:
   - `load()` — carrega todos YAML
   - `save(config_name)` — salva YAML preservando estrutura
   - `is_wizard_complete()` — verifica config/ populado
   - `get_device(id)` / `list_devices()` / `add_device()` / `update_device()` / `delete_device()`
   - `get_group(id)` / `list_groups()` / `add_group()` / `update_group()` / `delete_group()`
5. `app/utils/yaml.py` — helpers: load_yaml, dump_yaml (preservando comentários com ruamel.yaml se necessário, senão pyyaml simples)
6. `app/managers/device.py` — DeviceManager mantém estado em memória, sincroniza com YAML
7. `tests/test_config.py` — testes de carga/salva/validação

### Verificação
- Colar YAML de exemplo em `config/` e `devices/` → backend carrega sem erro
- `GET /api/system/wizard-status` retorna `{"completed": true}`
- Remover config/ → retorna `{"completed": false}`
- Tests passam

---

## Fase 2 — Wizard (Frontend + Backend)

**Objetivo:** Primeira execução sem config → wizard guia usuário → gera todos YAMLs → painel funcional.

### Tarefas
1. `app/api/wizard.py` — endpoints:
   - `POST /api/wizard/start` — inicia sessão wizard
   - `POST /api/wizard/step/{n}` — submete dados de cada step
   - `GET /api/wizard/preview` — prévia dos YAMLs
   - `POST /api/wizard/finish` — gera YAMLs, marca completo, recarrega config
2. `app/core/lifecycle.py` — middleware: se wizard_pending e request não é /wizard → redirect
3. `templates/wizard.html` — wizard multi-step
4. `static/css/wizard.css`
5. `static/js/wizard.js` — lógica de navegação entre steps:

**Steps do Wizard:**
1. **Boas-vindas** — explicação
2. **Servidor** — IP do servidor, porta do painel
3. **MediaMTX** — URL API, porta RTSP, porta RTMP
4. **ADB** — porta padrão, timeout
5. **Players** — VLC (confirmar package/activity), MPV
6. **Watchdog** — intervalos, tentativas, cooldowns
7. **Grupos iniciais** — criar grupos
8. **Dispositivos iniciais** — adicionar 1..N TV Boxes (IP, nome, localização, grupo, path)
9. **Revisão** — preview de todos YAMLs
10. **Finalizar** — gerar YAMLs, reiniciar config

### Verificação
- Remover config/ → abrir painel → wizard aparece
- Completar wizard → YAMLs criados em config/, devices/, groups/
- Refresh → painel carrega normalmente (sem wizard)
- `GET /api/system/wizard-status` → `{"completed": true}`

---

## Fase 3 — ADBManager + API de Dispositivos

**Objetivo:** Backend conecta a TV Box via ADB, executa comandos. API CRUD de dispositivos.

### Tarefas
1. `app/managers/adb.py` — ADBManager:
   ```python
   class ADBManager:
       async def connect(ip: str, port: int) -> bool
       async def disconnect(ip: str)
       async def shell(ip: str, command: str, timeout: int) -> str
       async def push(ip: str, local: str, remote: str) -> bool
       async def pull(ip: str, remote: str, local: str) -> bool
       async def install(ip: str, apk_path: str) -> bool
       async def reboot(ip: str)
       async def force_stop(ip: str, package: str)
       async def start_intent(ip: str, template: str, **kwargs)
       async def screenshot(ip: str, remote_path: str) -> str
       async def get_activity(ip: str) -> str  # dumpsys activity
       async def is_connected(ip: str) -> bool
   ```
   - Usa `asyncio.create_subprocess_exec` para adb binary
   - Nunca monta comandos via string concatenation — usa lista de args
2. `app/api/devices.py` — CRUD endpoints:
   - GET /api/devices (lista)
   - GET /api/devices/{id} (detalhe)
   - POST /api/devices (cria — escreve YAML)
   - PUT /api/devices/{id} (atualiza)
   - DELETE /api/devices/{id} (remove — deleta YAML)
3. `app/api/system.py` — GET /api/system/health
4. `tests/test_adb.py` — mock subprocess, testar command building

### Verificação
- `GET /api/devices` retorna lista (com devices do wizard)
- ADBManager.conecta em TV Box real (testar com 192.168.254.252)
- `adb shell echo ok` retorna "ok" via API
- Criar/disparar device via POST escreve YAML em devices/

---

## Fase 4 — Dashboard + WebSocket

**Objetivo:** Painel dashboard funcional com cards, status em tempo real via WebSocket.

### Tarefas
1. `app/core/websocket.py` — WebSocketHub:
   - `publish(topic, event)` — broadcast para inscritos
   - `subscribe(ws, topic, filters)` — 管理 subscrições
   - Mantém registry de connections
2. `app/api/system.py` — GET /api/system/metrics (psutil CPU/RAM/disk/uptime)
3. `app/utils/system.py` — get_cpu(), get_ram(), get_disk(), get_uptime()
4. Task em background: a cada 5s, publica `system_metrics` via WS
5. `templates/dashboard.html` — cards:
   - TVs Online / TVs Offline / Streams Ativas
   - MediaMTX status, ADB status
   - CPU, RAM, Disco, Uptime
   - Eventos recentes (últimos 10)
   - Alertas ativos
6. `static/css/dashboard.css`
7. `static/js/dashboard.js` — conecta WS, renderiza cards, atualiza em tempo real
8. `static/js/components.js` — createStatCard(), createDeviceCard(), createToast(), createModal()

### Verificação
- Dashboard mostra CPU/RAM/disk atualizando ao vivo
- Lista de dispositivos com status (inicialmente unknown → após Fase 6 fica online)
- Toast aparece ao executar ação
- WebSocket mantém conexão com auto-reconnect

---

## Fase 5 — PlayerManager + MediaMTXManager

**Objetivo:** Abrir/fechar streams, ver paths do MediaMTX, associar path → device.

### Tarefas
1. `app/managers/player.py` — PlayerManager:
   - `start_stream(device)` — monta URL RTSP, executa script start_stream.sh via ADB
   - `stop_stream(device)` — force-stop do player
   - `get_current_player(device)` — via dumpsys activity
   - Usa `config/players.yml` para template do intent
   -_RTSP URL montada de: `rtsp://{host_ip}:{rtsp_port}/{device.rtsp_path}`
2. `app/managers/mediamtx.py` — MediaMTXManager:
   - `list_paths()` — GET {api_url}/v3/paths/list
   - `get_path(name)` — GET {api_url}/v3/paths/get/{name}
   - `create_path(name, config)` — POST {api_url}/v3/paths/add/{name}
   - `delete_path(name)` — DELETE
   - `health()` — GET {api_url}/health
   - Usa httpx (async)
3. `app/api/mediamtx.py` — endpoints REST (proxy)
4. `templates/mediamtx.html` — tabela de paths com readers, publisher, bitrate, tracks
5. `static/js/mediamtx.js`
6. `app/api/devices.py` — adicionar:
   - POST /api/devices/{id}/start-stream
   - POST /api/devices/{id}/stop-stream
7. `templates/device.html` — página individual do device com botões de start/stop
8. `static/js/device.js`

### Verificação
- `POST /api/devices/{id}/start-stream` abre VLC/MPV no TV Box real
- `GET /api/mediamtx/paths` retorna paths do MediaMTX em execução
- Página do device mostra botões funcionais
- Página MediaMTX atualiza paths em tempo real via WS

---

## Fase 6 — Watchdog + Health + Recovery

**Objetivo:** Monitoramento automático, recuperação automática em cascata.

### Tarefas
1. `app/managers/health.py` — HealthManager:
   - `check(device)` — executa multi-camada:
     1. Ping (asyncio subprocess `ping`)
     2. ADB connect + shell echo
     3. Activity check (dumpsys)
     4. MediaMTX API (path existe?)
     5. Player running (pidof)
   - `combine(results)` — matriz de status (conforme specs)
2. `app/managers/watchdog.py` — WatchdogManager:
   - asyncio task per-device
   - Loop: a cada `check_interval` → `health.check()` → publica WS
   - Se status != online → dispara `RecoveryService`
3. `app/services/recovery.py` — RecoveryService:
   - Implementa fluxo de recuperação em cascata (conforme specs)
   - Cada step publica evento `recovery` via WS
   - Respeita todos os timeouts e limites configuráveis
   - Após esgotar → publica alerta crítico
4. Publica health changes via WebSocket
5. Dashboard mostra status atualizado em tempo real
6. Device page mostra histórico de recovery
7. `tests/test_health.py` — mock ping/adb/mediamtx, testar combine()
8. `tests/test_watchdog.py` — mock recovery flow

### Verificação
- Desligar TV Box → status muda para offline em tempo real
- Ligar TV Box → recovery inicia, tenta reabrir player, status volta a online
- Desconectar Wi-Fi → recovery reinicia Wi-Fi
- Logs de watchdog aparecem em tempo real na página de logs
- Todos os tempos respeitam config/watchdog.yml

---

## Fase 7 — Scripts Android + Provision

**Objetivo:** Cadastro de TV Box faz push de scripts automaticamente. Operações usam scripts.

### Tarefas
1. Criar todos scripts em `scripts/android/` (start_stream.sh, stop_stream.sh, restart_wifi.sh, restart_eth.sh, capture.sh, install_apk.sh, healthcheck.sh, update.sh)
2. `app/services/provision.py` — ProvisionService:
   - `provision(device)` — mkdir /data/local/tmp/panel/, adb push todos scripts, chmod +x
   - Chamado automaticamente no POST /api/devices (criar)
   - POST /api/devices/{id}/provision — re-push manual
3. PlayerManager.start_stream passa a usar: `adb shell sh /data/local/tmp/panel/start_stream.sh rtsp://... package activity title`
4. RecoveryService passa a usar scripts em vez de comandos diretos
5. `templates/device.html` — botão "Re-instalar Scripts"

### Verificação
- Criar novo device → scripts são enviados via adb push
- `adb shell ls /data/local/tmp/panel/` mostra os scripts no TV Box
- Start stream via script funciona
- Recovery usa scripts
- Re-push manual funciona

---

## Fase 8 — Screenshot + APK + Shell Remoto

**Objetivo:** Operações avançadas de administração.

### Tarefas
1. **Screenshot:**
   - ADBManager.screenshot(ip, remote_path) — executa capture.sh
   - adb pull screenshot para servidor
   - Salva em `backups/screenshots/{device_id}/latest.png`
   - GET /api/devices/{id}/screenshot → retorna imagem
   - POST /api/devices/{id}/screenshot → captura nova
   - Device page mostra screenshot com auto-refresh
2. **APK:**
   - POST /api/devices/{id}/install-apk (multipart upload)
   - Salva APK temporariamente
   - adb push APK para /data/local/tmp/panel/
   - adb shell pm install
   - Log resultado
   - Device page: botão upload APK
3. **Shell remoto:**
   - WebSocket /ws/shell/{device_id}
   - Cliente envia comando → executa via adb shell → retorna output
   - History de comandos na session
   - Log de todos os comandos em user.log
   - `templates/shell.html` — terminal emulado (estilo xterm)
   - `static/js/shell.js`

### Verificação
- Screenshot do TV Box aparece no painel
- Upload de APK instala no TV Box
- Shell remoto executa comandos e mostra output
- Comandos de shell são logados

---

## Fase 9 — Logs + Backup + Update

**Objetivo:** Operações de administração e manutenção.

### Tarefas
1. **Logs:**
   - `app/managers/log.py` — LogManager:
     - Múltiplos loggers (system, adb, mediamtx, watchdog, user, api)
     - Cada um escreve em arquivo próprio
     - `search(filters)` — le arquivo com filtros
     - `tail(source)` — retorna últimas N linhas
     - WebSocket tail em tempo real
   - `app/api/logs.py`:
     - GET /api/logs?source=&level=&device_id=&from=&to=&q=&page=
     - GET /api/logs/download?source=&from=&to=
     - GET /api/logs/sources
   - `templates/logs.html` — busca, filtros, tabela, download
   - `static/js/logs.js` — busca + auto-scroll para live tail
2. **Backup:**
   - `app/managers/backup.py` — BackupManager:
     - `export()` — cria ZIP de config/ + devices/ + groups/
     - `import(zip)` — valida e restaura
     - `list_backups()` — lista backups em backups/
   - `app/api/backup.py`
   - `templates/backup.html`
   - `static/js/backup.js`
3. **Update:**
   - `app/managers/update.py` — UpdateManager:
     - `check()` — git fetch + comparar HEAD
     - `apply()` — git pull + migration + restart
   - `app/services/migration.py` — MigrationService:
     - `migrate(old_version, new_version)` — ajusta YAML se schema mudou
   - `templates/settings.html` — inclui seção update
   - `static/js/update.js`

### Verificação
- Logs filtáveis por fonte, nível, device, texto, data
- Download de log funciona
- Backup export gera ZIP com todos YAML
- Backup import restaura config
- Update check detecta mudanças
- Update apply faz git pull

---

## Fase 10 — Grupos + Schedule

**Objetivo:** Gestão coletiva e agendamento de ações.

### Tarefas
1. `app/api/groups.py` — CRUD endpoints + ações coletivas:
   - POST /api/groups/{id}/start-stream (todos devices do grupo)
   - POST /api/groups/{id}/reboot
   - POST /api/groups/{id}/stop-stream
2. `templates/group.html` — lista devices do grupo, ações coletivas
3. `app/managers/schedule.py` — ScheduleManager:
   - Lê schedules de devices e groups
   - asyncio task que verifica cron expressions
   - Executa ação (start_stream, stop_stream, reboot)
   - Biblioteca `croniter` para parse de cron
4. `static/js/groups.js`

### Verificação
- Start stream em grupo abre stream em todos devices
- Schedule abre stream às 8h automaticamente
- Remover grupo não deleta devices

---

## Fase 11 — systemd + Deploy + Documentação

**Objetivo:** Deploy em produção Debian 13.

### Tarefas
1. `deploy/install.sh` — script de instalação:
   - Instala Python 3.12+, pip
   - Cria venv
   - pip install -r requirements.txt
   - Cria usuário `panel`
   - Copia arquivos para /opt/panel
   - Instala systemd units (panel.service, mediamtx.service)
   - Configura firewall (abre portas configuradas)
   - Habilita serviços
2. `deploy/panel.service` — systemd unit (final)
3. `deploy/mediamtx.service` — systemd unit
4. **Documentação:**
   - `docs/README.md` — visão geral
   - `docs/INSTALL.md` — instalação Debian 13
   - `docs/ARCHITECTURE.md` — este arquivo (01-ARQUITETURA.md)
   - `docs/ADDING_DEVICE.md` — como adicionar TV
   - `docs/UPDATING.md` — como atualizar
   - `docs/BACKUP.md` — backup/restore
   - `docs/APK_INSTALL.md` — instalar APK
   - `docs/CHANGING_PLAYER.md` — alterar player
   - `docs/GROUPS.md` — criar grupos
   - `docs/WATCHDOG.md` — configurar watchdog
   - `README.md` — raiz do projeto

### Verificação
- Instalação limpa em Debian 13 funciona
- `systemctl start panel` inicia serviço
- `systemctl enable panel` persiste reboot
- Toda documentação está completa e correta

---

## Fase 12 — Tests + Polimento

**Objetivo:** Qualidade, robustez, tratamento de erros.

### Tarefas
1. **Tests:**
   - `tests/test_config.py` — ConfigurationManager
   - `tests/test_adb.py` — ADBManager (mock subprocess)
   - `tests/test_health.py` — HealthManager combine()
   - `tests/test_watchdog.py` — recovery flow (mock)
   - `tests/test_api.py` — endpoints REST
   - `tests/test_websocket.py` — WS hub
   - `tests/test_yaml.py` — validação YAML
   - `pytest` + `pytest-asyncio`
   - CI: GitHub Actions (opcional)
2. **Polimento:**
   - Tratamento de erros em todos os endpoints (try/except, HTTP exception)
   - Loading states na UI
   - Empty states na UI (sem devices, sem logs, etc.)
   - Feedback visual em operações (spinner, disabled, confirmed)
   - Confirmação dupla em operações destrutivas
   - Responsividade mobile
   - Dark theme consistente
   - Atalhos de teclado (opcional)
3. **Performance:**
   - WebSocket throttling (não publicar mais de 1 event/sec por device para health)
   - Log rotation (configurar logging.handlers.RotatingFileHandler)
   - Static files com cache headers

### Verificação
- `pytest` passa com cobertura > 80%
- UI sem erros de console
- Operações destrutivas pedem confirmação
- Mobile layout funciona
- Log rotation configurado

---

## Ordem de Dependências (DAG)

```
Fase 0 (Scaffold)
  ├── Fase 1 (Config + Models)
  │     ├── Fase 2 (Wizard) ────────────┐
  │     ├── Fase 9 (Logs + Backup + Update)
  │     └── Fase 3 (ADB + Device API)
  │           ├── Fase 5 (Player + MediaMTX)
  │           │     ├── Fase 6 (Watchdog + Health + Recovery)
  │           │     └── Fase 10 (Grupos + Schedule)
  │           ├── Fase 4 (Dashboard + WebSocket)
  │           ├── Fase 7 (Scripts + Provision)
  │           └── Fase 8 (Screenshot + APK + Shell)
  └── Fase 11 (Deploy + Docs) ← após todas
  └── Fase 12 (Tests + Polimento) ← após Fase 11
```

**Paralelizáveis:** Fases 4, 7, 8 podem correr em paralelo após Fase 3. Fases 9 e 10 após Fase 5.

---

## Critério de Aceite por Fase

Cada fase só é considerada completa quando:
1. Código implementado e funcionando
2. Verificação da fase executada com sucesso
3. Sem erros de console/terminal
4. Commit com mensagem descritiva