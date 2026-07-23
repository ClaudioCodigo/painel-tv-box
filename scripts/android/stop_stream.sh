#!/system/bin/sh
# stop_stream.sh — Fecha player forçadamente
# Usage: stop_stream.sh <PACKAGE>

PACKAGE="${1:-org.videolan.vlc}"

am force-stop "$PACKAGE"
echo "stop_stream: $PACKAGE parado"
