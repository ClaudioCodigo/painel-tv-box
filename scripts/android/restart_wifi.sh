#!/system/bin/sh
# restart_wifi.sh — Reinicia Wi-Fi usando nohup (ADB cai temporariamente).
# Corrigido: usa root (svc wifi como shell pode falhar em alguns firmwares).
# Prefere /sbin/su (Magisk) quando existir; fallback su -c.

SU_PREFIX="/sbin/su -c"
if [ ! -x /sbin/su ]; then
  SU_PREFIX="su -c"
fi

nohup sh -c "$SU_PREFIX 'svc wifi disable && sleep 5 && svc wifi enable'" >/dev/null 2>&1 &
echo "wifi_restart: iniciado (reconexao ADB em ~10s, com root)"
