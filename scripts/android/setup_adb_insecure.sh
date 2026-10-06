#!/system/bin/sh
# setup_adb_insecure.sh — Instalador e ativador imediato do bypass de chave RSA via Magisk
#
# Uso no TV Box (via Terminal, Termux, USB ou Heartbeat):
#   su -c "sh /data/local/tmp/panel/setup_adb_insecure.sh"
# Ou se baixado isoladamente:
#   sh setup_adb_insecure.sh
#
# Acoes realizadas:
#   1. Garante privilegios de root (Magisk su).
#   2. Instala /data/adb/service.d/99-adb-insecure.sh com permissao 755.
#   3. Executa a ativacao imediata sem necessidade de reiniciar o TV Box.

TARGET_DIR="/data/adb/service.d"
TARGET_SCRIPT="$TARGET_DIR/99-adb-insecure.sh"

echo "=================================================="
echo "    Instalador ADB Insecure (Magisk service.d)    "
echo "=================================================="

# 1. Checa privilégios de root
if [ "$(id -u 2>/dev/null)" != "0" ]; then
    echo "[!] Privilegios de root necessarios. Tentando su..."
    if command -v su >/dev/null 2>&1 || [ -x /sbin/su ] || [ -x /system/xbin/su ]; then
        exec su -c "sh $0 $@"
    else
        echo "[ERRO] Binario 'su' nao encontrado. O TV Box precisa ter Magisk instalado."
        exit 1
    fi
fi

echo "[*] Executando como root (UID: $(id -u))"

# 2. Cria diretório service.d do Magisk se necessário
if [ ! -d "$TARGET_DIR" ]; then
    echo "[*] Criando diretorio $TARGET_DIR..."
    mkdir -p "$TARGET_DIR" || {
        echo "[ERRO] Falha ao criar $TARGET_DIR"
        exit 1
    }
fi

# 3. Copia ou gera o script 99-adb-insecure.sh
SCRIPT_SRC=""
if [ -f "/data/local/tmp/panel/99-adb-insecure.sh" ]; then
    SCRIPT_SRC="/data/local/tmp/panel/99-adb-insecure.sh"
elif [ -f "./99-adb-insecure.sh" ]; then
    SCRIPT_SRC="./99-adb-insecure.sh"
fi

if [ -n "$SCRIPT_SRC" ]; then
    echo "[*] Copiando de $SCRIPT_SRC para $TARGET_SCRIPT..."
    cp -f "$SCRIPT_SRC" "$TARGET_SCRIPT"
else
    echo "[*] Gerando $TARGET_SCRIPT diretamente..."
    cat << 'EOF' > "$TARGET_SCRIPT"
#!/system/bin/sh
LOG="/data/local/tmp/adb-insecure.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [adb-insecure] $1" >> "$LOG" 2>/dev/null
}

find_resetprop() {
    if command -v resetprop >/dev/null 2>&1; then
        echo "resetprop"
    elif command -v magisk >/dev/null 2>&1; then
        echo "magisk resetprop"
    elif [ -x /data/adb/magisk/magisk ]; then
        echo "/data/adb/magisk/magisk resetprop"
    elif [ -x /data/adb/magisk/resetprop ]; then
        echo "/data/adb/magisk/resetprop"
    elif [ -x /sbin/magisk ]; then
        echo "/sbin/magisk resetprop"
    elif [ -x /sbin/resetprop ]; then
        echo "/sbin/resetprop"
    elif [ -x /system/bin/resetprop ]; then
        echo "/system/bin/resetprop"
    elif [ -x /system/xbin/resetprop ]; then
        echo "/system/xbin/resetprop"
    else
        echo ""
    fi
}

apply_props() {
    log "Aplicando configuracoes de ADB inseguro..."
    RP=$(find_resetprop)
    if [ -n "$RP" ]; then
        log "resetprop encontrado: '$RP'"
        $RP ro.adb.secure 0
        $RP ro.debuggable 1
        $RP service.adb.root 1
    else
        log "Aviso: resetprop nao encontrado no PATH, aplicando via setprop"
        setprop ro.adb.secure 0
        setprop ro.debuggable 1
        setprop service.adb.root 1
    fi
    setprop service.adb.tcp.port 5555
    setprop persist.adb.tcp.port 5555
    log "Reiniciando daemon adbd..."
    setprop ctl.restart adbd 2>/dev/null || {
        stop adbd 2>/dev/null
        sleep 1
        start adbd 2>/dev/null
    }
    sleep 2
    SECURE=$(getprop ro.adb.secure)
    PORT=$(getprop service.adb.tcp.port)
    log "Status final: ro.adb.secure=$SECURE, service.adb.tcp.port=$PORT"
}

show_status() {
    echo "=========================================="
    echo "       STATUS ADB INSECURE (MAGISK)       "
    echo "=========================================="
    echo "ro.adb.secure        : $(getprop ro.adb.secure)"
    echo "ro.debuggable        : $(getprop ro.debuggable)"
    echo "service.adb.tcp.port : $(getprop service.adb.tcp.port)"
    echo "persist.adb.tcp.port : $(getprop persist.adb.tcp.port)"
    echo "adbd PID             : $(pidof adbd 2>/dev/null || echo 'desconhecido')"
    if [ -f "$LOG" ]; then
        echo "------------------------------------------"
        echo "Ultimos registros ($LOG):"
        tail -n 8 "$LOG" 2>/dev/null
    fi
    echo "=========================================="
}

MODE="${1:-boot}"
case "$MODE" in
    status)
        show_status
        exit 0
        ;;
    now|apply)
        log "Execucao imediata solicitada ($MODE)"
        apply_props
        exit 0
        ;;
    boot|*)
        log "Modo boot iniciado: aguardando sys.boot_completed=1..."
        i=0
        while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$i" -lt 90 ]; do
            sleep 1
            i=$((i + 1))
        done
        sleep 3
        apply_props
        exit 0
        ;;
esac
EOF
fi

# 4. Ajusta permissões
chmod 755 "$TARGET_SCRIPT"
chown root:root "$TARGET_SCRIPT" 2>/dev/null || true
echo "[*] Permissao 755 aplicada em $TARGET_SCRIPT"

# 5. Executa ativação imediata
echo "[*] Aplicando configuracao agora (sem reboot)..."
sh "$TARGET_SCRIPT" now

# 6. Exibe status final
echo ""
sh "$TARGET_SCRIPT" status

echo ""
echo "[SUCESSO] TV Box configurado para aceitar scrcpy sem solicitacao de chave RSA!"
exit 0
