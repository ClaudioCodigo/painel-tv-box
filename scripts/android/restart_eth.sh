#!/system/bin/sh
# restart_eth.sh — Reinicia Ethernet via root (sem acesso físico ao cabo).
#
# O toggle simples (ip link set eth0 down/up) NÃO resolve em alguns TV boxes
# (ex.: Allwinner sunxi-gmac): o PHY não reinicializa e o Android não reaplica
# o IP. Equivalente a "replugar o cabo": faz unbind+bind do driver, que
# reinicializa o PHY de verdade.
#
# IMPORTANTE: o netwatch só chama este script após FALHA REAL de conectividade
# (nc/ping no painel) — não pelo estado da interface. Por isso o rebind roda
# SEMPRE: no "link fantasma" a interface reporta carrier=1 e UP mesmo sem
# tráfego, e um gate antigo em `carrier != 1` fazia o rebind nunca rodar
# justamente no caso em que ele é a única estratégia eficaz.
#
# Cascata:
#   1. toggle ip link down/up (rápido, suficiente na maioria)
#   2. rebind do driver (força reset do PHY — resolve o link fantasma)
#   3. verificação real (nc no painel) + log do resultado

SU_PREFIX="/sbin/su -c"
if [ ! -x /sbin/su ]; then
  SU_PREFIX="su -c"
fi

CONFIG="/data/local/tmp/panel/heartbeat.conf"
LOG="/data/local/tmp/panel/restart_eth.log"

PANEL_IP=""
if [ -f "$CONFIG" ]; then
  PANEL_IP=$(sed -n 's#^PANEL_URL=http://\([^:]*\):.*#\1#p' "$CONFIG" | head -n 1)
fi
# Sem heartbeat.conf, use apenas um endereço de documentação neutro. Em
# produção o provisioning sempre deve gravar PANEL_URL no arquivo local.
[ -z "$PANEL_IP" ] && PANEL_IP="192.0.2.10"

# Passo 1: toggle simples
nohup sh -c "$SU_PREFIX 'ip link set eth0 down && sleep 2 && ip link set eth0 up'" >/dev/null 2>&1 &

# Passo 2 (após 8s): rebind do driver (reset do PHY) — sempre, ver acima.
# Detecta driver/device via sysfs (funciona em Allwinner sunxi-gmac e outros).
# Passo 3 (após o rebind): verifica conectividade REAL com nc e loga.
nohup sh -c "sleep 8; $SU_PREFIX '
  echo \"\$(date +%s) eth_restart: toggle feito, iniciando rebind\" >> $LOG
  DRV=\$(basename \$(readlink /sys/class/net/eth0/device/driver 2>/dev/null) 2>/dev/null)
  DEV=\$(basename \$(readlink /sys/class/net/eth0/device 2>/dev/null) 2>/dev/null)
  if [ -n \"\$DRV\" ] && [ -n \"\$DEV\" ] && [ -d \"/sys/bus/platform/drivers/\$DRV\" ]; then
    echo \"\$(date +%s) eth_restart: rebind \$DRV/\$DEV\" >> $LOG
    echo \$DEV > /sys/bus/platform/drivers/\$DRV/unbind 2>/dev/null
    sleep 3
    echo \$DEV > /sys/bus/platform/drivers/\$DRV/bind 2>/dev/null
    sleep 6
    ip link set eth0 up 2>/dev/null
    sleep 2
  else
    echo \"\$(date +%s) eth_restart: driver nao encontrado, pulando rebind\" >> $LOG
  fi
  # Passo 3: teste real (nc), nao o estado da interface
  if command -v nc >/dev/null 2>&1; then
    if nc -w 5 $PANEL_IP 8080 </dev/null >/dev/null 2>&1; then
      echo \"\$(date +%s) eth_restart: OK, rede voltou apos toggle+rebind\" >> $LOG
    else
      echo \"\$(date +%s) eth_restart: FALHOU, rede ainda indisponivel apos toggle+rebind\" >> $LOG
    fi
  fi
'" >/dev/null 2>&1 &

echo "eth_restart: iniciado (toggle + rebind sempre + verificacao nc)"
