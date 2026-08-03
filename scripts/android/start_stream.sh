#!/system/bin/sh
# start_stream.sh — Abre stream RTSP no player especificado
# Usage: start_stream.sh <RTSP_URL> <PACKAGE> <ACTIVITY> [TITLE] [EXTRA_ARGS]

RTSP_URL="$1"
PACKAGE="$2"
ACTIVITY="$3"
TITLE="${4:-Stream}"
EXTRA="${5:-}"

# Fecha player existente
am force-stop "$PACKAGE" >/dev/null 2>&1
sleep 1

# Abre stream com clear task
# EXTRA é passado como um único argumento quote-ado (anti injeção — auditoria)
am start -a android.intent.action.VIEW \
    -d "$RTSP_URL" \
    -n "$PACKAGE/$ACTIVITY" \
    --es "title" "$TITLE" \
    --activity-clear-task \
    "$EXTRA"

echo "start_stream: $RTSP_URL -> $PACKAGE/$ACTIVITY"
