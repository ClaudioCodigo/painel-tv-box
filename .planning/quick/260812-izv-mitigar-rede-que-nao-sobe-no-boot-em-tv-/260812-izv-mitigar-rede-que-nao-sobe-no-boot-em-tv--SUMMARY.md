---
quick_id: "260812-izv-mitigar-rede-que-nao-sobe-no-boot-em-tv-"
title: "Mitigar rede que não sobe no boot em TV boxes Allwinner (netwatch/restart_eth)"
date: "2026-08-12"
status: complete
---

# SUMMARY — Mitigar rede que não sobe no boot em TV boxes Allwinner

## O que foi feito

Fixes em `scripts/android/netwatch.sh` e `scripts/android/restart_eth.sh` para
recuperar a rede em boxes Allwinner (sunxi-gmac, ex.: modelo RO01/.84) que às
vezes sobem com "link fantasma" (eth UP + carrier=1 + IP, sem tráfego real).

### Causas raiz encontradas (evidências do box .84 em 2026-08-12)

1. **`restart_eth.sh` nunca fazia o rebind** — gate em `carrier != 1`, mas o link
   fantasma reporta `carrier=1`. A única estratégia eficaz (equivalente a
   replugar o cabo) nunca rodava.
2. **`REBOOT` falhava silenciosamente** — log dizia `REBOOT` mas o box não
   reiniciava (uptime provou). `/sbin/su -c reboot` não funciona neste
   firmware/Magisk.
3. **Cooldown por relógio quebrado** — RTC deriva sem NTP (log mostrava 2021 e
   -20 min no mesmo dia); `now - last_reboot` virava lixo → tempestade de
   reboots (a cada ~3,5 min no log antigo).
4. **`restart_wifi` inútil** em box só-Ethernet (wlan0 sem carrier).

### Correções

- `restart_eth.sh`: rebind SEMPRE (sem gate de carrier) + verificação real via
  `nc` no painel + log próprio `restart_eth.log`.
- `netwatch.sh`:
  - reboot funcional: `setprop sys.powerctl reboot` (root) → fallback
    `/sbin/su -c reboot` → fallback `reboot`;
  - cooldown por **contador persistente** `netwatch.reboot_checks` (60×30s =
    30 min), imune ao RTC; NET_OK reseta; reboot só ao zerar;
  - `restart_wifi` só se `wlan0` com carrier;
  - re-tentativa de `restart_eth` a cada 10 falhas durante o cooldown.

## Validação

- `sh -n` nos dois scripts + simulação local do quoting aninhado do
  `restart_eth.sh` (script interno gerado validado com `sh -n`).
- Deploy no box `.84`: scripts push (13:44) + netwatch reiniciado (PID 26376,
  contador = 60 → checagem OK).
- Servidor `.219`: `git pull` em `C:\PanelTVBox` → `a4f5a05` (provision
  distribuirá aos demais boxes).
- Commit `a4f5a05` publicado no GitHub (origin main).
- **Teste de mecanismo no .84 (13:57):** `restart_eth.sh` manual → log provou
  o rebind executando (`rebind sunxi-gmac/gmac1`) e conectividade real de volta
  em ~11s (`OK, rede voltou apos toggle+rebind`, nc RC=0), VLC continuou ativo.
  O rebind — a peça que nunca rodava — funciona neste hardware.

## Observações / pendências

- **Bug de boot REPLICADO (18:23):** o box bootou com link fantasma e o netwatch
  NÃO recuperou — causa encontrada: o `adb push` manual das 13:44 removeu o bit
  `+x` do netwatch.sh e o boot hook checava `[ -x ]` → netwatch nunca iniciou no
  boot (boot_hook.log provou: só heartbeat subiu). Usuário replugou o cabo.
  **Corrigido:** boot hook agora usa `[ -f ]` + `sh` (não depende do +x) — commit
  `f7099d2`. O provision normal faz chmod +x; o bug era só do push manual.
- **Evidência do dmesg (boot 18:23):** NENHUM "Link is Up" do sunxi-gmac no boot
  (só o do replug às 308s) — o PHY não negocia no boot quando o bug ocorre.
- **RTC em UTC preso em 2021-06-26 ~02:00** = "23:00" no fuso -03 — sintoma de
  boot sem NTP, não causa. Logado nos diags para correlação.
- **Sem default route mesmo com rede OK** — stack de rede do Android incompleto
  (provável elo com o bug); o box alcança só a LAN.
- **Logging novo (diag.sh):** snapshot completo (relógio+RTC, eth, rotas, ARP,
  stats, dmesg, logcat) antes de restart_eth/reboot + captura de boot via boot
  hook; NET_DOWN agora loga clock+carrier. Rotação: últimos 5.
- **Próxima ocorrência:** boot hook inicia netwatch sempre (resiliente) →
  fail=4 → snapshot + restart_eth (rebind ~11s, validado às 13:57) → deve
  recuperar SEM intervenção; diag files em /data/local/tmp/panel/diag/.
- O box .84 não tem default route (só rota /24) mesmo com rede OK — sintoma do
  stack de rede incompleto do firmware; não bloqueia o acesso ao painel (mesma
  sub-rede).
- Relógio do box deriva sem NTP (RTC fraco) — o contador de cooldown elimina a
  dependência; considerar sincronizar data no heartbeat se necessário no futuro.
