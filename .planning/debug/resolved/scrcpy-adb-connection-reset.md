---
status: resolved
trigger: "Launcher scrcpy recebe error: protocol fault (couldn't read status): connection reset após iniciar o daemon ADB local."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: ADB connection reset ao abrir scrcpy

## Symptoms

- expected: O cliente conecta ao `IP:5555`, confirma estado `device` e abre o scrcpy.
- actual: A primeira conexão TCP é resetada durante o protocolo ADB.
- errors: `protocol fault (couldn't read status): connection reset`.
- timeline: Após matrícula automática e reinício do `adbd` no primeiro Start.
- reproduction: Executar Start logo após autorizar a estação em um TV Box.

## Current Focus

- hypothesis: Confirmada como falha transitória compatível com o reinício/estado do `adbd`; tentativa única não era resiliente.
- test: O launcher gerado contém oito tentativas de connect + get-state e só prossegue em estado `device`.
- expecting: Confirmado pelos testes do bundle e suíte completa.
- next_action: Publicar e reinstalar o cliente da estação para receber o launcher atualizado.

## Evidence

- timestamp: 2026-08-31
  observation: Daemon ADB local inicia normalmente; o reset vem na conexão ao dispositivo.
- timestamp: 2026-08-31
  observation: Documentação oficial do scrcpy confirma `adb connect IP:PORT` e seleção pelo serial TCP; reconexão explícita é suportada.

## Eliminated

- hypothesis: O executável ADB local não inicia.
  reason: A saída confirma `daemon started successfully` na porta 5037.

## Resolution

- root_cause: O launcher fazia apenas um handshake ADB após o restart do `adbd`; um reset transitório encerrava toda a abertura.
- fix: Loop limitado de oito conexões, espera curta, validação por `adb get-state` e erro final com o último retorno.
- verification: 12 testes focados e 192 testes completos passaram; sintaxe JS validada.
- files_changed: `app/api/client_bundle.py`, `tests/test_client_bundle.py`
