# Análise dos Arquivos Fornecidos

## Arquivos examinados

| Arquivo | Propósito | Estado |
|---|---|---|
| `IDEA.md` | Briefing completo do projeto | Válido — é o contrato |
| `pier-maua-stream-automation.md` | Documentação técnica da automação atual | Válido com correções (ver abaixo) |
| `tvbox_watchdog.py` | Watchdog de conectividade atual | Legado — será substituído |
| `mediamtx_monitor.py` | Monitor MediaMTX + conversão UDP | **NÃO relacionado** (ver abaixo) |
| `mediamtx.yml` | Config MediaMTX em produção | Válido — base de referência |

---

## Inconsistências identificadas e correções

### 1. Formato da URL RTSP (pier-maua-stream-automation.md, linha 27-48)

**Diz:** `rtsp://{host}:{porta}/{chave}/{endereco_transmissao}` (dois níveis de path)

**Realidade (confirmado pelo próprio arquivo na linha 42 e pelo mediamtx.yml):** `rtsp://192.168.254.102:8554/TV_BOX_1` (path único, sem separação chave/endereço)

**Correção no painel:** O path RTSP será um campo único por dispositivo. Sem composição de chave + endereço.

### 2. Activity do VLC (pier-maua-stream-automation.md)

**Diz (linha 58):** `org.videolan.vlc/.StartActivity`

**Diz (linha 254, exemplos de conexão reais):** `org.videolan.vlc/.gui.video.video.VideoPlayerActivity`

**Correção:** Usar `org.videolan.vlc/.gui.video.VideoPlayerActivity` (validado nos exemplos reais de conexão). O painel deve permitir configurar a activity no YAML do dispositivo, então ambas as formas são suportadas — o padrão será `VideoPlayerActivity`.

### 3. writeQueueSize e timeouts do MediaMTX

**Diz (pier-maua-stream-automation.md, linha 92):** `writeQueueSize: 2048`

 **Real (mediamtx.yml antigo em produção, linha 28):** `128`

 **Real (mediamtx.yml v1.19.2 fresh, linha 28):** `512`, `readTimeout: 10s`, `writeTimeout: 10s`

**Correção:** Será configurável em `config/mediamtx.yml`. Padrão: `2048` (conforme documentação técnica pier-maua, otimizado para TV Box fraco). Timeouts padrão da v1.19.2: `10s`.

### 3a. Novo mediamtx.yml v1.19.2 — mudanças relevantes

O arquivo fresh da v1.19.2 tem mudanças em relação ao que está em produção:

| Campo | Antigo (produção) | Novo (v1.19.2 fresh) | Ação |
|---|---|---|---|
| `logLevel` | `warn` | `info` | Configurável. Padrão painel: `warn` |
| `writeQueueSize` | `128` | `512` | Configurável. Padrão painel: `2048` |
| `readTimeout` | `5s` | `10s` | Configurável. Padrão: `10s` |
| `writeTimeout` | `5s` | `10s` | Configurável. Padrão: `10s` |
| `rtspTransports` | `[udp, tcp]` | `[udp, multicast, tcp]` | Padrão painel: `[udp, tcp]` (sem multicast) |
| `hlsVariant` | `mpegts` | `lowLatency` | Configurável. Padrão painel: `mpegts` (compatibilidade) |
| `metrics` | `false` | `true` | Padrão painel: `false` (economiza recursos) |
| `authInternalUsers` | user any tem `ips: ['127.0.0.1', '::1', '192.168.254.0/24']` | `ips: ['127.0.0.1', '::1']` | Painel gera com IP da rede local doвиг Provid wizard |
| Comentários | "Environment variables are the same of..." | "...are the same as..." | Reescrita de comentários (sem impacto) |
| `apiAllowOrigins` | `['*']` (sem aspas) | `["*"]` (com aspas) | Sem impacto funcional |

**Decisão:** O painel gerará o `mediamtx.yml` a partir de `config/mediamtx.yml` do painel. O arquivo fresh da v1.19.2 é a referência para estrutura, mas os valores virão da configuração do painel. Paths serão gerados dinamicamente a partir dos dispositivos cadastrados.

### 4. mediamtx_monitor.py — Conversão UDP Multicast

Este arquivo converte streams RTSP → UDP multicast via FFmpeg para um sistema de "Infra de Senhas" (painéis de senha). **Não tem relação com o painel de TV Boxes.** Não será portado nem referenciado. A arquitetura do painel é OBS → MediaMTX (RTSP) → TV Box (VLC/MPV direto), sem conversão UDP.

### 5. tvbox_watchdog.py — Windows-only

O watchdog atual usa notificações PowerShell toast, ping com `-n` (Windows), e roda em Windows. O IDEA.md exige Debian 13. **Será completamente reescrito** — não há código reaproveitável, apenas conceito (monitorar, detectar queda, recuperar).

### 6. tvbox_watchdog.py — Ping-only

O watchdog atual só faz ping. O IDEA.md exige health check multi-camada (Ping + ADB + Activity + MediaMTX + Player). Status deve ser: `online` (todos OK), `degraded` (alguns falhando), `warning`, `offline` (todos falhando).

### 7. Paths do MediaMTX dessincronizados

O `mediamtx.yml` define `TV_BOX_1` a `TV_BOX_4` (4 paths). O `tvbox_watchdog.py` monitora 6 boxes (TV_BOX_1 a TV_BOX_6). No novo painel, os paths serão derivados dos dispositivos cadastrados — o `mediamtx.yml` é gerado/atualizado automaticamente pelo `ConfigurationManager`.

### 8. Reinício de Wi-Fi e ADB

O guia (linha 256) mostra: `nohup sh -c 'svc wifi disable && sleep 5 && svc wifi enable' >/dev/null 2>&1 &`

A reinicialização de Wi-Fi **derruba a conexão ADB temporariamente**. O watchdog precisa:
- Usar `nohup` (o comando continua mesmo após ADB cair)
- Aguardar reconexão ADB com timeout configurável
- Não considerar o device offline durante este período de manutenção

O mesmo se aplica a reiniciar Ethernet e reboot.