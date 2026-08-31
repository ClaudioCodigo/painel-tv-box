---
status: resolved
trigger: "Launcher fecha no início do daemon ADB e mostra '* daemon not running' como erro antes de executar as tentativas."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: stderr nativo interrompe launcher PowerShell

## Symptoms

- expected: Mensagens do daemon ADB são capturadas e o loop tenta conectar até oito vezes.
- actual: A primeira linha escrita em stderr entra no catch e encerra o launcher.
- errors: Caixa mostra `* daemon not running; starting now at tcp:5037`.
- timeline: Após adicionar retry em `c628491`.
- reproduction: Start com daemon ADB local parado.

## Current Focus

- hypothesis: Confirmada — stderr redirecionado do ADB virou ErrorRecord terminante no Windows PowerShell 5.1.
- test: Continue apenas ao executar ADB/scrcpy; Stop restaurado para validações e exceções próprias.
- expecting: Confirmado pela inspeção automatizada da ordem no launcher gerado.
- next_action: Publicar e reinstalar o cliente para substituir o launcher local.

## Evidence

- timestamp: 2026-08-31
  observation: A caixa exibe a primeira mensagem informativa do stderr do ADB, não o erro final das oito tentativas.
- timestamp: 2026-08-31
  observation: Documentação PowerShell confirma que `2>&1` redireciona o Error stream e que ErrorActionPreference Stop pode levá-lo ao catch; comportamento de nativos foi separado apenas em versões modernas.

## Eliminated

- hypothesis: O loop executou oito vezes e todas falharam.
  reason: A mensagem final programada não aparece; o catch recebe diretamente a primeira linha do daemon.

## Resolution

- root_cause: `2>&1` converteu mensagens informativas do daemon ADB em ErrorRecord enquanto ErrorActionPreference estava em Stop, desviando imediatamente ao catch.
- fix: Isolar comandos nativos com ErrorActionPreference Continue, validar por LASTEXITCODE/get-state e restaurar Stop antes de erros do launcher.
- verification: 12 testes focados e 192 testes completos passaram; documentação oficial do PowerShell confirmou a semântica dos streams.
- files_changed: `app/api/client_bundle.py`, `tests/test_client_bundle.py`
