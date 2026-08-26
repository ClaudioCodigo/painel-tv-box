"""Utilitários de sistema — CPU, RAM, disco, uptime."""

import logging
import os
import re
import time
import unicodedata
from pathlib import Path

logger = logging.getLogger("system")


def get_data_dir() -> Path:
    """Diretório de dados em runtime (backups, screenshots, apks, logs).

    Fora do repositório para que git push/pull não misture dados de máquinas.
    O painel roda apenas em Windows:
      1. Env PANEL_DATA_DIR (se definido);
      2. Windows: %LOCALAPPDATA%/PanelTVBox (default).
    """
    env = os.environ.get("PANEL_DATA_DIR")
    if env:
        return Path(env)

    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "PanelTVBox"


def slugify(text: str) -> str:
    """Converte texto em slug (id seguro para device/group)."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")


SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def is_safe_id(value: str) -> bool:
    """Valida id de device/grupo: só minúsculas, dígitos, . _ - (sem / ou ..)."""
    return bool(SAFE_ID_RE.match(value or ""))


PKG_RE = re.compile(r"^[a-zA-Z0-9._-]+$")


def is_safe_package(value: str) -> bool:
    """Valida package name Android (anti injeção em pm uninstall)."""
    return bool(PKG_RE.match(value or ""))


def is_valid_ipv4(value: str) -> bool:
    """Valida endereço IPv4 (anti SSRF em wizard/validate-device)."""
    try:
        import ipaddress

        ipaddress.IPv4Address(value)
        return True
    except Exception:
        return False


def is_safe_network_target(value: str) -> bool:
    """IP aceitável como alvo de conexão: IPv4 fora de loopback/link-local/multicast."""
    if not is_valid_ipv4(value):
        return False
    import ipaddress

    ip = ipaddress.IPv4Address(value)
    return not (ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified)


def is_safe_rtmp_url(value: str) -> bool:
    """Valida URL RTMP/RTMPS para destinos locais/privados (anti exfiltração de tela)."""
    import urllib.parse

    parsed = urllib.parse.urlparse(value or "")
    if parsed.scheme not in ("rtmp", "rtmps"):
        return False
    host = parsed.hostname or ""
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        import ipaddress

        ip = ipaddress.ip_address(host)
        # privado mas NÃO link-local (169.254.x — metadados cloud) nem multicast
        return ip.is_private and not ip.is_link_local and not ip.is_multicast
    except Exception:
        return False


def is_safe_http_url_local(value: str) -> bool:
    """Valida URL http(s) apontando para localhost/rede privada (anti SSRF)."""
    import urllib.parse

    parsed = urllib.parse.urlparse(value or "")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        import ipaddress

        ip = ipaddress.ip_address(host)
        # privado mas NÃO link-local (169.254.x — metadados cloud) nem multicast
        return ip.is_private and not ip.is_link_local and not ip.is_multicast
    except Exception:
        return False


def get_panel_adb_server_port() -> int | None:
    """Porta do servidor ADB usado pelo painel (e pelo scrcpy).

    Fonte única: env PANEL_ADB_SERVER_PORT (setada pelo serviço/install.ps1)
    ou `adb.server_port` em config/system.yml. O scrcpy usa a MESMA porta —
    assim ele sempre enxerga o device que o painel conectou.
    """
    env_port = os.environ.get("PANEL_ADB_SERVER_PORT", "")
    if env_port.isdigit():
        return int(env_port)
    try:
        import app.main

        cfg = app.main.config
        if cfg and getattr(cfg, "system", None) and getattr(cfg.system, "adb", None):
            sp = getattr(cfg.system.adb, "server_port", None)
            if sp:
                return int(sp)
    except Exception:
        pass
    return None


def get_metrics() -> dict:
    """Retorna métricas do host (CPU, RAM, disco, uptime)."""
    try:
        import psutil
    except ImportError:
        return {
            "cpu_percent": 0,
            "ram_percent": 0,
            "ram_used_gb": 0,
            "ram_total_gb": 0,
            "disk_percent": 0,
            "disk_used_gb": 0,
            "disk_total_gb": 0,
            "uptime_seconds": 0,
            "error": "psutil não instalado",
        }

    # interval=None → retorna a amostra desde a última chamada SEM bloquear o event loop
    cpu = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory()
    drive_root = Path.cwd().anchor or "C:\\"
    disk = psutil.disk_usage(drive_root)

    return {
        "cpu_percent": cpu,
        "ram_percent": ram.percent,
        "ram_used_gb": round(ram.used / (1024**3), 1),
        "ram_total_gb": round(ram.total / (1024**3), 1),
        "disk_percent": disk.percent,
        "disk_used_gb": round(disk.used / (1024**3), 1),
        "disk_total_gb": round(disk.total / (1024**3), 1),
        "uptime_seconds": int(time.time() - psutil.boot_time()),
    }


def find_nssm() -> str | None:
    """Resolve o executável nssm.exe: repo/bin → C:\\PanelTVBox\\bin → PATH.

    Retorna o caminho absoluto ou None se não encontrado.
    """
    import shutil

    candidates = [
        Path(__file__).resolve().parent.parent.parent / "bin" / "nssm.exe",
        Path(r"C:\PanelTVBox\bin\nssm.exe"),
    ]
    for p in candidates:
        if p.is_file():
            return str(p)
    return shutil.which("nssm")


def find_git() -> str | None:
    """Resolve o executável git.exe: PATH → caminhos padrão de instalação do Windows.

    Retorna o caminho absoluto do git.exe ou None se não encontrado.
    """
    import os
    import shutil

    # 1. PATH do processo
    p = shutil.which("git")
    if p:
        return p

    # 2. Caminhos comuns no Windows
    candidates = [
        Path(r"C:\Program Files\Git\cmd\git.exe"),
        Path(r"C:\Program Files\Git\bin\git.exe"),
        Path(r"C:\Program Files (x86)\Git\cmd\git.exe"),
        Path(r"C:\Program Files (x86)\Git\bin\git.exe"),
        Path(r"C:\PanelTVBox\bin\git.exe"),
        Path(r"C:\PanelTVBox\bin\Git\cmd\git.exe"),
    ]

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Programs" / "Git" / "cmd" / "git.exe")
        candidates.append(Path(local_app_data) / "Programs" / "Git" / "bin" / "git.exe")

    program_data = os.environ.get("ProgramData")
    if program_data:
        candidates.append(Path(program_data) / "chocolatey" / "bin" / "git.exe")

    user_profile = os.environ.get("USERPROFILE")
    if user_profile:
        candidates.append(Path(user_profile) / "scoop" / "shims" / "git.exe")

    for cand in candidates:
        if cand.is_file():
            return str(cand)

    return None
