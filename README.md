# Painel TV Box

Painel web para gerenciamento de TV Boxes Android com reprodução de streams RTSP via MediaMTX.

> **Nota de segurança:** configurações reais, credenciais, IPs da LAN e estado por dispositivo são locais e não devem ser versionados. Use os arquivos `config/*.yml.example` como referência e mantenha `config/*.yml`, `devices/*.yml`, `groups/*.yml`, chaves ADB e arquivos de heartbeat fora do Git.

## Recursos

- Dashboard em tempo real
- Cadastro e gerenciamento de TV Boxes
- Heartbeat device → servidor sem depender de ADB para liveness
- Watchdog e recuperação automática
- Controle de reprodução/stream
- Reboot, shell remoto, screenshot e instalação de APK
- Grupos de dispositivos
- Logs e backup
- Integração com scrcpy
- MediaMTX para distribuição RTSP/RTMP
- Servidor ADB isolado do painel

## Stack

- Python 3.11+
- FastAPI / Uvicorn / Pydantic
- HTML / CSS / JavaScript
- YAML
- WebSockets

## Instalação

O projeto é voltado para Windows 10+ / Windows Server 2019+.

Execute `instalar.bat` como administrador e siga o fluxo do instalador.

Consulte [docs/INSTALL.md](docs/INSTALL.md) para detalhes.

## Configuração local

Os arquivos reais de configuração não são versionados:

- `config/*.yml`
- `devices/*.yml`
- `groups/*.yml`
- `config/.panel_token`
- `config/admin.json`
- `config/.session_secret`
- chaves privadas ADB (`adbkey`)
- `heartbeat.conf`

O repositório mantém templates `.example` sanitizados. Nunca coloque `heartbeat_key`, senha, token, chave privada ou IP específico da infraestrutura nos templates ou documentação pública.

## Autenticação

O painel suporta usuário/senha de administrador, token de sessão e uma chave dedicada para heartbeat. Segredos são gerados e armazenados somente na instalação local.

## Desenvolvimento

```bash
python -m pytest
node --check static/js/*.js
```

## Documentação

- [Instalação](docs/INSTALL.md)
- [Como adicionar TV Box](docs/ADDING_DEVICE.md)
- [Como configurar grupos](docs/GROUPS.md)
- [Guia técnico para desenvolvimento](docs/LLM.md)

## Licença

Consulte os arquivos do repositório para os termos aplicáveis.
