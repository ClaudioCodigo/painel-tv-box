# HANDOFF — Refatoração Windows-only + Stream de Apps Office

> **Gerado em:** 2026-08-06 (troca de harness)
> **Autor:** sessão anterior (pi)
> **Leia antes:** [`IDEA.md`](../IDEA.md) (regras do projeto) → [`docs/LLM.md`](LLM.md) (referência técnica atual) → este handoff.
> **Regra absoluta do projeto:** NÃO invente requisitos; apresente alternativas com prós/contras antes de decisões arquiteturais (IDEA.md).

---

## 1. Resumo executivo

O **Painel TV Box** é um painel web (FastAPI + JS puro) que gerencia TV Boxes Android (streams RTSP via MediaMTX, controle via ADB TCP + heartbeat HTTP). O cliente descartou Linux: **o painel agora roda SOMENTE em Windows 10+**. Decisão desta sessão: serviços via **NSSM** (Opção A). Novo requisito do cliente: **stream de apps da suíte Office** (detalhes ainda a confirmar — §6).

Estado atual: `main` com 26 commits, **111 testes pytest passando**, Fases A–D do redesign completas, deploy Debian 13 documentado (a ser substituído).

---

## 2. Decisões tomadas (já confirmadas com o usuário)

1. **Linux descartado** — remover/arquivar tudo de Debian/systemd; o painel só precisa rodar em Windows 10+.
2. **Serviços Windows via NSSM** (Opção A — o usuário aprovou): wrapper de terceiros que registra qualquer exe como serviço Windows com auto-restart. Alternativas recusadas: Task Scheduler nativo (sem auto-restart, depende de sessão), winSW (equivalente ao NSSM), painel-gerencia-MediaMTX como subprocess (mudaria arquitetura).
3. **Binários baixados pelo install.ps1** (ffmpeg, ADB/platform-tools, MediaMTX, NSSM) — zero fricção pro cliente não-técnico; não depender de winget (ausente em vários Windows 10 corporativos).
4. **Instalar em `C:\PanelTVBox` preservando `.git`** — o `UpdateManager` (`app/managers/update.py`) faz `git pull` no `project_root`; no deploy Linux o rsync excluía `.git` e o update quebrava. No Windows já nasce certo.
5. **Data dir** = `%LOCALAPPDATA%\PanelTVBox` (já é o default de `get_data_dir()` em `app/utils/system.py`).
6. **Launcher** `instalar.bat` na raiz → chama `deploy/install.ps1` com `-ExecutionPolicy Bypass` (duplo clique).

## 3. Assets validados (nesta sessão, via API GitHub)

| Componente | Asset / URL | Tipo |
|---|---|---|
| MediaMTX | `mediamtx_v1.20.0_windows_amd64.zip` (resolver via API `https://api.github.com/repos/bluenviron/mediamtx/releases/latest`, filtrar asset com `windows_amd64` + `.zip`) | zip |
| NSSM | `https://nssm.cc/download` → `nssm-2.24.zip` | zip |
| ADB | `https://dl.google.com/android/repository/platform-tools-latest-windows.zip` | zip |
| ffmpeg | `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip` (build essenciais; inclui `bin/ffmpeg.exe`) | zip |
| scrcpy | já gerenciado pelo painel (`ScrcpyManager` baixa `scrcpy-win64-vX.zip` sozinho) | — |

Padrão do install.sh original (referência de lógica): resolve o asset real do MediaMTX pela API do GitHub em vez de assumir o nome — replicar em PowerShell com `Invoke-RestMethod`.

---

## 4. Tarefa 1 — Criar `deploy/install.ps1` (+ `instalar.bat`)

Espelho do `deploy/install.sh` (Debian) em PowerShell. Passos:

1. **Preflight**: verificar admin (elevar se preciso), Windows 10+ (`[System.Environment]::OSVersion.Version.Major -ge 10`), diretórios.
2. **Python + Git**: tentar `winget install Python.Python.3.12` e `Git.Git`; fallback → mensagem clara de instalação manual. Verificar `python --version` ≥ 3.11.
3. **Código**: copiar do diretório do repo atual para `C:\PanelTVBox` **preservando `.git`** (excluir `.venv`, `__pycache__`, `logs`, `backups`, `scrcpy/versions`, `scrcpy/downloads`, `.reasonix`). Se destino vazio e repo não local → `git clone https://github.com/ClaudioCodigo/painel-tv-box.git C:\PanelTVBox`.
4. **venv + pip**: `python -m venv C:\PanelTVBox\.venv` → `pip install .` (fallback: deps explícitas do pyproject).
5. **platform-tools**: extrair para `C:\PanelTVBox\platform-tools`; setar `adb.binary` no `config/system.yml` para `C:\PanelTVBox\platform-tools\adb.exe` (⚠️ só se o user não configurou manualmente; ver como `ConfigurationManager` carrega/salva `system.yml`).
6. **MediaMTX**: extrair para `C:\PanelTVBox\mediamtx\` (exe + pasta). Config real do MediaMTX = `config/mediamtx.generated.yml` (gerada pelo painel; o wizard/update a regenera).
7. **ffmpeg**: extrair para `C:\PanelTVBox\ffmpeg\bin\ffmpeg.exe`; garantir que o serviço do painel encontre no PATH (NSSM `AppEnvironmentExtra` com `PATH=...`).
8. **NSSM — registrar serviços** (comandos de referência):
   ```powershell
   nssm install panel-tvbox "C:\PanelTVBox\.venv\Scripts\uvicorn.exe" "app.main:app --host 0.0.0.0 --port 8080 --workers 1"
   nssm set panel-tvbox AppDirectory "C:\PanelTVBox"
   nssm set panel-tvbox AppEnvironmentExtra PANEL_DATA_DIR=%LOCALAPPDATA%\PanelTVBox PANEL_ADB_SERVER_PORT=5038 PANEL_MEDIAMTX_CONFIG=C:\PanelTVBox\config\mediamtx.generated.yml
   nssm set panel-tvbox AppRestartDelay 5000
   nssm install mediamtx "C:\PanelTVBox\mediamtx\mediamtx.exe" "C:\PanelTVBox\config\mediamtx.generated.yml"
   nssm set mediamtx AppRestartDelay 3000
   nssm start panel-tvbox; nssm start mediamtx
   ```
   ⚠️ NSSM com espaços no caminho: usar `nssm set <svc> AppParameters` para argumentos; caminhos com aspas funcionam.
9. **Firewall** (Windows Firewall, liberar só LAN — espelhar o ufw do install.sh):
   ```powershell
   New-NetFirewallRule -DisplayName "Painel TV Box 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -RemoteAddress LocalSubnet
   # 8554 (RTSP), 1935 (RTMP), 9997 (MediaMTX API) — mesmo padrão
   # 5555 (ADB) opcional via flag -AllowAdb (⚠️ nunca abrir para o mundo)
   ```
10. **Sincronizar config inicial**: copiar `config/*.yml.example` → `*.yml` se ausentes (o painel já faz no 1º boot, verificar); gerar `mediamtx.generated.yml` (o wizard gera; se `wizard_completed: false`, ok deixar).
11. **Iniciar serviços + resumo** (URL do painel, caminho do código, próximo passo = wizard).

**Flags sugeridas** (espelhar install.sh): `-NoMediamtx`, `-AllowAdb`, `-SkipVenv`, `-RepoUrl`. `-Help`.

**Testes do script**: rodar com `powershell -ExecutionPolicy Bypass -File deploy/install.ps1 -Help`; `node --check`; pytest. Não dá para testar a instalação completa na máquina dev sem risco — ao menos validar sintaxe e fluxo de download dos 4 assets.

---

## 5. Tarefa 2 — Refatoração Windows-only (limpeza do Linux)

Inventário do que é Linux-specific (levantado nesta sessão):

| Arquivo | Ação |
|---|---|
| `deploy/install.sh` | Substituir por `install.ps1`; mover para `deploy/legacy/` ou remover (propor: arquivar em `deploy/legacy/` p/ histórico, ou remover — decisão do usuário) |
| `deploy/panel.service`, `deploy/mediamtx.service` | Idem (systemd não existe no Windows) |
| `app/managers/scrcpy.py:562` | Mensagem `"apt install ffmpeg"` → referenciar o ffmpeg baixado pelo install.ps1 (PATH) |
| `app/managers/scrcpy.py` `_platform_info` | Tem branches linux/macos; pode simplificar p/ Windows-only ou manter (inofensivo) — decidir |
| `app/utils/system.py` `get_data_dir` | Já é Windows-first (docstring diz "roda apenas em Windows"); pode limpar fallbacks Linux/macOS |
| `tests/test_scrcpy.py` `test_platform_info_linux` | Ajustar/remover se `_platform_info` virar Windows-only |
| `README.md` | Seções "Produção (Debian 13)", tabela de data dir com Linux, `deploy/install.sh` → instruções Windows |
| `docs/INSTALL.md` | Reescrever para Windows (passo a passo do install.ps1) |
| `docs/LLM.md` | Atualizar: "Como rodar" (produção Windows), data dir, `deploy/`, testes (111 não 70), remover menções Debian/systemd |
| `app/core/config.py` `PANEL_MEDIAMTX_CONFIG` | Já lê da env var — ok; no Windows o install.ps1 seta nos serviços |
| `app/managers/health.py` ping | Já é cross-platform (`os.name == "nt"` → `-n 1 -w`) — ✅ sem mudança |
| `app/managers/update.py` | `git` funciona no Windows (Git instalado) — ✅ |

⚠️ **Não** tocar em `scripts/android/*.sh` (rodam NO TV Box Android, não no servidor). `deploy/mediamtx.service` tem hardening que vira NSSM equivalente (`AppRestartDelay`, sem no-new-privileges no NSSM — ok).

Docs históricos (AUDITORIA.md, 10-IMPLEMENTACAO.md, specs) **não** precisam ser reescritos — registram o passado.

---

## 6. Tarefa 3 — Requisito do cliente: Stream de apps da suíte Office

**O que se sabe:** o cliente pediu "algo bem específico da Microsoft" = **stream de apps da suíte Office**. Interpretação mais provável (a confirmar com o usuário):

> Transmitir a **tela de apps Office rodando na máquina Windows** (ex.: PowerPoint em apresentação, dashboard Excel, Word) para os **TV Boxes** via o pipeline já existente: `ffmpeg captura a tela → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)`.

**Isso encaixa na arquitetura existente** — o painel já:
- cria/consome paths no MediaMTX via API (`MediaMTXManager`, `/api/mediamtx/paths`);
- tem pipeline de streaming de tela (`ScrcpyManager.start_streaming`: `adb exec-out screenrecord | ffmpeg → RTMP → MediaMTX`);
- abre stream no TV Box (`PlayerManager.start_stream` → `rtsp://HOST:8554/<path>`).

**Hipótese de implementação (esboço p/ validar com o usuário):**
1. Botão/rota no painel tipo `/api/office/start` (ex.: criar path `office/<nome>` no MediaMTX via API + spawn `ffmpeg -f gdigrab` capturando janela/fullscreen → `-f flv rtmp://localhost:1935/office/<nome>`);
2. Seleção de **janela** do app Office (gdigrab suporta `-i title="<título da janela>"` ou `hwnd`) — enumeração de janelas acessível via PowerShell/`ctypes` no Windows;
3. TV Box abre `rtsp://<host>:8554/office/<nome>` (reaproveitar `PlayerManager`);
4. Stop = matar processo ffmpeg + remover path.

**Perguntas em aberto (perguntar ao usuário ANTES de implementar — regra IDEA.md):**
1. Qual app da suíte exatamente? (PowerPoint p/ apresentação em TV é o mais provável; Excel dashboard; Word; Teams?)
2. Fullscreen da tela ou **janela específica** do app?
3. Precisa **áudio** junto (ex.: vídeo com narração)? gdigrab só captura vídeo; áudio exigiria device de áudio virtual.
4. Quantos fluxos simultâneos (1 sala? N TVs com apps diferentes? por TV Box?)
5. Quem inicia: o painel (botão "Transmitir") ou o apresentador no PC?
6. O TV Box é só **display** (one-way, apresentador controla no PC) ou precisa interação?
7. Relação com a feature existente de scrcpy/streaming — substituir ou coexistir?
8. O requisito pode ser outra coisa? (ex.: o painel controlar Office nos TV Boxes — improvável, TV Box é Android sem Office desktop)

---

## 7. Como rodar / testar (referência)

```bash
# Testes (Windows, do repo)
.venv/Scripts/python -m pytest -q          # 111 passed (estado atual)
node --check static/js/*.js                # 20 módulos JS

# Rodar o painel em dev
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080

# Token de acesso: config/.panel_token (gitignored, gerado no 1º boot)
```

Stack: Python 3.11+ / FastAPI / Pydantic v2 / YAML / WebSocket / JS puro (SPA sem build, sem CDN). Persistência: `config/`, `devices/*.yml`, `groups/*.yml` (locais, gitignored, com templates `.example`).

---

## 8. Referências-chave

| Doc | O que tem |
|---|---|
| [`IDEA.md`](../IDEA.md) | Requisitos originais + regra absoluta (não inventar requisitos; apresentar alternativas) |
| [`docs/LLM.md`](LLM.md) | Referência técnica ATUAL do código e da API (contrato real) |
| [`docs/09-HEARTBEAT-SPEC.md`](09-HEARTBEAT-SPEC.md) | Heartbeat + regra ADB×scrcpy (§3.3) |
| [`docs/10-IMPLEMENTACAO.md`](10-IMPLEMENTACAO.md) | Histórico de implementação (Fases A–D, scrcpy headless) |
| [`docs/AUDITORIA.md`](AUDITORIA.md) | Achados de segurança (Rodadas 1 e 2) |
| [`deploy/install.sh`](../deploy/install.sh) | Lógica a espelhar no PowerShell (downloads, flags, firewall) |

## 9. Ordem sugerida de execução (próxima sessão)

1. Confirmar com o usuário: (a) requisito Office (§6 perguntas 1–8); (b) arquivar vs remover deploy Linux; (c) simplificar `_platform_info`/`get_data_dir` ou manter.
2. Implementar `deploy/install.ps1` + `instalar.bat` (Tarefa 1).
3. Refatorar Linux→Windows (Tarefa 2) com pytest verde ao final.
4. Implementar Office streaming (Tarefa 3) após validação do desenho com o usuário.
