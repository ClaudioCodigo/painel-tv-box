#!/system/bin/sh
# restart_eth.sh — Reinicia Ethernet via root (sem acesso físico ao cabo).
#
# O toggle simples (ip link set eth0 down/up) NÃO resolve em alguns TV boxes
# (ex.: Allwinner sunxi-gmac): o PHY não reinicializa e o Android não reaplica
# o IP. Equivalente a "replugar o cabo": faz unbind+bind do driver, que
# reinicializa o PHY de verdade.
#
# Cascata:
#   1. ip link down/up (rápido, suficiente na maioria)
#   2. rebind do driver (força reset do PHY — resolve o caso crônico)

SU_PREFIX="/sbin/su -c"
if [ ! -x /sbin/su ]; then
  SU_PREFIX="su -c"
fi

# Passo 1: toggle simples
nohup sh -c "$SU_PREFIX 'ip link set eth0 down && sleep 2 && ip link set eth0 up'" >/dev/null 2>&1 &

# Passo 2 (após 8s): se ainda sem carrier, rebind do driver (reset do PHY).
# Detecta driver/device via sysfs (funciona em Allwinner sunxi-gmac e outros).
nohup sh -c "sleep 8; $SU_PREFIX '
  if [ \"\$(cat /sys/class/net/eth0/carrier 2>/dev/null)\" != \"1\" ]; then
    DRV=\$(basename \$(readlink /sys/class/net/eth0/device/driver 2>/dev/null) 2>/dev/null)
    DEV=\$(basename \$(readlink /sys/class/net/eth0/device 2>/dev/null) 2>/dev/null)
    if [ -n \"\$DRV\" ] && [ -n \"\$DEV\" ] && [ -d \"/sys/bus/platform/drivers/\$DRV\" ]; then
      echo \$DEV > /sys/bus/platform/drivers/\$DRV/unbind 2>/dev/null
      sleep 3
      echo \$DEV > /sys/bus/platform/drivers/\$DRV/bind 2>/dev/null
      sleep 5
    fi
  fi
'" >/dev/null 2>&1 &

echo "eth_restart: iniciado (toggle + rebind driver se necessario)"
