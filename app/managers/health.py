"""HealthManager — health check multi-camada por dispositivo."""

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Optional

from app.models.device import DeviceConfig
from app.managers.scrcpy import ScrcpyManager

logger = logging.getLogger("health")

# Anti-spam ADB: quando o ping falha (device fora da rede), não martela
# `adb connect`+shell a cada ciclo do watchdog — tenta ADB no máximo 1× a
# cada intervalo. O `adb connect` para IP inalcançável demora até o timeout
# e congestiona o servidor ADB 5038 compartilhado com os outros boxes.
ADB_TRY_COOLDOWN = 60  # s


class HealthManager:
    """Realiza health check multi-camada em dispositivos."""

    def __init__(self, adb_manager=None, mediamtx_manager=None, players_config=None, heartbeat_timeout: int = 60):
        self.adb = adb_manager
        self.mediamtx = mediamtx_manager
        self.players_config = players_config
        self.heartbeat_timeout = heartbeat_timeout  # s; heartbeat fresco = device na rede
        # Cache de último status bem-sucedido por device
        self._last_good: dict[str, datetime] = {}
        # Anti-spam ADB: último momento em que tentamos ADB para um device
        self._last_adb_try: dict[str, float] = {}

    async def check(self, device: DeviceConfig) -> dict:
        """Executa verificação completa e retorna resultado com status."""
        results = {
            "device_id": device.id,
            "ping": False,
            "adb": False,
            "activity": None,
            "mediamtx_path": False,
            "player_ok": None,
            "status": "unknown",
            "error": None,
        }
        target = f"{device.ip}:{device.adb_port}"
        scrcpy_active = ScrcpyManager.is_device_active(target)
        results["scrcpy_active"] = scrcpy_active

        # Heartbeat fresco = device na rede SEM tocar em ADB (spec docs/09 §3.3)
        heartbeat_fresh = False
        if device.state.last_heartbeat:
            elapsed = (datetime.now() - device.state.last_heartbeat).total_seconds()
            heartbeat_fresh = elapsed < self.heartbeat_timeout
        results["heartbeat_fresh"] = heartbeat_fresh

        # 1. Ping (informativo, NÃO usado para determinar offline)
        try:
            ping_args = ["-n", "1", "-w", "1000", device.ip] if os.name == "nt" else ["-c", "1", "-W", "1", device.ip]
            proc = await asyncio.create_subprocess_exec(
                "ping", *ping_args,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            code = await proc.wait()
            results["ping"] = code == 0
        except Exception:
            results["ping"] = False

        # 2. ADB — pulado quando o device está claramente na rede (regra ADB×scrcpy):
        #    scrcpy ativo, heartbeat fresco OU ping OK. ICMP não usa ADB → não derruba o scrcpy.
        adb_ok = False
        if scrcpy_active:
            adb_ok = True
            results["adb"] = True
            results["adb_checked"] = False
            results["adb_skipped"] = "scrcpy"
            logger.debug("Health check pulou ADB shell para %s — scrcpy ativo", device.id)
        elif heartbeat_fresh:
            adb_ok = True
            results["adb"] = True
            results["adb_checked"] = False
            results["adb_skipped"] = "heartbeat"
            logger.debug("Health check pulou ADB shell para %s — heartbeat fresco", device.id)
        elif results["ping"]:
            adb_ok = True
            results["adb"] = True
            results["adb_checked"] = False
            results["adb_skipped"] = "ping"
            logger.debug("Health check pulou ADB shell para %s — ping OK (sem ADB spam)", device.id)
        else:
            # Ping falhou → device provavelmente fora da rede. Anti-spam:
            # só tenta ADB de tempos em tempos (connect para IP morto é lento
            # e congestiona o servidor ADB 5038 compartilhado).
            now_mono = time.monotonic()
            last_try = self._last_adb_try.get(device.id, 0)
            if now_mono - last_try < ADB_TRY_COOLDOWN:
                results["adb"] = False
                results["adb_checked"] = False
                results["adb_skipped"] = "cooldown"
                logger.debug("Health check pulou ADB shell para %s — cooldown anti-spam", device.id)
            else:
                self._last_adb_try[device.id] = now_mono
                for attempt in range(2):
                    if self.adb:
                        try:
                            output, code = await self.adb.shell(device.ip, "echo ok", port=device.adb_port, timeout=5)
                            if code == 0 and "ok" in output.lower():
                                adb_ok = True
                                break
                        except Exception:
                            pass
                    if not adb_ok and attempt == 0:
                        await asyncio.sleep(2)  # espera 2s antes de retry
                results["adb"] = adb_ok
                results["adb_checked"] = True

        # 3. Determina status
        if not adb_ok:
            # ADB falhou após 2 tentativas
            last_good = self._last_good.get(device.id)
            if last_good and (datetime.now() - last_good).total_seconds() < 60:
                results["status"] = "degraded"
                results["reason"] = "Conexão instável"
                results["error"] = "adb_transient_fail"
                logger.debug("ADB falhou para %s, mas estava OK há %ds — mantendo degraded",
                             device.id, (datetime.now() - last_good).total_seconds())
                return results

            results["status"] = "offline"
            results["reason"] = "Desconectado"
            results["error"] = "adb_failed"
            return results

        # ADB OK — marca como último bom
        self._last_good[device.id] = datetime.now()

        # 4. Activity check. Zero ADB enquanto scrcpy ativo ou heartbeat fresco
        #    (a activity chega via heartbeat; dumpsys só no fallback ADB).
        if scrcpy_active or heartbeat_fresh:
            results["activity"] = device.state.current_activity or ""
            if scrcpy_active:
                logger.debug("Activity check pulado para %s: scrcpy ativo em %s", device.id, target)
            else:
                logger.debug("Activity check pulado para %s: heartbeat fresco", device.id)
        else:
            try:
                output, _ = await self.adb.shell(
                    device.ip,
                    "dumpsys activity activities 2>/dev/null | grep -i ResumedActivity | head -1",
                    port=device.adb_port,
                    timeout=5,
                )
                results["activity"] = output.strip() if output and "ResumedActivity" in output else ""
            except Exception:
                results["activity"] = ""

        # 5. MediaMTX path — readers indicam stream ativa (apenas se mode == "stream")
        device_mode = getattr(device, "mode", "stream")
        results["mode"] = device_mode

        if device_mode == "web":
            # Web Signage: verifica ping WebSocket do wrapper HTML
            signage_fresh = False
            if device.state.last_signage_ping:
                elapsed_signage = (datetime.now() - device.state.last_signage_ping).total_seconds()
                signage_fresh = elapsed_signage < 30
            results["signage_fresh"] = signage_fresh

            browser_pkg = getattr(device, "web_browser", "chrome")
            act_lower = (results["activity"] or "").lower()
            results["player_ok"] = signage_fresh or ("chrome" in act_lower or "browser" in act_lower or browser_pkg in act_lower)
        else:
            if self.mediamtx:
                try:
                    paths_resp = await self.mediamtx.list_paths()
                    if paths_resp.get("success"):
                        items = paths_resp.get("data", {}).get("items", [])
                        for p in items:
                            if p.get("name") == device.rtsp_path:
                                results["mediamtx_path"] = p.get("ready", False) or p.get("online", False)
                                results["tracks"] = len(p.get("tracks", []))
                                results["readers"] = len(p.get("readers", []))
                                results["stream_active"] = results["readers"] > 0
                                break
                except Exception as e:
                    logger.warning("MediaMTX check failed for %s: %s", device.id, e)

            # 6. Player OK?
            if results.get("stream_active"):
                results["player_ok"] = True
            elif results["activity"] and device.player:
                results["player_ok"] = device.player in results["activity"].lower()

        # 7. Resolve status final
        results["status"], results["reason"] = self._resolve_status(results)
        return results

    def _resolve_status(self, r: dict) -> tuple[str, str]:
        """Retorna (status, motivo).
        Prioridade: Web Signage ping / readers MediaMTX > activity Android.
        """
        adb = r["adb"]
        if not adb:
            return ("offline", "Desconectado")

        if r.get("mode") == "web":
            if r.get("signage_fresh"):
                return ("online", "Página web ativa ✅")
            if r.get("activity"):
                return ("degraded", "Browser aberto mas página sem resposta")
            return ("degraded", "Browser fechado")

        readers = r.get("readers", 0)
        mtx_ready = r.get("mediamtx_path", False)
        act = r.get("activity", "") != ""

        # Stream com leitores → online
        if readers > 0 and mtx_ready:
            return ("online", "Stream ativa ✅")

        # Stream publicada mas sem leitores → exibindo status correto
        if mtx_ready:
            return ("degraded", "Sem stream ativa")

        if act:
            return ("degraded", "Player offline")

        return ("degraded", "Sem stream ativa")
