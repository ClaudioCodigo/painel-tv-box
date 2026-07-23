#!/system/bin/sh
# restart_eth.sh — Reinicia Ethernet usando nohup (ADB cai temporariamente)

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

nohup sh -c 'ip link set eth0 down && sleep 3 && ip link set eth0 up' >/dev/null 2>&1 &
echo "eth_restart: iniciado"
