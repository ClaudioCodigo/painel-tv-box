"""ProvisionService — instala scripts Android nos TV Boxes."""

import logging
import os
from pathlib import Path

from app.models.device import DeviceConfig

logger = logging.getLogger("provision")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts" / "android"
REMOTE_DIR = "/data/local/tmp/panel"

# Scripts que devem ser enviados para o TV Box
MANIFEST = [
    "start_stream.sh",
    "stop_stream.sh",
    "restart_wifi.sh",
    "restart_eth.sh",
    "capture.sh",
    "healthcheck.sh",
    "install_apk.sh",
    "update.sh",
]


class ProvisionService:
    """Gerencia instalação e atualização de scripts nos TV Boxes."""

    def __init__(self, adb_manager=None):
        self.adb = adb_manager

    async def provision(self, device: DeviceConfig) -> dict:
        """Faz push de todos os scripts para o dispositivo.
        Cria diretório remoto, envia scripts, chmod +x.
        """
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        ip = device.ip
        port = device.adb_port
        results = []
        errors = []

        # 1. Cria diretório remoto
        output, code = await self.adb.shell(
            ip, f"mkdir -p {REMOTE_DIR}", port=port, timeout=10
        )
        if code != 0 and "File exists" not in output:
            errors.append(f"mkdir falhou: {output.strip()}")

        # 2. Push de cada script
        for script_name in MANIFEST:
            local_path = SCRIPTS_DIR / script_name
            if not local_path.is_file():
                errors.append(f"script não encontrado: {script_name}")
                continue

            remote_path = f"{REMOTE_DIR}/{script_name}"
            try:
                success = await self.adb.push(ip, str(local_path), remote_path, port=port)
                if success:
                    results.append(script_name)
                else:
                    errors.append(f"push falhou: {script_name}")
            except Exception as e:
                errors.append(f"{script_name}: {e}")

        # 3. chmod +x em todos
        output, code = await self.adb.shell(
            ip, f"chmod +x {REMOTE_DIR}/*.sh", port=port, timeout=10
        )
        if code != 0:
            errors.append(f"chmod falhou: {output.strip()}")

        # 4. Verifica
        output, _ = await self.adb.shell(
            ip, f"ls -la {REMOTE_DIR}/", port=port, timeout=10
        )

        logger.info(
            "Provision %s: %d scripts enviados, %d erros",
            device.id, len(results), len(errors)
        )

        return {
            "success": len(errors) == 0,
            "device_id": device.id,
            "scripts_pushed": results,
            "scripts_count": len(results),
            "errors": errors,
            "remote_ls": output.strip(),
        }

    async def verify(self, device: DeviceConfig) -> dict:
        """Verifica quais scripts existem no dispositivo."""
        if not self.adb:
            return {"success": False, "error": "ADBManager não configurado"}

        output, code = await self.adb.shell(
            device.ip, f"ls {REMOTE_DIR}/ 2>/dev/null || echo 'DIR_NOT_FOUND'",
            port=device.adb_port, timeout=10
        )

        if "DIR_NOT_FOUND" in output or not output.strip():
            return {"provisioned": False, "files": []}

        files = [f.strip() for f in output.strip().split("\n") if f.strip().endswith(".sh")]
        all_present = all(s in files for s in MANIFEST)

        return {
            "provisioned": all_present,
            "files": files,
            "missing": [s for s in MANIFEST if s not in files],
        }
