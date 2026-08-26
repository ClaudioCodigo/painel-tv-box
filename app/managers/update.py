"""UpdateManager — verificação, aplicação e rollback seguro de atualizações via git."""

import asyncio
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import shutil
import sys
import time
from typing import Optional

logger = logging.getLogger("update")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class UpdateManager:
    """Gerencia atualização segura do painel via git pull com backup, validação e restart."""

    GIT_TIMEOUT = 30  # segundos por comando git

    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = project_root or PROJECT_ROOT
        self._lock = asyncio.Lock()
        self._status = {
            "checked": False,
            "has_update": False,
            "current": "",
            "remote": "",
            "error": "",
            "changelog": [],
            "backup_path": "",
            "last_applied": "",
        }

    async def _run_git(self, *args, timeout: int | None = None) -> tuple[str, str, int]:
        """Executa git com timeout. Retorna (stdout, stderr, returncode)."""
        timeout = timeout or self.GIT_TIMEOUT
        from app.utils.system import find_git

        git_bin = find_git() or "git"
        try:
            proc = await asyncio.create_subprocess_exec(
                git_bin, "-C", str(self.project_root), *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            raise FileNotFoundError(
                "Git não encontrado no sistema. Instale o Git para Windows (https://git-scm.com) ou adicione ao PATH."
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
        """Verifica se há atualizações disponíveis via git e extrai changelog."""
        async with self._lock:
            try:
                from app.utils.system import find_git

                if not find_git():
                    self._status = {
                        "checked": True,
                        "has_update": False,
                        "current": "",
                        "remote": "",
                        "error": "Git não encontrado no servidor. Instale o Git para Windows (https://git-scm.com) ou adicione ao PATH.",
                        "changelog": [],
                        "backup_path": self._status.get("backup_path", ""),
                        "last_applied": self._status.get("last_applied", ""),
                    }
                    return self._status

                git_dir = self.project_root / ".git"
                if not git_dir.is_dir():
                    self._status = {
                        "checked": True,
                        "has_update": False,
                        "current": "",
                        "remote": "",
                        "error": "Não é um repositório git (.git ausente)",
                        "changelog": [],
                        "backup_path": self._status.get("backup_path", ""),
                        "last_applied": self._status.get("last_applied", ""),
                    }
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
                changelog = []

                if has_update:
                    log_out, _, _ = await self._run_git(
                        "log", "HEAD..origin/main", "--oneline", "--no-merges", "-n", "20"
                    )
                    changelog = [line.strip() for line in log_out.strip().splitlines() if line.strip()]

                self._status = {
                    "checked": True,
                    "has_update": has_update,
                    "current": current,
                    "remote": remote,
                    "error": "",
                    "changelog": changelog,
                    "backup_path": self._status.get("backup_path", ""),
                    "last_applied": self._status.get("last_applied", ""),
                }
                logger.info("Update check: current=%s remote=%s update=%s commits=%d", current, remote, has_update, len(changelog))

            except Exception as e:
                self._status["checked"] = True
                self._status["has_update"] = False
                self._status["error"] = str(e)
                logger.warning("Update check falhou: %s", e)

            return self._status

    async def apply(self) -> dict:
        """Aplica atualização: backup de config -> git pull -> validação -> migração -> agendamento de restart."""
        async with self._lock:
            try:
                # 1. Backup de segurança das configurações locais
                backup_dir = self.project_root / "backups" / f"pre-update-{int(time.time())}"
                config_dir = self.project_root / "config"
                if config_dir.is_dir():
                    backup_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(config_dir, backup_dir / "config", dirs_exist_ok=True)
                    self._status["backup_path"] = str(backup_dir)
                    logger.info("Backup pré-update salvo em %s", backup_dir)

                # 2. git stash (guarda alterações locais não commitadas)
                await self._run_git("stash")

                # 3. git pull origin main
                out, err, code = await self._run_git("pull", "origin", "main")
                output = (out + err).strip()

                if code != 0:
                    # Rollback imediato do git
                    await self._run_git("reset", "--hard", "HEAD")
                    return {
                        "success": False,
                        "error": f"git pull falhou: {output}",
                        "rolled_back": True,
                    }

                # 4. Validação pós-update (integridade do código)
                validation = await self._validate_post_update()
                if not validation.get("ok"):
                    logger.error("Validação pós-update falhou: %s. Revertendo commit...", validation.get("error"))
                    await self._run_git("reset", "--hard", "HEAD~1")
                    if backup_dir.is_dir() and (backup_dir / "config").is_dir():
                        shutil.copytree(backup_dir / "config", config_dir, dirs_exist_ok=True)
                    return {
                        "success": False,
                        "error": f"Validação falhou ({validation.get('error')}) — rollback realizado com sucesso",
                        "rolled_back": True,
                    }

                # 5. Recarregamento de configurações e MediaMTX
                import app.main

                cm = getattr(app.main, "config", None)
                migrate_msg = ""
                if cm and cm.wizard_completed:
                    await cm.load()
                    cm.generate_mediamtx_yml()
                    migrate_msg = f"Config recarregada: {len(cm.devices)} devices"

                # 6. Agendar restart do serviço se NSSM estiver presente
                restart_msg = await self._schedule_restart()

                self._status["last_applied"] = datetime.now(timezone.utc).isoformat()
                self._status["has_update"] = False
                self._status["changelog"] = []

                logger.info("Update aplicado com sucesso: %s", output)
                return {
                    "success": True,
                    "output": output,
                    "migration": migrate_msg or "nenhuma migração necessária",
                    "backup": str(backup_dir),
                    "restart": restart_msg,
                }

            except Exception as e:
                logger.error("Update apply falhou: %s", e)
                return {"success": False, "error": str(e)}

    async def rollback(self) -> dict:
        """Rollback manual: reseta para o commit anterior (HEAD~1) e restaura backup."""
        async with self._lock:
            try:
                out, err, code = await self._run_git("reset", "--hard", "HEAD~1")
                output = (out + err).strip()
                if code != 0:
                    return {"success": False, "error": f"git reset falhou: {output}"}

                backup_path = self._status.get("backup_path")
                if backup_path and Path(backup_path).is_dir():
                    config_backup = Path(backup_path) / "config"
                    if config_backup.is_dir():
                        shutil.copytree(config_backup, self.project_root / "config", dirs_exist_ok=True)

                restart_msg = await self._schedule_restart()
                return {"success": True, "output": output, "restart": restart_msg}
            except Exception as e:
                logger.error("Rollback falhou: %s", e)
                return {"success": False, "error": str(e)}

    async def _validate_post_update(self) -> dict:
        """Verifica integridade do código após git pull executando import teste."""
        main_py = self.project_root / "app" / "main.py"
        if not main_py.is_file():
            return {"ok": False, "error": "app/main.py ausente"}

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-c", "import app.main",
                cwd=str(self.project_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
            if proc.returncode != 0:
                err = stderr.decode(errors="replace")[:400]
                return {"ok": False, "error": f"Import test falhou (code {proc.returncode}): {err}"}
            return {"ok": True}
        except asyncio.TimeoutError:
            return {"ok": False, "error": "Import test excedeu timeout de 15s"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _schedule_restart(self) -> str:
        """Agenda reinício do serviço Windows via NSSM se disponível."""
        from app.utils.system import find_nssm

        nssm = find_nssm()
        if not nssm:
            return "NSSM não encontrado — reinicie manualmente se necessário"

        async def _restart_delayed():
            await asyncio.sleep(2)
            try:
                logger.info("Executando reinício do serviço panel-tvbox via NSSM...")
                proc = await asyncio.create_subprocess_exec(
                    nssm, "restart", "panel-tvbox",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await asyncio.wait_for(proc.wait(), timeout=15)
            except Exception as e:
                logger.warning("Falha no restart agendado via NSSM: %s", e)

        asyncio.create_task(_restart_delayed())
        return "Serviço panel-tvbox será reiniciado em ~2s"

    def get_status(self) -> dict:
        return self._status

    def get_changelog(self) -> list[str]:
        return self._status.get("changelog", [])
