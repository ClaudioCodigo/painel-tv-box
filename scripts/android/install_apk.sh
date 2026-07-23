#!/system/bin/sh
# install_apk.sh — Instala APK no dispositivo
# Usage: install_apk.sh <APK_PATH>
# O painel envia o APK via adb push antes de chamar este script

APK_PATH="$1"

if [ -z "$APK_PATH" ]; then
  echo "install_apk: erro — caminho do APK não informado"
  exit 1
fi

pm install -r "$APK_PATH" 2>&1
echo "install_apk: exit_code=$?"
