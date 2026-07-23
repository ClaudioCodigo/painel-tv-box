"""UpdateManager — verificação e aplicação de atualizações via git."""

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("update")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class UpdateManager:
    """Gerencia atualização do painel via git pull."""

    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = project_root or PROJECT_ROOT
        self._status = {"checked": False, "has_update": False, "current": "", "remote": "", "error": ""}

    async def check(self) -> dict:
        """Verifica se há atualizações disponíveis via git."""
        try:
            git_dir = self.project_root / ".git"
            if not git_dir.is_dir():
                self._status = {"checked": True, "has_update": False, "error": "Não é um repositório git"}
                return self._status

            # git fetch
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", str(self.project_root), "fetch", "origin",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()

            # git rev-parse HEAD
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", str(self.project_root), "rev-parse", "--short", "HEAD",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            current = stdout.decode().strip()

            # git rev-parse origin/main
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", str(self.project_root), "rev-parse", "--short", "origin/main",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            remote = stdout.decode().strip()

            has_update = current != remote and bool(remote)

            self._status = {
                "checked": True,
                "has_update": has_update,
                "current": current,
                "remote": remote,
                "error": "",
            }
            logger.info("Update check: current=%s remote=%s update=%s", current, remote, has_update)

        except Exception as e:
            self._status["checked"] = True
            self._status["has_update"] = False
            self._status["error"] = str(e)
            logger.warning("Update check falhou: %s", e)

        return self._status

    async def apply(self) -> dict:
        """Aplica atualização: git pull + migração."""
        try:
            # git stash (por segurança)
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", str(self.project_root), "stash",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()

            # git pull
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", str(self.project_root), "pull", "origin", "main",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            output = stdout.decode() + stderr.decode()

            success = proc.returncode == 0

            import app.main

            cm = getattr(app.main, "config", None)
            migrate_msg = ""
            if cm and cm.wizard_completed:
                # Re-load config (migração implícita — YAML é carregado novamente)
                await cm.load()
                migrate_msg = f"Config recarregada: {len(cm.devices)} devices"

            logger.info("Update applied: success=%s", success)
            return {
                "success": success,
                "output": output.strip(),
                "migration": migrate_msg or "nenhuma migração necessária",
            }

        except Exception as e:
            logger.error("Update apply falhou: %s", e)
            return {"success": False, "error": str(e)}

    def get_status(self) -> dict:
        return self._status
