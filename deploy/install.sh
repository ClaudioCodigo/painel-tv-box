#!/usr/bin/env bash
#=============================================================================
# Painel TV Box — Instalação Automática para Debian 13 (Trixie)
#=============================================================================
# Uso:
#   sudo bash deploy/install.sh              # Instalação completa
#   sudo bash deploy/install.sh --help       # Ajuda
#   sudo bash deploy/install.sh --no-venv    # Pula criação de venv
#   sudo bash deploy/install.sh --no-adb     # Pula configuração ADB
#=============================================================================
set -euo pipefail

# ── Cores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }
header() { echo -e "\n${BOLD}━━━ $* ━━━${NC}\n"; }

# ── Configurações ──────────────────────────────────────────────────────────
INSTALL_DIR="/opt/panel"
USER_NAME="panel"
VENV_DIR="$INSTALL_DIR/venv"
CONFIG_DIR="$INSTALL_DIR/config"
DEVICES_DIR="$INSTALL_DIR/devices"
LOGS_DIR="$INSTALL_DIR/logs"
BACKUPS_DIR="$INSTALL_DIR/backups"
SCRIPTS_DIR="$INSTALL_DIR/scripts/android"

PANEL_PORT="8080"
ADB_PORT="5555"
MEDIAMTX_PORT="9997"

# ── Detecta flags ──────────────────────────────────────────────────────────
SKIP_VENV=false
SKIP_ADB=false
for arg in "$@"; do
    case "$arg" in
        --help|-h)
            echo "Uso: sudo bash deploy/install.sh [--no-venv] [--no-adb]"
            echo "  --no-venv   Pula criação do virtualenv"
            echo "  --no-adb    Pula configuração do servidor ADB"
            exit 0
            ;;
        --no-venv) SKIP_VENV=true ;;
        --no-adb)  SKIP_ADB=true  ;;
    esac
done

# ── Verifica root ──────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    err "Execute como root: sudo bash deploy/install.sh"
    exit 1
fi

# ── Identifica diretório do projeto ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║         Painel TV Box — Instalação Debian 13        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Projeto:  $PROJECT_DIR"
echo "  Destino:  $INSTALL_DIR"
echo "  Usuário:  $USER_NAME"
echo "  Porta:    $PANEL_PORT"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 1: Verificar sistema
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 1/7 — Verificando sistema"

OS_ID=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="$ID"
fi

if [ "$OS_ID" != "debian" ]; then
    warn "Sistema: $OS_ID (recomendado: Debian 13)"
    warn "O script foi otimizado para Debian 13, mas pode funcionar em outras distros."
else
    log "Sistema: Debian $VERSION_ID ($VERSION_CODENAME)"
fi

ARCH=$(uname -m)
log "Arquitetura: $ARCH"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 2: Instalar pacotes
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 2/7 — Instalando pacotes do sistema"

info "Atualizando lista de pacotes..."
apt-get update -qq

REQUIRED_PACKAGES=(
    python3
    python3-pip
    python3-venv
    git
    curl
    wget
    android-tools-adb
    systemd
)

MISSING=()
for pkg in "${REQUIRED_PACKAGES[@]}"; do
    if dpkg -l "$pkg" 2>/dev/null | grep -q '^ii'; then
        log "$pkg já instalado"
    else
        MISSING+=("$pkg")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    info "Instalando pacotes faltantes: ${MISSING[*]}"
    apt-get install -y -qq "${MISSING[@]}"
    for pkg in "${MISSING[@]}"; do
        if dpkg -l "$pkg" 2>/dev/null | grep -q '^ii'; then
            log "$pkg instalado"
        else
            warn "Falha ao instalar $pkg"
        fi
    done
fi

# Verifica versão do Python
PYTHON_VERSION=$(python3 --version 2>&1 | grep -oP '\d+\.\d+')
info "Python $PYTHON_VERSION detectado"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 3: Criar usuário e diretórios
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 3/7 — Criando usuário e estrutura de diretórios"

if id "$USER_NAME" &>/dev/null; then
    log "Usuário $USER_NAME já existe"
else
    useradd -r -s /usr/sbin/nologin -m -d "$INSTALL_DIR" "$USER_NAME"
    log "Usuário $USER_NAME criado"
fi

mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR" "$DEVICES_DIR" "$LOGS_DIR" "$BACKUPS_DIR" "$SCRIPTS_DIR"
log "Diretórios criados em $INSTALL_DIR"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 4: Copiar arquivos do projeto
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 4/7 — Copiando arquivos do projeto"

info "Copiando de $PROJECT_DIR → $INSTALL_DIR"

# Copia tudo exceto venv/, __pycache__/, .git/
rsync -a --delete \
    --exclude='.git/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='venv/' \
    --exclude='.venv/' \
    --exclude='logs/*.log' \
    "$PROJECT_DIR/" "$INSTALL_DIR/"

log "Arquivos copiados"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 5: Criar virtualenv e instalar dependências Python
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 5/7 — Configurando ambiente Python"

if [ "$SKIP_VENV" = true ]; then
    warn "Pulando criação do virtualenv (--no-venv)"
    PIP_CMD="pip3"
else
    if [ ! -d "$VENV_DIR" ]; then
        info "Criando virtualenv..."
        python3 -m venv "$VENV_DIR"
        log "Virtualenv criado em $VENV_DIR"
    else
        info "Virtualenv já existe"
    fi
    PIP_CMD="$VENV_DIR/bin/pip"
fi

info "Instalando dependências Python..."
$PIP_CMD install --quiet --upgrade pip
$PIP_CMD install --quiet \
    fastapi>=0.115.0 \
    "uvicorn[standard]>=0.30.0" \
    pydantic>=2.0 \
    pyyaml>=6.0 \
    httpx>=0.27.0 \
    psutil>=6.0 \
    python-multipart>=0.0.9

log "Dependências Python instaladas"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 6: Configurar systemd
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 6/7 — Configurando serviços systemd"

# Define caminho correto do Python no venv
if [ "$SKIP_VENV" = true ]; then
    PYTHON_BIN="python3"
else
    PYTHON_BIN="$VENV_DIR/bin/uvicorn"
fi

# Gera o service do painel
cat > /etc/systemd/system/panel.service << EOF
[Unit]
Description=Painel TV Box - Gerenciamento de TV Boxes Android
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=$PYTHON_BIN app.main:app --host 0.0.0.0 --port $PANEL_PORT --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# Gera o service do MediaMTX (opcional — template)
if [ ! -f /etc/systemd/system/mediamtx.service ]; then
    cat > /etc/systemd/system/mediamtx.service << 'EOF'
[Unit]
Description=MediaMTX Streaming Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/mediamtx
WorkingDirectory=/opt/mediamtx
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
    warn "Service mediamtx.service criado (binário e config precisam ser instalados manualmente)"
else
    log "mediamtx.service já existe"
fi

systemctl daemon-reload
log "Serviços systemd configurados"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 6b: Firewall
# ═══════════════════════════════════════════════════════════════════════════
info "Configurando firewall..."

if command -v ufw &>/dev/null; then
    ufw allow "$PANEL_PORT/tcp" comment "Painel TV Box"
    ufw allow "$ADB_PORT/tcp" comment "ADB"
    ufw allow 8554/tcp comment "MediaMTX RTSP"
    ufw allow 1935/tcp comment "MediaMTX RTMP"
    ufw allow "$MEDIAMTX_PORT/tcp" comment "MediaMTX API"
    log "Firewall UFW configurado"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="$PANEL_PORT/tcp"
    firewall-cmd --permanent --add-port="8554/tcp"
    firewall-cmd --permanent --add-port="1935/tcp"
    firewall-cmd --reload
    log "Firewall firewalld configurado"
else
    warn "Nenhum firewall detectado. Configure manualmente as portas:"
    warn "  $PANEL_PORT/tcp (Painel), 8554/tcp (RTSP), 1935/tcp (RTMP)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 7: Finalizar
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 7/7 — Finalizando"

# Ajusta permissões
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR"
chmod 644 "$INSTALL_DIR/config/"*.yml 2>/dev/null || true

# Habilita e inicia o serviço
systemctl enable panel.service
systemctl start panel.service || warn "Falha ao iniciar panel.service (verifique com: journalctl -u panel.service)"

# Status
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           Instalação Concluída! 🚀                 ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Painel:${NC}        http://$(hostname -I | awk '{print $1}'):$PANEL_PORT"
echo -e "  ${GREEN}Diretório:${NC}     $INSTALL_DIR"
echo -e "  ${GREEN}Logs:${NC}          journalctl -u panel.service -f"
echo -e "  ${GREEN}Status:${NC}        systemctl status panel.service"
echo ""

# Verifica se o serviço está rodando
if systemctl is-active --quiet panel.service; then
    log "Painel está rodando!"
else
    warn "Painel não está rodando. Verifique os logs: journalctl -u panel.service -n 50"
fi

echo ""
info "Próximos passos:"
info "  Acesse http://$(hostname -I | awk '{print $1}'):$PANEL_PORT e configure pelo Wizard"
info "  Configure ADB nos TV Boxes: Settings → Developer Options → USB Debugging"
info "  Verifique conectividade: adb connect <IP_TV_BOX>:5555"
echo ""
info "Documentação: $INSTALL_DIR/docs/"
echo ""
