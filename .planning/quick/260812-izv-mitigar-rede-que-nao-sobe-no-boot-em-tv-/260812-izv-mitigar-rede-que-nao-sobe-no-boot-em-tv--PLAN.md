---
quick_id: "260812-izv-mitigar-rede-que-nao-sobe-no-boot-em-tv-"
title: "Mitigar rede que não sobe no boot em TV boxes Allwinner (netwatch/restart_eth)"
date: "2026-08-12"
status: planned
---

# Mitigar rede que não sobe no boot em TV boxes Allwinner (sunxi-gmac)

## Problema (evidências de um box de teste em 2026-08-12)

Boxes específicos (Allwinner, modelo RO01, driver `sunxi-gmac`) às vezes sobem a
eth com "link fantasma": interface `UP` + `carrier=1` + IP, mas **sem tráfego
real** (nc/ping ao painel falham). O netwatch detecta (via TCP real, não pelo
estado da interface — correto) e tenta recuperar, mas a cascata não resolvia:

1. **`restart_eth.sh` nunca fazia o rebind do driver** — o rebind (equivalente a
   replugar o cabo) era gateado por `carrier != 1`, e o link fantasma tem
   exatamente `carrier=1`. A única estratégia eficaz nunca rodava.
2. **`REBOOT` falhava silenciosamente** — log dizia `REBOOT` mas o box não
   reiniciava (uptime provou boot real só na intervenção manual). `/sbin/su -c
   reboot` não funciona neste firmware/Magisk.
3. **Cooldown baseado em relógio quebrava** — o RTC deriva (2021 / +10h) quando
   sem NTP; `now - last_reboot` virava lixo → tempestade de reboots (a cada
   ~3,5 min no log) com o código antigo.
4. **`restart_wifi` inútil** em box só-Ethernet (wlan0 sem carrier).

## Decisões (usuário, 2026-08-12)

- **Manter reboot como último recurso** (com comando corrigido + cooldown robusto).
- **Sem troca de hardware** — problema conhecido em boxes específicos, já ocorreu
  em produção; objetivo é mitigar via scripts.

## Tarefas

### 1. restart_eth.sh — rebind SEMPRE + verificação real (nc)

- Remover o gate `carrier != 1` que impedia o rebind no link fantasma.
- Cascata: toggle `ip link down/up` → (8s) rebind do driver (`unbind`/`bind` via
  sysfs, driver detectado por readlink) → `ip link set eth0 up` → (2s)
  **verificação real** com `nc` no painel e log do resultado.
- Log próprio `restart_eth.log` com timestamps.

Arquivos: `scripts/android/restart_eth.sh`
Verificação: `sh -n` + review; deploy e teste controlado no box.

### 2. netwatch.sh — reboot funcional + cooldown à prova de relógio

- `_do_reboot`: `setprop sys.powerctl reboot` (root) primeiro — mecanismo que o
  Android respeita; fallback `/sbin/su -c reboot`; fallback `reboot`.
- Cooldown por **contador persistente** `netwatch.reboot_checks` (60 × 30s =
  30 min), imune ao RTC: NET_OK reseta para 60; cada falha ≥ 6 decrementa;
  reboot só quando chega a 0; grava 60 antes do reboot (sobrevive ao boot).
- `restart_wifi` só se `wlan0` existir com carrier (box só-Ethernet pula).
- Re-tenta `restart_eth` a cada 10 falhas (5 min) durante o cooldown.

Arquivos: `scripts/android/netwatch.sh`
Verificação: `sh -n` + review; deploy + restart no box.

### 3. Deploy e validação

- `sh -n` nos dois scripts; review do diff.
- Commit atômico (docs GSD incluídos — `commit_docs: true`).
- Push dos scripts para um box de teste via adb + restart do netwatch; sincronizar o
  repo no servidor do painel (`C:\PanelTVBox`) para o provision distribuir aos boxes.
- Teste controlado (com aprovação do usuário): derrubar a eth no box e ver o
  netwatch recuperar; documentar resultado no SUMMARY.

## Critérios de pronto

- Rebind roda em todo `restart_eth` (sem gate de carrier).
- Log mostra reboot real OU cooldown respeitado (nunca tempestade).
- Scripts passam `sh -n`; deploy no box de teste e servidor feito.
