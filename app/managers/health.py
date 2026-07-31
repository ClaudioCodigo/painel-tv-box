"""HealthManager — health check multi-camada por dispositivo."""

import asyncio
import logging
import os
from datetime import datetime
from typing import Optional

from app.models.device import DeviceConfig
from app.managers.scrcpy import ScrcpyManager

logger = logging.getLogger("health")


class HealthManager:
    """Realiza health check multi-camada em dispositivos."""

    def __init__(self, adb_manager=None, mediamtx_manager=None, players_config=None, heartbeat_timeout: int = 60):
        self.adb = adb_manager
        self.mediamtx = mediamtx_manager
        self.players_config = players_config
        self.heartbeat_timeout = heartbeat_timeout  # s; heartbeat fresco = device na rede
        # Cache de último status bem-sucedido por device
        self._last_good: dict[str, datetime] = {}

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

        # 2. ADB — tenta 2 vezes (scrcpy pode estar usando a conexão)
        adb_ok = False
        if scrcpy_active:
            # scrcpy já confirmou ADB OK — pula shell check pra não causar ConnectionReset
            adb_ok = True
            results["adb"] = True
            results["adb_skipped_for_scrcpy"] = True
            logger.debug("Health check pulou ADB shell para %s — scrcpy ativo", device.id)
        elif heartbeat_fresh:
            # Heartbeat recente prova que o device está na rede — zero ADB (regra §3.3)
            adb_ok = True
            results["adb"] = True
            results["adb_skipped_for_heartbeat"] = True
            logger.debug("Health check pulou ADB shell para %s — heartbeat fresco", device.id)
        else:
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

        # 4. Activity check. Evita um segundo adb shell enquanto scrcpy está ativo
        #    ou quando a activity já chegou via heartbeat (sem ADB).
        if scrcpy_active:
            results["activity"] = device.state.current_activity or ""
            logger.debug("Activity check pulado para %s: scrcpy ativo em %s", device.id, target)
        elif heartbeat_fresh and device.state.current_activity:
            results["activity"] = device.state.current_activity
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

        # 5. MediaMTX path — readers indicam stream ativa
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
        Prioridade: readers MediaMTX > activity Android > mediamtx_path.
        """
        adb = r["adb"]
        readers = r.get("readers", 0)
        mtx_ready = r.get("mediamtx_path", False)
        act = r.get("activity", "") != ""

        if not adb:
            return ("offline", "Desconectado")

        # Stream com leitores → online
        if readers > 0 and mtx_ready:
            return ("online", "Stream ativa ✅")

        # Stream publicada mas sem leitores → exibindo status correto
        if mtx_ready:
            return ("degraded", "Sem stream ativa")

        if act:
            return ("degraded", "Player offline")

        return ("degraded", "Sem stream ativa")
