"""API routes para geração e download do bundle scrcpy client-side."""

import io
from pathlib import Path
import re
import shutil
import zipfile

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from app.managers.scrcpy import ScrcpyManager
from app.utils.system import is_safe_id

router = APIRouter(prefix="/api/scrcpy/client", tags=["scrcpy-client"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _safe_filename(name: str) -> str:
    """Sanitiza string para uso seguro em nomes de arquivo."""
    s = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", name or "device")
    return s.strip("_") or "device"


def _generate_launcher(ip: str, port: int, name: str) -> str:
    """Gera o script .bat para execução com duplo-clique no cliente."""
    return f"""@echo off
chcp 65001 >nul
title scrcpy - {name} ({ip}:{port})
echo =======================================================
echo   Painel TV Box - scrcpy Launcher Local
echo   Dispositivo : {name}
echo   Endereco    : {ip}:{port}
echo =======================================================
echo.
cd /d "%~dp0"
echo Conectando ao TV Box via ADB...
scrcpy\\adb.exe connect {ip}:{port}
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Nao foi possivel conectar ao TV Box no endereco {ip}:{port}.
    echo Verifique se o TV Box esta ligado e na mesma rede que este computador.
    echo.
    pause
    exit /b 1
)
echo.
echo Iniciando espelhamento scrcpy...
echo Dica: Use Alt+F para tela cheia e Alt+O para desligar a tela do TV Box.
echo.
scrcpy\\scrcpy.exe -s {ip}:{port} --max-size=1024
echo.
echo Sessao do scrcpy encerrada.
pause
"""


def _generate_readme(name: str, ip: str, port: int) -> str:
    """Gera o arquivo de instruções README.txt."""
    return f"""===========================================================
  PAINEL TV BOX - INSTRUCOES DO SCRCPY CLIENT-SIDE
===========================================================

Dispositivo : {name}
Endereco    : {ip}:{port}

COMO USAR:
1. Extraia todo o conteudo deste arquivo ZIP em uma pasta do seu computador.
2. De um duplo-clique no arquivo "iniciar-{_safe_filename(name)}.bat".
3. O script conectara automaticamente ao TV Box e abrira a tela na sua maquina.

REQUISITOS:
- Seu computador deve estar conectado na mesma rede local que o TV Box ({ip}).
- Nao e necessario instalar nada adicional; todos os executaveis estao incluidos na pasta scrcpy/.

ATALHOS UTEIS:
- Alt + F : Alternar tela cheia
- Alt + O : Desligar a tela física do TV Box (mantém transmitindo)
- Alt + S : Tirar screenshot
- Alt + P : Ligar/desligar tela
- Botao direito do mouse : Voltar (Back do Android)
- Botao do meio do mouse : Home do Android
"""


@router.get("/bundle/{device_id}")
async def get_client_bundle(device_id: str):
    """Gera e entrega arquivo ZIP com scrcpy + adb + launcher.bat para o operador."""
    if not is_safe_id(device_id):
        raise HTTPException(400, "ID de dispositivo inválido")

    import app.main

    cfg = getattr(app.main, "config", None)
    if not cfg:
        raise HTTPException(500, "Configuração do painel não disponível")

    device = cfg.get_device(device_id)
    if not device:
        raise HTTPException(404, f"Dispositivo '{device_id}' não encontrado")

    mgr = ScrcpyManager()
    scrcpy_dir = mgr.get_active_dir()
    if not scrcpy_dir or not scrcpy_dir.is_dir():
        raise HTTPException(
            500,
            "scrcpy não instalado no servidor — instale uma versão na aba 'scrcpy' antes de baixar o bundle",
        )

    safe_name = _safe_filename(device.name or device.id)
    launcher_content = _generate_launcher(device.ip, device.adb_port, device.name or device.id)
    readme_content = _generate_readme(device.name or device.id, device.ip, device.adb_port)

    # Cria ZIP em memória
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Adiciona todos os arquivos do scrcpy
        for f in scrcpy_dir.rglob("*"):
            if f.is_file():
                arcname = f"scrcpy/{f.relative_to(scrcpy_dir)}"
                zf.write(f, arcname)

        # 2. Garante que adb.exe está incluído se não estava dentro da pasta do scrcpy
        has_adb = (scrcpy_dir / "adb.exe").is_file()
        if not has_adb:
            adb_sys = shutil.which("adb")
            if adb_sys:
                adb_path = Path(adb_sys)
                zf.write(adb_path, "scrcpy/adb.exe")
                # Copia DLLs irmãs se existirem (AdbWinApi.dll, etc.)
                for dll in adb_path.parent.glob("*.dll"):
                    zf.write(dll, f"scrcpy/{dll.name}")

        # 3. Adiciona launcher.bat e README.txt na raiz do ZIP
        zf.writestr(f"iniciar-{safe_name}.bat", launcher_content.encode("utf-8"))
        zf.writestr("README.txt", readme_content.encode("utf-8"))

    zip_buffer.seek(0)
    filename = f"scrcpy-{safe_name}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/launcher/{device_id}")
async def get_client_launcher(device_id: str):
    """Gera apenas o arquivo launcher .bat para um dispositivo."""
    if not is_safe_id(device_id):
        raise HTTPException(400, "ID de dispositivo inválido")

    import app.main

    cfg = getattr(app.main, "config", None)
    if not cfg:
        raise HTTPException(500, "Configuração do painel não disponível")

    device = cfg.get_device(device_id)
    if not device:
        raise HTTPException(404, f"Dispositivo '{device_id}' não encontrado")

    safe_name = _safe_filename(device.name or device.id)
    launcher_content = _generate_launcher(device.ip, device.adb_port, device.name or device.id)

    return Response(
        content=launcher_content.encode("utf-8"),
        media_type="application/x-bat",
        headers={"Content-Disposition": f'attachment; filename="iniciar-{safe_name}.bat"'},
    )
