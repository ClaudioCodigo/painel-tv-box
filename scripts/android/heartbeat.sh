#!/system/bin/sh
# heartbeat.sh — envia batida HTTP ao painel (substitui reverse_ping.sh)
# O TV Box posta /api/heartbeat/<device_id> em loop com cooldown.
# SEM ADB no servidor: o painel registra last_heartbeat e sabe que o box
# está na rede sem spammar o ADB (que derrubaria o scrcpy).
#
# Config: /data/local/tmp/panel/heartbeat.conf
#   PANEL_URL=http://IP:8080
#   DEVICE_ID=qa
#   KEY=<heartbeat_key>
#   INTERVAL=20
CONFIG="/data/local/tmp/panel/heartbeat.conf"
PID_FILE="/data/local/tmp/panel/heartbeat.pid"

install() {
    local url="$1" id="$2" key="$3" interval="${4:-20}"
    if [ -z "$url" ] || [ -z "$id" ] || [ -z "$key" ]; then
        echo "Uso: $0 install URL DEVICE_ID KEY [INTERVAL]"
        exit 1
    fi
    echo "PANEL_URL=$url" > "$CONFIG"
    echo "DEVICE_ID=$id" >> "$CONFIG"
    echo "KEY=$key" >> "$CONFIG"
    echo "INTERVAL=$interval" >> "$CONFIG"
    echo "Instalado: heartbeat para $url a cada ${interval}s"
    start
}

start() {
    if [ -f "$CONFIG" ]; then
        . "$CONFIG"
    fi
    if [ -z "$PANEL_URL" ] || [ -z "$DEVICE_ID" ] || [ -z "$KEY" ]; then
        echo "Configure primeiro: $0 install URL DEVICE_ID KEY [INTERVAL]"
        exit 1
    fi
    stop
    (
        while true; do
            ACTIVITY=$(dumpsys activity 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1 | sed 's/.*\/\([^}]*\)}/\1/' | awk '{print $1}')
            BODY="{\"activity\":\"$ACTIVITY\"}"
            if command -v curl >/dev/null 2>&1; then
                curl -s -o /dev/null -X POST "$PANEL_URL/api/heartbeat/$DEVICE_ID" \
                     -H "X-Heartbeat-Key: $KEY" -H "Content-Type: application/json" -d "$BODY"
            elif command -v wget >/dev/null 2>&1; then
                wget -q -O /dev/null --post-data "$BODY" --header="X-Heartbeat-Key: $KEY" \
                     --header="Content-Type: application/json" "$PANEL_URL/api/heartbeat/$DEVICE_ID"
            fi
            sleep "$INTERVAL"
        done
    ) &
    echo $! > "$PID_FILE"
    echo "heartbeat: iniciado (PID $(cat "$PID_FILE")) para $DEVICE_ID"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null
        rm -f "$PID_FILE"
        echo "heartbeat: parado"
    fi
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        . "$CONFIG" 2>/dev/null
        echo "heartbeat: ATIVO para ${DEVICE_ID:-desconhecido} (PID $(cat "$PID_FILE"))"
    else
        echo "heartbeat: PARADO"
    fi
}

# Main
case "${1:-}" in
    install) shift; install "$@" ;;
    start) start ;;
    stop) stop ;;
    status) status ;;
    restart) stop; start ;;
    *)
        echo "Uso: $0 {install URL DEVICE_ID KEY [INTERVAL]|start|stop|status|restart}"
        exit 1
        ;;
esac
