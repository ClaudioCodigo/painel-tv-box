# Guia de Instalação — Debian 13 (Trixie)

## Pré-requisitos

- Debian 13 instalado
- Acesso root ou sudo
- Conexão de rede
- TV Box Android com ADB via TCP habilitado

## 1. Instalação Automática (recomendado)

```bash
# Clone o repositório
git clone https://github.com/seu-repo/panel-tvbox.git
cd panel-tvbox

# Execute como root
sudo bash deploy/install.sh
```

O script faz tudo automaticamente:
1. ✅ Verifica sistema e arquitetura
2. ✅ Instala pacotes: python3, pip, venv, git, adb, systemd
3. ✅ Cria usuário `panel` e estrutura de diretórios
4. ✅ Copia arquivos do projeto para `/opt/panel`
5. ✅ Cria virtualenv e instala dependências Python
6. ✅ Configura serviços systemd (panel, mediamtx)
7. ✅ Configura firewall (UFW ou firewalld)
8. ✅ Habilita e inicia o serviço

## 2. Instalação Manual

### 2.1 Pacotes

```bash
apt update
apt install -y python3 python3-pip python3-venv git curl wget android-tools-adb
```

### 2.2 Criar diretórios

```bash
mkdir -p /opt/panel
mkdir -p /opt/panel/{config,devices,groups,logs,backups,scripts/android}
```

### 2.3 Copiar projeto

```bash
cp -r app/ static/ templates/ scripts/ config/ deploy/ pyproject.toml /opt/panel/
```

### 2.4 Criar virtualenv

```bash
python3 -m venv /opt/panel/venv
source /opt/panel/venv/bin/activate
pip install --upgrade pip
pip install fastapi "uvicorn[standard]" pydantic pyyaml httpx psutil python-multipart
```

### 2.5 Configurar systemd

```bash
cp deploy/panel.service /etc/systemd/system/
cp deploy/mediamtx.service /etc/systemd/system/  # se tiver MediaMTX
systemctl daemon-reload
systemctl enable panel.service
systemctl start panel.service
```

### 2.6 Firewall

```bash
# UFW
ufw allow 8080/tcp comment "Painel TV Box"
ufw allow 5555/tcp comment "ADB"
ufw allow 8554/tcp comment "MediaMTX RTSP"
ufw allow 1935/tcp comment "MediaMTX RTMP"

# firewalld
firewall-cmd --permanent --add-port=8080/tcp
firewall-cmd --permanent --add-port=8554/tcp
firewall-cmd --permanent --add-port=1935/tcp
firewall-cmd --reload
```

### 2.7 Verificar

```bash
systemctl status panel.service
journalctl -u panel.service -f

# Testar API
curl http://localhost:8080/api/system/health

# Acessar
# http://IP_DO_SERVIDOR:8080
```

## 3. Configuração ADB nos TV Boxes

Em cada TV Box Android:

1. Acesse **Configurações → Sobre o dispositivo**
2. Toque 7x em **Número da versão** (ative Modo Desenvolvedor)
3. Volte → **Opções do Desenvolvedor**
4. Ative **Depuração USB**
5. Ative **Depuração USB (Configuração de segurança)**
6. Ative **Permanecer ativo** (não dormir com carregador)
7. Conecte o TV Box na rede Wi-Fi ou Ethernet
8. Descubra o IP: `adb shell ip addr show wlan0 | grep 'inet '`

No servidor, teste a conexão:
```bash
adb connect 192.168.254.XXX:5555
adb devices
adb shell echo "ADB funcionando"
```

## 4. Configuração do MediaMTX (opcional)

```bash
# Download
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_linux_amd64.tar.gz
tar -xzf mediamtx_linux_amd64.tar.gz
cp mediamtx /usr/local/bin/
mkdir -p /opt/mediamtx
cp mediamtx.yml /opt/mediamtx/

# Config mediaMTX (use o gerado pelo painel em config/mediamtx.generated.yml)
# ou copie o template do painel:
cp /opt/panel/config/mediamtx.generated.yml /opt/mediamtx/mediamtx.yml

# Iniciar
systemctl start mediamtx.service
```

## 5. Estrutura de Diretórios

```
/opt/panel/
├── app/              # Código Python (FastAPI)
│   ├── api/          # Rotas REST
│   ├── core/         # Config, WebSocket, lifecycle
│   ├── managers/     # ADB, MediaMTX, Device, Watchdog
│   ├── models/       # Pydantic models
│   ├── services/     # Recovery, Provision
│   └── utils/        # Sistema, YAML
├── config/           # YAML de configuração (gerado pelo Wizard)
├── devices/          # YAML por TV Box
├── groups/           # YAML por grupo
├── static/           # CSS, JS
├── templates/        # HTML
├── scripts/android/  # Scripts .sh pushados pros TV Boxes
├── logs/             # Logs do sistema
├── backups/          # Backups ZIP
├── venv/             # Virtualenv Python
├── deploy/           # systemd, install script
└── docs/             # Documentação
```

## 6. Logs

```bash
# Systemd
journalctl -u panel.service -f

# Arquivos do painel
tail -f /opt/panel/logs/{system,adb,mediamtx,watchdog,user,api}.log
```
