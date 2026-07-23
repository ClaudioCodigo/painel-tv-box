#!/system/bin/sh
# restart_wifi.sh — Reinicia Wi-Fi usando nohup (ADB cai temporariamente)

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

nohup sh -c 'svc wifi disable && sleep 5 && svc wifi enable' >/dev/null 2>&1 &
echo "wifi_restart: iniciado (reconexao ADB em ~10s)"
