#!/system/bin/sh
# 99-adb-insecure.sh — Desativa validação de chave RSA do ADB permanentemente via Magisk
#
# Arquivo no TV Box: /data/adb/service.d/99-adb-insecure.sh
# Permissões: chmod 755 /data/adb/service.d/99-adb-insecure.sh
#
# Executado automaticamente pelo Magisk no boot (late_start service mode) como root.
# Elimina a necessidade de autorização física de chave RSA na tela da TV, permitindo
# conexão direta e imediata do scrcpy na rede local (porta 5555).
#
# Modos de uso:
#   sh /data/adb/service.d/99-adb-insecure.sh props   (aplica propriedades sem reiniciar adbd — seguro para provisionamento)
#   sh /data/adb/service.d/99-adb-insecure.sh now     (aplica e reinicia adbd em background desacoplado)
#   sh /data/adb/service.d/99-adb-insecure.sh status  (exibe status atual das propriedades)
#   sh /data/adb/service.d/99-adb-insecure.sh boot    (executado pelo Magisk no boot: espera boot_completed)

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
    DO_RESTART="${1:-0}"
    log "Aplicando configuracoes de ADB inseguro (restart=$DO_RESTART)..."

    RP=$(find_resetprop)
    if [ -n "$RP" ]; then
        log "resetprop encontrado: '$RP'"
        # Desativa a obrigatoriedade de chave RSA (ro.adb.secure=0)
        $RP ro.adb.secure 0
        # Habilita depuração irrestrita
        $RP ro.debuggable 1
        # Habilita root adb
        $RP service.adb.root 1
    else
        log "Aviso: resetprop nao encontrado no PATH, aplicando via setprop"
        setprop ro.adb.secure 0
        setprop ro.debuggable 1
        setprop service.adb.root 1
    fi

    # Garante a porta TCP 5555 ativa e persistente entre boots
    setprop service.adb.tcp.port 5555
    setprop persist.adb.tcp.port 5555

    SECURE=$(getprop ro.adb.secure)
    PORT=$(getprop service.adb.tcp.port)
    log "Status final: ro.adb.secure=$SECURE, service.adb.tcp.port=$PORT"

    if [ "$DO_RESTART" = "1" ]; then
        log "Agendando reinicio do adbd em background desacoplado..."
        (
            sleep 2
            setprop ctl.restart adbd 2>/dev/null || {
                stop adbd 2>/dev/null
                sleep 1
                start adbd 2>/dev/null
            }
        ) >/dev/null 2>&1 &
    fi
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
    props)
        log "Modo props solicitado (sem reiniciar adbd)"
        apply_props 0
        exit 0
        ;;
    now|apply)
        log "Execucao imediata solicitada ($MODE)"
        apply_props 1
        exit 0
        ;;
    boot|*)
        log "Modo boot iniciado: aguardando sys.boot_completed=1..."
        # 1. Aguarda a inicializacao do Android completar (ate 90s)
        i=0
        while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$i" -lt 90 ]; do
            sleep 1
            i=$((i + 1))
        done

        # 2. Pequena pausa para estabilizacao de servicos de rede
        sleep 3

        apply_props 1
        exit 0
        ;;
esac
