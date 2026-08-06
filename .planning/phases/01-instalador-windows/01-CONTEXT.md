# Phase 1: Instalador Windows - Context

**Gathered:** 2026-08-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Criar o instalador Windows (`deploy/install.ps1` + `instalar.bat` na raiz) que, com um duplo clique em um Windows 10+, baixa automaticamente os 4 binários (ffmpeg, ADB/platform-tools, MediaMTX, NSSM), copia o código para `C:\PanelTVBox` preservando `.git`, cria o venv Python, registra painel (`panel-tvbox`) e MediaMTX (`mediamtx`) como serviços NSSM com auto-restart e libera o firewall do Windows somente para a LAN. O resultado é o painel acessível em `http://<host>:8080` para o cliente não-técnico, com o wizard na primeira execução.

</domain>

<decisions>
## Implementation Decisions

### Experiência de instalação
- **D-01:** install.ps1 é **totalmente automático** no duplo clique — sem prompts; opções avançadas ficam como flags (`-AllowAdb`, `-NoMediamtx`, `-SkipVenv`, `-RepoUrl`, `-Help`).
- **D-02:** Ao concluir, o install.ps1 **abre `http://localhost:8080` no navegador padrão** (na 1ª vez leva ao wizard).
- **D-03:** O resumo final **não mostra token** — o acesso passou a ser por **usuário/senha de administrador** (ver D-07).
- **D-04:** O instalador reporta **progresso por etapa** (baixando, extraindo, registrando serviços) na janela do PowerShell — não é silencioso.

### Autenticação (mudança de requisito — novo login/senha)
- **D-05:** O mecanismo de acesso **não é mais token compartilhado**. É **login com usuário e senha de administrador do painel**; o "token" passa a ser um vínculo de sessão da máquina/navegador. — **Reversibility:** costly — muda o contrato de auth existente (`app/core/auth.py` token-based), a SPA (`static/js/auth.js`) e os testes de auth; refazer todo o caminho de login.
- **D-06:** A criação do admin acontece no **wizard do painel na 1ª execução** (o wizard já existe em `app/api/wizard.py` e ganha etapa de criar usuário/senha). O install.ps1 não pergunta nem gera senha.
- **D-07:** A **implementação do login/senha é pré-requisito** desta fase — o instalador assume que o painel autentica por senha; o resumo final orienta o usuário a concluir o wizard (criar admin) em vez de exibir token.
- **D-08:** As **credenciais do admin devem ser armazenadas localmente e gitignored** — nunca no repo (regra de config limpa, ver D-15).

### Atualização / reexecução
- **D-09:** install.ps1 é **idempotente**: reexecutar sobre instalação existente preserva `config/`, `devices/` e dados locais; só sincroniza serviços e binários faltantes.
- **D-10:** A **atualização do código continua pelo painel** (`UpdateManager` via `git pull`); o install.ps1 **não** faz `git pull`.
- **D-11:** Reexecutando com serviços NSSM já registrados, **não duplica serviço** — detecta o registro existente e reinicia/atualiza apenas se necessário.

### Configuração inicial do painel
- **D-12:** O install.ps1 seta `adb.binary` em `config/system.yml` para `C:\PanelTVBox\platform-tools\adb.exe` **apenas se o usuário não tiver configurado manualmente** (respeita config existente).
- **D-13:** O serviço `mediamtx` **lê diretamente `C:\PanelTVBox\config\mediamtx.generated.yml`** via `PANEL_MEDIAMTX_CONFIG` (sem cópia para data dir) — o painel já sincroniza essa config para o caminho do serviço quando a env está setada (`app/core/config.py:generate_mediamtx_yml`).
- **D-14:** O install.ps1 **só aponta** o serviço para a config gerada; recarga/reinício do MediaMTX após mudanças de config não é responsabilidade do instalador.

### Config isolada da máquina (nunca no git)
- **D-15:** **REGRA FORTE (usuário enfatizou):** configurações específicas do painel (`config/*.yml`, `devices/*.yml`, `groups/*.yml`, `.panel_token`, `mediamtx.generated.yml`, credenciais admin) ficam **somente na máquina** e **nunca sobem no `git push`**. O repo vai **limpo** — apenas os templates `.example`. O install.ps1 deve (1) copiar preservando `.git` e garantir que nenhuma config real fique rastreada; (2) validar que o `.git` de `C:\PanelTVBox` não contém configs reais em seu índice.

### Firewall e segurança
- **D-16:** Regras do firewall com `RemoteAddress LocalSubnet` criadas em **todos os perfis ativos** (Private/Public) para 8080/8554/1935/9997.
- **D-17:** Se o Windows Firewall estiver **desligado**, o install **avisa** (risco de exposição) mas **segue** a instalação — não aborta.
- **D-18:** Além de **não abrir 5555 por default**, o install.ps1 cria **regra de bloqueio explícita** para a porta ADB nos perfis Public/Domain quando `-AllowAdb` for usado (defesa em profundidade).

### Logs dos serviços
- **D-19:** Logs de stdout dos serviços (uvicorn/MediaMTX) vão para **arquivos no data dir** (`%LOCALAPPDATA%\PanelTVBox\logs`) via NSSM `AppStdout`/`AppStderr` — fora do repo.

### the agent's Discretion
- Detalhes de implementação do install.ps1 (funções auxiliares, ordem exata dos passos, tratamento de erro individual por download) ficam a cargo do planner/executor, respeitando as decisões acima e o espelhamento da lógica do `deploy/install.sh`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Fonte da lógica a espelhar
- `deploy/install.sh` — lógica de referência: download via API GitHub (resolver asset real do MediaMTX, não assumir nome), exclusões da cópia, venv + fallback de deps, flags, firewall, resumo final.
- `deploy/panel.service` — config do serviço do painel (env `PANEL_*`, args uvicorn) para mapear ao NSSM `AppEnvironmentExtra`.
- `deploy/mediamtx.service` — hardening/systemd do MediaMTX (RestartSec, User isolado) para mapear ao NSSM equivalente.

### Decisões e assets já validados
- `docs/HANDOFF.md` §2-§4 — decisões aprovadas (NSSM Opção A, binários via install.ps1, `C:\PanelTVBox` com `.git`, data dir, flags), assets validados (MediaMTX windows_amd64 via API, NSSM 2.24, platform-tools, ffmpeg gyan.dev) e comandos NSSM/firewall de referência.
- `docs/HANDOFF.md` §4.8 — exemplo de comandos NSSM (`AppParameters` para caminhos com espaço, `AppEnvironmentExtra`, `AppRestartDelay`).
- `docs/HANDOFF.md` §4.9 — regras `New-NetFirewallRule` com `RemoteAddress LocalSubnet`.

### Config do painel (comportamento que o install.ps1 precisa respeitar)
- `app/core/config.py` §generate_mediamtx_yml — painel sincroniza `mediamtx.generated.yml` para `PANEL_MEDIAMTX_CONFIG` quando setada; configs `.example` → real no 1º boot.
- `app/utils/system.py` §get_data_dir — data dir `%LOCALAPPDATA%\PanelTVBox` / env `PANEL_DATA_DIR`.
- `config/system.yml.example` — campos de config (inclui `adb.binary`).
- `.gitignore` — quais configs ficam fora do versionamento (garantir que install.ps1 não quebre essa proteção).

### Auth (mudança de requisito)
- `app/core/auth.py` — estado atual (token-based) a ser substituído por login/senha.
- `app/api/wizard.py` — wizard existente; ganha etapa de criação do admin.
- `static/js/auth.js` — SPA de login atual a ser adaptada.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ConfigurationManager.generate_mediamtx_yml` (`app/core/config.py`): já escreve a config do MediaMTX e sincroniza para `PANEL_MEDIAMTX_CONFIG` — o serviço lendo esse caminho fecha o ciclo sem lógica nova no instalador.
- `ScrcpyManager.download` (`app/managers/scrcpy.py`): padrão existente de resolver asset real via GitHub API — mesmo padrão a usar no install.ps1 para o MediaMTX (com `Invoke-RestMethod`).
- Wizard (`app/api/wizard.py`): já existe e finaliza com `wizard_completed: true` + gera configs — ponto de inserção da etapa de criação do admin.

### Established Patterns
- Config `.example` → real no 1º boot (`_ensure_default_config`): o instalador só precisa garantir os templates presentes; o painel cria os arquivos reais (gitignored).
- Managers retornam dicts e a API converte em HTTP; não aplicar padrão de subprocess no installer — ele é PowerShell standalone.
- Data dir fora do repo (`get_data_dir`); logs de runtime vão para lá.

### Integration Points
- `PANEL_DATA_DIR`, `PANEL_ADB_SERVER_PORT=5038`, `PANEL_MEDIAMTX_CONFIG` — env vars que o serviço `panel-tvbox` (NSSM `AppEnvironmentExtra`) precisa carregar.
- `adb.binary` em `config/system.yml` — caminho do ADB usado pelo `ADBManager`.
- Portas: 8080 (painel), 8554/1935/9997 (MediaMTX), 5555 (ADB, opcional).

</code_context>

<specifics>
## Specific Ideas

- O cliente é **não-técnico** — o instalador precisa ser um duplo clique que "só funciona", com progresso visível por etapa e o navegador abrindo o painel ao final.
- Não depender de winget (ausente em Windows 10 corporativos) — binários baixados pelo próprio instalador.
- O usuário mostrou **ansiedade com vazamento de config no git** — a regra "config limpa no repo" é prioritária e deve aparecer como item de validação no install.ps1.

</specifics>

<deferred>
## Deferred Ideas

- **Implementação do login/senha de admin** — novo requisito que a Fase 1 assume como pré-requisito, mas a implementação em si (substituir `app/core/auth.py`, adaptar SPA e wizard) precisa ser planejada/verificada dentro do escopo desta fase ou da seguinte; registrar no REQUIREMENTS.md como requisito novo.
- **Atualização de código via install.ps1 (`git pull`)** — descartada; update fica no painel (`UpdateManager`).
- **Copiar config do MediaMTX para data dir** — descartada; serviço lê `mediamtx.generated.yml` direto.

</deferred>

---

*Phase: 1-Instalador Windows*
*Context gathered: 2026-08-06*
