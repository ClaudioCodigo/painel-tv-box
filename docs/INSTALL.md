# Guia de Instalação — Windows 10+ / Windows Server 2019+

> **Atualizado (refatoração Windows-only):** o Linux foi descartado pelo cliente — o painel roda **somente em Windows**. Instalação por **duplo clique** (`instalar.bat`), painel e MediaMTX como **serviços NSSM** com auto-restart, firewall restrito à LAN.

## Pré-requisitos

- Windows 10 64-bit ou Windows Server 2019+ (com **Windows PowerShell 5.1**, já incluído)
- **Python 3.10+** instalado (python.org, marcar "Add to PATH") — usado para criar o venv
- Rede local com os TV Boxes Android (ADB via TCP habilitado)
- O instalador baixa sozinho: ffmpeg, ADB/platform-tools, MediaMTX e NSSM (não precisa winget)

## 1. Instalação Automática (recomendado)

1. Clone/descompacte o projeto em qualquer pasta (ex.: `C:\Users\Cliente\painel-tv-box`).
2. **Duplo clique em `instalar.bat`** (na raiz).
3. Aceite o **UAC** (Administrador — necessário para serviços e firewall).
4. Acompanhe o progresso na janela (7 passos). Ao final, o navegador abre `http://localhost:8080`.
5. Na 1ª execução, o **wizard** cria as configs (adicionar TV Boxes, players, etc.).

O script faz tudo automaticamente:

1. ✅ Baixa binários: **ffmpeg** (gyan.dev), **ADB/platform-tools** (Google), **MediaMTX** (GitHub) e **NSSM 2.24**
2. ✅ Copia o código para **`C:\PanelTVBox`** preservando `.git` (o painel se atualiza por `git pull`)
3. ✅ Cria o virtualenv Python e instala as dependências (`pyproject.toml`)
4. ✅ Registra os serviços NSSM **`panel-tvbox`** (uvicorn :8080) e **`mediamtx`** (RTSP/RTMP) com **auto-restart**
5. ✅ Firewall: regras **somente LAN** (`LocalSubnet`) para 8080/8554/1935/9997; porta ADB 5555 permanece **fechada**
6. ✅ Aponta `adb.binary` para `C:\PanelTVBox\bin\platform-tools\adb.exe` (se não configurado manualmente)

### Flags opcionais

```powershell
.\deploy\install.ps1 -Help            # ajuda
.\deploy\install.ps1 -AllowAdb        # abre ADB 5555 só na LAN + bloqueio explícito em Public/Domain
.\deploy\install.ps1 -NoMediamtx      # não instala/registra o MediaMTX
.\deploy\install.ps1 -SkipVenv        # reutiliza o venv existente
.\deploy\install.ps1 -RepoUrl <url>   # clona de outro repositório se a origem não for git
```

O instalador é **idempotente**: reexecutar sobre instalação existente preserva `config/`, `devices/` e dados locais; não duplica serviços.

## 2. Instalação Manual (desenvolvimento)

```powershell
git clone https://github.com/ClaudioCodigo/painel-tv-box.git
cd painel-tv-box

python -m venv .venv
.venv\Scripts\python -m pip install .
# fallback explícito:
.venv\Scripts\python -m pip install "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" pydantic pyyaml httpx psutil python-multipart

.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8080
```

## 3. Serviços (NSSM) e atualização

- **Gerenciar:** `services.msc` → `panel-tvbox` / `mediamtx` (iniciar/parar/reiniciar).
- **Logs dos serviços:** `%LOCALAPPDATA%\PanelTVBox\logs\panel.out.log`, `panel.err.log`, `mediamtx.out.log` (fora do repo).
- **Atualização do código:** pelo próprio painel (página Configurações → Atualizar), via `git pull` em `C:\PanelTVBox` — o instalador **não** faz pull.

## 4. Firewall

| Porta | Serviço | Default |
|---|---|---|
| 8080/tcp | Painel web | aberta (só LAN) |
| 8554/tcp | MediaMTX RTSP | aberta (só LAN) |
| 1935/tcp | MediaMTX RTMP | aberta (só LAN) |
| 9997/tcp | MediaMTX API | aberta (só LAN) |
| 5555/tcp | ADB | **fechada** (abrir com `-AllowAdb`; bloqueio explícito em Public/Domain) |

Se o Windows Firewall estiver desligado, o instalador **avisa** (risco de exposição) mas continua.

## 5. Configuração ADB nos TV Boxes

Em cada TV Box Android:

1. Acesse **Configurações → Sobre o dispositivo**
2. Toque 7x em **Número da versão** (ative Modo Desenvolvedor)
3. Volte → **Opções do Desenvolvedor**
4. Ative **Depuração USB**
5. Ative **Depuração USB (Configuração de segurança)**
6. Ative **Permanecer ativo** (não dormir com carregador)
7. Conecte o TV Box na rede Wi-Fi ou Ethernet
8. Descubra o IP: `adb shell ip addr show wlan0 | grep 'inet '`

No painel, adicione o TV Box pelo wizard ou página Devices; a conexão ADB é testada automaticamente (`adb connect IP:5555`).

## 6. Dados e estrutura

**Dados em runtime (fora do repo — git push/pull não mistura máquinas):** `%LOCALAPPDATA%\PanelTVBox` (backups, screenshots, apks, logs).

```
C:\PanelTVBox\
├── app/              # Código Python (FastAPI)
├── static/           # CSS, JS
├── templates/        # HTML (SPA)
├── config/           # YAML de configuração (gitignored; templates .example no repo)
├── devices/          # YAML por TV Box (gitignored)
├── groups/           # YAML por grupo (gitignored)
├── scripts/android/  # Scripts .sh pushados pros TV Boxes
├── bin/              # ffmpeg, platform-tools, mediamtx, nssm (baixados)
├── .venv/            # Virtualenv Python
├── .git/             # preservado (UpdateManager faz git pull)
└── deploy/           # install.ps1 (instalador) + legacy/ (Linux arquivado)
```

## 7. Verificação

```powershell
# API
curl http://localhost:8080/api/system/health

# Serviços
Get-Service panel-tvbox, mediamtx

# Logs
Get-Content "$env:LOCALAPPDATA\PanelTVBox\logs\panel.err.log" -Tail 50 -Wait
```
