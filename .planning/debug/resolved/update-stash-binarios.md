---
status: resolved
trigger: "Update falha ao preservar alterações porque git stash -u tenta remover executáveis de bin/ que estão em uso."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: stash tenta capturar binários em uso

## Symptoms

- expected: O updater preserva alterações de código e ignora runtimes instalados.
- actual: `git stash -u` inclui `bin/` e tenta remover executáveis em uso.
- errors: `failed to remove bin/mediamtx/mediamtx.exe`, `bin/nssm.exe`, `adb.exe` e DLLs.
- timeline: Primeiro update após a sincronização sem merge de `e3eaf6c`.
- reproduction: Atualizar instalação Windows com ferramentas baixadas em `C:\PanelTVBox\bin`.

## Current Focus

- hypothesis: Confirmada — `-u` incluiu o runtime não rastreado e tentou removê-lo durante o stash.
- test: Stash sem `-u`; teste proíbe essa opção e `bin/` foi incluído no gitignore.
- expecting: Confirmado pelos testes focados e suíte completa.
- next_action: Publicar e sincronizar o servidor uma vez manualmente.

## Evidence

- timestamp: 2026-08-31
  observation: Stash informa que salvou o estado, mas termina com falha ao remover quatro binários em uso.
- timestamp: 2026-08-31
  observation: `.gitignore` atual ignora scrcpy e dados, mas não contém `bin/`.

## Eliminated

- hypothesis: O Git não conseguiu criar o stash.
  reason: A saída começa com `Saved working directory and index state`; a falha ocorreu na limpeza de arquivos não rastreados.

## Resolution

- root_cause: `git stash push -u` capturava ferramentas de runtime não rastreadas e falhava ao limpar executáveis bloqueados pelos serviços Windows.
- fix: Preservar apenas arquivos versionados no stash e declarar `bin/` como runtime ignorado.
- verification: 8 testes focados e 192 testes completos passaram; regressão verifica ausência de `-u`.
- files_changed: `.gitignore`, `app/managers/update.py`, `tests/test_update_manager.py`
