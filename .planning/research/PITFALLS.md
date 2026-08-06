# Pitfalls Research

**Domain:** Deploy Windows-only de painel FastAPI + MediaMTX como serviços NSSM
**Researched:** 2026-08-06
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Caminhos com espaço em NSSM

**What goes wrong:** `nssm install` interpreta argumentos de forma imprevisível quando o exe ou os args têm espaços; o serviço não sobe ou sobe com argumentos truncados.
**Why it happens:** NSSM quebra a linha de comando pelos espaços; o diretório dev do projeto é `...\TV Box\Paniel` (com espaço) e o deploy atual do painel em produção poderia herdar isso.
**How to avoid:** Instalar em `C:\PanelTVBox` (sem espaços — decisão já registrada); passar argumentos do app via `nssm set <svc> AppParameters` e caminhos com aspas quando necessário.
**Warning signs:** Serviço entra em estado "Stopped" logo após o start; `nssm status` mostra exit code inesperado.
**Phase to address:** Fase A (instalador).

### Pitfall 2: winget ausente em Windows 10 corporativo

**What goes wrong:** `winget install Python.Python.3.12` falha ou o comando nem existe; o instalador aborta e o cliente não-técnico fica sem painel.
**Why it happens:** winget não está em vários Windows 10 corporativos (decisão registrada no HANDOFF §2.3).
**How to avoid:** Tratar winget como tentativa com fallback: se falhar, exibir passo-a-passo claro de instalação manual (Python 3.11+ e Git); verificar `python --version` ≥ 3.11 depois.
**Warning signs:** Exit code não-zero do winget; `Get-Command winget` vazio.
**Phase to address:** Fase A (instalador).

### Pitfall 3: Serviço não enxerga PATH/ffmpeg (e outros binários)

**What goes wrong:** O serviço do painel roda sem o PATH da sessão do usuário; `ScrcpyManager`/streaming falham ao chamar `ffmpeg`/`adb`/`git` porque não estão no PATH do serviço.
**Why it happens:** Serviços Windows herdam o ambiente do sistema, não o do usuário; binários extraídos pelo install.ps1 não estão no PATH do sistema.
**How to avoid:** `nssm set panel-tvbox AppEnvironmentExtra PATH=<C:\PanelTVBox\ffmpeg\bin;C:\PanelTVBox\platform-tools;...>+<PATH existente>` — **usar `AppEnvironmentExtra`**, não `AppEnvironment` (que SUBSTITUI o ambiente do sistema, quebrando TUDO — nssm.cc: "the environment variables specified in AppEnvironment will replace those set by the system").
**Warning signs:** Streaming falha com `ffmpeg: command not found` / `[WinError 2]` só em produção (funciona em dev).
**Phase to address:** Fase A (instalador) + verificação no resumo final.

### Pitfall 4: Presumir nome fixo do asset MediaMTX

**What goes wrong:** URL hardcoded (`mediamtx_v1.20.0_windows_amd64.zip`) quebra quando o projeto muda a convenção de nomes ou faz release novo com outro padrão.
**Why it happens:** Release notes variam; versões antigas somem do "latest".
**How to avoid:** Resolver via `https://api.github.com/repos/bluenviron/mediamtx/releases/latest` e filtrar asset por `windows_amd64` + `.zip` (padrão já usado pelo install.sh e pelo `ScrcpyManager`).
**Warning signs:** 404 no download em release novo.
**Phase to address:** Fase A (instalador).

### Pitfall 5: `git pull` quebra sem `.git` no destino

**What goes wrong:** `UpdateManager` roda `git pull` no `project_root`; se a instalação copiou o código sem `.git`, o update falha e o cliente não atualiza nunca.
**Why it happens:** No deploy Linux, o rsync excluía `.git` (HANDOFF §2.4); Windows precisa nascer certo.
**How to avoid:** Copiar o repo para `C:\PanelTVBox` **preservando `.git`**, excluindo apenas `.venv`, `__pycache__`, `logs`, `backups`, `scrcpy/*`, `.reasonix`. Se destino vazio e repo não local → `git clone`.
**Warning signs:** Update retorna erro de git; `.git` ausente no destino.
**Phase to address:** Fase A (instalador).

### Pitfall 6: Firewall abrindo para o mundo (ou não abrindo para a LAN)

**What goes wrong:** (a) Regra sem `RemoteAddress` → painel exposto à Internet; (b) regra só para o perfil atual → cliente em outra rede Wi-Fi/Ethernet não acessa.
**Why it happens:** Default do `New-NetFirewallRule` sem escopo; perfis de rede diferentes (Domain/Private/Public).
**How to avoid:** Sempre `-RemoteAddress LocalSubnet` + `-Profile Private, Domain`; 5555 (ADB) só via flag `-AllowAdb` e documentar que nunca abrir para o mundo.
**Warning signs:** Painel acessível fora da LAN; ou acessível só numa rede.
**Phase to address:** Fase A (instalador).

### Pitfall 7: Serviço em execução vs config do MediaMTX desatualizada

**What goes wrong:** Wizard/update regenera `mediamtx.generated.yml`, mas o serviço MediaMTX continua com a config antiga (paths novas não aparecem; TV Box não abre stream).
**Why it happens:** O serviço só relê a config ao reiniciar; sem sincronização, config e serviço divergem.
**How to avoid:** `generate_mediamtx_yml` já sincroniza via `PANEL_MEDIAMTX_CONFIG` quando gravável (implementado); o install.ps1 deve setar essa env no serviço; documentar reinício do MediaMTX após mudanças.
**Warning signs:** Path criada no painel mas `GET /v3/paths/get/<nome>` no MediaMTX não a encontra.
**Phase to address:** Fase A + Fase C (docs).

### Pitfall 8: Deixar código/docs Linux no caminho ativo

**What goes wrong:** Cliente (ou futuro dev) segue `README.md`/`docs/INSTALL.md` Debian em máquina Windows; `deploy/install.sh` e units systemd poluem o repo; mensagem `"apt install ffmpeg"` confunde no Windows.
**Why it happens:** Docs evoluem mais devagar que a decisão de plataforma.
**How to avoid:** Arquivar Linux em `deploy/legacy/` (escolha do usuário), simplificar `_platform_info`/`get_data_dir`, atualizar README/INSTALL/LLM e a mensagem de ffmpeg no `scrcpy.py`. **Não tocar** em `scripts/android/*.sh` (rodam NOS TV Boxes).
**Warning signs:** README ainda cita "Debian 13", "104 testes", `deploy/install.sh` como caminho principal.
**Phase to address:** Fase B + Fase C.

### Pitfall 9: Testes que dependem do branch Linux

**What goes wrong:** Ao simplificar `_platform_info` p/ Windows-only, `tests/test_scrcpy.py::test_platform_info_linux` quebra a suíte (gate de 111 testes vermelho).
**Why it happens:** O teste valida comportamento que a refatoração remove.
**How to avoid:** Ajustar/remover o teste junto com a mudança; rodar `pytest -q` completo + `node --check` ao final de cada fase.
**Warning signs:** `pytest` vermelho em CI/local após a refatoração.
**Phase to address:** Fase B.

### Pitfall 10: Instalador não testável na máquina dev

**What goes wrong:** Instalação completa (NSSM, serviços, firewall) na dev pode quebrar o ambiente/portas; mudanças no .ps1 ficam sem verificação e quebram no cliente.
**Why it happens:** Não há ambiente Windows isolado de teste.
**How to avoid:** Validar sintaxe (`powershell -ExecutionPolicy Bypass -File deploy/install.ps1 -Help`), `node --check`, pytest, e teste isolado do fluxo de download dos 4 assets; documentar teste manual no cliente como gate de aceite (UAT).
**Warning signs:** .ps1 com erro de sintaxe/typo só descoberto na máquina do cliente.
**Phase to address:** Fase A (inclui smoke-tests do script).

---

*Pitfalls analysis: 2026-08-06*
