#!/system/bin/sh
# reverse_ping.sh — Ping reverso do TV Box para o servidor
# O TV Box pinga o servidor para manter a conexão de rede ativa
# e permitir diagnóstico bidirecional.
#
# Instalação (via shell):
#   curl -s http://SERVER_IP:8080/static/scripts/reverse_ping.sh | sh
#
# Ou manual:
#   sh /data/local/tmp/panel/reverse_ping.sh install SERVER_IP

SERVER_IP="${1:-}"
CONFIG="/data/local/tmp/panel/reverse_ping.conf"
PID_FILE="/data/local/tmp/panel/reverse_ping.pid"
INTERVAL=30  # segundos entre pings

install() {
    local ip="$1"
    if [ -z "$ip" ]; then
        echo "Uso: $0 install SERVER_IP"
        exit 1
    fi
    echo "SERVER_IP=$ip" > "$CONFIG"
    echo "INTERVAL=$INTERVAL" >> "$CONFIG"
    echo "Instalado: ping reverso para $ip a cada ${INTERVAL}s"
    start
}

start() {
    if [ -f "$CONFIG" ]; then
        . "$CONFIG"
    fi
    if [ -z "$SERVER_IP" ]; then
        echo "Configure primeiro: $0 install SERVER_IP"
        exit 1
    fi
    # Mata instância anterior
    stop
    # Loop em background
    (
        while true; do
            ping -c 1 -W 2 "$SERVER_IP" >/dev/null 2>&1
            sleep "$INTERVAL"
        done
    ) &
    echo $! > "$PID_FILE"
    echo "reverse_ping: iniciado (PID $(cat "$PID_FILE")) para $SERVER_IP"
}

stop() {
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null
        rm -f "$PID_FILE"
        echo "reverse_ping: parado"
    fi
}

status() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        . "$CONFIG" 2>/dev/null
        echo "reverse_ping: ATIVO para ${SERVER_IP:-desconhecido} (PID $(cat "$PID_FILE"))"
    else
        echo "reverse_ping: PARADO"
    fi
}

# Main
case "${1:-}" in
    install) install "$2" ;;
    start) start ;;
    stop) stop ;;
    status) status ;;
    restart) stop; start ;;
    *)
        echo "Uso: $0 {install IP|start|stop|status|restart}"
        echo ""
        echo "  install IP  — Configura e inicia ping reverso para o servidor"
        echo "  start       — Inicia o ping"
        echo "  stop        — Para o ping"
        echo "  status      — Mostra status"
        exit 1
        ;;
esac
