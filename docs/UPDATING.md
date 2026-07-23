# Como Atualizar o Painel

## Pela Interface (Settings)

1. Acesse **Configurações** na sidebar
2. Na seção **Atualização**, clique em **🔍 Verificar**
3. Se houver atualização, clique em **🔄 Aplicar**

## Pela API

```bash
# Verificar
curl -X POST http://localhost:8080/api/update/check

# Aplicar
curl -X POST http://localhost:8080/api/update/apply
```

## Pelo Terminal

```bash
cd /opt/panel
sudo -u panel git pull
sudo -u panel /opt/panel/venv/bin/pip install -r requirements.txt
sudo systemctl restart panel.service
```

## O que acontece durante o update

1. `git stash` (protege mudanças locais)
2. `git pull origin main`
3. Recarrega configuração (migração automática de YAML)
4. Reinicia o serviço do painel

## Observações

- Se o MediaMTX precisar ser reiniciado, o painel avisa
- Durante o update, o painel fica offline por alguns segundos
- Backup automático é recomendado antes de atualizar
- Se houver conflitos no git pull, o update falha e o git stash preserva as mudanças
