# Como Fazer Backup e Restore

## Pela Interface

1. Acesse **Backup** na sidebar
2. Clique em **⬇ Exportar Backup** para baixar ZIP
3. Para restaurar: **📤 Importar ZIP**

## Pela API

### Exportar

```bash
curl -X POST http://localhost:8080/api/backup/export -o backup-painel.zip
```

### Listar Backups

```bash
curl http://localhost:8080/api/backup/list
```

### Importar

```bash
curl -X POST http://localhost:8080/api/backup/import \
  -F "file=@backup-painel.zip"
```

### Restaurar (por nome)

```bash
curl -X POST http://localhost:8080/api/backup/restore/backup-2026-07-22T09-28-13.zip
```

## Estrutura do Backup

```
backup-2026-07-22T09-28-13.zip
├── config/
│   ├── system.yml
│   ├── watchdog.yml
│   ├── players.yml
│   └── mediamtx.yml
├── devices/
│   ├── tvbox-armazem-1b.yml
│   └── ...
├── groups/
│   └── ...
└── backup_manifest.json
```

## Dicas

- O painel cria **backup automático** antes de cada importação
- Backups são salvos em `backups/`
- Use `POST /api/backup/cleanup?keep_last=10` para limpar antigos
- O backup contém apenas configuração (YAML), não logs ou screenshots
