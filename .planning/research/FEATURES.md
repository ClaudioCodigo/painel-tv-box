# Feature Research

**Domain:** Migração Windows-only de painel de gerenciamento de TV Boxes (deploy + operação)
**Researched:** 2026-08-06
**Confidence:** HIGH

> Milestone **subsequent**: features de produto já existem e estão Validated (streaming, watchdog, heartbeat, scrcpy, grupos). A pesquisa foca no que a **migração Windows** exige.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Instalação por duplo clique (`instalar.bat`) | Cliente não-técnico; zero fricção | MEDIUM | `instalar.bat` → `install.ps1 -ExecutionPolicy Bypass` |
| Download automático dos 4 binários (ffmpeg, ADB, MediaMTX, NSSM) | Não depender de winget/choco | MEDIUM | Resolver assets reais via API GitHub (`Invoke-RestMethod`) |
| Serviços com auto-restart (NSSM) | "Serviço tem que estar rodando boa parte do tempo" (requisito explícito) | LOW | `AppRestartDelay` 5000ms painel / 3000ms MediaMTX |
| Painel acessível às máquinas Windows da LAN | Requisito explícito do usuário | LOW | Firewall `RemoteAddress LocalSubnet` (8080/8554/1935/9997) |
| Código e docs sem rastros Linux no caminho ativo | Windows-only decidido | MEDIUM | `deploy/legacy/`, README/INSTALL/LLM atualizados |
| Preservar `.git` na instalação | `UpdateManager` faz `git pull` | LOW | Copiar repo excluindo runtime dirs, mantendo `.git` |
| Data dir fora do repo (`%LOCALAPPDATA%\PanelTVBox`) | git push/pull não mistura dados de máquinas | LOW | Já é default de `get_data_dir()` |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Config MediaMTX sincronizada com o serviço (`PANEL_MEDIAMTX_CONFIG`) | Wizard/update altera o MediaMTX em execução sem cópia manual | LOW | Já implementado (`generate_mediamtx_yml`); replicar no Windows |
| `-AllowAdb` opcional e documentado (5555 só LAN) | Flexibilidade sem risco de exposição | LOW | Espelhar flag do install.sh |
| Verificação de sintaxe + downloads testáveis do install.ps1 | Instalador confiável sem testar instalação completa na dev | MEDIUM | `-Help`, `node --check`, pytest, teste dos 4 downloads |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Captura de tela de apps Office no painel | Cliente quer transmitir a suíte Office | Painel não faz captura; adicionaria dependência de desktop interativo do serviço Windows (serviços não têm desktop) | Apps externas (OBS/ffmpeg) publicam RTMP; painel gerencia/distribui os streams como já faz |
| Abrir ADB (5555) para toda a rede / Internet | "Facilita" acesso remoto | Qualquer host da rede controla os TV Boxes | `-AllowAdb` só LAN; uso do painel como intermediário |
| winget como único caminho de instalação | Automatiza Python/Git | Ausente em vários Windows 10 corporativos | Tentar winget → fallback com mensagem clara de instalação manual |
| Serviço interagindo com desktop (SERVICE_INTERACTIVE_PROCESS) | Necessário p/ gdigrab capturar janela | Quebrado/depreciado em Windows moderno; sessão 0 | Captura via app externo na sessão do usuário, não no serviço |
| Vários workers uvicorn em produção | "Mais performance" | Locks em memória (ADB/command queue) e estado local quebram | 1 worker (já configurado) |

## Feature Dependencies

```
instalar.bat
    └──requires──> deploy/install.ps1
                       ├──requires──> downloads (ffmpeg, ADB, MediaMTX, NSSM)
                       ├──requires──> venv + pip install . (pyproject)
                       ├──requires──> cópia repo preservando .git
                       ├──requires──> config inicial (.example → real + mediamtx.generated.yml)
                       ├──requires──> NSSM serviços (panel-tvbox, mediamtx)
                       └──requires──> firewall LAN (8080/8554/1935/9997)
deploy/legacy/ (arquivamento Linux)
    └──requires──> mover install.sh + units systemd; atualizar refs em docs
Refatoração Windows-only (scrcpy _platform_info, get_data_dir)
    └──requires──> ajustar tests/test_scrcpy.py::test_platform_info_linux
Docs (README, INSTALL.md, LLM.md)
    └──requires──> decisões acima refletidas
```

---

*Features analysis: 2026-08-06*
