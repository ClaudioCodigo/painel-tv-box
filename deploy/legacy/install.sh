#!/usr/bin/env bash
#=============================================================================
# Painel TV Box — Instalação Automática para Debian 13 (Trixie)
#=============================================================================
# Uso:
#   sudo bash deploy/install.sh                        # Instalação completa
#   sudo bash deploy/install.sh --help                # Ajuda
#   sudo bash deploy/install.sh --no-venv             # Pula criação de venv
#   sudo bash deploy/install.sh --no-mediamtx         # Não instala o MediaMTX
#   sudo bash deploy/install.sh --lan 192.168.1.0/24  # Sub-rede do firewall
#   sudo bash deploy/install.sh --allow-adb           # Abre 5555/tcp para a LAN
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
DATA_DIR="/var/lib/panel-tvbox"        # backups/logs/dados em runtime (fora do repo)
USER_NAME="panel"
MEDIAMTX_USER="mediamtx"
VENV_DIR="$INSTALL_DIR/venv"

PANEL_PORT="8080"
ADB_PORT="5555"
MEDIAMTX_API_PORT="9997"
MEDIAMTX_RTSP_PORT="8554"
MEDIAMTX_RTMP_PORT="1935"

LAN_NET="192.168.254.0/24"
ALLOW_ADB=false
INSTALL_MEDIAMTX=true
SKIP_VENV=false
ENABLE_UFW=false

# ── Detecta flags ──────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --help|-h)
            echo "Uso: sudo bash deploy/install.sh [opções]"
            echo "  --no-venv       Pula criação do virtualenv"
            echo "  --no-mediamtx   Não instala o MediaMTX"
            echo "  --lan CIDR      Sub-rede liberada no firewall (default: $LAN_NET)"
            echo "  --allow-adb     Abre 5555/tcp (ADB) para a LAN"
            echo "  --enable-ufw    Habilita o UFW (libera SSH 22 antes — sem trancar o acesso)"
            exit 0
            ;;
        --no-venv) SKIP_VENV=true ;;
        --no-mediamtx) INSTALL_MEDIAMTX=false ;;
        --allow-adb) ALLOW_ADB=true ;;
        --enable-ufw) ENABLE_UFW=true ;;
        --lan) shift; LAN_NET="${1:-$LAN_NET}" ;;
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
echo "  Projeto:   $PROJECT_DIR"
echo "  Destino:   $INSTALL_DIR"
echo "  Dados:     $DATA_DIR (backups/logs — fora do repositório)"
echo "  Usuário:   $USER_NAME"
echo "  Rede LAN:  $LAN_NET"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 1: Verificar sistema
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 1/8 — Verificando sistema"

OS_ID=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="$ID"
fi

if [ "$OS_ID" != "debian" ]; then
    warn "Sistema: $OS_ID (recomendado: Debian 13)"
fi
ARCH=$(uname -m)
log "Arquitetura: $ARCH"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 2: Instalar pacotes
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 2/8 — Instalando pacotes do sistema"

info "Atualizando lista de pacotes..."
apt-get update -qq

REQUIRED_PACKAGES=(
    python3
    python3-pip
    python3-venv
    git
    curl
    wget
    rsync
    android-tools-adb
    ufw
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
fi

PYTHON_VERSION=$(python3 --version 2>&1 | grep -oP '\d+\.\d+')
info "Python $PYTHON_VERSION detectado"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 3: Criar usuários e diretórios
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 3/8 — Criando usuários e estrutura de diretórios"

if id "$USER_NAME" &>/dev/null; then
    log "Usuário $USER_NAME já existe"
else
    useradd -r -s /usr/sbin/nologin -m -d "$INSTALL_DIR" "$USER_NAME"
    log "Usuário $USER_NAME criado"
fi

if [ "$INSTALL_MEDIAMTX" = true ] && ! id "$MEDIAMTX_USER" &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -M -d /var/lib/mediamtx "$MEDIAMTX_USER"
    log "Usuário $MEDIAMTX_USER criado"
fi

# /opt/panel (código) + /var/lib/panel-tvbox (dados em runtime)
mkdir -p "$INSTALL_DIR"
mkdir -p "$DATA_DIR/backups" "$DATA_DIR/logs" "$DATA_DIR/screenshots" "$DATA_DIR/apks"
log "Diretórios criados: $INSTALL_DIR e $DATA_DIR"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 4: Copiar arquivos do projeto
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 4/8 — Copiando arquivos do projeto"

info "Copiando de $PROJECT_DIR → $INSTALL_DIR"

# Sem --delete (não apaga arquivos locais de /opt/panel); exclui runtime/binários
rsync -a \
    --exclude='.git/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='venv/' \
    --exclude='.venv/' \
    --exclude='logs/' \
    --exclude='backups/' \
    --exclude='scrcpy/versions/' \
    --exclude='scrcpy/downloads/' \
    --exclude='scrcpy/*.apk' \
    --exclude='scrcpy/mpv_splits/' \
    --exclude='.reasonix/' \
    --exclude='*.xlsx' \
    "$PROJECT_DIR/" "$INSTALL_DIR/"

log "Arquivos copiados"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 5: Criar virtualenv e instalar dependências Python
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 5/8 — Configurando ambiente Python"

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

info "Instalando dependências Python (pyproject.toml)..."
$PIP_CMD install --quiet --upgrade pip
$PIP_CMD install --quiet "$PROJECT_DIR" || {
    # Fallback: instala explícito se o pyproject empacotar de forma inesperada
    warn "pip install . falhou — instalando dependências explicitamente"
    $PIP_CMD install --quiet \
        "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" pydantic>=2.0 \
        pyyaml>=6.0 httpx>=0.27.0 psutil>=6.0 python-multipart>=0.0.9
}
log "Dependências Python instaladas"

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 6: MediaMTX (download do binário + serviço não-root)
# ═══════════════════════════════════════════════════════════════════════════
if [ "$INSTALL_MEDIAMTX" = true ]; then
    header "Passo 6/8 — Instalando MediaMTX"

    MEDIAMTX_BIN="/usr/local/bin/mediamtx"
    MEDIAMTX_DATA="/var/lib/mediamtx"

    if [ ! -x "$MEDIAMTX_BIN" ]; then
        # Mapeia arquitetura para asset do release
        case "$ARCH" in
            x86_64|amd64) MTX_ARCH="amd64" ;;
            aarch64|arm64) MTX_ARCH="arm64" ;;
            armv7l|armhf) MTX_ARCH="armv7" ;;
            *) MTX_ARCH="" ;;
        esac

        if [ -n "$MTX_ARCH" ]; then
            info "Baixando MediaMTX ($MTX_ARCH) do GitHub..."
            TMP_DIR=$(mktemp -d)
            # Resolve a última release via API e descobre o asset REAL do linux
            # (não assume o formato do nome — o MediaMTX publica com "v" no nome,
            # ex: mediamtx_v1.19.3_linux_amd64.tar.gz)
            ASSET_URL=""
            LATEST=$(curl -fsSL https://api.github.com/repos/bluenviron/mediamtx/releases/latest \
                        | grep -oP '"tag_name":\s*"\K[^"]+' || echo "v1.9.2")
            ASSET_URL=$(curl -fsSL https://api.github.com/repos/bluenviron/mediamtx/releases/latest \
                        | grep -oP '"browser_download_url":\s*"\K[^"]+' \
                        | grep "linux_${MTX_ARCH}" | grep '\.tar\.gz$' | head -1 || true)
            if [ -z "$ASSET_URL" ]; then
                # Fallback: assume o padrão atual (com "v" no nome do asset)
                ASSET="mediamtx_${LATEST}_linux_${MTX_ARCH}.tar.gz"
                ASSET_URL="https://github.com/bluenviron/mediamtx/releases/download/${LATEST}/${ASSET}"
            fi
            if curl -fsSL -o "$TMP_DIR/mediamtx.tar.gz" "$ASSET_URL"; then
                mkdir -p "$MEDIAMTX_DATA"
                tar -xzf "$TMP_DIR/mediamtx.tar.gz" -C "$TMP_DIR"
                # Garante o diretório do binário (alguns Debian não têm /usr/local/bin)
                mkdir -p "$(dirname "$MEDIAMTX_BIN")"
                install -m 0755 "$TMP_DIR/mediamtx" "$MEDIAMTX_BIN"
                log "MediaMTX ${LATEST} instalado em $MEDIAMTX_BIN"
            else
                warn "Falha no download do MediaMTX — instale manualmente em $MEDIAMTX_BIN"
            fi
            rm -rf "$TMP_DIR"
        else
            warn "Arquitetura $ARCH sem asset MediaMTX — instale manualmente em $MEDIAMTX_BIN"
        fi
    else
        log "MediaMTX já instalado em $MEDIAMTX_BIN"
    fi

    mkdir -p "$MEDIAMTX_DATA"
    chown -R "$MEDIAMTX_USER:$MEDIAMTX_USER" "$MEDIAMTX_DATA"

    # Gera o service (usuário não-root, hardening)
    cat > /etc/systemd/system/mediamtx.service << EOF
[Unit]
Description=MediaMTX Streaming Server (RTSP/RTMP/WebRTC)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$MEDIAMTX_USER
Group=$MEDIAMTX_USER
WorkingDirectory=$MEDIAMTX_DATA
ExecStart=$MEDIAMTX_BIN $MEDIAMTX_DATA/mediamtx.yml
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$MEDIAMTX_DATA
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

    # Copia a config gerada pelo painel (se existir) para o data dir
    if [ -f "$INSTALL_DIR/config/mediamtx.generated.yml" ]; then
        install -o "$MEDIAMTX_USER" -g "$MEDIAMTX_USER" -m 0644 \
            "$INSTALL_DIR/config/mediamtx.generated.yml" "$MEDIAMTX_DATA/mediamtx.yml"
        log "Config do MediaMTX copiada para $MEDIAMTX_DATA/mediamtx.yml"
    else
        # Fallback: config mínimo VÁLIDO do MediaMTX com API ligada (porta 9997).
        # NOTA: config/mediamtx.yml é o template do PAINEL (não serve p/ o MediaMTX).
        cat > "$MEDIAMTX_DATA/mediamtx.yml" << 'MTX_DEFAULT'
# Config padrão do MediaMTX (gerada pelo install.sh)
# O wizard do painel sobrescreve com os paths dos devices (mediamtx.generated.yml).
api: true
rtsp: {}
rtmp: {}
logLevel: info
MTX_DEFAULT
        chown "$MEDIAMTX_USER:$MEDIAMTX_USER" "$MEDIAMTX_DATA/mediamtx.yml"
        chmod 0640 "$MEDIAMTX_DATA/mediamtx.yml"
        warn "Usando config padrão do MediaMTX (API na 9997) — conclua o wizard p/ paths dos devices"
    fi

    # Painel (owner) grava o config do serviço; MediaMTX (grupo) lê
    chown "$USER_NAME:$MEDIAMTX_USER" "$MEDIAMTX_DATA/mediamtx.yml" 2>/dev/null || true
    chmod 0660 "$MEDIAMTX_DATA/mediamtx.yml"

    systemctl daemon-reload
    systemctl enable mediamtx.service
    systemctl start mediamtx.service || warn "Falha ao iniciar mediamtx.service (journalctl -u mediamtx.service)"
else
    warn "MediaMTX não instalado (--no-mediamtx)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 7: systemd (painel) + firewall
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 7/8 — Serviço do painel + firewall"

if [ "$SKIP_VENV" = true ]; then
    PYTHON_BIN="python3"
else
    PYTHON_BIN="$VENV_DIR/bin/uvicorn"
fi

cat > /etc/systemd/system/panel.service << EOF
[Unit]
Description=Painel TV Box - Gerenciamento de TV Boxes Android
After=network.target mediamtx.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$USER_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=$PYTHON_BIN app.main:app --host 0.0.0.0 --port $PANEL_PORT --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1
Environment=PANEL_DATA_DIR=$DATA_DIR
Environment=PANEL_ADB_SERVER_PORT=5038
Environment=PANEL_MEDIAMTX_CONFIG=$MEDIAMTX_DATA/mediamtx.yml
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA_DIR $INSTALL_DIR/config $INSTALL_DIR/devices $INSTALL_DIR/groups $INSTALL_DIR/scrcpy $MEDIAMTX_DATA

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
log "Serviço panel.service configurado"

# Firewall — libera apenas para a LAN, NUNCA 5555 para o mundo
if command -v ufw &>/dev/null; then
    info "Configurando firewall (liberando para $LAN_NET)..."
    if [ "$ENABLE_UFW" = true ]; then
        # Sempre libera SSH antes de habilitar — evita se trancar para fora
        ufw allow 22/tcp comment "SSH"
        ufw --force enable
        log "UFW habilitado (--enable-ufw), SSH 22 liberado"
    else
        info "UFW NÃO habilitado (regras prontas; use --enable-ufw para ativar)"
    fi
    # Sintaxe correta do ufw: porta e protocolo separados (proto tcp)
    ufw allow from "$LAN_NET" to any port "$PANEL_PORT" proto tcp comment "Painel TV Box"
    if [ "$INSTALL_MEDIAMTX" = true ]; then
        ufw allow from "$LAN_NET" to any port "$MEDIAMTX_RTSP_PORT" proto tcp comment "MediaMTX RTSP"
        ufw allow from "$LAN_NET" to any port "$MEDIAMTX_RTMP_PORT" proto tcp comment "MediaMTX RTMP"
        ufw allow from "$LAN_NET" to any port "$MEDIAMTX_API_PORT" proto tcp comment "MediaMTX API"
    fi
    if [ "$ALLOW_ADB" = true ]; then
        ufw allow from "$LAN_NET" to any port "$ADB_PORT" proto tcp comment "ADB (LAN)"
        warn "ADB 5555 liberado para $LAN_NET (--allow-adb)"
    else
        info "ADB 5555 NÃO foi aberto (use --allow-adb se precisar de adb connect externo)"
    fi
    log "Firewall UFW configurado"
else
    warn "UFW não encontrado — abra manualmente para $LAN_NET: $PANEL_PORT, 8554, 1935, 9997"
fi

# ═══════════════════════════════════════════════════════════════════════════
# PASSO 8: Finalizar
# ═══════════════════════════════════════════════════════════════════════════
header "Passo 8/8 — Finalizando"

# Permissões: código só-leitura para panel; data dir gravável
chown -R "$USER_NAME:$USER_NAME" "$INSTALL_DIR"
chown -R "$USER_NAME:$USER_NAME" "$DATA_DIR"
chmod 750 "$INSTALL_DIR"
chmod 750 "$DATA_DIR"
find "$INSTALL_DIR/config" -type f -name "*.yml" -exec chmod 640 {} + 2>/dev/null || true
find "$DATA_DIR" -type d -exec chmod 750 {} +

# Habilita e inicia o serviço
systemctl enable panel.service
systemctl start panel.service || warn "Falha ao iniciar panel.service (journalctl -u panel.service -n 50)"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           Instalação Concluída!                      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo -e "  ${GREEN}Painel:${NC}     http://${IP:-<IP>}:$PANEL_PORT"
echo -e "  ${GREEN}Código:${NC}     $INSTALL_DIR"
echo -e "  ${GREEN}Dados:${NC}      $DATA_DIR (backups/logs — fora do git)"
echo -e "  ${GREEN}Logs:${NC}       journalctl -u panel.service -f"
echo ""

if systemctl is-active --quiet panel.service; then
    log "Painel está rodando!"
else
    warn "Painel não está rodando. Verifique: journalctl -u panel.service -n 50"
fi

echo ""
info "Próximos passos:"
info "  Acesse http://${IP:-<IP>}:$PANEL_PORT e configure pelo Wizard"
info "  ADB nos TV Boxes: Settings → Developer Options → USB Debugging"
info "  Após gerar o wizard, re-execute: sudo bash deploy/install.sh --no-venv --no-mediamtx  (para sincronizar configs)"
echo ""
