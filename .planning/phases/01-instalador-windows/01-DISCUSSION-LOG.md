# Phase 1: Instalador Windows - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-06
**Phase:** 1-Instalador Windows
**Areas discussed:** Experiência de instalação, Atualização/reexecução, Configuração inicial do painel, Firewall e segurança

---

## Experiência de instalação

| Option | Description | Selected |
|--------|-------------|----------|
| Totalmente automático | Duplo clique roda a instalação inteira sem perguntas; flags para controle | ✓ |
| 1 prompt inicial | Pergunta as opções-chave antes de rodar | |
| Passo a passo interativo | Cada etapa pergunta antes de prosseguir | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, abrir painel | Abre http://localhost:8080 no navegador padrão ao final | ✓ |
| Só mostrar a URL | Imprime a URL no resumo final | |

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, mostrar token | Imprime o token no resumo | |
| Não mostrar | Cliente pega o token do arquivo manualmente | |
| **Free-text** | "Não tem mais token, fiz algumas alterações a partir de agora é feito com login e senha de administrador do paniel, o token fica vinculado a maquina/navegador e o acesso é feito via usuario e senha" | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Wizard cria na 1ª vez | 1ª execução abre o wizard que cria admin + senha | ✓ |
| Install pergunta e configura | Install pergunta usuário/senha antes de rodar | |
| Install gera senha aleatória | Gera senha e mostra no resumo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Logs por etapa | Janela do PowerShell com progresso por etapa | ✓ |
| Só resumo final | Instalador silencioso | |

**User's choice:** Instalação totalmente automática, abre o painel ao final, sem token (migração para login/senha), admin criado no wizard na 1ª vez, logs por etapa.
**Notes:** Mudança de requisito importante: autenticação deixa de ser por token compartilhado e passa a ser por usuário/senha de administrador; token vira vínculo de sessão máquina/navegador. O repo ainda está token-based — implementação do login/senha é novo requisito assumido como pré-requisito da Fase 1.

---

## Atualização / reexecução

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotente + preserva configs | Reexecutar preserva config/ e devices/; só sincroniza serviços/binários | ✓ |
| Recria do zero | Reexecutar destrói configs locais | |

| Option | Description | Selected |
|--------|-------------|----------|
| Update fica no painel | UpdateManager (git pull) dentro do painel; install.ps1 não faz git pull | ✓ |
| Install também atualiza | Reexecutar também faz git pull | |

| Option | Description | Selected |
|--------|-------------|----------|
| Não duplica serviço | Detecta serviço NSSM existente e reinicia/atualiza se necessário | ✓ |
| Recria serviços sempre | Para, remove e recria os serviços do zero | |

**User's choice:** Install idempotente preservando configs; update de código fica no painel; reexecução não duplica serviços NSSM.

---

## Configuração inicial do painel

| Option | Description | Selected |
|--------|-------------|----------|
| Só se não configurado | adb.binary setado apenas se o usuário não tiver configurado manualmente | ✓ |
| Sempre sobrescreve | Sempre seta adb.binary para C:\PanelTVBox\platform-tools\adb.exe | |

| Option | Description | Selected |
|--------|-------------|----------|
| Serviço lê a config gerada | mediamtx aponta para config/mediamtx.generated.yml via PANEL_MEDIAMTX_CONFIG | ✓ |
| Copia para data dir | Copia config gerada para o data dir (espelha install.sh) | |

| Option | Description | Selected |
|--------|-------------|----------|
| Install só aponta | Install aponta o serviço para a config gerada | ✓ |
| Install garante reload | Install garante recarga após mudanças de config | |

**User's choice:** adb.binary só se não configurado manualmente; serviço MediaMTX lê mediamtx.generated.yml direto (o painel já sincroniza via PANEL_MEDIAMTX_CONFIG); install só aponta o serviço.

---

## Config isolada da máquina (levantada pelo usuário na pergunta final)

| Item | Descrição |
|------|-----------|
| **Preocupação do usuário** | "uma coisa que me deixou nervoso no ultimo teste no painel, configurações especificas do painel tem que ficar na maquina e não pode subir no git push é só isso, a config do paniel tem que ir limpa pro repo" |

**Verificação feita:** `.gitignore` já cobre `config/*.yml`, `devices/*.yml`, `groups/*.yml`, `config/.panel_token`, `config/mediamtx.generated.yml`; `git ls-files` mostra apenas templates `.example` versionados. Diff pendente em `app/utils/system.py` é a simplificação Windows-only do `get_data_dir` (pré-existente).
**User's choice:** Confirmou — configs reais (incluindo credenciais admin) ficam só na máquina, nunca no git; repo vai limpo com templates `.example`; install.ps1 valida que nada de config real está rastreado no `.git` de `C:\PanelTVBox`.

---

## Firewall e segurança

| Option | Description | Selected |
|--------|-------------|----------|
| Todos os perfis ativos | Regras com LocalSubnet em Private/Public | ✓ |
| Só perfil Private | Só no perfil Private, avisa se Public | |
| Escolhe perfil | Pergunta/escolhe perfil na instalação | |

| Option | Description | Selected |
|--------|-------------|----------|
| Avisa e segue | Se firewall desligado, avisa risco mas segue | ✓ |
| Aborta instalação | Aborta se firewall desligado | |

| Option | Description | Selected |
|--------|-------------|----------|
| Bloqueio explícito extra | Regra de bloqueio para 5555 no Public/Domain se -AllowAdb usado | ✓ |
| Só não abrir | Confia no default fechado | |

| Option | Description | Selected |
|--------|-------------|----------|
| Logs no data dir | stdout dos serviços vai para %LOCALAPPDATA%\PanelTVBox\logs via AppStdout/AppStderr | ✓ |
| Rotação NSSM | NSSM AppRotateFiles | |
| Sem logs | stdout descartado | |

**User's choice:** Regras LocalSubnet em todos os perfis ativos; firewall desligado → avisa e segue; bloqueio explícito extra para 5555 quando -AllowAdb; logs dos serviços no data dir.

---

## the agent's Discretion

- Detalhes de implementação do install.ps1 (funções auxiliares, ordem exata dos passos, tratamento de erro por download) — planner/executor decide, respeitando as decisões e espelhando a lógica do install.sh.

## Deferred Ideas

- **Implementação do login/senha de admin** — novo requisito (auth por senha substitui token); assumido como pré-requisito da Fase 1, implementação a planejar.
- **Atualização de código via install.ps1 (`git pull`)** — descartada; update fica no painel.
- **Copiar config do MediaMTX para data dir** — descartada; serviço lê a config gerada direto.
