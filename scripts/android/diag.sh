#!/system/bin/sh
# diag.sh - Diagnóstico do "link fantasma" da eth (interface UP + IP sem tráfego
# real) em boxes Allwinner (sunxi-gmac). Uso:
#   diag.sh snapshot <motivo>   — estado completo da rede/relógio/kernel
#   diag.sh boot                — captura dmesg + logcat do boot (boot hook)
# Saída em /data/local/tmp/panel/diag/ (rotação: mantém os últimos 5 arquivos).
#
# O objetivo é registrar o MÁXIMO de contexto em cada ocorrência para entender
# a causa:
#   - relógio do sistema + RTC (o box pula para ~23:00/2021 fixo quando o bug
#     ocorre — registra o momento exato do salto)
#   - estado da interface (carrier, speed, carrier_changes)
#   - rotas e ARP (o box às vezes fica sem default route)
#   - contadores de erro do driver (rx/tx errors/drops)
#   - dmesg do sunxi-gmac/PHY (negociação do link no boot)
#   - logcat de Ethernet/Connectivity/DHCP (o framework Android)

PANEL_DIR="/data/local/tmp/panel"
DIAG_DIR="$PANEL_DIR/diag"
CONFIG="$PANEL_DIR/heartbeat.conf"
LOG="$PANEL_DIR/diag.log"
SEQ_FILE="$PANEL_DIR/diag.seq"

# Sequência crescente para nomes de arquivo — imune ao relógio do box (que
# RESETA para 2021/23:00 no boot sem NTP; `ls -1t` por mtime apagava o arquivo
# recém-criado por ele parecer o mais antigo).
_next_seq() {
    local n=0
    [ -f "$SEQ_FILE" ] && n=$(cat "$SEQ_FILE" 2>/dev/null)
    n=$((n + 1))
    echo "$n" > "$SEQ_FILE" 2>/dev/null
    printf '%05d' "$n"
}

PANEL_IP=""
if [ -f "$CONFIG" ]; then
    PANEL_IP=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
fi
[ -z "$PANEL_IP" ] && PANEL_IP="192.168.254.219"

mkdir -p "$DIAG_DIR" 2>/dev/null

# Rotação: mantém apenas os 5 arquivos mais recentes (ordena por NOME —
# sequência crescente, não por mtime que quebra com o relógio resetado).
_rotate() {
    ls -1 "$DIAG_DIR" 2>/dev/null | sort | head -n -5 | while read -r f; do
        rm -f "$DIAG_DIR/$f" 2>/dev/null
    done
}

# Snapshot completo (rede + relógio + kernel) — chamado quando o netwatch
# detecta falha e antes/depois do restart_eth.
snapshot() {
    local reason="${1:-manual}"
    local seq
    seq=$(_next_seq)
    local out="$DIAG_DIR/${seq}_snap_${reason}.txt"
    {
        echo "===== SNAPSHOT $reason ====="
        echo "DATA_SISTEMA: $(date 2>/dev/null)  (epoch=$ts)"
        echo "UPTIME: $(uptime 2>/dev/null)"
        echo "RTC: $(cat /sys/class/rtc/rtc0/time 2>/dev/null)"
        echo "--- INTERFACE eth0 ---"
        ip addr show eth0 2>/dev/null | grep -E "state|inet "
        echo "carrier=$(cat /sys/class/net/eth0/carrier 2>/dev/null) speed=$(cat /sys/class/net/eth0/speed 2>/dev/null) duplex=$(cat /sys/class/net/eth0/duplex 2>/dev/null)"
        echo "carrier_changes=$(cat /sys/class/net/eth0/carrier_changes 2>/dev/null)"
        echo "--- ROTAS ---"
        ip route 2>/dev/null
        echo "--- ARP (painel/gateway) ---"
        ip neigh 2>/dev/null | grep -E "$PANEL_IP|192\.168\.254\.1"
        echo "--- STATS eth0 ---"
        for f in rx_errors tx_errors rx_dropped tx_dropped rx_crc_errors collisions; do
            echo "$f=$(cat /sys/class/net/eth0/statistics/$f 2>/dev/null)"
        done
        echo "--- TESTE REDE ---"
        if command -v nc >/dev/null 2>&1; then
            nc -w 5 "$PANEL_IP" 8080 < /dev/null >/dev/null 2>&1
            echo "nc $PANEL_IP:8080 -> rc=$?"
        fi
        echo "--- DMESG (gmac/eth0/phy) ---"
        su -c dmesg 2>/dev/null | grep -iE "gmac|eth0|stmmac|phy|carrier|link" | tail -20
        echo "--- LOGCAT (Ethernet/Connectivity/DHCP) ---"
        logcat -d 2>/dev/null | grep -iE "Ethernet|ConnectivityService|DhcpClient|ipclient|netd" | tail -15
        echo "===== FIM ====="
    } > "$out" 2>&1
    echo "$(date +%s) snapshot($reason) -> $(basename "$out")" >> "$LOG" 2>/dev/null
    _rotate
}

# Captura do boot: dmesg + logcat do framework (chamado pelo boot hook após o
# boot completar — é quando o "link fantasma" aparece).
boot() {
    local seq
    seq=$(_next_seq)
    local out="$DIAG_DIR/${seq}_boot.txt"
    {
        echo "===== BOOT DIAG ====="
        echo "DATA_SISTEMA: $(date 2>/dev/null)"
        echo "UPTIME: $(uptime 2>/dev/null)"
        echo "RTC: $(cat /sys/class/rtc/rtc0/time 2>/dev/null)"
        echo "--- DMESG boot (gmac/eth0/phy) ---"
        su -c dmesg 2>/dev/null | grep -iE "gmac|eth0|stmmac|phy|carrier|link" | head -60
        echo "--- LOGCAT boot (Ethernet/Connectivity/DHCP) ---"
        logcat -d 2>/dev/null | grep -iE "Ethernet|ConnectivityService|DhcpClient|ipclient|netd|NetworkAgent" | head -40
        echo "===== FIM ====="
    } > "$out" 2>&1
    echo "$(date +%s) boot diag -> $(basename "$out")" >> "$LOG" 2>/dev/null
    _rotate
}

case "${1:-}" in
    snapshot) snapshot "${2:-manual}" ;;
    boot) boot ;;
    *) echo "Uso: $0 {snapshot <motivo>|boot}" ;;
esac
