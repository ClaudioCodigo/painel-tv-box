"""Script standalone: instala o Magisk em um TV Box de forma automatizada.

Uso (no servidor .219, dentro de C:\PanelTVBox):
  .venv\Scripts\python.exe scripts\magisk_install.py <ip> [--no-reboot] [--apk C:\path\Magisk.apk]

Mesma lógica do endpoint POST /api/devices/{id}/magisk/install, mas sem o
painel — útil para bancada/teste ou quando o painel está fora do ar.

Requer o APK em bin\Magisk.apk (ou --apk). A única interação manual é
aceitar o prompt de root do Magisk no box após o reboot.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.managers.adb import ADBManager  # noqa: E402
from app.models.device import DeviceConfig  # noqa: E402
from app.services.magisk_install import MagiskInstaller  # noqa: E402


def _parse_args(argv):
    ip = None
    reboot = True
    apk = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--no-reboot", "-nr"):
            reboot = False
        elif a in ("--apk", "-a"):
            i += 1
            apk = argv[i]
        elif not a.startswith("-") and ip is None:
            ip = a
        i += 1
    if not ip:
        print(__doc__)
        sys.exit(2)
    return ip, reboot, apk


async def main():
    ip, reboot, apk = _parse_args(sys.argv[1:])
    device = DeviceConfig(id=f"standalone-{ip.replace('.', '-')}", name="Standalone", ip=ip, adb_port=5555)

    async def send_event(ev):
        print(f"[{ev.get('step')}] {ev.get('message')}")

    installer = MagiskInstaller(adb_manager=ADBManager(), apk_path=Path(apk) if apk else None, send_event=send_event)
    result = await installer.install(device, reboot=reboot)
    print("\n=== RESULTADO ===")
    for k, v in result.items():
        print(f"{k}: {v}")
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    asyncio.run(main())
