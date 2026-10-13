#!/system/bin/sh
# healthcheck.sh — Verifica saúde do dispositivo
# Usage: healthcheck.sh [EXPECTED_PACKAGE]
# Output: informações em texto plano

EXPECTED="${1:-}"

# Timestamp local
echo "TIMESTAMP: $(date +%s)"

# Activity atual (compatível com todas as versões do Android)
CURRENT=$(dumpsys window 2>/dev/null | grep -e mCurrentFocus -e mFocusedApp | grep -oE '[a-zA-Z0-9._]+/[a-zA-Z0-9._]+' | head -1)
[ -z "$CURRENT" ] && CURRENT=$(dumpsys activity activities 2>/dev/null | grep -i ResumedActivity | grep -oE '[a-zA-Z0-9._]+/[a-zA-Z0-9._]+' | head -1)
echo "CURRENT_ACTIVITY: $CURRENT"

# Player / Kiosk rodando?
if [ -n "$EXPECTED" ]; then
  PID=$(pidof "$EXPECTED" 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "PLAYER_RUNNING: true"
    echo "PLAYER_PID: $PID"
  else
    echo "PLAYER_RUNNING: false"
  fi
else
  # Auto-detecção de players/kiosks conhecidos
  for pkg in com.freekiosk com.android.chrome org.videolan.vlc is.xyz.mpv; do
    PID=$(pidof "$pkg" 2>/dev/null)
    if [ -n "$PID" ]; then
      echo "PLAYER_RUNNING: true"
      echo "PLAYER_PACKAGE: $pkg"
      echo "PLAYER_PID: $PID"
      break
    fi
  done
fi

# URL do Free Kiosk (se disponível)
if [ -f /data/data/com.freekiosk/databases/RKStorage ]; then
  KIOSK_URL=$(sqlite3 /data/data/com.freekiosk/databases/RKStorage "SELECT value FROM catalystLocalStorage WHERE key='kiosk_url';" 2>/dev/null)
  [ -n "$KIOSK_URL" ] && echo "KIOSK_URL: $KIOSK_URL"
fi

# Bateria (se disponível)
if [ -f /sys/class/power_supply/battery/capacity ]; then
  echo "BATTERY: $(cat /sys/class/power_supply/battery/capacity)%"
fi

# Temperatura (se disponível)
if [ -f /sys/class/power_supply/battery/temp ]; then
  echo "TEMP: $(cat /sys/class/power_supply/battery/temp)"
fi

# Memória
echo "MEM: $(cat /proc/meminfo 2>/dev/null | grep MemFree | awk '{print $2 $3}')"
