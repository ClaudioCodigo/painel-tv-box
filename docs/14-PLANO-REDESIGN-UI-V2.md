# Plano de Redesign — Painel TV Box v2 · “Sala de Controle”

**Documento:** `docs/14-PLANO-REDESIGN-UI-V2.md`
**Data:** 2026-08 (revisão de UI sobre o estado atual do `main`, commit `e7ab637`)
**Status:** Proposta para revisão — acompanhada do mock piloto navegável
**Mock piloto:** [`docs/redesign-mock/sala-de-controle.html`](redesign-mock/sala-de-controle.html) (abrir direto no navegador; `#dark:sala`, `#light:mural`, `#dark:sessao`)
**Escopo:** camada de apresentação (`static/`, `templates/`). Sem mudança de contrato de API, WebSocket ou domínio.
**Relação com documentos existentes:** estende o [`06-UI-REDESIGN-SPEC.md`](06-UI-REDESIGN-SPEC.md) (linguagem monocromática, tokens, acessibilidade) e implementa na UI o que o [`13-IDEIAS-E-ROADMAP-KIOSK-MONITORING.md`](13-IDEIAS-E-ROADMAP-KIOSK-MONITORING.md) definiu como produto.

---

## 0. A decisão central

> **O painel hoje é um formulário de configuração que mostra status.
> Ele precisa ser um console de operação que esconde a configuração.**

Nada de novo em funcionalidade: o backend já entrega heartbeat, watchdog com cascata de recuperação, screenshot, scrcpy 1-clique e métricas via WebSocket. O que falta é a **interface responder à pergunta que o operador faz 50 vezes por dia**:

1. *“Está tudo no ar?”* → hoje: 4 cards de CPU/RAM/disco no topo e 12 cards iguais em ordem alfabética.
2. *“O que quebrou e desde quando?”* → hoje: preciso varrer 12 cards lendo pastilhas cinza-claro sobre cinza-escuro.
3. *“Resolve para mim.”* → hoje: 11 ações dentro de um dropdown `⋯` por card, sem ação em lote.

O redesign inverte a hierarquia: **saúde da frota primeiro, exceção no topo, ação a um clique, configuração para o segundo plano.**

---

## 1. Diagnóstico (ancorado no código)

| # | Problema | Evidência no código | Consequência operacional |
|---|---|---|---|
| 1 | **Métrica de host no lugar de saúde da frota** | `dashboard.js` renderiza `stat-grid` de CPU/RAM/disco/uptime (`loadSystemMetrics`) antes da lista de TV Boxes | O operador rola a tela para ver o que importa; CPU do servidor não é o trabalho dele |
| 2 | **Status sem força visual** | `pages/dashboard.css` L77-80: `.dcard-status.success/warning/danger` = `text-primary`/`text-secondary`/`text-muted` | “No ar”, “atenção” e “fora” ficam quase iguais em B&W; a exceção não salta |
| 3 | **11 ações por card em dropdown** | `dashboard.js` `buildCard()` → `menu-${d.id}` com reboot, excluir, renomear, mover grupo… | Ações raras competem com as frequentes; nada é descobrível sem abrir cada menu |
| 4 | **Sem ação em lote** | Não existe seleção múltipla no `card-grid` | Recarregar 5 TVs de uma área = 5 fluxos completos (roadmap §Feature 5 pede isso) |
| 5 | **Prova visual pequena** | `dcard-thumb-wrap` com `height:100px` no meio do card, abaixo do header e da barra de status | A miniatura — que é a única prova de *o que está na tela* — é o menor elemento |
| 6 | **Duas telas fazem a mesma coisa** | `dashboard.js:217` e `devices.js:164` têm o mesmo botão “Scrcpy”; ambos renderizam grade de cards | Usuário não sabe onde “é o lugar” de gerenciar TV Boxes |
| 7 | **Navegação com níveis misturados** | `base.html`: 9 itens planos — TV Boxes, Acesso Remoto, Grupos *(operação)* junto de Shell, Logs, Backup, Configurações, Wizard *(sistema)* | Custo de navegação alto; itens de uso diário e de uso anual com o mesmo peso |
| 8 | **MediaMTX/streaming ainda na UI** | Item de nav próprio, `scrcpy.js` com “Streaming Server (sem tela)” e “Tela ao vivo (no navegador)”, badge “⚠️ BETA” no título | A UI contradiz o produto atual (Kiosk/MDM por decisão do `docs/13`); o operador procura o que não existe mais |
| 9 | **Eventos escondidos no rodapé** | `dashboard.js` renderiza `event-list` **depois** da grade | Recuperação do watchdog — o diferencial do produto — fica abaixo da dobra |
| 10 | **Sem teclado e sem palette** | Nenhum handler global de teclado (só `device.js`/`shell.js` em inputs locais) | Operador que repete as mesmas 4 ações usa mouse 100% do tempo |
| 11 | **Risco não proporcional** | Excluir pede modal; reboot é clique direto em item de menu | Erro irreversível fácil, ação reversível difícil |
| 12 | **Dado “velho” não se denuncia** | `freshness(d)` existe por card; não há indicador global de atraso do WS | Operador confia em tela congelada |

---

## 2. Princípios de design v2

Herdados do `docs/06` (monocromático, contraste como hierarquia, forma+rótulo para estado, movimento com propósito):

1. **Exceção é barulhenta; normal é silencioso.** No sistema monocromático o recurso mais forte é a inversão (fundo branco/preto). Ela é **reservada para o que está errado**. “No ar” é discreto; “fora” é invertido, com borda de acento e tempo decorrido. *(Hoje é o contrário: “online” chama atenção.)*
2. **A pergunta primária manda no layout.** Home = saúde da frota. CPU/RAM/disco viram um bloco compacto de “Servidor” na coluna lateral.
3. **Ordem = prioridade, não alfabeto.** Default “Atenção primeiro” (`bad → warn → new → ok`), com opção explícita de A-Z.
4. **Uma linha, um TV Box.** A lista densa (tabela) escala para 40 caixas; o card de 320px não. A miniatura continua, em 16:9 compacto, como primeira evidência.
5. **Uma ação primária por contexto.** Na lista: *abrir tela*. No detalhe expandido: as secundárias. As destrutivas exigem confirmação proporcional.
6. **Densidade com ritmo.** Linha base de 64 px, 4 px de grade, tipografia em 4 degraus (11/12/13.5/27). Nada abaixo de 11 px.
7. **Tudo que é ao vivo se parece com ao vivo.** Ponto pulsante + “atualizado há N s” + flash de 1s na linha que mudou (respeitando `prefers-reduced-motion`).
8. **Representação dupla de estado.** Forma (● ◐ ✕ ○) + rótulo em maiúsculas + tempo. Nunca só cor — a regra do `docs/06` §2.3 passa a ser executada de fato.

---

## 3. Nova arquitetura de informação

**Antes (9 itens planos):** Dashboard · TV Boxes · Acesso Remoto · Grupos · Shell · Logs · Backup · Configurações · Wizard

**Depois (3 grupos, 8 destinos):**

```
OPERAÇÃO      Sala de Controle     saúde + ações da frota (home)
              Mural (NOC)          grade de telas ao vivo, 3–5 s
              Telas & Sessões      sessões scrcpy abertas, mosaico 2×2
              Áreas                grupos: ações em lote, URL padrão

CONTEÚDO      Páginas & URLs       catálogo de páginas kiosk + atribuição
              Agendamentos         reboot noturno, horários de exibição

SISTEMA       Logs & Auditoria     eventos, watchdog, quem fez o quê
              Backup · Configurações (+ Shell e Wizard como sub-abas)
```

Ganhos: “TV Boxes” e “Dashboard” deixam de ser duas telas para a mesma coisa (o inventário virou a aba *Áreas* + filtros dentro da Sala de Controle); “Acesso Remoto” deixa de ser um destino separado e vira **ação** (na linha) e **tela** (Telas & Sessões); MediaMTX sai da navegação principal (segue acessível em Sistema até ser descontinuado — `docs/13` §1).

---

## 4. Telas

### 4.1 Sala de Controle (home) — *o piloto implementado no mock*

Ordem vertical, de cima para baixo:

1. **Faixa de incidente** (só quando existe exceção): “4 de 12 precisam de atenção — 2 fora do ar, 2 degradadas”, com nomes, tempo e o motivo principal. Ações: *Ver fila de atenção* / *silenciar 1 h*.
2. **KPIs de frota** (4): No ar `7/12` (com sparkline de 24 h) · Atenção · Fora · Sessões scrcpy. Baixa altura, número grande, `tabular-nums`.
3. **Lista de TV Boxes** (corpo): miniatura 16:9 · nome + área · IP/URL/app/watchdog · **pastilha de estado com tempo** · ações (`abrir`, `↻ kiosk`, `⋯`). Linha expandida mostra: identificação, watchdog 24 h, **cascata de recuperação** (player → Wi-Fi → reboot → alerta), últimos eventos e as ações secundárias.
4. **Coluna lateral** (316 px): *Atividade* (feed de heartbeat/recovery/alerta vindo do WS) e *Servidor* (CPU/RAM/disco + serviços, compacto).
5. **Rodapé**: legenda de atalhos + contagem/estado global.

### 4.2 Mural (NOC)

Grade 3×N de telas com `aspect-ratio:16/9`, cabeçalho por tile (nome + estado + idade), borda dupla + “SEM SINAL” para caixas fora. Controles: filtro por área, **Abrir mosaico scrcpy 2×2**, *Tela cheia (parede)*. Duplo-clique no tile abre a sessão. *(Implementa `docs/13` Feature 1 — mural web.)*

### 4.3 Telas & Sessões / Detalhe do TV Box

Split: tela grande à esquerda (16:9) com barra de controles (tela cheia, teclado, capturar, recarregar kiosk, encerrar) e, à direita, abas *Visão geral / Histórico / Mini controle*. A aba **Mini controle** traz o D-pad + injeção de texto (`input text`) — `docs/13` Feature 3 — para o caso “só preciso dar um OK” sem abrir o scrcpy.

### 4.4 Áreas

Cartões por grupo com: contagem por estado, ações em lote (recarregar kiosk, definir URL, reboot), e “última mudança”. É onde a Feature 5 do roadmap vive.

### 4.5 Conteúdo e Sistema

- **Páginas & URLs**: catálogo (nome, URL, quem usa, última alteração) + atribuição em lote por área.
- **Conteúdo/Agendamentos**: janelas de reboot noturno e horários de exibição (Feature 4).
- **Logs & Auditoria**: o feed de eventos promovido a tela, com filtro por caixa/tipo e exportação (já existe `downloadLog`).
- **Sistema**: host, serviços, versões, backup, shell, wizard e atualização — agrupados em sub-abas (hoje espalhados em 4 itens de menu).

---

## 5. Design system v2 (delta sobre `docs/06`)

**Tokens novos** (aditivos, sem quebrar os atuais):

| Token | Papel |
|---|---|
| `--state-ok-fg/bd` | estado normal — **discreto** (texto muted + borda fraca) |
| `--state-warn-fg/bd/bg` | degradado — borda forte + fundo elevado |
| `--state-bad-fg/bd/bg` | fora — **invertido** (fundo = `--text-primary`) |
| `--state-unknown-bd` | tracejado (nunca visto) |
| `--row-h` | altura base da linha (64 px) |
| `--row-accent` | largura do acento lateral (3 px) |

**Tipografia** (4 degraus, piso 11 px): `27/700` KPI · `13.5/650` nome · `12/400` corpo · `11/700 uppercase` rótulos e pastilhas. Números sempre com `font-variant-numeric: tabular-nums` (KPIs e tempos não “dançam”).

**Componentes novos:** `state-pill` (forma+rótulo+idade), `data-row`/`row-detail`, `kpi-tile` + `spark`, `incident-banner`, `bulk-bar`, `tile` (mural), `screen-panel` (sessão), `command-palette`, `feed`, `meter`.

**Componentes que saem de cena:** `.card.device-card` como unidade de frota (vira linha), `stat-card` de host no topo, `dropdown-menu` de 11 itens (vira `⋯` com 4 itens + detalhe), `.live-badge`, `.badge-warning` do título “BETA”.

---

## 6. Interação

**Teclado (global):** `/` busca · `j`/`k` navega linhas · `Enter` abre tela · `r` recarrega kiosk · `R` reinicia (com confirmação) · `x` seleciona · `Esc` fecha detalhe · `Ctrl/⌘+K` command palette (ir para TV, abrir mural, recarregar área).

**Confirmação proporcional ao risco:**

| Ação | Custo |
|---|---|
| Abrir tela, recarregar kiosk, capturar, mini controle | 1 clique, com toast |
| Reiniciar 1 caixa | confirmação inline na linha (não modal) |
| Reiniciar área / todas | modal com contagem + digitar o nome da área |
| Excluir TV Box | modal + digitar o nome |

**Feedback:** toast com ação *desfazer* onde for possível (mudança de URL, renomear); flash de 1 s na linha alterada por WS; ponto “ao vivo” + “atualizado há N s” sempre visível; se o WS cair, o indicador passa a “reconectando” e os dados ficam visualmente marcados como antigos.

**Estados de tela:** vazio (com ação primária), carregando (skeleton na forma final), erro (com *tentar de novo*), sem permissão, filtro sem resultado, frota vazia (aponta o Wizard).

---

## 7. Acessibilidade e temas

- Contraste AA nos dois temas para todos os pares texto/fundo (a inversão do estado “fora” foi escolhida justamente por isso: preto sobre branco = 21:1).
- Foco visível com `:focus-visible` em todos os controles; a lista é navegável por teclado com `aria-selected` e `aria-live` na faixa de incidente.
- Nada de informação só por cor (forma + rótulo + tempo).
- `prefers-reduced-motion`: sem pulso, sem flash, sem transição de linha.
- Alvos de clique ≥ 28 px; miniaturas com `alt` textual derivado do nome/estado.

---

## 8. Como implementar sem quebrar as regras do projeto

| Regra | Como o redesign respeita |
|---|---|
| JS puro, sem framework, sem build | Tudo continua em módulos IIFE `render(el)`; o mock é HTML/CSS/JS vanilla justamente para provar isso |
| Sem CDN | Ícones inline (`UI.icon`) e caracteres de forma; nenhuma fonte ou lib externa |
| `node --check` + pytest (212) verdes | Mudanças são de apresentação; nenhum endpoint tocado; cada página migra isolada |
| Cache-bust | Bump global de `?v=` em `templates/base.html` (padrão do repo: CSS e JS em blocos) |
| Monocromático | Tokens existentes preservados; apenas semânticos de estado adicionados |
| Documentos históricos | `docs/06` e `docs/13` não são reescritos — este documento é o delta |

**Ordem de migração (uma página por vez, sempre com o app funcionando):**

1. `tokens.css` (semânticos de estado) + `components.css` (state-pill, kpi-tile, data-row) — *nada muda visualmente ainda*.
2. Sala de Controle: `dashboard.js` + `pages/dashboard.css` (lista, KPIs, incidente, feed lateral).
3. Mural: nova página `mural.js` reaproveitando `/devices/{id}/screenshot` (o backend já serve).
4. Telas & Sessões: reaproveita `scrcpy.js` (mosaico 2×2 exige backend: `--window-x/y/width/height` — hoje só o mock cobre).
5. Áreas + ações em lote (exige endpoints em lote no backend).
6. Conteúdo/Sistema: reorganizar nav de `base.html`, arquivar MediaMTX da navegação.

---

## 9. Fases, entregáveis e critérios de aceite

| Fase | Entrega | Aceite |
|---|---|---|
| **F0** | Tokens de estado + componentes base | Testes verdes; nenhuma mudança visual perceptível |
| **F1** | Sala de Controle (home) | 12+ caixas sem rolagem horizontal em 1366×768; exceção acima dos saudáveis; 3 cliques do login até “abrir tela” de uma caixa fora do ar |
| **F2** | Mural + Telas & Sessões | Mural atualiza a 3–5 s sem travar a SPA; duplo-clique abre sessão |
| **F3** | Áreas + lote + agendamentos | Recarregar 5 caixas em 1 ação; reboot noturno configurável |
| **F4** | Command palette + atalhos + auditoria | Ações principais 100% por teclado; log de quem fez o quê |
| **F5** | Limpeza: nav v2, saída do MediaMTX da UI, remoção do “BETA” | Nenhum item de menu sem uso; `docs/` atualizado |

Esforço estimado (1 dev, meio período/dia): **F1 ≈ 2–3 dias**, F2 ≈ 2 dias, F3 ≈ 2 dias (depende de backend em lote), F4 ≈ 2 dias, F5 ≈ 1 dia.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Mural com 40 caixas sobrecarrega o servidor (40 `screencap` a cada 3 s) | Limitar concorrência (4–6 em paralelo), cache por caixa, atualizar só o que está visível (`IntersectionObserver`), FPS adaptativo |
| Perder densidade de informação ao simplificar | O detalhe expandido mantém tudo o que o card mostra hoje; nada é removido, só reordenado |
| Migração quebrar o app em produção | Página por página atrás do mesmo shell, com bump de cache; rollback = reverter 1 arquivo |
| Usuário acostumado com o card atual | Manter o modo *Cards* como alternância na Sala de Controle (o mock já tem `Lista | Mural`; basta acrescentar `Cards`) |
| Monocromático com muitos estados | Forma + rótulo + tempo + acento lateral; teste de “olhar de 3 segundos” com 12 linhas |

---

## 11. O que o mock **não** cobre

- Dados fictícios (12 TV Boxes, nomes de áreas plausíveis) — nenhuma chamada real à API.
- Sem WebSocket: o “ao vivo” é simulado pelo contador e pelo botão *simular evento*.
- Mosaico 2×2 e mini controle são **só interface**: o backend hoje não posiciona janelas nem injeta `input text` (está no `docs/13` Features 1B e 3).
- Responsivo verificado apenas em 1440 px e num breakpoint de 1180 px; mobile não é alvo do operador.
- Sem testes automatizados do mock (é artefato de design, não código de produção).

---

## 12. Anexo — como abrir o mock

```
docs/redesign-mock/sala-de-controle.html     ← abrir no navegador (duplo-clique; é autocontido)
```

- `1` Sala de Controle · `2` Mural · `3` Sessão (ou clique no menu lateral)
- `#dark:sala` / `#light:sala` — deep-link de tema + tela
- Botão **◐ tema claro/escuro** no topo
- **▶ simular evento** dispara um heartbeat falso (flash na linha + entrada no feed)
- Evidências: `evidencias-redesign/*.png` (pasta ignorada pelo git)
