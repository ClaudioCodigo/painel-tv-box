#!/system/bin/sh
# 01-eth-fix.sh — Autocura e inicialização forçada da Ethernet em TV Boxes Allwinner (cupid/sunxi-gmac)
#
# Instalado em: /data/adb/service.d/01-eth-fix.sh
# Permissões: chmod 755 /data/adb/service.d/01-eth-fix.sh
# Executado automaticamente pelo Magisk no boot (late_start service) como root.
#
# Problema resolvido: Ao reiniciar o TV Box com o cabo de rede conectado, o PHY Ethernet
# interno trava e não renegocia o link com o switch até que o cabo seja fisicamente
# removido e inserido novamente.
#
# Solução: Simula eletronicamente a remoção e inserção do cabo via unbind+bind do driver
# sunxi-gmac, forçando o PHY a emitir pulsos de auto-negociação (FLP) e garantindo
# a rota default e IP estático.

PANEL_DIR="/data/local/tmp/panel"
LOG="$PANEL_DIR/eth_boot.log"
mkdir -p "$PANEL_DIR" 2>/dev/null

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [eth-fix] $1" >> "$LOG" 2>/dev/null
}

log "=== Iniciando verificacao de Ethernet no boot ==="

# 1. Aguarda a inicializacao do Android completar (ate 45s)
i=0
while [ "$(getprop sys.boot_completed)" != "1" ] && [ "$i" -lt 45 ]; do
    sleep 1
    i=$((i + 1))
done

# Pausa breve para o driver de rede tentar negociar naturalmente
sleep 6

# 2. Testa se a rede ja subiu e esta alcancando o gateway/painel
check_conn() {
    # 192.168.254.6 (Gateway), 192.168.254.219 (Painel), 192.168.254.102 (Host TI)
    ping -c 1 -W 2 192.168.254.6 >/dev/null 2>&1 && return 0
    ping -c 1 -W 2 192.168.254.219 >/dev/null 2>&1 && return 0
    ping -c 1 -W 2 192.168.254.102 >/dev/null 2>&1 && return 0
    return 1
}

CARRIER=$(cat /sys/class/net/eth0/carrier 2>/dev/null)
log "Checagem inicial: carrier=$CARRIER"

if check_conn; then
    log "Rede ja esta operacional e respondendo a ping. Nenhuma acao necessaria."
    exit 0
fi

log "Rede NAO respondeu a ping (carrier=$CARRIER). Aplicando ciclo de replugue virtual..."

# 3. Ciclo de Replugue Virtual:
#    Derruba a interface, desvincula o driver do SoC e re-vincula
ip link set eth0 down 2>/dev/null
sleep 1

DRV_PATH="/sys/bus/platform/drivers/sunxi-gmac"
DEV="gmac1"
if [ ! -d "$DRV_PATH" ]; then
    # Fallback para deteccao dinamica caso o driver tenha outro nome
    DRV_NAME=$(basename "$(readlink /sys/class/net/eth0/device/driver 2>/dev/null)" 2>/dev/null)
    DEV=$(basename "$(readlink /sys/class/net/eth0/device 2>/dev/null)" 2>/dev/null)
    [ -n "$DRV_NAME" ] && DRV_PATH="/sys/bus/platform/drivers/$DRV_NAME"
fi

if [ -e "$DRV_PATH/unbind" ] && [ -e "$DRV_PATH/bind" ]; then
    log "Desvinculando $DEV de $DRV_PATH..."
    echo "$DEV" > "$DRV_PATH/unbind" 2>/dev/null
    sleep 2
    log "Vinculando $DEV a $DRV_PATH (reinicializacao fisica do PHY)..."
    echo "$DEV" > "$DRV_PATH/bind" 2>/dev/null
    sleep 3
else
    log "Aviso: sysfs unbind/bind nao disponivel em $DRV_PATH"
fi

# 4. Sobe a interface e aguarda o link eletrico (ate 15s)
ip link set eth0 up 2>/dev/null

c=0
while [ "$(cat /sys/class/net/eth0/carrier 2>/dev/null)" != "1" ] && [ "$c" -lt 15 ]; do
    sleep 1
    c=$((c + 1))
done

FINAL_CARRIER=$(cat /sys/class/net/eth0/carrier 2>/dev/null)
log "Carrier apos rebind: $FINAL_CARRIER (aguardou ${c}s)"

# 5. Garante IP Estatico e Rotas caso o framework do Android falhe ao restaurar
# Le a configuracao original de ipconfig.txt se disponivel, ou usa fallback
STATIC_IP="192.168.254.85"
GATEWAY="192.168.254.6"

if [ -f "/data/misc/ethernet/ipconfig.txt" ]; then
    CFG_IP=$(grep -o '192\.168\.[0-9.]*' /data/misc/ethernet/ipconfig.txt 2>/dev/null | head -n 1)
    [ -n "$CFG_IP" ] && STATIC_IP="$CFG_IP"
fi

CURRENT_IP=$(ip -4 addr show dev eth0 2>/dev/null | grep -o 'inet [0-9.]*' | awk '{print $2}')
if [ "$CURRENT_IP" != "$STATIC_IP" ]; then
    log "Atribuindo IP estatico $STATIC_IP..."
    ip addr add "${STATIC_IP}/24" dev eth0 2>/dev/null
fi

# Garante a rota de sub-rede e a rota padrao (default gateway)
ip route add 192.168.254.0/24 dev eth0 scope link src "$STATIC_IP" 2>/dev/null
ip route add default via "$GATEWAY" dev eth0 2>/dev/null

# Servidores DNS
setprop net.dns1 8.8.8.8
setprop net.dns2 8.8.4.4

# 6. Teste final de validacao
sleep 2
if check_conn; then
    log "SUCESSO: Conectividade Ethernet restabelecida automaticamente!"
else
    log "AVISO: Gateway ainda nao respondeu a ping, mas link e rotas foram reaplicados."
fi

exit 0
