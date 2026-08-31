---
status: resolved
trigger: "Update aplicado corretamente, mas o painel não volta porque nssm restart panel-tvbox é executado como filho do próprio serviço."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: update NSSM não reinicia o painel

## Symptoms

- expected: Após aplicar um update, o serviço `panel-tvbox` deve reiniciar e voltar a responder HTTP automaticamente.
- actual: O NSSM para o painel, mata a árvore que contém o comando de restart e a fase de start não ocorre.
- errors: Serviço termina com exit 0 e permanece parado; o código atualizado importa e inicia normalmente quando acionado manualmente.
- timeline: Reproduzido após atualizar o servidor para `6e50c99`.
- reproduction: Aplicar atualização pela API/tela enquanto o painel roda como serviço NSSM.

## Current Focus

- hypothesis: Confirmada — o processo `nssm restart` era encerrado junto com a árvore do serviço.
- test: Tarefa agendada `SYSTEM` com script externo e testes de criação, disparo e falha.
- expecting: Confirmado por teste real no servidor e por testes automatizados do comando gerado.
- next_action: Publicar o fix e validar o próximo update pela interface no servidor.

## Evidence

- timestamp: 2026-08-31
  observation: O servidor voltou com `sc start panel-tvbox`, health 200 e repositório íntegro em `6e50c99`.
- timestamp: 2026-08-31
  observation: Teste real com `schtasks /ru SYSTEM` executando stop, espera e start devolveu RUNNING e HTTP 200.

## Eliminated

- hypothesis: O update corrompeu o código do painel.
  reason: `import app.main`, inicialização manual e health HTTP passaram.

## Resolution

- root_cause: `nssm restart` era filho do painel; o stop encerrava o pai e sua árvore antes da fase de start.
- fix: Criar e disparar uma tarefa `schtasks` como SYSTEM que executa stop, espera 5 segundos e start fora da árvore do serviço, com autolimpeza.
- verification: 8 testes focados e 190 testes completos passaram; mecanismo equivalente já validado no servidor com RUNNING e HTTP 200.
- files_changed: `app/managers/update.py`, `tests/test_update_manager.py`
