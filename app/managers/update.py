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

    GIT_TIMEOUT = 30  # segundos por comando git

    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = project_root or PROJECT_ROOT
        self._status = {"checked": False, "has_update": False, "current": "", "remote": "", "error": ""}

    async def _run_git(self, *args, timeout: int | None = None) -> tuple[str, str, int]:
        """Executa git com timeout. Retorna (stdout, stderr, returncode)."""
        timeout = timeout or self.GIT_TIMEOUT
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(self.project_root), *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            await proc.wait()
            raise TimeoutError(f"git {' '.join(args)} excedeu {timeout}s")
        return stdout.decode(errors="replace"), stderr.decode(errors="replace"), proc.returncode

    async def check(self) -> dict:
        """Verifica se há atualizações disponíveis via git."""
        try:
            git_dir = self.project_root / ".git"
            if not git_dir.is_dir():
                self._status = {"checked": True, "has_update": False, "error": "Não é um repositório git"}
                return self._status

            # git fetch (com timeout)
            await self._run_git("fetch", "origin")

            # git rev-parse HEAD
            out, _, _ = await self._run_git("rev-parse", "--short", "HEAD")
            current = out.strip()

            # git rev-parse origin/main
            out, _, _ = await self._run_git("rev-parse", "--short", "origin/main")
            remote = out.strip()

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
            # git stash (por segurança — mudanças locais ficam guardadas)
            await self._run_git("stash")

            # git pull (com timeout)
            out, err, code = await self._run_git("pull", "origin", "main")
            output = (out + err).strip()

            success = code == 0

            import app.main

            cm = getattr(app.main, "config", None)
            migrate_msg = ""
            if cm and cm.wizard_completed:
                # Re-load config (migração implícita — YAML é carregado novamente)
                await cm.load()
                # Regenera o mediamtx.generated.yml com os paths atuais
                cm.generate_mediamtx_yml()
                migrate_msg = f"Config recarregada: {len(cm.devices)} devices"

            logger.info("Update applied: success=%s", success)
            return {
                "success": success,
                "output": output,
                "migration": migrate_msg or "nenhuma migração necessária",
            }

        except Exception as e:
            logger.error("Update apply falhou: %s", e)
            return {"success": False, "error": str(e)}

    def get_status(self) -> dict:
        return self._status
