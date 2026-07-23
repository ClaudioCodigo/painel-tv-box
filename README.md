# Painel TV Box

Painel web para gerenciamento e monitoramento de TV Boxes Android que reproduzem streams RTSP via MediaMTX.

📡 **Dashboard** — status em tempo real de todos os TV Boxes  
🎬 **Streaming** — abrir/fechar streams com VLC ou MPV  
🔄 **Watchdog** — recuperação automática em cascata  
📸 **Screenshot** — captura remota de tela  
📦 **APK** — instalação remota de aplicativos  
📋 **Logs** — busca e filtros com auto-refresh  
💾 **Backup** — export/import completo da configuração  

## Arquitetura

```
OBS → RTMP → MediaMTX → RTSP → TV Box (VLC/MPV)
                              ↑
                         Painel Web
                         (FastAPI + ADB)
```

## Stack

| Componente | Tecnologia |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| Frontend | HTML + CSS + JavaScript puro (sem framework) |
| Persistência | YAML (um arquivo por dispositivo) |
| Tempo real | WebSocket |
| Streaming | MediaMTX (RTSP/RTMP) |
| Controle remoto | ADB via TCP |

## Instalação Rápida (Debian 13)

```bash
# 1. Clone
git clone https://github.com/seu-repo/panel-tvbox.git /opt/panel
cd /opt/panel

# 2. Execute instalação como root
sudo bash deploy/install.sh

# 3. Acesse o painel
# http://IP_DO_SERVIDOR:8080
```

## Instalação Manual

Ver [docs/INSTALL.md](docs/INSTALL.md)

## Documentação

- [Instalação](docs/INSTALL.md)
- [Como adicionar TV Box](docs/ADDING_DEVICE.md)
- [Como configurar grupos](docs/GROUPS.md)
- [Como configurar o Watchdog](docs/WATCHDOG.md)
- [Como alterar o Player](docs/CHANGING_PLAYER.md)
- [Como instalar APK](docs/APK_INSTALL.md)
- [Como fazer backup/restore](docs/BACKUP.md)
- [Como atualizar](docs/UPDATING.md)

## Licença

MIT
