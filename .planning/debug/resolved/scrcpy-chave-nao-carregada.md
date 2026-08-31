---
status: resolved
trigger: "Launcher scrcpy retorna failed to authenticate e device unauthorized após matrícula RSA"
created: "2026-08-31"
updated: "2026-08-31"
---

# Debug: scrcpy chave não carregada

## Symptoms

- expected: launcher usar a chave local já matriculada e abrir o scrcpy sem confirmação física.
- actual: `adb connect` informa `failed to authenticate`; scrcpy encontra o device como `unauthorized`.
- errors: `ERROR: Device is unauthorized` e `Server connection failed`.
- timeline: primeira UAT após a implementação da matrícula por chave individual.
- reproduction: extrair o bundle, executar o `.bat` e conectar ao box `192.168.254.84:5555`.

## Current Focus

- hypothesis: confirmada — `ADB_VENDOR_KEYS` apontava para o diretório e o ADB não carregava o arquivo `adbkey` durante a varredura de vendor keys.
- test: teste de regressão exige o caminho completo `credencial\adbkey` e uma verificação real por `adb get-state`.
- expecting: atendido no launcher gerado; UAT deve reutilizar a chave já matriculada.
- next_action: baixar novo bundle e repetir UAT no box `.84`.

## Evidence

- timestamp: 2026-08-31
  observation: o log não contém "Matriculando este computador", logo `.matriculado` já existia.
- timestamp: 2026-08-31
  observation: o launcher define `ADB_VENDOR_KEYS` como `%~dp0credencial`, enquanto a chave privada se chama `adbkey`.
- timestamp: 2026-08-31
  observation: AOSP carrega caminho de arquivo diretamente; ao varrer diretório de vendor keys, filtra nomes com sufixo `.adb_key`.
- timestamp: 2026-08-31
  observation: `adb connect` pode encerrar com código zero mesmo contendo `failed to authenticate`, então o teste atual de `%errorlevel%` não bloqueia o scrcpy.

## Eliminated

- hypothesis: o pacote não gerou chave local.
  reason: a pasta `credencial` e o marcador são reconhecidos pelo launcher; o fluxo pulou matrícula deliberadamente.

## Resolution

- root_cause: `ADB_VENDOR_KEYS` recebeu a pasta `credencial`; o arquivo privado dentro dela se chama `adbkey`, não corresponde ao filtro de arquivos de vendor key aplicado quando o ADB varre um diretório, e portanto não era carregado. O launcher também confiava no exit code de `adb connect`, que pode ser zero mesmo com falha de autenticação.
- fix: apontar `ADB_VENDOR_KEYS` diretamente para `credencial\adbkey`; validar `adb -s <target> get-state` igual a `device`; remover o marcador local em falha para permitir nova matrícula por um pacote recém-baixado.
- verification: teste de regressão falhou antes da correção e passou depois; suíte completa com 183 testes; `node --check` passou.
- files_changed: `app/api/client_bundle.py`, `tests/test_client_bundle.py`
