# Como Configurar o Watchdog

## O que é

O Watchdog monitora cada TV Box automaticamente e tenta recuperá-lo em caso de falha, seguindo uma cascata de ações.

## Configuração

Edite `config/watchdog.yml`:

```yaml
check_interval: 10          # segundos entre verificações

ping:
  count: 1
  timeout_ms: 800

adb:
  timeout: 5                # segundos

activity_check: true        # verificar Activity atual do player
mediamtx_check: true       # verificar path na API do MediaMTX

recovery:
  cooldown_seconds: 15      # aguardar antes de iniciar recuperação
  player_retry_max: 2       # tentativas de reabrir player
  player_retry_delay: 10    # segundos entre tentativas
  wifi_restart: true        # tentar reiniciar Wi-Fi
  wifi_reconnect_timeout: 30
  eth_restart: true         # tentar reiniciar Ethernet
  eth_reconnect_timeout: 30
  reboot_max: 1             # máximo de reboots por ciclo
  reboot_boot_timeout: 120  # aguardar boot
  critical_alert_cooldown: 300  # não repetir alerta antes de 5 min
```

## Sobrescrita por Dispositivo

Um dispositivo pode ter configuração própria:

```yaml
# devices/tvbox-meu-device.yml
watchdog_override:
  check_interval: 5       # verificar mais rápido
  recovery:
    player_retry_max: 3   # mais tentativas
```

## Fluxo de Recuperação

```
1. Detecta falha (health check ≠ online)
2. Aguarda cooldown (15s)
3. Reabre Player (até N tentativas)
4. Reinicia Wi-Fi (se configurado)
5. Reinicia Ethernet (se configurado)
6. Reboot Android (limitado)
7. Alerta crítico (se tudo falhar)
```

## Health Check — Matriz de Status

| Ping | ADB | Activity | MediaMTX | Status |
|---|---|---|---|---|
| ✅ | ✅ | ✅ | ✅ | online |
| ✅ | ✅ | ❌ | ✅ | degraded |
| ❌ | ✅ | - | - | online (ADB > ping) |
| ❌ | ❌ | - | - | offline |
