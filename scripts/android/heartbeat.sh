#!/system/bin/sh
# heartbeat.sh — batida HTTP + execução de comandos via heartbeat (Ideia 3).
# Transporte: nc/toybox (Android sem curl/wget). Zero ADB painel→device.
#
# Config: /data/local/tmp/panel/heartbeat.conf
#   PANEL_URL=http://IP:8080
#   DEVICE_ID=qa
#   KEY=<heartbeat_key>
#   INTERVAL=20
CONFIG="/data/local/tmp/panel/heartbeat.conf"
PID_FILE="/data/local/tmp/panel/heartbeat.pid"
LOG="/data/local/tmp/panel/heartbeat.log"

# Verifica se o PID do pidfile está vivo. Usa `ps` + `grep -w` (não `kill -0`):
# com Magisk o processo pode rodar como root e o adb shell (uid 2000) não pode
# sinalizá-lo (kill -0 → EPERM) nem vê-lo (hidepid=2) — status falso PARADO.
# Nota: toybox awk trata `exit` de forma não-padrão; grep -w é confiável.
alive() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    [ -n "$pid" ] || return 1
    ps -A 2>/dev/null | grep -w "$pid" >/dev/null 2>&1
}

# ── HTTP via nc (sem curl/wget) ───────────────────────────────
# http_req METHOD URL [BODY] → imprime a resposta (headers + corpo)
http_req() {
    local method="$1" url="$2" body="${3:-}"
    local rest hostport host port path len
    rest="${url#http://}"
    hostport="${rest%%/*}"
    path="/${rest#*/}"
    [ "$path" = "/" ] && path="/"
    host="${hostport%:*}"
    port="${hostport##*:}"
    [ "$port" = "$host" ] && port=80
    len=0
    [ -n "$body" ] && len=$(printf '%s' "$body" | wc -c)
    {
        printf '%s %s HTTP/1.1\r\nHost: %s\r\nX-Heartbeat-Key: %s\r\nConnection: close\r\n' \
            "$method" "$path" "$hostport" "$KEY"
        if [ -n "$body" ]; then
            printf 'Content-Type: application/json\r\nContent-Length: %s\r\n' "$len"
        fi
        printf '\r\n'
        [ -n "$body" ] && printf '%s' "$body"
    } | nc -w 5 "$host" "$port" 2>/dev/null
}

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

_loop() {
    . "$CONFIG"
    while true; do
        ACTIVITY=$(dumpsys activity 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1 | sed 's/.*\/\([^}]*\)}/\1/' | awk '{print $1}')
        BODY="{\"activity\":\"$ACTIVITY\"}"
        HB_URL="$PANEL_URL/api/heartbeat/$DEVICE_ID"
        # 1. Heartbeat POST
        http_req POST "$HB_URL" "$BODY" >/dev/null 2>&1
        # 2. Puxa comandos (linhas: id<TAB>cmd) — remove headers HTTP
        CMDS=$(http_req GET "$HB_URL/commands" "" | sed '1,/^[[:space:]]*$/d')
        # 3. Executa LOCALMENTE e reporta
        echo "$CMDS" | while IFS="$(printf '\t')" read -r CID CMD; do
            [ -z "$CID" ] && continue
            OUT=$(sh -c "$CMD" 2>&1)
            RC=$?
            RES="{\"id\":\"$CID\",\"success\":$([ $RC -eq 0 ] && echo true || echo false),\"output\":\"$OUT\"}"
            http_req POST "$HB_URL/result" "$RES" >/dev/null 2>&1
        done
        sleep "$INTERVAL"
    done
}

start() {
    if [ -f "$CONFIG" ]; then
        . "$CONFIG"
    fi
    if [ -z "$PANEL_URL" ] || [ -z "$DEVICE_ID" ] || [ -z "$KEY" ]; then
        echo "Configure primeiro: $0 install URL DEVICE_ID KEY [INTERVAL]"
        exit 1
    fi
    # Já rodando? Não duplica (kill via adb shell falha em processo root/Magisk)
    if alive; then
        echo "heartbeat: já ativo (PID $(cat "$PID_FILE"))"
        return 0
    fi
    stop
    # Dispara em nova sessão (setsid) para sobreviver ao fechamento do adb shell.
    # Re-invoca o próprio script com `_loop` (a função vive dentro do script).
    if command -v setsid >/dev/null 2>&1; then
        setsid sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    elif command -v nohup >/dev/null 2>&1; then
        nohup sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    else
        sh "$0" _loop >> "$LOG" 2>&1 < /dev/null &
    fi
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
    if alive; then
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
    _loop) _loop ;;
    *)
        echo "Uso: $0 {install URL DEVICE_ID KEY [INTERVAL]|start|stop|status|restart}"
        exit 1
        ;;
esac
