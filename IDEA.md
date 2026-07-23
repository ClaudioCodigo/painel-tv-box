# CONTEXTO DO PROJETO

O objetivo é desenvolver um painel web para gerenciamento e monitoramento de TV Boxes Android responsáveis por reproduzir streams RTSP fornecidas pelo MediaMTX.

O sistema será utilizado exclusivamente em rede local.

Não existe necessidade de autenticação.

Todo o sistema será executado em uma única máquina Debian 13.

Essa mesma máquina hospeda:

* MediaMTX
* Painel Web
* Backend Python
* ADB
* Scripts de automação

O OBS publica streams para o MediaMTX utilizando o plugin Multi RTMP.

O painel NÃO controla diretamente o OBS inicialmente, porém deve possuir arquitetura preparada para integração futura.

---

# ARQUITETURA OBRIGATÓRIA

Utilizar:

Frontend

* HTML
* CSS
* JavaScript puro

Backend

* Python
* FastAPI

Persistência

* YAML

Comunicação em tempo real

* WebSocket

Sistema

* Debian 13
* systemd

ADB

* adb via TCP

MediaMTX

* API REST

---

# OBJETIVOS

O sistema deve ser parecido com um CasaOS especializado em TV Boxes.

Ele deverá permitir:

* monitorar
* configurar
* controlar
* diagnosticar
* recuperar automaticamente
* administrar

todos os TV Boxes.

---

# IMPORTANTE

O sistema deve ser completamente orientado à configuração.

Evite absolutamente qualquer valor hardcoded.

Toda informação configurável deve estar:

* no Wizard inicial
* na interface
* ou em arquivos YAML

---

# ARQUIVOS FORNECIDOS

Utilize os arquivos anexados como documentação técnica e referência.

NÃO copie erros existentes.

Valide todas as informações.

Caso existam inconsistências, corrija a implementação.

---

# ARQUITETURA DO SISTEMA

Criar módulos independentes.

Exemplo:

Frontend

↓

API

↓

Managers

ADBManager

MediaMTXManager

DeviceManager

WatchdogManager

PlayerManager

ConfigurationManager

UpdateManager

LogManager

BackupManager

HealthManager

↓

Services

↓

Scripts Android

---

# ESTRUTURA DO PROJETO

Organizar algo semelhante a:

project/

app/

api/

core/

managers/

models/

services/

utils/

config/

devices/

groups/

scripts/

android/

templates/

static/

logs/

backups/

tests/

docs/

Cada TV Box deve possuir um arquivo YAML próprio.

Exemplo

devices/

tvbox-armazem.yml

tvbox-portaria.yml

tvbox-embarque.yml

Nunca colocar todos os dispositivos em um único arquivo.

---

# CONFIGURAÇÃO

Separar configurações.

config/

system.yml

watchdog.yml

players.yml

mediamtx.yml

Cada TV Box deve possuir:

Nome

IP

MAC

Localização

Descrição

Grupo

Path RTSP

Player

Porta ADB

Observações

Root

Capabilities

Parâmetros extras

---

# CAPABILITIES

Cada dispositivo informa o que suporta.

Exemplo

wifi_restart

ethernet_restart

reboot

root

install_apk

shell

screenshot

volume

mute

Isso evita condicionais espalhadas pelo código.

---

# WIZARD INICIAL

Na primeira execução deve existir um assistente.

O Wizard deve solicitar:

IP do servidor

Portas

Localização do MediaMTX

ADB

Pastas

Primeiros dispositivos

Primeiros grupos

Configuração do Watchdog

Ao finalizar deve gerar automaticamente todos os YAML.

---

# DASHBOARD

Inspirado visualmente no CasaOS.

Layout moderno.

Cards.

Menu lateral.

Responsivo.

Mostrar:

TVs Online

TVs Offline

Streams Ativas

MediaMTX

ADB

CPU

RAM

Disco

Uptime

Eventos recentes

Alertas

Logs

---

# DISPOSITIVOS

Cada TV Box deve possuir uma página.

Mostrar:

Status

Ping

ADB

Player

Root

Screenshot

Stream atual

Path

Grupo

Tempo conectado

Histórico

Último erro

Última recuperação

---

# HEALTH CHECK

NUNCA confiar apenas em um indicador.

Combinar:

Ping

ADB

Activity atual

MediaMTX API

Player

Somente considerar ONLINE quando todas as verificações forem compatíveis.

Caso contrário:

Warning

Degraded

Offline

---

# MEDIAMTX

Consumir

[http://localhost:9997/v3/paths/list](http://localhost:9997/v3/paths/list)

Descobrir automaticamente:

Paths

Readers

Publisher

Bitrate

Tracks

Online

Disponibilidade

Disponibilizar interface para:

Criar Paths

Importar Paths

Associar Path a um TV Box

---

# ADB

Criar camada de abstração.

Nunca espalhar comandos adb pelo código.

Toda chamada deve passar pelo ADBManager.

Implementar:

connect

disconnect

shell

push

pull

install

reboot

force-stop

intent

---

# PLAYER

Suportar:

VLC

MPV

Selecionável por dispositivo.

Permitir parâmetros extras configuráveis.

Nunca deixar comandos hardcoded.

---

# SCRIPTS NO TV BOX

Durante o cadastro o sistema deverá instalar automaticamente uma pasta.

Exemplo

/data/local/tmp/panel/

Criar scripts como:

start_stream.sh

restart_wifi.sh

restart_eth.sh

capture.sh

install_apk.sh

healthcheck.sh

update.sh

Depois o painel apenas executará:

adb shell sh /data/local/tmp/panel/start_stream.sh

Evitar comandos gigantes enviados diretamente.

---

# WATCHDOG

Cada TV Box possui um Watchdog independente.

Todos os tempos configuráveis.

Fluxo:

Detecta falha

↓

Aguardar

↓

Reabrir Player

↓

Reabrir novamente

↓

Reiniciar Wi-Fi

↓

Testar

↓

Reiniciar Ethernet

↓

Testar

↓

Reboot Android

↓

Aguardar Boot

↓

Abrir Stream

↓

Continuou falhando

↓

Gerar alerta crítico

Todos os tempos:

Tentativas

Cooldown

Timeout

Reboots máximos

Devem ser configuráveis.

Nunca fixos.

---

# LOGS

Implementar:

Pesquisa

Filtros

Download

Exportação

Tempo real

Histórico

Separar:

Sistema

ADB

MediaMTX

Watchdog

Usuário

API

---

# SCREENSHOT

Permitir captura remota.

O screenshot deve retornar automaticamente ao servidor.

Disponibilizar visualização no painel.

---

# APK

Permitir:

Instalar APK

Atualizar APK

Selecionar arquivo

Enviar automaticamente via adb

---

# SHELL

Criar terminal remoto.

Executar comandos específicos.

Registrar logs.

---

# BACKUPS

Permitir:

Exportar YAML

Importar YAML

Backup completo

Restore

---

# UPDATE

Implementar atualização simples.

git pull

↓

migração de configuração

↓

reinício do serviço

Caso seja necessário reiniciar algum componente, avisar claramente o usuário.

---

# API

Criar API REST organizada.

Separar rotas.

Documentação automática.

Preparada para expansão.

---

# WEBSOCKET

Todas as informações devem atualizar automaticamente.

Sem refresh.

---

# PADRÕES

Código fortemente tipado.

Sem duplicação.

SOLID.

DRY.

KISS.

Arquitetura modular.

Comentários apenas quando realmente necessários.

---

# UX

Interface extremamente simples.

Poucos cliques.

Operações críticas com confirmação.

Feedback visual.

Estados claros.

Sem poluição visual.

---

# ESCALABILIDADE

Projetar para aproximadamente 20 TV Boxes.

Adicionar um novo dispositivo não deve exigir alteração de código.

Apenas criar configuração.

---

# DOCUMENTAÇÃO

Gerar:

README

Instalação

Estrutura

Arquitetura

Como adicionar TV

Como atualizar

Como fazer backup

Como restaurar

Como instalar APK

Como alterar Player

Como criar Groups

Como configurar Watchdog

---

# QUALIDADE

Sempre preferir soluções:

mais simples

mais robustas

mais legíveis

mais configuráveis

mais modulares

mais fáceis de manter

---

# REGRA ABSOLUTA

NÃO invente requisitos.

NÃO tome decisões arquiteturais sem justificativa.

Quando existir mais de uma solução possível que possa alterar a arquitetura ou afetar a manutenção futura, interrompa a implementação e apresente as alternativas com seus prós e contras antes de prosseguir.

Antes de escrever qualquer código, faça uma análise completa dos arquivos fornecidos, identifique inconsistências, proponha a arquitetura detalhada do projeto, apresente um plano de implementação por fases (MVP → funcionalidades intermediárias → versão completa) e somente então inicie o desenvolvimento.
