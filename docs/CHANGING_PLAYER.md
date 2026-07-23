# Como Alterar o Player

## Players Suportados

| Player | Package | Activity |
|---|---|---|
| VLC | `org.videolan.vlc` | `org.videolan.vlc.gui.video.VideoPlayerActivity` |
| MPV | `is.xyz.mpv` | `is.xyz.mpv.MPVActivity` |

## Por Dispositivo

Edite o YAML do dispositivo:

```yaml
# devices/tvbox-meu-device.yml
player: "mpv"        # vlc | mpv
```

Ou via API:

```bash
curl -X PUT http://localhost:8080/api/devices/tvbox-meu-device \
  -H "Content-Type: application/json" \
  -d '{"player": "mpv"}'
```

## Configuração Global

Edite `config/players.yml`:

```yaml
players:
  vlc:
    package: "org.videolan.vlc"
    activity: "org.videolan.vlc.gui.video.VideoPlayerActivity"
    force_stop: "org.videolan.vlc"
    intent_template: >
      am start -a android.intent.action.VIEW
      -d "{URL}"
      -n {PACKAGE}/{ACTIVITY}
      --activity-clear-task
  mpv:
    package: "is.xyz.mpv"
    activity: "is.xyz.mpv.MPVActivity"
    force_stop: "is.xyz.mpv"
    intent_template: >
      am start -a android.intent.action.VIEW
      -d "{URL}"
      -n {PACKAGE}/{ACTIVITY}
      --activity-clear-task
default: vlc
```

## Adicionar Novo Player

Basta adicionar ao `players.yml`:

```yaml
players:
  exoplayer:
    package: "com.google.android.exoplayer2.demo"
    activity: "com.google.android.exoplayer2.demo.MainActivity"
    force_stop: "com.google.android.exoplayer2.demo"
    intent_template: >
      am start -a android.intent.action.VIEW
      -d "{URL}"
      -n {PACKAGE}/{ACTIVITY}
```
