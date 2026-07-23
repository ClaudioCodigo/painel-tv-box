# Como Instalar APK

## Pela Interface

1. Acesse a página do dispositivo
2. Role até a seção **APK**
3. Clique em **📤 Instalar APK**
4. Selecione o arquivo .apk
5. Aguarde a instalação

## Pela API

```bash
curl -X POST http://localhost:8080/api/devices/tv-box-pier/install-apk \
  -F "file=@/caminho/para/app.apk"
```

## Como funciona

1. Upload do APK para o servidor
2. `adb push` para o TV Box: `/data/local/tmp/panel/app.apk`
3. Executa `sh /data/local/tmp/panel/install_apk.sh /data/local/tmp/panel/app.apk`
4. O script executa `pm install -r` no Android
5. Limpa arquivos temporários

## Requisitos

- TV Box com ADB conectado
- APK compativel com a versão do Android no TV Box
- Se `root: true` no YAML do dispositivo, usa `su` para instalação privilegiada
