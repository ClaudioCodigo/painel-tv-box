# Fase 13 — scrcpy Integration (Adição de Última Hora)

## Análise

### O que é scrcpy

Aplicação open-source (Apache 2.0) que espelha e controla dispositivos Android via ADB.
- **Versão mais recente:** v4.1 (12/07/2026)
- **Linux asset:** `scrcpy-linux-x86_64-v4.1.tar.gz` (~17.7 MB)
- **Server asset:** `scrcpy-server-v4.1` (~734 KB, enviado via ADB)
- **146k stars**, mantido por Romain Vimont (Genymobile)
- **Sem root** no dispositivo Android
- **Funciona via ADB TCP** (já temos)

### Requisitos do usuário

1. Painel para verificar atualizações do scrcpy
2. Download e instalação de novas versões
3. Manter 1-2 versões anteriores para rollback
4. Fallback automático em caso de falha

### Arquitetura de Versões

```
/opt/panel/scrcpy/
├── downloads/              # Arquivos tar.gz baixados
├── versions/               # Versões extraídas
│   ├── v4.0/
│   └── v4.1/
├── current → versions/v4.1   # Symlink para versão ativa
└── version.json             # Metadados {current, installed, dates}
```

### Regras de Versionamento

- Cada release do GitHub vira uma pasta em `versions/`
- `current` é um symlink para a versão ativa
- Máximo de 3 versões instaladas simultaneamente
- Cleanup automático: remove a mais antiga ao instalar nova (se > 3)
- Rollback: aponta `current` para versão anterior

### Funcionamento

```bash
# scrcpy usa ADB transparentemente:
scrcpy --tcpip=192.168.254.232:5555 --no-audio --max-size=1024

# O painel executará como subprocess:
# 1. Verifica conexão ADB com o device
# 2. Executa scrcpy com parâmetros configuráveis
# 3. Captura stdout/stderr
# 4. Opcional: gravação de sessão
```

### Endpoints

```
GET  /api/scrcpy/status         → versão atual, disponível, installed
POST /api/scrcpy/check          → verifica GitHub releases
POST /api/scrcpy/install        → download + extrai + ativa versão
POST /api/scrcpy/rollback       → volta pra versão anterior
GET  /api/scrcpy/versions       → lista versões instaladas
POST /api/scrcpy/start/{device} → inicia scrcpy para um device
POST /api/scrcpy/stop           → para instância em execução
```

### Planos de fallback

- Se `scrcpy` novo falhar ao iniciar (exit code ≠ 0, timeout), auto-rollback
- Mantém versão `previous` como symlink para fallback rápido
- Log de cada tentativa de mirroring para auditoria
