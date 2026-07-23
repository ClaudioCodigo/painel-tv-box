#!/system/bin/sh
# healthcheck.sh — Verifica saúde do dispositivo
# Usage: healthcheck.sh [EXPECTED_PACKAGE]
# Output: informações em texto plano

EXPECTED="${1:-}"

# Timestamp local
echo "TIMESTAMP: $(date +%s)"

# Activity atual
CURRENT=$(dumpsys activity 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -1 | sed 's/.*\/\([^}]*\)}/\1/' | awk '{print $1}')
echo "CURRENT_ACTIVITY: $CURRENT"

# Player rodando?
if [ -n "$EXPECTED" ]; then
  PID=$(pidof "$EXPECTED" 2>/dev/null)
  if [ -n "$PID" ]; then
    echo "PLAYER_RUNNING: true"
    echo "PLAYER_PID: $PID"
  else
    echo "PLAYER_RUNNING: false"
  fi
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
