# Como Criar e Usar Grupos

## O que são

Grupos organizam TV Boxes para ações em lote. Um dispositivo pode pertencer a apenas um grupo.

## Criar um Grupo

### Pela API

```bash
curl -X POST http://localhost:8080/api/groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Armazéns",
    "description": "TV Boxes dos armazéns do Píer"
  }'
```

### Pela Interface

1. Acesse **Grupos** na sidebar
2. Clique em **+ Novo Grupo**
3. Preencha nome e descrição
4. Clique em Confirmar

## Adicionar Dispositivos ao Grupo

Atualize o dispositivo:

```bash
curl -X PUT http://localhost:8080/api/devices/tv-box-armazem-1b \
  -H "Content-Type: application/json" \
  -d '{"group": "armazens"}'
```

Ou edite o YAML do dispositivo:

```yaml
# devices/tvbox-armazem-1b.yml
group: "armazens"
```

## Ações Coletivas

```bash
# Iniciar stream em todos do grupo
curl -X POST http://localhost:8080/api/groups/armazens/start-stream

# Parar stream em todos
curl -X POST http://localhost:8080/api/groups/armazens/stop-stream

# Reiniciar todos
curl -X POST http://localhost:8080/api/groups/armazens/reboot
```

## Schedule por Grupo

```yaml
# groups/armazens.yml
schedule:
  - action: "start_stream"
    cron: "0 8 * * *"    # todo dia às 8h
  - action: "stop_stream"
    cron: "0 22 * * *"   # todo dia às 22h
```

## Pela Interface

Na página de **Grupos**, cada card mostra:
- Nome e descrição
- Quantidade de dispositivos
- Botões: ▶ Start, ⏹ Stop, 🔄 Reboot
- Tags com status de cada dispositivo 🟢🔴
