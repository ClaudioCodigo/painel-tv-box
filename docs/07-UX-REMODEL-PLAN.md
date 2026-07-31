# Plano de Remodelagem UX/UI — Painel TV Box
## Todas as seções, padrão V2 (monocromático + glanceable)

> **Data:** 2026-07-31 · **Base:** redesign `docs/06-UI-REDESIGN-SPEC.md` (já entregue) + pesquisa de cards (glanceability, hierarquia, status por forma+rótulo) + inventário de dados. **Backend:** mudanças mínimas e listadas por seção. **Fonte da verdade do frontend:** `docs/LLM.md` §8.

---

## 0. Princípios do novo padrão (derivados da pesquisa)

1. **Glanceable (1–2s):** cada tela responde "o que está quebrado?" na primeira olhada; detalhe vai para drill-down.
2. **Status = forma + ícone + rótulo + motivo** (nunca cor sozinha — WCAG 1.4.1). Online é "silencioso"; anomalia salta.
3. **Frescura visível:** "visto há Ns" em todo dado em tempo real (detecta dado velho).
4. **Ações por hierarquia:** operações frequentes sempre visíveis; raras/perigosas no kebab/confirmação.
5. **Toolbar de gestão:** busca, filtro por grupo, contadores — padrão para frotas 10–50 (PatternFly card view).
6. **Estados completos:** loading (skeleton) → vazio (ícone + retry) → erro (mensagem + retry) → dado.
7. **Sem emojis coloridos:** ícones SVG stroke; toasts com ícone por tipo.
8. **A11y:** contraste AA, foco visível, `aria-live` em status/feed, teclado.

---

## 1. Plano por seção

Legenda: 🔴 P0 (alto valor, pouco risco) · 🟠 P1 · 🟡 P2 (polimento)

### 1.1 Dashboard — Eventos e toolbar 🔴
| Item                          | Estado atual                        | Proposta                                                                                                                         |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Feed de eventos `#event-list` | Placeholder morto ("Aguardando...") | Popula com eventos WS (`health`/`recovery`/`alert`): ícone + device + motivo + timestamp; máximo ~50 itens; `aria-live="polite"` |
| Toolbar de gestão             | Não existe                          | Acima do grid: contadores (total/online/degradado/offline) + busca por nome/IP + filtro por grupo + sort (nome/IP/status)        |
| Cards V2                      | ✅ entregue                          | — (refinar: chip de grupo com nome real, não o id)                                                                               |

### 1.2 Header — status vivo 🔴
| Item             | Estado atual          | Proposta                                                                                                                                                      |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#header-status` | Morto (nenhum JS usa) | Mostra estado do servidor + conexão WS (dot + "Servidor OK" / "offline WS"); usa `/api/system/health` + eventos de WS (`connected`/`disconnected` do `ws.js`) |

### 1.3 Página Dispositivos (gestão) 🔴
| Item     | Estado atual                             | Proposta                                                      |
| -------- | ---------------------------------------- | ------------------------------------------------------------- |
| Status   | Badge por classe (sem reason, sem forma) | Status bar compacta V2 (forma+rótulo+reason truncado)         |
| Frescura | Não existe                               | "visto há Ns" (com atualização via WS — hoje não há listener) |
| Toolbar  | Não existe                               | Busca + filtro por grupo + contadores                         |
| Ações    | Renomear/Grupo/Excluir com texto         | Ícones + rótulo; Excluir com confirmação (já tem modal)       |
| WS       | Sem listener                             | `WS.on('health')` atualiza badge/reason em tempo real         |
| Backend  | —                                        | Nenhum (GET /devices já traz state)                           |

### 1.4 Página do device (detalhe) 🟠
| Item            | Estado atual                                                             | Proposta                                                                                                     |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Organização     | Tudo empilhado (rede, stream, screenshot, APK, shell)                    | **Tabs**: Visão geral \| Stream \| Apps \| Shell \| Screenshots                                              |
| Cabeçalho       | Ícone + nome + localização                                               | Status bar V2 + freshness + reason em destaque; grupo clicável                                               |
| Dados faltantes | `current_activity` = "Android X" (genérico)                              | Atividade real em foco; última recuperação; reboot count                                                     |
| Backend         | `uptime_seconds`, `recovery_count`, `last_fail` do device são **mortos** | Preencher no watchdog/health (uptime via `cat /proc/uptime`; recovery_count no recovery) OU remover do model |

### 1.5 Grupos 🟠
| Item             | Estado atual               | Proposta                                                                                               |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Resumo por grupo | Só count de devices        | Contadores online/degradado/offline por grupo (ícone+forma)                                            |
| `/group/{id}`    | Placeholder "em breve"     | **Página real**: devices do grupo (cards V2 compactos), ações coletivas (start/stop/reboot), scheduler |
| Card             | Tags de devices com status | Chip de grupo nos cards do dashboard usa o **nome** (via GET /groups)                                  |

### 1.6 MediaMTX 🟠
| Item              | Estado atual                                   | Proposta                                                                                                                                           |
| ----------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status do serviço | Linha de texto                                 | Cards de status (serviço up/down, portas, versão se disponível) com forma+rótulo                                                                   |
| Tabela de paths   | name, ready, publisher, readers, tracks, bytes | Indicador de forma por path (ready/offline); readers como barra/sparkline; empty state com ícone; refresh com guarda (hoje 10s sem destroy → leak) |

### 1.7 Logs 🟠
| Item                | Estado atual                                            | Proposta                                               |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Auto-refresh        | `setInterval` 5s **sem destroy** (leak) + possível race | Guarda de requisição + `destroy()` exposto no router   |
| Timestamps          | Cru                                                     | Relativo ("há 2min") + título com absoluto             |
| Filtros             | Inputs soltos                                           | Chips de nível (INFO/WARN/ERROR); botão limpar filtros |
| Toggle auto-refresh | Sempre ligado                                           | Botão pausar/retomar                                   |

### 1.8 Shell 🟡
| Item          | Estado atual  | Proposta                                                                                    |
| ------------- | ------------- | ------------------------------------------------------------------------------------------- |
| Histórico     | Não existe    | ↑/↓ navega histórico da sessão                                                              |
| Estado        | Sem indicador | Prompt com `device@painel` e dot de conexão ADB                                             |
| Quick actions | Botões        | Com ícones + tooltip; "Reverse Ping" com IP configurável (hoje hardcoded `192.168.254.102`) |

### 1.9 scrcpy 🟡
| Item             | Estado atual | Proposta                                                                     |
| ---------------- | ------------ | ---------------------------------------------------------------------------- |
| Estado da sessão | Texto solto  | Badge de estado (parado/espelhando/streaming) com forma; diagnóstico legível |
| Versões          | Lista        | Versão ativa destacada (pill invertida); confirmação para delete/rollback    |

### 1.10 Backup 🟡
| Item        | Estado atual          | Proposta                                                      |
| ----------- | --------------------- | ------------------------------------------------------------- |
| Metadados   | ISO cru + bytes       | Data legível (relativa) + tamanho formatado (KB/MB)           |
| Restore     | Confirmação genérica  | Resumo do que será restaurado (count de arquivos, pre-backup) |
| Empty state | "Nenhum backup" texto | Ícone + retry                                                 |

### 1.11 Settings 🟡
| Item        | Estado atual           | Proposta                                                    |
| ----------- | ---------------------- | ----------------------------------------------------------- |
| Tema        | Botão que cicla        | Seletor explícito (Escuro/Claro/Sistema) via `THEME`        |
| Update      | Texto                  | Estado com branch/commit atuais; resultado do apply legível |
| Server info | `#server-info` loading | Tabela completa (uptime real, disco, versão, devices)       |
| Segurança   | —                      | (opcional) mostrar onde está o token e como trocá-lo        |

### 1.12 Wizard 🟡
| Item      | Estado atual | Proposta                                                         |
| --------- | ------------ | ---------------------------------------------------------------- |
| Progresso | Barra        | Indicadores numerados por step (spec §6) + transição entre steps |
| Validação | Genérica     | Inline por campo; teste de conexão com estados claros            |

---

## 2. Melhorias transversais

| #   | Item                                                                                         | Onde                      |
| --- | -------------------------------------------------------------------------------------------- | ------------------------- |
| T1  | Corrigir leaks de `setInterval` (logs 5s, mediamtx 10s, devices 15s) — `destroy()` no router | `app.js` + módulos        |
| T2  | Empty/error states padronizados: ícone + título + retry (helper `UI.stateView`)              | todas as páginas          |
| T3  | `aria-live` em status que muda via WS (cards, feed, header)                                  | dashboard, devices        |
| T4  | Nome do grupo real nos chips (buscar `GET /groups` e mapear id→name)                         | dashboard                 |
| T5  | Timestamps relativos (helper `UI.timeAgo`)                                                   | logs, backup, feed, cards |
| T6  | Remover emojis remanescentes em mensagens/erros (passada final)                              | todas                     |
| T7  | Chip de grupo clicável → página do grupo                                                     | dashboard, devices        |

---

## 3. Backend necessário (mínimo, separado por risco)

| #   | Mudança                                                                                                                                                                                           | Risco           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| B1  | ✅ **Feito:** `reason` no evento WS `health`                                                                                                                                                       | —               |
| B2  | Preencher campos mortos do `DeviceState`: `uptime_seconds` (device via `/proc/uptime`), `recovery_count` (no recovery), `last_fail` (no health fail) — ou removê-los do model se não forem usados | Baixo           |
| B3  | `current_activity` real no endpoint `/status` (hoje seta `"Android {versão}"`)                                                                                                                    | Baixo           |
| B4  | (opcional) Endpoint para regenerar token de acesso (`POST /api/auth/rotate`)                                                                                                                      | Médio — decidir |

---

## 4. Fases de implementação (ordem sugerida)

| Fase                      | Escopo                                                                                            | Estimativa |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| **A — Transversais P0**   | T1 leaks · T2/T3 helpers · feed de eventos + toolbar do dashboard · header status vivo · T4/T5/T6 | ~1 dia     |
| **B — Dispositivos**      | Página Dispositivos (V2 + toolbar + WS) · página do device com tabs + B2/B3                       | ~1.5 dia   |
| **C — Grupos + MediaMTX** | Página de grupo real (substitui "em breve") · resumos por grupo · MediaMTX status/paths           | ~1 dia     |
| **D — Polimento**         | Logs (chips/guarda/toggle) · Shell (histórico) · scrcpy · Backup · Settings · Wizard              | ~1.5 dia   |

Cada fase termina com: `node --check static/js/*.js` + `pytest -q` verdes, revisão claro+escuro, sem hex cromático novo, cache-busting incrementado (`?v=19`...), `docs/LLM.md` sincronizado.

---

## 5. Fora de escopo / não-objetivos

- Migração de `onclick` → event delegation (fica para entrega futura; mantém `unsafe-inline` no CSP).
- Backend funcional (watchdog, recovery, ADB) — só o mínimo B2/B3 para exibir dados corretos.
- Framework JS / build step (mantém política do projeto).
- Toggle de "cores de status" (extensão opcional do spec, default desligado).

---

## 6. Critérios de aceite (geral)

1. Toda tela é glanceable: status em ≤1s; motivo sempre legível.
2. Frescura visível em todo dado em tempo real.
3. Nenhum leak de intervalo; `destroy()` funciona em todas as rotas.
4. Estados loading→vazio→erro completos nas páginas principais.
5. `node --check` + `pytest` verdes; revisão claro/escuro manual; sem hex cromático novo.
6. A11y: `aria-live` em status/feed, foco visível, teclado nas interações novas.
