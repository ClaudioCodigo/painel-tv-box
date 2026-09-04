# 🖥️ Painel TV Box

Painel web para **gerenciamento e monitoramento de TV Boxes Android** que reproduzem streams RTSP via **MediaMTX**. Controle total pela rede: abrir/fechar stream, reboot, shell remoto, screenshot, instalar APK — com **watchdog** que recupera quedas automaticamente e uma interface **monocromática** com temas claro/escuro.

> **Plataforma: Windows 10+ / Windows Server 2019+** (requisito do cliente — instalação por duplo clique, ver [Instalação](#-instalação)).
> Estado atual: Fases A–D do redesign + refatoração Windows-only · **111 testes** · heartbeat device→servidor · política ADB×scrcpy.

---

## ✨ Funcionalidades

- 📡 **Dashboard em tempo real** — cards V2 por TV Box (status por forma+ícone+rótulo, motivo, frescura "visto há Ns", linha do watchdog), toolbar com busca/filtro/sort e **feed de eventos ao vivo** via WebSocket
- 🎬 **Streaming** — abrir/fechar streams RTSP em VLC/MPV (via ADB ou **sem ADB** pelo canal de comandos do heartbeat)
- 🔄 **Watchdog** — health check ADB-light (heartbeat/scrcpy) + recuperação em cascata (player retry → Wi-Fi → Ethernet → reboot) com eventos no feed
- 💓 **Heartbeat device→servidor** — o TV Box se reporta por HTTP (zero ADB): liveness, activity em foco e **execução de comandos localmente** (start/stop stream, reboot) sem derrubar o scrcpy
- 📸 **Screenshot** — captura remota de tela
- 📦 **APK** — instalação/remoção remota de aplicativos
- 🖥️ **Shell remoto** — terminal interativo (WebSocket + fallback REST) com histórico
- 📋 **Logs** — busca com filtros, chips de nível, auto-refresh controlável e download
- 💾 **Backup** — export/import completo em **pasta de dados fora do repositório** (`%LOCALAPPDATA%\PanelTVBox`)
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

**ADB × scrcpy (regra central):** enquanto o scrcpy estiver ativo (ou o device na rede por heartbeat), o painel **não executa comandos ADB** no device — o scrcpy nunca cai por ação do painel. O painel usa um **servidor ADB isolado** (porta 5038) e o scrcpy roda no default (5037). Detalhes: [`docs/09-HEARTBEAT-SPEC.md`](docs/09-HEARTBEAT-SPEC.md).

## 🧰 Stack

| Componente | Tecnologia |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic v2 |
| Frontend | HTML + CSS + JavaScript puro (sem framework, sem CDN, sem build) |
| Persistência | YAML (um arquivo por dispositivo/grupo) |
| Tempo real | WebSocket (`/ws`, `/ws/shell/{id}`) |
| Streaming | MediaMTX (RTSP/RTMP/WebRTC) |
| Controle remoto | ADB via TCP + heartbeat HTTP |
| Serviços (produção) | NSSM 2.24 (painel `panel-tvbox` + `mediamtx`, auto-restart) |
| Dados em runtime | `%LOCALAPPDATA%\PanelTVBox` (env `PANEL_DATA_DIR`) |

---

## 🚀 Início rápido

### Desenvolvimento (Windows)

```powershell
git clone https://github.com/ClaudioCodigo/painel-tv-box.git
cd painel-tv-box

python -m venv .venv
.venv\Scripts\python -m pip install .          # instala dependências (pyproject)
# ou, se preferir explícito:
.venv\Scripts\python -m pip install "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" pydantic pyyaml httpx psutil python-multipart

.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Abra `http://localhost:8080` e use o **token de acesso** (ver [Autenticação](#-autenticação)).

### Instalação (produção, Windows 10+)

**Duplo clique em `instalar.bat`** (na raiz do projeto). O instalador (`deploy/install.ps1`):

1. Baixa os binários automaticamente — **ffmpeg, ADB/platform-tools, MediaMTX e NSSM** (sem winget);
2. Copia o código para **`C:\PanelTVBox`** preservando `.git` (o painel se atualiza por `git pull`);
3. Cria o venv Python com as dependências;
4. Registra **painel (`panel-tvbox`) e MediaMTX (`mediamtx`) como serviços NSSM** com auto-restart;
5. Libera o **firewall só para a LAN** (8080/8554/1935/9997, `LocalSubnet`); porta ADB 5555 fica **fechada**;
6. Abre `http://localhost:8080` — na 1ª execução o **wizard** cria as configs.

Flags opcionais: `-AllowAdb` (abre 5555 só na LAN + bloqueio explícito em Public/Domain), `-NoMediamtx`, `-SkipVenv`, `-RepoUrl`. Manual completo: [`docs/INSTALL.md`](docs/INSTALL.md).

### Testes

```powershell
.venv\Scripts\python -m pytest -q    # 111 testes
node --check static\js\*.js          # sintaxe de todo o JS
```

---

## 🔐 Autenticação (usuário/senha do administrador)

- O **administrador** é criado no **wizard** (1ª instalação) ou em **Configurações → Segurança** (criar/alterar). Credenciais ficam em `config/admin.json` (gitignored), com hash **PBKDF2-SHA256** (salt aleatório) e comparação em tempo constante.
- `POST /api/auth/login` com `{"username", "password"}` → **token de sessão** (HMAC-SHA256, expira em 12h); envie via header `Authorization: Bearer <token>` ou `?token=` (downloads/imagens).
- Rotas públicas: `/api/system/health`, `/api/auth/status`, `/api/auth/login` e o wizard (antes de concluir).
- **Backward compat:** enquanto não houver admin configurado, o token legado `config/.panel_token` continua valendo; **ao criar o admin, apenas sessões de login são aceitas**.
- Desligar a exigência: `config/system.yml → security: {enabled: false}`.
- O **heartbeat** usa uma chave dedicada (`security.heartbeat_key`), não o token do painel.

> ⚠️ **Config, devices e groups são LOCAIS** (gitignored): contêm IPs, `heartbeat_key` e credenciais da máquina e **não sobem no `git push`**. O repositório mantém apenas templates `.example`; o painel cria os arquivos reais no 1º boot. **Chaves ADB (`adbkey`) e `heartbeat.conf` também são credenciais locais e nunca devem ser commitadas.**

## 💾 Dados em runtime (fora do git)

Backups, screenshots e APKs ficam em uma pasta de dados — **git push/pull não mistura dados de máquinas**:

| Fonte | Local |
|---|---|
| env `PANEL_DATA_DIR` | qualquer (setado pelo serviço) |
| default (Windows) | `%LOCALAPPDATA%\PanelTVBox` |

O instalador aponta `PANEL_DATA_DIR` para essa pasta nos serviços; logs de stdout/stderr dos serviços também vão para `%LOCALAPPDATA%\PanelTVBox\logs`.

---

## 📁 Estrutura

```
├── app/              # Backend FastAPI (api/, core/, managers/, models/, services/, utils/)
├── static/           # Frontend (css/ tokens+pages, js/ 20 módulos)
├── templates/        # base.html (SPA)
├── config/           # system.yml, watchdog.yml, players.yml, mediamtx.yml, .panel_token (gitignored)
├── devices/          # Um YAML por TV Box (gitignored)
├── groups/           # Um YAML por grupo (gitignored)
├── scripts/android/  # Scripts enviados aos TV Boxes (start_stream, heartbeat, healthcheck...)
├── deploy/           # install.ps1 (instalador Windows) + legacy/ (Linux arquivado)
├── tests/            # 111 testes pytest
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
