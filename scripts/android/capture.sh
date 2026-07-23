#!/system/bin/sh
# capture.sh — Captura screenshot do dispositivo
# Usage: capture.sh [OUTPUT_PATH]
# Output: PNG salvo no path especificado (padrão: /data/local/tmp/panel/screenshot.png)

SU=""
if command -v su >/dev/null 2>&1; then
  SU="su -c"
fi

# Tenta /sdcard primeiro (mais confiável), fallback /data/local/tmp
if [ -d /sdcard ]; then
  BASE="/sdcard/panel"
else
  BASE="/data/local/tmp/panel"
fi

mkdir -p "$BASE" 2>/dev/null

OUTPUT="${1:-$BASE/screenshot.png}"

if [ -n "$SU" ]; then
  $SU "screencap -p $OUTPUT"
else
  screencap -p "$OUTPUT"
fi

echo "screenshot: salvo em $OUTPUT"
