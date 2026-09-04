#!/system/bin/sh
# restart_eth.sh — Reinicia Ethernet via root (sem acesso físico ao cabo).
#
# O toggle simples (ip link set eth0 down/up) NÃO resolve em alguns TV boxes
# (ex.: Allwinner sunxi-gmac): o PHY pode ficar em "link fantasma" (carrier=1,
# interface UP, mas sem tráfego). O rebind do driver reinicializa o PHY de
# verdade e equivale, na prática, a replugar o cabo.
#
# O netwatch chama este script somente após falha REAL de conectividade com o
# painel, então o rebind continua sendo executado sempre. O recovery roda em um
# único worker root para evitar corrida entre toggle/rebind e usa lock para não
# deixar duas recuperações simultâneas brigarem pelo mesmo driver.

CONFIG="/data/local/tmp/panel/heartbeat.conf"
LOG="/data/local/tmp/panel/restart_eth.log"
LOCK_DIR="/data/local/tmp/panel/restart_eth.lock"

log() {
    echo "$(date +%s) eth_restart: $*" >> "$LOG"
}

panel_ip() {
    local ip=""
    if [ -f "$CONFIG" ]; then
        ip=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
    fi
    [ -n "$ip" ] && echo "$ip" || echo "192.168.254.219"
}

check_net() {
    local ip="$1"
    if command -v nc >/dev/null 2>&1; then
        nc -w 5 "$ip" 8080 < /dev/null >/dev/null 2>&1 && return 0
    fi
    ping -c 1 -W 3 "$ip" >/dev/null 2>&1 && return 0
    return 1
}

wait_iface() {
    local i=0
    while [ ! -e /sys/class/net/eth0 ] && [ "$i" -lt 10 ]; do
        sleep 1
        i=$((i + 1))
    done
    [ -e /sys/class/net/eth0 ]
}

wait_carrier() {
    local i=0
    while [ "$i" -lt 12 ]; do
        [ "$(cat /sys/class/net/eth0/carrier 2>/dev/null)" = "1" ] && return 0
        sleep 1
        i=$((i + 1))
    done
    return 1
}

get_ipv4() {
    ip -4 addr show dev eth0 2>/dev/null \
        | sed -n 's/.*inet \([^ ]*\).*/\1/p' \
        | head -n 1
}

wait_ipv4() {
    local i=0 ip=""
    while [ "$i" -lt 12 ]; do
        ip=$(get_ipv4)
        [ -n "$ip" ] && echo "$ip" && return 0
        sleep 1
        i=$((i + 1))
    done
    return 1
}

acquire_lock() {
    local old_pid=""

    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$LOCK_DIR/pid" 2>/dev/null
        return 0
    fi

    # /data/local/tmp persiste após reboot; limpa lock órfão para não desativar
    # o recovery para sempre se a box reiniciar no meio do reset.
    old_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
        return 1
    fi

    rm -f "$LOCK_DIR/pid" 2>/dev/null
    rmdir "$LOCK_DIR" 2>/dev/null
    mkdir "$LOCK_DIR" 2>/dev/null || return 1
    echo "$$" > "$LOCK_DIR/pid" 2>/dev/null
    return 0
}

release_lock() {
    rm -f "$LOCK_DIR/pid" 2>/dev/null
    rmdir "$LOCK_DIR" 2>/dev/null
}

worker() {
    if ! acquire_lock; then
        log "ignorado: recovery ja em andamento"
        return 0
    fi
    trap 'release_lock' EXIT
    trap 'release_lock; exit 1' HUP INT TERM

    local target driver dev driver_dir carrier ipv4
    target=$(panel_ip)
    log "inicio target=$target"

    # Passo 1: toggle simples.
    ip link set eth0 down 2>/dev/null
    sleep 2
    ip link set eth0 up 2>/dev/null
    log "toggle concluido"

    # Mantém aproximadamente a janela antiga de 8s antes do rebind.
    sleep 6

    # Passo 2: rebind do driver. Salva o caminho real antes do unbind, pois o
    # symlink em /sys/class/net/eth0/device/driver pode sumir durante o reset.
    driver=$(basename "$(readlink /sys/class/net/eth0/device/driver 2>/dev/null)" 2>/dev/null)
    dev=$(basename "$(readlink /sys/class/net/eth0/device 2>/dev/null)" 2>/dev/null)
    driver_dir=$(readlink -f /sys/class/net/eth0/device/driver 2>/dev/null)

    # Fallback para firmwares/toybox sem `readlink -f`.
    if [ -z "$driver_dir" ] && [ -n "$driver" ] && [ -d "/sys/bus/platform/drivers/$driver" ]; then
        driver_dir="/sys/bus/platform/drivers/$driver"
    fi

    if [ -n "$dev" ] && [ -n "$driver_dir" ] \
        && [ -e "$driver_dir/unbind" ] && [ -e "$driver_dir/bind" ]; then
        log "rebind driver=$driver dev=$dev path=$driver_dir"
        echo "$dev" > "$driver_dir/unbind" 2>/dev/null
        sleep 3
        echo "$dev" > "$driver_dir/bind" 2>/dev/null

        if wait_iface; then
            ip link set eth0 up 2>/dev/null
        else
            log "WARN eth0 nao reapareceu apos rebind"
        fi
    else
        log "WARN driver nao encontrado; rebind pulado driver=$driver dev=$dev"
    fi

    # Passo 3: espera sinais mínimos da pilha antes de testar o painel. Não
    # força DHCP aqui para não sobrescrever configuração de IP estático.
    if wait_carrier; then
        carrier=1
    else
        carrier=$(cat /sys/class/net/eth0/carrier 2>/dev/null)
        [ -z "$carrier" ] && carrier="?"
    fi

    ipv4=$(wait_ipv4)
    [ -z "$ipv4" ] && ipv4="none"
    log "estado carrier=$carrier ipv4=$ipv4"

    # Passo 4: valida conectividade real (TCP no painel; ping como fallback).
    if check_net "$target"; then
        log "OK rede voltou apos toggle+rebind"
    else
        log "FALHOU rede indisponivel apos toggle+rebind carrier=$carrier ipv4=$ipv4"
    fi
}

if [ "${1:-}" = "_worker" ]; then
    if [ "$(id -u 2>/dev/null)" != "0" ]; then
        log "ERRO worker sem root"
        exit 1
    fi
    worker
    exit $?
fi

# Mantém o contrato assíncrono com o netwatch: dispara e retorna imediatamente.
# O worker decide se há outro recovery ativo e também limpa locks órfãos.
if [ "$(id -u 2>/dev/null)" = "0" ]; then
    nohup sh "$0" _worker >/dev/null 2>&1 &
elif [ -x /sbin/su ]; then
    nohup /sbin/su -c "sh '$0' _worker" >/dev/null 2>&1 &
else
    nohup su -c "sh '$0' _worker" >/dev/null 2>&1 &
fi

echo "eth_restart: iniciado (toggle + rebind + espera carrier/IP + verificacao real)"
