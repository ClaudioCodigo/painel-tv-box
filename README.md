# 🖥️ Painel TV Box

Painel web para **gerenciamento e monitoramento de TV Boxes Android** que reproduzem streams RTSP via **MediaMTX**. Controle total pela rede: abrir/fechar stream, reboot, shell remoto, screenshot, instalar APK — com **watchdog** que recupera quedas automaticamente e uma interface **monocromática** com temas claro/escuro.

> Estado atual: Fases A–D do redesign implementadas · **104 testes** · heartbeat device→servidor · política ADB×scrcpy.

---

## ✨ Funcionalidades

- 📡 **Dashboard em tempo real** — cards V2 por TV Box (status por forma+ícone+rótulo, motivo, frescura "visto há Ns", linha do watchdog), toolbar com busca/filtro/sort e **feed de eventos ao vivo** via WebSocket
- 🎬 **Streaming** — abrir/fechar streams RTSP em VLC/MPV (via ADB ou **sem ADB** pelo canal de comandos do heartbeat)
- 🔄 **Watchdog** — health check ADB-light (ICMP/heartbeat/scrcpy) + recuperação em cascata (player retry → Wi-Fi → Ethernet → reboot) com eventos no feed
- 💓 **Heartbeat device→servidor** — o TV Box se reporta por HTTP (zero ADB): liveness, activity em foco e **execução de comandos localmente** (start/stop stream, reboot) sem derrubar o scrcpy
- 📸 **Screenshot** — captura remota de tela
- 📦 **APK** — instalação/remoção remota de aplicativos
- 🖥️ **Shell remoto** — terminal interativo (WebSocket + fallback REST) com histórico
- 📋 **Logs** — busca com filtros, chips de nível, auto-refresh controlável e download
- 💾 **Backup** — export/import completo em **pasta de dados fora do repositório** (appdata/data dir)
- 👥 **Grupos** — ações coletivas (start/stop/reboot) + página de grupo com resumo de status
- 🎛️ **scrcpy** — gestão de versões, mirroring/streaming com args presets e badge de sessão
- 🌗 **Temas** claro/escuro/sistema (monocromático, sem CDN, sem build step)

---

## 🏗️ Arquitetura

```
OBS → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)
                          ↑
                    Painel Web (FastAPI)
                          │
        ┌─────────────────┼──────────────────┐
     ADB (TCP 5555)   Heartbeat HTTP    MediaMTX API
     (ações sob       (device→painel,    (stream state)
      demanda)         zero ADB)
```

**ADB × scrcpy (regra central):** enquanto o scrcpy estiver ativo (ou o device na rede por heartbeat/ping), o painel **não executa comandos ADB** no device — o scrcpy nunca cai por ação do painel. O painel usa um **servidor ADB isolado** (porta 5038) e o scrcpy roda no default (5037). Detalhes: [`docs/09-HEARTBEAT-SPEC.md`](docs/09-HEARTBEAT-SPEC.md).

## 🧰 Stack

| Componente | Tecnologia |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 |
| Frontend | HTML + CSS + JavaScript puro (sem framework, sem CDN, sem build) |
| Persistência | YAML (um arquivo por dispositivo/grupo) |
| Tempo real | WebSocket (`/ws`, `/ws/shell/{id}`) |
| Streaming | MediaMTX (RTSP/RTMP/WebRTC) |
| Controle remoto | ADB via TCP + heartbeat HTTP |
| Dados em runtime | `%LOCALAPPDATA%\PanelTVBox` · `/var/lib/panel-tvbox` (env `PANEL_DATA_DIR`) |

---

## 🚀 Início rápido

### Desenvolvimento (Windows/macOS/Linux)

```bash
git clone https://github.com/ClaudioCodigo/painel-tv-box.git
cd painel-tv-box

python -m venv .venv
.venv/Scripts/python -m pip install .          # instala dependências (pyproject)
# ou, se preferir explícito:
.venv/Scripts/python -m pip install "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" pydantic pyyaml httpx psutil python-multipart

.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Abra `http://localhost:8080` e use o **token de acesso** (ver [Autenticação](#-autenticação)).

### Produção (Debian 13 Trixie)

```bash
sudo bash deploy/install.sh                          # instalação completa
sudo bash deploy/install.sh --lan 192.168.1.0/24     # firewall só para a sub-rede
sudo bash deploy/install.sh --allow-adb              # (opcional) abre 5555/tcp p/ ADB externo
sudo bash deploy/install.sh --no-mediamtx            # (opcional) sem MediaMTX
```

O script cria usuários **não-root** (`panel`, `mediamtx`), usa `/var/lib/panel-tvbox` como pasta de dados, baixa o **MediaMTX** do GitHub, configura **systemd** (com hardening) e o **firewall restrito à LAN**. Manual: [`docs/INSTALL.md`](docs/INSTALL.md).

### Testes

```bash
.venv/Scripts/python -m pytest -q    # 104 testes
node --check static/js/*.js          # sintaxe de todo o JS
```

---

## 🔐 Autenticação

- Token compartilhado gerado no primeiro boot em **`config/.panel_token`** (gitignored).
- `POST /api/auth/login` com `{"token": "..."}`; envie via header `Authorization: Bearer <token>` ou `?token=` (downloads/imagens).
- Rotas públicas: `/api/system/health`, `/api/auth/login` e o wizard (antes de concluir).
- Desligar: `config/system.yml → security: {enabled: false}`.
- O **heartbeat** usa uma chave dedicada (`security.heartbeat_key`), não o token do painel.

## 💾 Dados em runtime (fora do git)

Backups, screenshots e APKs ficam em uma pasta de dados — **git push/pull não mistura dados de máquinas**:

| SO | Local |
|---|---|
| env `PANEL_DATA_DIR` | qualquer (usado pelo systemd) |
| Windows | `%LOCALAPPDATA%\PanelTVBox` |
| Linux (serviço) | `/var/lib/panel-tvbox` |
| Linux (usuário) | `~/.local/share/panel-tvbox` |
| macOS | `~/Library/Application Support/PanelTVBox` |

---

## 📁 Estrutura

```
├── app/              # Backend FastAPI (api/, core/, managers/, models/, services/, utils/)
├── static/           # Frontend (css/ tokens+pages, js/ 20 módulos)
├── templates/        # base.html (SPA)
├── config/           # system.yml, watchdog.yml, players.yml, mediamtx.yml, .panel_token
├── devices/          # Um YAML por TV Box
├── groups/           # Um YAML por grupo
├── scripts/android/  # Scripts enviados aos TV Boxes (start_stream, heartbeat, healthcheck...)
├── deploy/           # install.sh + systemd units (panel, mediamtx)
├── tests/            # 104 testes pytest
└── docs/             # Specs, plano, auditoria e referência técnica
```

## 📚 Documentação

- [**Guia técnico completo (contexto para LLM/agentes)**](docs/LLM.md) — referência atual do código e da API
- [**Registro de implementação**](docs/10-IMPLEMENTACAO.md) — o que foi feito (redesign, Fases A–D, ADB×scrcpy) e o que falta
- [Auditoria](docs/AUDITORIA.md) — achados e correções (Rodadas 1 e 2)
- Specs de design: [`06-UI-REDESIGN-SPEC`](docs/06-UI-REDESIGN-SPEC.md) · [`07-UX-REMODEL-PLAN`](docs/07-UX-REMODEL-PLAN.md) · [`08-UX-CHANGE-SPEC`](docs/08-UX-CHANGE-SPEC.md) · [`09-HEARTBEAT-SPEC`](docs/09-HEARTBEAT-SPEC.md)
- Guias: [Instalação](docs/INSTALL.md) · [Adicionar TV Box](docs/ADDING_DEVICE.md) · [Grupos](docs/GROUPS.md) · [Watchdog](docs/WATCHDOG.md) · [Player](docs/CHANGING_PLAYER.md) · [APK](docs/APK_INSTALL.md) · [Backup](docs/BACKUP.md) · [Atualizar](docs/UPDATING.md)

## 📄 Licença

MIT
