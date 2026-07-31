# UI Redesign — Spec & Plano de Implementação
## Painel TV Box — Interface monocromática (preto & branco) com tema claro/escuro

> **Data:** 2026-07-31 · **Escopo:** frontend (`static/` + `templates/base.html`) · **Backend:** sem mudanças (contrato da API em `docs/LLM.md` §6) · **Fonte de verdade do frontend atual:** `docs/LLM.md` §8.

---

## 1. Visão geral

Redesenhar a interface do Painel TV Box com uma identidade **monocromática profissional** (preto & branco), tema **claro e escuro** completos e **animações suaves e discretas**. A reforma é visual e estrutural — nenhum endpoint, WebSocket ou comportamento de domínio muda.

O redesign elimina a paleta colorida atual (azul/violeta/verde/âmbar/vermelho) e a substitui por um sistema de design em escala de cinza, onde **hierarquia é expressa por contraste, tipografia, ícones e forma** — não por cor. O status operacional dos TV Boxes continua legível por ícones + rótulos + formas dos indicadores.

### 1.1 Objetivos

- Identidade **preto & branco** consistente, com temas claro e escuro nativos.
- Arquitetura CSS moderna: design tokens, camadas (`layers`), componentes reutilizáveis.
- Animações **profissionais e contidas**: transições de página, micro-interações, skeletons e feedback de ações — todas respeitando `prefers-reduced-motion`.
- Acessibilidade AA: contraste, foco visível, navegação por teclado, `aria-*`.
- **Zero dependência externa obrigatória** (sem CDN, sem build step), mantendo a política atual do projeto. Libs externas **permitidas** se vendored e justificadas (§4.4).
- Zero mudança de comportamento: 70 testes `pytest` + `node --check` continuam passando.

### 1.2 Não-objetivos

- Não migrar para framework JS (React/Vue) nem introduzir build step.
- Não alterar o backend, o contrato da API ou os WebSockets.
- Não refatorar a lógica de domínio (ADB, watchdog, recovery) — apenas a camada de apresentação.

---

## 2. Princípios de design

1. **Monocromático por decisão, não por acidente.** Toda a superfície usa a escala de cinza (§3.1). Cor não é usada para branding nem decoração.
2. **Contraste é a hierarquia.** Elementos importantes têm maior contraste de fundo/texto e maior peso tipográfico; elementos secundários recuam.
3. **Forma comunica estado.** Status operacional usa ícone + rótulo + forma do indicador (preenchido, tracejado, vazio, com X) — nunca cor sozinha.
4. **Movimento com propósito.** Animações guiam atenção e dão feedback; nada se move por movimento. Durações curtas, easing suave, sem "efeitos" gratuitos.
5. **Inversão como acento.** O botão primário e o item de navegação ativo invertem o fundo (branco em tema escuro, preto em tema claro) — o "destaque" máximo disponível em B&W.
6. **Acessibilidade primeiro.** Contraste AA em todo texto, foco visível, `prefers-reduced-motion` respeitado, HTML semântico.

---

## 3. Sistema de design (design tokens)

Todos os valores vivem como **CSS custom properties** em `static/css/tokens.css`. Nada de hexes soltos em folhas de página.

### 3.1 Escala monocromática (neutros)

| Token | Hex | Uso |
|---|---|---|
| `--gray-0` | `#FFFFFF` | Branco puro (tema claro) |
| `--gray-50` | `#FAFAFA` | Fundo claro mais suave |
| `--gray-100` | `#F5F5F5` | Superfícies claras / hover claro |
| `--gray-200` | `#E5E5E5` | Borda sutil / divisores |
| `--gray-300` | `#D4D4D4` | Borda forte / input |
| `--gray-400` | `#A3A3A3` | Placeholder / ícones desabilitados |
| `--gray-500` | `#737373` | Texto secundário (muted) |
| `--gray-600` | `#525252` | Texto secundário (dark) |
| `--gray-700` | `#404040` | Borda forte / hover (dark) |
| `--gray-800` | `#262626` | Superfície elevada (dark) |
| `--gray-900` | `#171717` | Superfície (dark) |
| `--gray-950` | `#0A0A0A` | Fundo base (dark) / texto primário (light) |

### 3.2 Tokens semânticos

As páginas consomem **somente** os tokens semânticos abaixo — nunca a escala bruta.

#### Tema escuro (`data-theme="dark"`, default)

| Token | Valor | Uso |
|---|---|---|
| `--bg-base` | `#0A0A0A` | Fundo da aplicação |
| `--bg-surface` | `#171717` | Cards, sidebar, header |
| `--bg-raised` | `#262626` | Hover, dropdowns, modais |
| `--bg-inset` | `#000000` | Terminais, código, inputs readonly |
| `--bg-overlay` | `rgba(10,10,10,0.72)` | Backdrop de modais |
| `--border-subtle` | `#262626` | Divisores internos |
| `--border-strong` | `#404040` | Bordas de inputs/cards |
| `--text-primary` | `#FAFAFA` | Títulos, valores |
| `--text-secondary` | `#D4D4D4` | Corpo, descrições |
| `--text-muted` | `#737373` | Metadados, placeholders |
| `--text-inverse` | `#0A0A0A` | Texto sobre superfície invertida (botão primário) |
| `--control-hover` | `#262626` | Fundo de hover em controles |
| `--focus-ring` | `#FAFAFA` | Anel de foco (outline) |

#### Tema claro (`data-theme="light"`)

| Token | Valor | Uso |
|---|---|---|
| `--bg-base` | `#FFFFFF` | Fundo da aplicação |
| `--bg-surface` | `#FAFAFA` | Cards, sidebar, header |
| `--bg-raised` | `#FFFFFF` | Hover, dropdowns, modais |
| `--bg-inset` | `#F5F5F5` | Terminais, código, inputs readonly |
| `--bg-overlay` | `rgba(10,10,10,0.42)` | Backdrop de modais |
| `--border-subtle` | `#E5E5E5` | Divisores internos |
| `--border-strong` | `#D4D4D4` | Bordas de inputs/cards |
| `--text-primary` | `#0A0A0A` | Títulos, valores |
| `--text-secondary` | `#404040` | Corpo, descrições |
| `--text-muted` | `#737373` | Metadados, placeholders |
| `--text-inverse` | `#FFFFFF` | Texto sobre superfície invertida (botão primário) |
| `--control-hover` | `#F5F5F5` | Fundo de hover em controles |
| `--focus-ring` | `#0A0A0A` | Anel de foco (outline) |

#### Tokens compartilhados

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | `6px` | Badges, chips, inputs |
| `--radius` | `10px` | Cards, botões, modais |
| `--radius-lg` | `14px` | Superfícies grandes, login |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.06)` | Elevação sutil |
| `--shadow` | `0 4px 16px rgba(0,0,0,0.10)` | Cards em hover / dropdown |
| `--shadow-lg` | `0 16px 48px rgba(0,0,0,0.22)` | Modais |
| `--font-sans` | `'Segoe UI', system-ui, -apple-system, sans-serif` | Interface (mantém stack nativa — sem CDN) |
| `--font-mono` | `'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace` | Terminais, logs, código |
| `--sidebar-w` | `240px` | Largura da sidebar |
| `--sidebar-collapsed-w` | `64px` | Sidebar colapsada |
| `--header-h` | `56px` | Altura do header |
| `--space-1..8` | `4, 8, 12, 16, 24, 32, 48, 64px` | Escala de espaçamento |

#### Tokens de status (monocromáticos)

O status do device é comunicado por **ícone + rótulo + forma do indicador**:

| Status | Indicador (forma) | Ícone | Rótulo |
|---|---|---|---|
| `online` | Círculo sólido preenchido | `check` | Online |
| `degraded` | Anel tracejado (`dashed`) | `pause`/`alert` | Degradado |
| `warning` | Círculo com linha vertical | `alert` | Atenção |
| `offline` | Círculo vazado com X | `x` | Offline |
| `unknown` | Círculo cinza-médio sem ícone | `help` | Desconhecido |

Tokens: `--status-online`, `--status-degraded`, `--status-warning`, `--status-offline`, `--status-unknown` — todos derivados da escala de cinza (preenchimento = `--text-inverse`, fundo = `--text-primary`, etc.). Nenhum token de cor cromática é definido no CSS base.

> **Extensão opcional (fora do escopo default):** um toggle "cores de status" no Settings pode mapear os mesmos tokens para cores (verde/âmbar/vermelho) sem tocar em nenhum outro token. Default: **monocromático**.

### 3.3 Tokens de movimento

| Token | Valor | Uso |
|---|---|---|
| `--dur-instant` | `80ms` | Feedback de clique, hover |
| `--dur-fast` | `150ms` | Micro-interações (hover, toasts) |
| `--dur-base` | `240ms` | Padrão: modais, dropdowns, accordion |
| `--dur-slow` | `400ms` | Transições de página, skeletons |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrada (desacelera suavemente) |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Saída/simétrica |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Elementos "vivos" (badges de status) |

Regra de ouro: **animar apenas `transform` e `opacity`** (nunca `width/height/top/left/margin`), e usar `@media (prefers-reduced-motion: reduce)` para zerar durações e desligar loops.

### 3.4 Ativação do tema

- Atributo `data-theme="dark|light"` no `<html>`, definido por **script inline no `<head>`** (antes do primeiro paint, evitando flash) a partir de:
  1. `localStorage['panel_theme']` (`dark` | `light` | `system`);
  2. senão `prefers-color-scheme` do navegador.
- Troca manual: botão na sidebar/header alterna claro ↔ escuro (ciclo de 2 estados + opção "sistema" no Settings).
- Sincronização entre abas: `storage` event listener em `theme.js`.
- O `localStorage` é independente do token de auth (chave `panel_theme`).
- CSS: `html[data-theme] { color-scheme: dark | light; }` para controls nativos corretos.

---

## 4. Arquitetura frontend alvo

### 4.1 Princípios

- **Sem build step, sem CDN, sem npm.** Mantém o deploy atual (arquivos servidos pelo FastAPI) e a política CSP.
- **Módulos JS globais (IIFE)** como hoje — nenhuma reescrita da lógica de páginas.
- **CSS por camadas e responsabilidades** — os 12 arquivos atuais são reorganizados (§4.2).
- **Event delegation** progressiva: novo código não usa `onclick` inline; os existentes são migrados aos poucos (objetivo: permitir remover `unsafe-inline` do CSP no futuro — mas **não** nesta entrega).
- **Ícones SVG inline** substituem emojis e siglas (`TV`, `DB`, `MX`...) — stroke monocromático, herdando `currentColor`.

### 4.2 Estrutura de arquivos alvo

```
static/
├── css/
│   ├── tokens.css          # NOVO — escala, semânticos, temas claro/escuro, movimento
│   ├── base.css            # NOVO — reset, tipografia, scrollbars, seleção, utilidades
│   ├── layout.css          # NOVO — shell: sidebar, header, main, grid
│   ├── components.css      # NOVO — botões, cards, badges, toasts, modais, forms, tabelas, skeleton
│   ├── motion.css          # NOVO — view transitions, micro-interações, reduced-motion
│   └── pages/              # NOVO — um arquivo por página (renomeia os atuais)
│       ├── dashboard.css   # (dashboard.css)
│       ├── devices.css
│       ├── device.css
│       ├── groups.css
│       ├── mediamtx.css
│       ├── logs.css
│       ├── shell.css
│       ├── scrcpy.css
│       ├── backup.css
│       ├── settings.css
│       ├── wizard.css
│       └── auth.css        # (login overlay — hoje em main.css)
├── js/
│   ├── theme.js            # NOVO — leitura/escrita do tema + botão + storage event
│   ├── motion.js           # NOVO — startViewTransition + helpers de animação
│   ├── icons.js            # NOVO — catálogo de SVG inline
│   └── ... (16 módulos atuais, sem reescrita de lógica)
└── img/
    └── icons.svg           # Opcional — sprite de ícones (ou inline via icons.js)
```

`templates/base.html`:
- script inline anti-flash de tema no `<head>` (antes do CSS crítico);
- `<link>` para `tokens.css`, `base.css`, `layout.css`, `components.css`, `motion.css` + CSS da página atual (pode carregar todos — arquivos pequenos);
- `theme.js` e `motion.js` carregados antes de `app.js`;
- mantém cache-busting `?v=N` — **incrementar `v` a cada entrega de Fase**.

### 4.3 Migração das folhas atuais (mapeamento)

| Atual | Destino | Ação |
|---|---|---|
| `main.css` (tokens + layout + overlay de login + utilidades) | `tokens.css` + `base.css` + `layout.css` + `components.css` + `pages/auth.css` | Decompor |
| `forms.css` | `components.css` | Consolidar |
| `dropdown.css` | `components.css` | Consolidar |
| `apps.css` | `pages/devices.css` (seção APK) | Consolidar |
| `dashboard/device/devices/groups/mediamtx/logs/backup/scrcpy/wizard.css` | `pages/*.css` | Renomear + trocar cores por tokens |

### 4.4 Decisão sobre libs externas

**Recomendação: nenhuma lib nova é necessária.** O redesign usa apenas:

- CSS custom properties (tokens) — nativo;
- `document.startViewTransition()` (View Transitions API) — nativo, com fallback;
- `prefers-color-scheme` / `prefers-reduced-motion` — nativo;
- SVG inline — nativo.

Custo-benefício de libs comuns avaliado:

| Lib | Uso proposto | Veredito |
|---|---|---|
| Framework (React/Vue/Svelte) | Reescrita da SPA | Não — exige build step e reescreve 16 módulos; risco alto, ganho baixo |
| Tailwind | Utilidades CSS | Não — exige build ou CDN; conflita com a política do projeto |
| Chart.js / uPlot | Sparklines do dashboard | Opcional — só se evoluir para gráficos ricos; vendored e sem CDN. Sparklines atuais em canvas são suficientes |
| Alpine.js | Estado/reatividade | Opcional — pequeno e sem build, mas não é necessário para o escopo |
| Ícones (lucide/feather) | Set de ícones | Opcional — pode **vendar** o set (arquivos locais) em `icons.js`; não usar CDN |
| Fontes (Inter etc.) | Tipografia | Opcional — vendor `@fontsource` local se desejado; stack nativa já é boa e tem custo zero |

**Regras para aceitar lib externa nesta reforma:**
1. Servida localmente (vendored) — nunca CDN (CSP/offline).
2. Sem build step obrigatório.
3. Tamanho pequeno (< ~50 kB gzip) e sem dependências transitivas pesadas.
4. Justificativa registrada aqui (nova linha na tabela) e no commit.
5. Compatível com a SPA atual (IIFE/ESM simples, sem `type="module"` obrigatório por página — pode usar ESM se servido como `module`).

---

## 5. Especificação de animações

### 5.1 Transição de página (View Transitions)

```js
// motion.js — usado pelo router (app.js)
function withTransition(render) {
  if (document.startViewTransition) {
    document.startViewTransition(render);
  } else {
    render(); // fallback: sem animação
  }
}
```

CSS:

```css
::view-transition-old(root) {
  animation: vt-out var(--dur-fast) var(--ease-in-out) both;
}
::view-transition-new(root) {
  animation: vt-in var(--dur-slow) var(--ease-out) both;
}
@keyframes vt-out { to { opacity: 0; } }
@keyframes vt-in { from { opacity: 0; transform: translateY(8px); } }
```

- Direção: saída = fade out rápido (150ms); entrada = fade + elevação sutil de 8px (400ms).
- **Recomendado:** limitar a transição apenas quando a rota muda (não em mount inicial nem no wizard).
- Fallback: browsers sem suporte renderizam instantaneamente (nenhuma quebra).

### 5.2 Micro-interações

| Elemento | Animação | Duração/Easing |
|---|---|---|
| Botão primário `:hover` | Elevação + sombra (transform) | 150ms `--ease-out` |
| Botão `:active` | `scale(0.97)` | 80ms |
| Nav item | Indicador ativo desliza (pill com `transform`) | 240ms `--ease-out` |
| Card `:hover` | `translateY(-2px)` + sombra | 240ms `--ease-out` |
| Badge de status | Pulsação sutil apenas em `warning`/`offline` (opacidade 0.6→1, loop suave) | 1.6s |
| Input `:focus` | Anel de foco (outline + leve sombra) | 150ms |
| Toast entrada | `translateY(12px)→0` + fade | 240ms `--ease-out` |
| Toast saída | fade + `translateY(6px)` | 150ms `--ease-in` |
| Modal | Backdrop fade; conteúdo `scale(0.96)→1` + fade | 240ms |
| Dropdown | `opacity` + `translateY(4px)` | 150ms |
| Skeleton | shimmer de fundo (gradiente animado, `background-position`) | 1.2s loop, desligado em `reduced-motion` |

### 5.3 Carregamento

- Substituir o texto "Carregando..." por **skeletons** com formato do conteúdo (cards no dashboard, linhas em tabelas).
- API responses rápidas: skeleton mínimo (150ms mínimo visível para evitar flicker).
- Intervalos de refresh (logs 5s, mediamtx 10s) **não animam** o conteúdo inteiro — apenas o dado que mudou (flash discreto no campo atualizado ou `aria-live`).

### 5.4 `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none !important; }
}
```

Loops de status (pulsação) desligados; skeletons estáticos (apenas opacidade fixa).

---

## 6. Componentes (inventário e regras)

| Componente | Regra no novo sistema |
|---|---|
| **Sidebar** | Fundo `--bg-surface`; borda direita `--border-subtle`; item ativo = pill invertido (`--text-inverse` sobre `--text-primary`); ícone stroke 20px; label colapsa. Botão de tema no rodapé. |
| **Header** | `--bg-base` translúcido + blur sutil; título em `--text-primary` 600; status do sistema = dot + texto. |
| **Cards** | `--bg-surface`, borda `--border-subtle`, raio `--radius`; hover eleva 2px. Cabeçalho com título (600) + subtítulo (`--text-secondary`). |
| **Stat cards** | Valor em 28px/600 `--text-primary`; label `--text-secondary`; sparkline stroke `--text-primary` (espessura 1.5px) com área a 10% de opacidade. |
| **Botões** | Primário = invertido (preto/claro); secundário = outline (`--border-strong`); ghost = sem borda, hover `--control-hover`; danger = apenas variação tipográfica (sempre B&W). Estados: `:hover`, `:active` (scale), `:disabled` (40% opacidade, sem hover). |
| **Inputs** | `--bg-base`/`--bg-surface`, borda `--border-strong` 1px, foco com `--focus-ring` (outline 2px offset 2px); placeholder `--text-muted`. |
| **Tabelas (logs etc.)** | Cabeçalho `--text-secondary` 12px uppercase; zebra sutil com `--bg-surface` alternado ou divisores `--border-subtle`; hover de linha `--control-hover`; monospace para dados técnicos. |
| **Badges de status** | Indicador (forma §3.2) + ícone + rótulo; sem cor. |
| **Toasts** | Posição bottom-right; ícone stroke; borda esquerda espessa (`--text-primary`); close visível no hover; `role="status"`/`aria-live="polite"`. |
| **Modais** | Backdrop `--bg-overlay` + blur; conteúdo `--bg-raised`, `--shadow-lg`; animação de entrada; `role="dialog"`, focus trap (existente: manter). |
| **Skeletons** | Blocos `--bg-raised` com shimmer; formato do conteúdo real. |
| **Empty/error states** | Ícone grande (stroke, `--text-muted`), título, ação de retry; sem ilustração colorida. |
| **Login overlay** | Card centralizado `--bg-raised`, `--shadow-lg`; logo = monograma invertido em círculo; input de token + botão primário. |
| **Wizard** | Passos com progresso por indicadores numerados; transição entre passos = slide/fade (300ms); passo atual em destaque invertido. |
| **Terminal shell** | `--bg-inset`, texto `--text-primary` mono, cursor piscando 1s (desligado em reduced-motion); prompt `--text-secondary`. |

### 6.1 Ícones

- Set mínimo: `dashboard, tv, users, server, file-text, terminal, monitor, archive, settings, sun, moon, play, stop, refresh, reboot, camera, download, upload, trash, edit, plus, x, check, alert, pause, help, search, chevron-down`.
- Todos SVG inline, `width/height: 1em`, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.8"`.
- Emojis atuais e siglas de 2 letras nos nav items são removidos.

---

## 7. Plano de implementação (fases)

Cada fase termina com **`node --check static/js/*.js` + `pytest -q` verdes** e revisão visual manual (claro + escuro) antes de avançar.

### Fase 0 — Baseline (0.5 dia)

- [ ] Criar branch `codex/ui-redesign` a partir de `main`.
- [ ] Tirar screenshots do estado atual (claro/escuro, todas as rotas) em `docs/screenshots/` para comparação.
- [ ] Rodar `pytest -q` e `node --check` e registrar contagem.

### Fase 1 — Tokens + sistema de tema (1 dia)

- [ ] Criar `static/css/tokens.css` com §3 completo (escala, semânticos, temas, movimento).
- [ ] Criar `static/js/theme.js` (leitura, toggle, persistência, `storage` event).
- [ ] Adicionar script anti-flash + `data-theme` em `templates/base.html`; botão de tema na sidebar.
- [ ] Aplicar `color-scheme` por tema.
- [ ] **Aceite:** trocar tema sem flash; preferência persiste; `node --check` OK; nenhuma página quebrada visualmente além de cores herdadas.

### Fase 2 — Base, layout e componentes (2–3 dias)

- [ ] `base.css`: reset (aproveitar o atual), tipografia, scrollbar, utilidades (`flex`, `gap`, `text-*`).
- [ ] `layout.css`: shell (sidebar colapsável, header, main, grid de cards).
- [ ] `components.css`: botões, inputs, tabelas, badges, toasts, modais, dropdowns, skeletons, empty/error.
- [ ] Migrar `forms.css`/`dropdown.css`/`apps.css` para `components.css`/`pages/`.
- [ ] Substituir emojis/siglas por ícones SVG (`icons.js` + atualização dos templates HTML).
- [ ] **Aceite:** shell e componentes 100% B&W nos dois temas; navegação e colapso funcionam; foco visível.

### Fase 3 — Páginas, uma a uma (2–3 dias)

Ordem sugerida (do mais visível ao mais complexo):
1. `dashboard` (stat cards, sparklines, status)
2. `devices` + `device` (cards, formulários, ações)
3. `groups`
4. `mediamtx` (tabela de paths)
5. `logs` (tabela, filtros)
6. `backup`
7. `settings`
8. `scrcpy`
9. `shell` (terminal)
10. `wizard` (steps)
11. `auth` (login overlay)

Por página: extrair CSS para `pages/*.css`, trocar cores por tokens, aplicar §6 e verificar **claro + escuro + estado de erro/empty**.

- [ ] **Aceite:** nenhuma classe CSS órfã das 12 folhas antigas permanece sem token; `node --check` verde.

### Fase 4 — Animações (1–1.5 dia)

- [ ] `motion.css` com §5 (view transitions, micro-interações, skeletons).
- [ ] `motion.js` + integração no router (`app.js` — 3 linhas).
- [ ] Animações de toast/modal/dropdown substituem os hacks atuais (`toast.style.opacity` manual).
- [ ] Skeletons nos pontos de carregamento principais (dashboard, devices, logs).
- [ ] Testar `prefers-reduced-motion` no DevTools.
- [ ] **Aceite:** transições suaves e sem "saltos"; nada anima com `reduced-motion`; FPS estável (sem animar layout).

### Fase 5 — QA, acessibilidade e entrega (1 dia)

- [ ] Contraste AA em todos os textos (verificar tokens nos dois temas).
- [ ] Navegação por teclado: sidebar, modais (focus trap), tabelas, wizard.
- [ ] `aria-live` em toasts/status; `aria-current` no nav ativo; `role="dialog"`/`aria-modal` nos modais.
- [ ] Testes: `pytest -q` (70), `node --check`, revisão manual das 12 rotas × 2 temas.
- [ ] Incrementar cache-busting `?v=` em `base.html` (para 18).
- [ ] Atualizar `docs/LLM.md` §8 (estrutura do frontend) e README se necessário.
- [ ] Commit por fase com mensagens claras; PR final com screenshots antes/depois.

---

## 8. Critérios de aceite (geral)

1. Interface **100% monocromática** (preto & branco) nos dois temas — nenhuma cor cromática em produção, exceto a extensão opcional desligada por default.
2. Tema claro/escuro completos, sem flash no load, com persistência e sincronização entre abas.
3. Animações suaves e profissionais; `prefers-reduced-motion` respeitado integralmente.
4. Nenhuma regressão funcional: `pytest` (70) e `node --check` verdes; rotas e ações idênticas.
5. Acessibilidade: contraste AA, foco visível, navegação por teclado, `aria` adequado.
6. Sem CDN e sem build step; qualquer lib externa vendored e justificada (§4.4).
7. Cache-busting atualizado; docs sincronizadas.

---

## 9. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Regressão visual em página pouco visitada (wizard, scrcpy) | Médio | Fase 3 por página com checklist claro/escuro + screenshot baseline |
| View Transitions não suportada em browser antigo | Baixo | Fallback instantâneo (`if (document.startViewTransition)`) |
| Remover cores de status reduz legibilidade | Médio | Ícone + rótulo + forma (§3.2); teste com usuário; extensão opcional documentada |
| `unsafe-inline` continua no CSP | Baixo (não bloqueia) | Migrar `onclick` para event delegation progressivamente; remover do CSP em entrega futura |
| CSS antigo órfão confunde o novo sistema | Médio | Fase 3 exige remoção das classes mortas; `rg` para hexes antigos antes do merge |
| Mudança de tema quebra screenshot/token URLs (`?token=`) | Baixo | `theme.js` não toca em `api.js`/`auth.js`; testar login e screenshots pós-Fase 1 |

---

## 10. Definição de pronto (DoD) por commit

- `node --check static/js/*.js` verde.
- `pytest -q` verde.
- Revisão visual manual nos dois temas da rota afetada.
- Nenhum hex cromático novo no diff (revisar `rg "#[0-9a-fA-F]{6}"`).
- Cache-busting `?v=` incrementado quando `base.html` muda.
- Mensagem de commit descritiva (ex.: `feat(ui): design tokens monocromáticos + tema claro/escuro`).
