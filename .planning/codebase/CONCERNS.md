# Codebase Concerns

**Analysis Date:** 2026-08-06

## Tech Debt

**Linux-specific deploy (a remover/arquivar):**
- Issue: `deploy/install.sh`, `deploy/panel.service`, `deploy/mediamtx.service` (systemd) existem para Debian 13, mas o cliente descartou Linux — o painel roda SOMENTE em Windows 10+.
- Why: decisão desta sessão (HANDOFF §2.1); o deploy Linux foi documentado e validado antes.
- Impact: código morto/confuso; risco de alguém seguir instruções erradas; `docs/INSTALL.md`, `README.md` e `docs/LLM.md` ainda citam Debian/systemd.
- Fix approach: HANDOFF Tarefa 2 — criar `deploy/install.ps1` (+ `instalar.bat`), arquivar ou remover os arquivos Linux (decisão do usuário: `deploy/legacy/` vs remover), atualizar docs. **Não tocar** em `scripts/android/*.sh` (rodam NOS TV Boxes, não no servidor).

**`app/managers/scrcpy.py` branches Linux/macOS:**
- Issue: `_platform_info` (linhas ~166-186) e `_platform_binary_name` mantêm branches linux/aarch64/macos e a mensagem `"apt install ffmpeg"` (linha ~562) para quando ffmpeg não está instalado.
- Why: herança do período cross-platform; o produto é Windows-only agora.
- Impact: no Windows, se ffmpeg não estiver no PATH, o usuário recebe instrução de `apt` (sem sentido); branches nunca executados.
- Fix approach: simplificar para Windows-only (referenciar o ffmpeg baixado pelo install.ps1 / PATH); ajustar `tests/test_scrcpy.py::test_platform_info_linux`. Decisão do usuário pendente (HANDOFF §5: "simplificar ou manter").

**`app/utils/system.py::get_data_dir`:**
- Issue: docstring diz "roda apenas em Windows" mas ainda há fallbacks genéricos (`APPDATA` → `Path.home()`).
- Why: Windows-first desde o início; fallbacks são herança.
- Impact: baixo — fallbacks são inofensivos; mas o HANDOFF lista como candidato a limpeza.
- Fix approach: limpar fallbacks Linux/macOS (opcional, decisão do usuário).

**Docs desatualizados (contagem de testes e plataforma):**
- Issue: `README.md` cita "104 testes" (atual: 111) e seções "Produção (Debian 13)" + tabela de data dir com Linux/macOS; `docs/LLM.md` idem; `docs/INSTALL.md` é Debian.
- Why: docs evoluem mais devagar que o código.
- Impact: orientação errada para quem for instalar em produção.
- Fix approach: HANDOFF Tarefa 2 — reescrever README/docs para Windows + 111 testes. Docs históricos (AUDITORIA.md, specs, 10-IMPLEMENTACAO.md) NÃO reescrever.

## Known Bugs

**(Sem bugs abertos conhecidos além dos itens de tech debt acima; 111 testes passando.)**

- Risco conhecido de design: `config/mediamtx.generated.yml` é regenerado pelo wizard/update; se o serviço MediaMTX rodar com config antiga e o `PANEL_MEDIAMTX_CONFIG` não apontar para o arquivo certo, paths novas não aparecem até o serviço recarregar — mitigado pela sincronização automática em `generate_mediamtx_yml` (HANDOFF registra que o deploy Linux tinha fallback "api:true" p/ config válida; replicar no Windows).

## Security Considerations

**Auth do painel:**
- Risk: acesso não autorizado ao painel (controle de TV Boxes).
- Current mitigation: token compartilhado em `config/.panel_token` (gitignored), Bearer header, rotas públicas mínimas (`/api/system/health`, login, wizard incompleto), `security.enabled` toggle, security headers (CSP, X-Frame-Options DENY, nosniff, no-referrer) em `app/main.py`.
- Recommendations: manter `security.enabled: true` em produção; nunca abrir o ADB (5555) para o mundo (flag `-AllowAdb` só LAN, opcional).

**SSRF / injeção (auditoria Rodadas 1-2, `docs/AUDITORIA.md`):**
- Risk: URLs/payloads de devices maliciosos explorando o painel (ex.: RTMP de exfiltração de tela, SSRF via wizard).
- Current mitigation: `is_safe_network_target`, `is_safe_rtmp_url`, `is_safe_http_url_local`, `is_safe_package`, `is_safe_id`, `shlex.quote` em comandos de player, validação de payload de heartbeat, anti path traversal no catch-all SPA.
- Recommendations: novos endpoints que aceitem URL/IP devem passar pelos mesmos validadores; revisar em code review.

**Firewall Windows (deploy planejado):**
- Risk: painel exposto na Internet.
- Current mitigation: regras `New-NetFirewallRule` com `RemoteAddress LocalSubnet` apenas (8080/8554/1935/9997); 5555 opcional.
- Recommendations: espelhar o ufw do install.sh; documentar que abrir para o mundo é não-suportado.

**Secrets em config:**
- Risk: `heartbeat_key`/token vazados via git.
- Current mitigation: `config/*.yml` e `.panel_token` gitignored; templates `.example` sem secrets; heartbeat_key gerada no 1º boot.
- Recommendations: no install Windows, garantir que `C:\PanelTVBox\.git` não exponha configs locais (preservar `.git` mas configs continuam gitignored).

## Platform/Deployment Risks (Windows)

- **NSSM + caminhos com espaço:** `C:\PanelTVBox` é sem espaços, mas o repo dev está em "TV Box/Paniel" (com espaço) — usar `nssm set <svc> AppParameters` para argumentos (HANDOFF §4.8).
- **winget ausente:** vários Windows 10 corporativos não têm winget — install.ps1 precisa de fallback manual claro para Python/Git.
- **Preservar `.git` na cópia:** `UpdateManager` faz `git pull`; copiar para `C:\PanelTVBox` deve excluir `.venv`, `__pycache__`, `logs`, `backups`, `scrcpy/*`, `.reasonix` mas MANTER `.git` (HANDOFF §4.3).
- **ffmpeg no PATH do serviço:** o serviço do painel precisa achar `ffmpeg.exe` (NSSM `AppEnvironmentExtra` com `PATH=...`), senão streaming/scrcpy falham em produção.
- **Requisito novo não confirmado:** "stream de apps da suíte Office" (§6 HANDOFF) tem 8 perguntas em aberto — NÃO implementar antes de validar o desenho com o usuário (regra absoluta do IDEA.md).

---

*Concerns analysis: 2026-08-06*
