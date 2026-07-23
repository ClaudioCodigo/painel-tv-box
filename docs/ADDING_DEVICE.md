# Como Adicionar um TV Box

## Pelo Wizard (primeira execução)

Na primeira execução, o assistente guia passo a passo. Basta informar:

1. IP do servidor
2. Dados do MediaMTX
3. Nome, IP e localização do TV Box

## Pela API

```bash
curl -X POST http://localhost:8080/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TV Box Armazém 1B",
    "ip": "192.168.254.13",
    "adb_port": 5555,
    "location": "Armazém 1B",
    "rtsp_path": "TV_BOX_3",
    "player": "vlc",
    "root": true,
    "group": "armazens"
  }'
```

O painel automaticamente:
1. ✅ Cria o arquivo YAML em `devices/tv-box-armazem-1b.yml`
2. ✅ Tenta conectar via ADB
3. ✅ Envia os scripts .sh para `/data/local/tmp/panel/`
4. ✅ Inicia o watchdog para monitoramento

## Pela Interface

1. Acesse o Dashboard
2. Clique em **Dispositivos** na sidebar
3. Aguarde a página de dispositivos (em desenvolvimento)

## Manualmente (criando YAML)

Crie um arquivo em `devices/`:

```yaml
# devices/tvbox-meu-dispositivo.yml
id: "tvbox-meu-dispositivo"
name: "Meu TV Box"
ip: "192.168.254.100"
adb_port: 5555
location: "Sala de Reunião"
rtsp_path: "MEU_STREAM"
player: "vlc"
root: false
capabilities:
  wifi_restart: true
  ethernet_restart: true
  reboot: true
  root: false
  install_apk: true
  shell: true
  screenshot: true
```

Reinicie o painel ou chame `POST /api/devices/reload`.
