---
status: resolved
trigger: "Atualização falha com conflito de merge em app/managers/update.py quando o servidor possui alteração ou commit local."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: conflito de git pull no atualizador

## Symptoms

- expected: O servidor sincroniza de forma previsível com a versão publicada em `origin/main`.
- actual: `git pull` tenta mesclar código local divergente e remoto, gerando conflito.
- errors: `CONFLICT (content): Merge conflict in app/managers/update.py`.
- timeline: Após correções emergenciais feitas diretamente no servidor.
- reproduction: Ter commit local divergente e aplicar atualização pela interface.

## Current Focus

- hypothesis: Confirmada — `git stash` não altera commits locais e o pull tentava mesclar históricos divergentes.
- test: Fluxo sem pull, usando fetch + reset para origin/main e rollback pelo SHA capturado.
- expecting: Confirmado pelos testes; nenhum caminho de apply executa `git pull`.
- next_action: Publicar e sincronizar o servidor uma última vez manualmente.

## Evidence

- timestamp: 2026-08-31
  observation: Saída do servidor mostra conflito durante `git pull origin main`; arquivo afetado tinha correção local emergencial.

## Eliminated


## Resolution

- root_cause: O servidor possuía código/commit local divergente; `git pull` iniciou merge e encontrou conflito em `update.py`.
- fix: Atualização determinística com stash de arquivos locais, fetch e reset para origin/main; rollback usa o SHA anterior exato.
- verification: 8 testes focados e 192 testes completos passaram; testes proíbem `pull` no apply.
- files_changed: `app/managers/update.py`, `tests/test_update_manager.py`
