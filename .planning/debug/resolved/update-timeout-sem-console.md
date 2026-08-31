---
status: resolved
trigger: "A tarefa SYSTEM usa timeout.exe /t 5 sem console; o timeout falha imediatamente e o nssm start disputa com o stop, deixando o serviço parado."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: delay do restart falha sem console

## Symptoms

- expected: A tarefa aguarda cerca de 5 segundos entre `nssm stop` e `nssm start`.
- actual: `timeout.exe` falha imediatamente em tarefa agendada sem console e o start ocorre junto com o stop.
- errors: `Input redirection not supported`.
- timeline: Detectado no primeiro uso do restart externo publicado em `1463239`.
- reproduction: Executar o script de restart como tarefa agendada SYSTEM sem sessão interativa.

## Current Focus

- hypothesis: Confirmada — `timeout.exe` depende de console/stdin e não atrasava a tarefa não interativa.
- test: Atraso via `ping.exe -n 6 127.0.0.1`; teste proíbe o retorno de `timeout.exe`.
- expecting: Confirmado no servidor e pela inspeção automatizada do script gerado.
- next_action: Publicar e aplicar esta atualização no servidor.

## Evidence

- timestamp: 2026-08-31
  observation: A mensagem `Input redirection not supported` foi observada na tarefa sem console; o teste manual com ping funcionou.

## Eliminated


## Resolution

- root_cause: `timeout.exe` falha sem console com `Input redirection not supported`, eliminando a espera entre stop e start.
- fix: Substituído por seis pings ao loopback, equivalentes a aproximadamente cinco segundos de atraso independente de console.
- verification: 8 testes focados e 192 testes completos passaram; mecanismo validado no servidor.
- files_changed: `app/managers/update.py`, `tests/test_update_manager.py`
