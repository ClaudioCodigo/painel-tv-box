#!/system/bin/sh
# update.sh — Script de atualização dos scripts no dispositivo
# Executado pelo painel após adb push dos novos scripts

echo "update: scripts atualizados em $(date)"
ls -la /data/local/tmp/panel/ 2>/dev/null || echo "update: diretorio panel nao encontrado"
