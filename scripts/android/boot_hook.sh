#!/system/bin/sh
# boot_hook.sh — sobrevive ao reboot do box.
#
# Instalado como /system/bin/install-recovery.sh (service do init.rc:
#   service flash_recovery /system/bin/install-recovery.sh
#   class main / oneshot)
# O Android executa esse arquivo uma vez no boot, como root. Aqui usamos o
# gancho para religar heartbeat.sh + netwatch.sh automaticamente, sem depender
# do painel re-provisionar.
#
# Seguro: se /data/local/tmp/panel não estiver provisionado, apenas sai.
# O SuperSU desta ROM (daemonsu em /system/xbin) não usa install-recovery.sh
# (o arquivo não existia antes), então não quebramos a persistência de root.

PANEL_DIR=/data/local/tmp/panel
LOG="$PANEL_DIR/boot_hook.log"

log() {
    echo "$(date +%s) $1" >> "$LOG" 2>/dev/null
}

# 1. Espera o boot completar (até 90s)
i=0
while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$i" -lt 90 ]; do
    sleep 1
    i=$((i + 1))
done

# 2. Tempo para a rede subir (DHCP/wifi)
sleep 10

# 3. Sobe os scripts (start é idempotente: mata PID antigo e re-dispara)
[ -x "$PANEL_DIR/heartbeat.sh" ] && {
    sh "$PANEL_DIR/heartbeat.sh" start >> "$LOG" 2>&1
    log "heartbeat.sh start (boot hook)"
}
[ -x "$PANEL_DIR/netwatch.sh" ] && {
    sh "$PANEL_DIR/netwatch.sh" start >> "$LOG" 2>&1
    log "netwatch.sh start (boot hook)"
}

exit 0
