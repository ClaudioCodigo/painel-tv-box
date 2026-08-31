---
quick_id: "260831-m6z"
status: complete
date: "2026-08-31"
commit: "5ecd9a5"
---

# Resumo — cliente scrcpy instalado uma vez e revogação visual

## Entregue

- Pacote único por estação Windows com `scrcpy`, ADB e instalador de duplo clique.
- Instalação no perfil do usuário em `%LOCALAPPDATA%`, sem administrador e sem processo residente.
- Protocolo `paineltvbox://` registrado em HKCU para o botão **Start** abrir o cliente local.
- Ticket de abertura autenticado, vinculado ao TV Box, com 60 segundos, finalidade separada e uso único.
- Autorização automática da chave pública na primeira abertura de cada box; a chave privada nunca sai da estação.
- Espera automática pelo reinício do `adbd` somente quando uma nova autorização é criada.
- Tela **Estações autorizadas** com fingerprint e revogação por TV Box ou de todos os vínculos da estação.
- Fluxo antigo por bundle específico preservado para compatibilidade.

## Validação

- Testes focados: 22 passed.
- Suíte completa: 188 passed.
- `node --check static/js/*.js`: passou.
- `git diff --check`: passou; apenas avisos esperados de LF/CRLF no Windows.

## Uso operacional

Na primeira vez em cada computador, baixar **Instalar cliente neste PC**, extrair e executar
`instalar-cliente.bat`. Depois disso, basta selecionar o TV Box e pressionar **Start** no painel.
