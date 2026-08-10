#!/system/bin/sh
# netwatch.sh - Auto-recupera a rede do TV box quando cai (loop independente do painel).
# Usage: netwatch.sh {start|stop|status}
# Comportamento: pinga o IP do painel (lido do heartbeat.conf). Se falhar:
#   2 falhas  -> reinicia wifi
#   4 falhas  -> reinicia eth
#   6+ falhas -> reboot do box (cooldown de 30 min entre reboots)

CONFIG="/data/local/tmp/panel/heartbeat.conf"
PID_FILE="/data/local/tmp/panel/netwatch.pid"
LOG="/data/local/tmp/panel/netwatch.log"
CHECK_EVERY=30
REBOOT_COOLDOWN=1800

PANEL_IP=""
if [ -f "$CONFIG" ]; then
    PANEL_IP=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
fi
[ -z "$PANEL_IP" ] && PANEL_IP="192.168.254.219"

# Verifica se o PID do pidfile está vivo via `ps` + `grep -w` (cross-UID: o
# processo pode rodar como root via Magisk e o adb shell ser uid 2000 — kill -0
# daria EPERM e hidepid=2 esconderia o processo). toybox awk trata exit de forma
# não-padrão; grep -w é confiável. Definida ANTES de start()/status().
alive() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    [ -n "$pid" ] || return 1
    ps -A 2>/dev/null | grep -w "$pid" >/dev/null 2>&1
}

check_net() {
    # TCP na porta do painel (mais confiavel que ping - Windows pode bloquear ICMP)
    if command -v nc >/dev/null 2>&1; then
        nc -w 5 "$PANEL_IP" 8080 < /dev/null >/dev/null 2>&1 && return 0
    fi
    # fallback: ping
    ping -c 1 -W 3 "$PANEL_IP" >/dev/null 2>&1 && return 0
    return 1
}

_loop() {
    local fails=0 last_reboot=0
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
                if [ $((now - last_reboot)) -ge "$REBOOT_COOLDOWN" ]; then
                    echo "$(date +%s) REBOOT (rede indisponivel)" >> "$LOG"
                    last_reboot=$now
                    sleep 2
                    reboot >/dev/null 2>&1 || su -c reboot >/dev/null 2>&1
                    exit 0
                fi
            fi
        fi
        sleep "$CHECK_EVERY"
    done
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
