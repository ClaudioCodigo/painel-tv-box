#!/system/bin/sh
# netwatch.sh - Auto-recupera a rede do TV box quando cai (loop independente do painel).
# Usage: netwatch.sh {start|stop|status}
# Comportamento: testa TCP na porta 8080 do painel (lido do heartbeat.conf).
#   2 falhas  -> reinicia wifi
#   4 falhas  -> reinicia eth
#   6+ falhas -> reboot do box (cooldown persistente de 30 min entre reboots)

CONFIG="/data/local/tmp/panel/heartbeat.conf"
PID_FILE="/data/local/tmp/panel/netwatch.pid"
LOG="/data/local/tmp/panel/netwatch.log"
LAST_REBOOT_FILE="/data/local/tmp/panel/netwatch.last_reboot"
CHECK_EVERY=30
REBOOT_COOLDOWN=1800

PANEL_IP=""
if [ -f "$CONFIG" ]; then
    PANEL_IP=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
fi
[ -z "$PANEL_IP" ] && PANEL_IP="192.168.254.219"

# su preferido (Magisk /sbin/su ignora SuperSU conflitante)
SU_PREFIX="/sbin/su -c"
if [ ! -x /sbin/su ]; then
    SU_PREFIX="su -c"
fi

check_net() {
    # TCP na porta do painel (mais confiavel que ping - Windows pode bloquear ICMP)
    if command -v nc >/dev/null 2>&1; then
        nc -w 5 "$PANEL_IP" 8080 < /dev/null >/dev/null 2>&1 && return 0
    fi
    # fallback: ping
    ping -c 1 -W 3 "$PANEL_IP" >/dev/null 2>&1 && return 0
    return 1
}

_last_reboot() {
    [ -f "$LAST_REBOOT_FILE" ] && cat "$LAST_REBOOT_FILE" 2>/dev/null || echo 0
}

_set_last_reboot() {
    echo "$(date +%s)" > "$LAST_REBOOT_FILE" 2>/dev/null
}

_do_reboot() {
    # reboot com root correto (Magisk /sbin/su)
    if [ -x /sbin/su ]; then
        /sbin/su -c reboot >/dev/null 2>&1
    else
        su -c reboot >/dev/null 2>&1
    fi
    # fallback: reboot direto (se rodando como root)
    reboot >/dev/null 2>&1
}

_loop() {
    local fails=0
    while true; do
        if check_net; then
            if [ "$fails" -gt 0 ]; then
                echo "$(date +%s) NET_OK apos $fails falhas" >> "$LOG"
            fi
            fails=0
        else
            fails=$((fails + 1))
            echo "$(date +%s) NET_DOWN fail=$fails target=$PANEL_IP" >> "$LOG"
            if [ "$fails" -eq 2 ]; then
                echo "$(date +%s) restart_wifi" >> "$LOG"
                sh /data/local/tmp/panel/restart_wifi.sh >/dev/null 2>&1
            elif [ "$fails" -eq 4 ]; then
                echo "$(date +%s) restart_eth" >> "$LOG"
                sh /data/local/tmp/panel/restart_eth.sh >/dev/null 2>&1
            elif [ "$fails" -ge 6 ]; then
                now=$(date +%s)
                last_reboot=$(_last_reboot)
                if [ $((now - last_reboot)) -ge "$REBOOT_COOLDOWN" ]; then
                    echo "$(date +%s) REBOOT (rede indisponivel)" >> "$LOG"
                    _set_last_reboot
                    sleep 2
                    _do_reboot
                    exit 0
                else
                    echo "$(date +%s) REBOOT_SKIP (cooldown, ultimo=$last_reboot)" >> "$LOG"
                fi
            fi
        fi
        sleep "$CHECK_EVERY"
    done
}

alive() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    [ -n "$pid" ] || return 1
    ps -A 2>/dev/null | grep -w "$pid" >/dev/null 2>&1
}

start() {
    # Já rodando? Não duplica (kill via adb shell falha em processo root/Magisk)
    if alive; then
        echo "netwatch: já ativo (PID $(cat "$PID_FILE"))"
        return 0
    fi
    stop
    if command -v setsid >/dev/null 2>&1; then
        setsid sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    elif command -v nohup >/dev/null 2>&1; then
        nohup sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    else
        sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    fi
    echo $! > "$PID_FILE"
    echo "netwatch: iniciado (PID $(cat "$PID_FILE")) para $PANEL_IP"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null
        rm -f "$PID_FILE"
        echo "netwatch: parado"
    fi
}

status() {
    if alive; then
        echo "netwatch: ATIVO (PID $(cat "$PID_FILE"))"
    else
        echo "netwatch: PARADO"
    fi
}

case "${1:-}" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    _loop) _loop ;;
    *) echo "Uso: $0 {start|stop|status}" ;;
esac
