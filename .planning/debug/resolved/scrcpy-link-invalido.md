---
status: resolved
trigger: "Cliente scrcpy instalado exibe 'Link de abertura invalido' e o README/pacote de instalação está desatualizado."
created: 2026-08-31
updated: 2026-08-31
---

# Debug: link scrcpy inválido e instalação trabalhosa

## Symptoms

- expected: O botão Start abre o cliente instalado e o instalador busca o pacote atual diretamente do painel.
- actual: O handler mostra `Link de abertura invalido`; o operador ainda precisa baixar e extrair um ZIP manualmente.
- errors: Caixa do PowerShell `Painel TV Box - scrcpy: Link de abertura invalido.`
- timeline: Após instalar o cliente introduzido em `5ecd9a5`.
- reproduction: Instalar o cliente, selecionar um box e pressionar Start no navegador.

## Current Focus

- hypothesis: Confirmada — a regex aceitava somente a URI sem `/` antes da query.
- test: Launcher gerado aceita as duas formas e instalador baixa o pacote com token próprio.
- expecting: Confirmado pelos testes focados e inspeção do launcher gerado.
- next_action: Publicar e reinstalar o cliente uma vez nas estações que possuem o launcher antigo.

## Evidence

- timestamp: 2026-08-31
  observation: Screenshot mostra o handler instalado sendo executado e rejeitando a URI antes de contatar o painel.

## Eliminated


## Resolution

- root_cause: Regex excessivamente estrita rejeitava a normalização `paineltvbox://scrcpy/?ticket=...` feita pelo navegador.
- fix: Aceitar barra opcional; trocar o download manual do ZIP por `.cmd` bootstrap que baixa e instala o pacote atual com token descartável; atualizar README.
- verification: 24 testes focados, 192 testes completos e todos os `node --check` passaram.
- files_changed: `app/api/client_bundle.py`, `app/core/auth.py`, `app/managers/adb_enrollment.py`, `static/js/scrcpy.js`, testes.
