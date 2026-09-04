#!/system/bin/sh
# netwatch.sh - Auto-recupera a rede do TV box quando cai (loop independente do painel).
# Usage: netwatch.sh {start|stop|status}
# Comportamento: testa TCP na porta 8080 do painel (lido do heartbeat.conf).
#   2 falhas          -> reinicia wifi (apenas se wlan0 existir com carrier)
#   4 falhas          -> reinicia eth (toggle + rebind do driver — link fantasma)
#   6+ falhas         -> reboot do box (último recurso), limitado por
#                        COOLDOWN_CHECKS (contador PERSISTENTE, imune ao relógio:
#                        o RTC deriva quando sem NTP e quebrava o cooldown por data)
#   a cada 10 falhas  -> re-tenta restart_eth durante o cooldown

CONFIG="/data/local/tmp/panel/heartbeat.conf"
PID_FILE="/data/local/tmp/panel/netwatch.pid"
LOG="/data/local/tmp/panel/netwatch.log"
CHECKS_FILE="/data/local/tmp/panel/netwatch.reboot_checks"
CHECK_EVERY=30
COOLDOWN_CHECKS=60   # 60 checagens x 30s = 30 min entre reboots (persistente)

PANEL_IP=""
if [ -f "$CONFIG" ]; then
    PANEL_IP=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
fi

# Nunca use um IP de produção hardcoded como fallback: sem heartbeat.conf o
# netwatch não sabe qual painel testar e poderia entrar em recovery/reboot por
# apontar para um host errado. Provisioning deve sempre criar a config local.
_require_panel_ip() {
    if [ -n "$PANEL_IP" ]; then
        return 0
    fi
    echo "$(date +%s) CONFIG_ERROR PANEL_URL ausente/invalida em $CONFIG; netwatch nao iniciado" >> "$LOG"
    return 1
}

# su preferido (Magisk /sbin/su ignora SuperSU conflitante)
SU_PREFIX="/sbin/su -c"
if [ ! -x /sbin/su ]; then
    SU_PREFIX="su -c"
fi

check_net() {
    _require_panel_ip || return 1
    # TCP na porta do painel (mais confiavel que ping - Windows pode bloquear ICMP)
    if command -v nc >/dev/null 2>&1; then
        nc -w 5 "$PANEL_IP" 8080 < /dev/null >/dev/null 2>&1 && return 0
    fi
    # fallback: ping
    ping -c 1 -W 3 "$PANEL_IP" >/dev/null 2>&1 && return 0
    return 1
}

# wlan0 em uso? (box só-Ethernet pula o restart_wifi — inútil e atrasa a cascata)
_wifi_up() {
    [ -e /sys/class/net/wlan0 ] || return 1
    [ "$(cat /sys/class/net/wlan0/carrier 2>/dev/null)" = "1" ]
}

# Cooldown por contador persistente: quantas checagens faltam até poder rebootar.
# Imune ao RTC do box (que deriva sem NTP e quebrava `now - last_reboot`).
_checks_left() {
    [ -f "$CHECKS_FILE" ] && cat "$CHECKS_FILE" 2>/dev/null || echo 0
}

_set_checks() {
    echo "$1" > "$CHECKS_FILE" 2>/dev/null
}

_do_reboot() {
    # Reboot de verdade: `su -c reboot` falha silenciosamente em alguns
    # firmwares/Magisk; `setprop sys.powerctl reboot` é o mecanismo que o
    # Android respeita. Fallbacks em sequência.
    if [ -x /sbin/su ]; then
        /sbin/su -c 'setprop sys.powerctl reboot' >/dev/null 2>&1 || \
            /sbin/su -c reboot >/dev/null 2>&1
    else
        su -c 'setprop sys.powerctl reboot' >/dev/null 2>&1 || \
            su -c reboot >/dev/null 2>&1
    fi
    # fallback final: reboot direto (se já rodando como root)
    reboot >/dev/null 2>&1
}

_loop() {
    local fails=0
    _require_panel_ip || exit 1
    while true; do
        if check_net; then
            if [ "$fails" -gt 0 ]; then
                echo "$(date +%s) NET_OK apos $fails falhas" >> "$LOG"
            fi
            fails=0
            _set_checks "$COOLDOWN_CHECKS"
        else
            fails=$((fails + 1))
            echo "$(date +%s) NET_DOWN fail=$fails target=$PANEL_IP clock=$(date '+%d/%m %H:%M') carrier=$(cat /sys/class/net/eth0/carrier 2>/dev/null)" >> "$LOG"
            if [ "$fails" -eq 2 ] && _wifi_up; then
                echo "$(date +%s) restart_wifi" >> "$LOG"
                sh /data/local/tmp/panel/restart_wifi.sh >/dev/null 2>&1
            elif [ "$fails" -eq 4 ] || { [ "$fails" -ge 10 ] && [ $((fails % 10)) -eq 0 ]; }; then
                echo "$(date +%s) restart_eth (fail=$fails)" >> "$LOG"
                # snapshot de diagnostico ANTES da recuperacao (ver diag.sh)
                sh /data/local/tmp/panel/diag.sh snapshot "fail=$fails" >/dev/null 2>&1
                sh /data/local/tmp/panel/restart_eth.sh >/dev/null 2>&1
            elif [ "$fails" -ge 6 ]; then
                checks=$(_checks_left)
                if [ "$checks" -le 0 ]; then
                    echo "$(date +%s) REBOOT (rede indisponivel apos $fails falhas)" >> "$LOG"
                    # grava ANTES do reboot: sobrevive ao boot e evita tempestade
                    _set_checks "$COOLDOWN_CHECKS"
                    sh /data/local/tmp/panel/diag.sh snapshot "pre-reboot" >/dev/null 2>&1
                    sleep 2
                    _do_reboot
                    exit 0
                else
                    _set_checks $((checks - 1))
                    echo "$(date +%s) REBOOT_SKIP (cooldown: $checks checagens restantes)" >> "$LOG"
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
    _require_panel_ip || {
        echo "netwatch: config invalida (PANEL_URL ausente em $CONFIG)"
        return 1
    }
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
