---
quick_id: "260831-k17"
status: passed
verified_at: "2026-08-31"
commit: "2f2a200"
---

# Verificação

## Resultado

PASSED — o MVP satisfaz os `must_haves` do plano.

## Evidências

| Requisito | Evidência | Resultado |
|-----------|----------|-----------|
| Privada somente no cliente | `matricular.ps1` executa `adb keygen`; payload contém apenas `public_key`; ZIP não contém `adbkey` | PASS |
| Token curto e descartável | `EnrollmentStore.issue_token/consume_token`; vínculo a `device_id`; hash SHA-256; TTL 10 min | PASS |
| Cadastro/revogação via root | `ADBKeyProvisioner.install/revoke`; ADB push + comando estático `su -c`; reload do `adbd` | PASS |
| Launcher usa chave explícita | `ADB_VENDOR_KEYS` aponta para `credencial/` antes de iniciar o servidor ADB e o scrcpy | PASS |
| Sem regressão | 183 testes pytest e validação JS concluídos | PASS |

## Verificação humana pendente

O comportamento real de `su`, permissões/SELinux e `setprop ctl.restart adbd` deve ser exercitado em pelo menos um modelo de TV Box com Magisk antes da distribuição geral. Isso é UAT de hardware, não uma lacuna detectada na implementação.
