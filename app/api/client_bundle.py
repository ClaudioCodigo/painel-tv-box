"""API routes para geração e download do bundle scrcpy client-side."""

import io
from pathlib import Path
import re
import shutil
import time
import zipfile

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.auth import verify_session_token
from app.managers.adb_enrollment import (
    ADBKeyProvisioner,
    EnrollmentStore,
    normalize_adb_public_key,
)
from app.managers.scrcpy import ScrcpyManager
from app.utils.system import is_safe_id

router = APIRouter(prefix="/api/scrcpy/client", tags=["scrcpy-client"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class EnrollmentRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    client_name: str = Field(min_length=1, max_length=80)
    public_key: str = Field(min_length=100, max_length=4096)


def _safe_filename(name: str) -> str:
    """Sanitiza string para uso seguro em nomes de arquivo."""
    s = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", name or "device")
    return s.strip("_") or "device"


def _generate_launcher(ip: str, port: int, name: str, enrollment: bool = False) -> str:
    """Gera o script .bat para execução com duplo-clique no cliente."""
    enrollment_block = ""
    if enrollment:
        enrollment_block = r'''if not exist "credencial\.matriculado" (
    echo Matriculando este computador no painel...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0matricular.ps1"
    if errorlevel 1 (
        echo.
        echo [ERRO] Matricula nao concluida. Baixe um pacote novo no painel e tente novamente.
        pause
        exit /b 1
    )
)
set "ADB_VENDOR_KEYS=%~dp0credencial"
set "ADB_SERVER_PORT=5037"
scrcpy\adb.exe kill-server >nul 2>&1
'''
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
{enrollment_block}echo Chave ADB local: %~dp0credencial
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


def _ps_literal(value: str) -> str:
    """Literal PowerShell de aspas simples, sem caracteres de controle."""
    clean = value.replace("\r", "").replace("\n", "")
    return "'" + clean.replace("'", "''") + "'"


def _generate_enrollment_script(panel_url: str, device_id: str, token: str) -> str:
    endpoint = f"{panel_url.rstrip('/')}/api/scrcpy/client/enroll/{device_id}"
    return f"""$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Adb = Join-Path $Root 'scrcpy\\adb.exe'
$KeyDir = Join-Path $Root 'credencial'
$KeyPath = Join-Path $KeyDir 'adbkey'
$Marker = Join-Path $KeyDir '.matriculado'

New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
if (-not (Test-Path $KeyPath) -or -not (Test-Path ($KeyPath + '.pub'))) {{
    & $Adb keygen $KeyPath
    if ($LASTEXITCODE -ne 0) {{ throw 'Falha ao gerar a chave ADB local.' }}
}}

$PublicKey = (Get-Content -Raw -Encoding UTF8 ($KeyPath + '.pub')).Trim()
$ClientName = if ($env:COMPUTERNAME) {{ $env:COMPUTERNAME }} else {{ 'Windows-PC' }}
$Payload = @{{
    token = {_ps_literal(token)}
    client_name = $ClientName
    public_key = $PublicKey
}} | ConvertTo-Json

$Result = Invoke-RestMethod -Method Post -Uri {_ps_literal(endpoint)} -ContentType 'application/json' -Body $Payload
if (-not $Result.success) {{ throw 'O painel recusou a matricula.' }}
$Result.client_id | Set-Content -Encoding ASCII $Marker
Write-Host ('Matricula concluida: ' + $Result.fingerprint) -ForegroundColor Green
Start-Sleep -Seconds 4
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
3. Na primeira abertura, o computador gera sua propria chave ADB e o painel
   autoriza somente a chave publica no TV Box usando Magisk/root.
4. O script conectara automaticamente ao TV Box e abrira a tela na sua maquina.

REQUISITOS:
- Seu computador deve estar conectado na mesma rede local que o TV Box ({ip}).
- Nao e necessario instalar nada adicional; todos os executaveis estao incluidos na pasta scrcpy/.
- A chave privada fica apenas na pasta credencial/ deste computador.
- O token de matricula e descartavel e expira em poucos minutos. Se falhar,
  baixe um pacote novo no painel.

ATALHOS UTEIS:
- Alt + F : Alternar tela cheia
- Alt + O : Desligar a tela física do TV Box (mantém transmitindo)
- Alt + S : Tirar screenshot
- Alt + P : Ligar/desligar tela
- Botao direito do mouse : Voltar (Back do Android)
- Botao do meio do mouse : Home do Android
"""


@router.get("/bundle/{device_id}")
async def get_client_bundle(request: Request, device_id: str):
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
    raw_session = request.headers.get("Authorization", "")
    username = verify_session_token(raw_session[7:].strip()) if raw_session.startswith("Bearer ") else None
    enrollment = EnrollmentStore().issue_token(device.id, issued_by=username or "panel")
    launcher_content = _generate_launcher(device.ip, device.adb_port, device.name or device.id, enrollment=True)
    enrollment_content = _generate_enrollment_script(str(request.base_url), device.id, enrollment["token"])
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

        # 3. Adiciona matrícula, launcher e instruções na raiz do ZIP
        zf.writestr("matricular.ps1", enrollment_content.encode("utf-8-sig"))
        zf.writestr(f"iniciar-{safe_name}.bat", launcher_content.encode("utf-8"))
        zf.writestr("README.txt", readme_content.encode("utf-8"))

    zip_buffer.seek(0)
    filename = f"scrcpy-{safe_name}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/enroll/{device_id}")
async def enroll_client(device_id: str, data: EnrollmentRequest, request: Request):
    """Matricula uma chave pública usando token descartável do bundle."""
    if not is_safe_id(device_id):
        raise HTTPException(400, "ID de dispositivo inválido")

    import app.main

    cfg = getattr(app.main, "config", None)
    device = cfg.get_device(device_id) if cfg else None
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    try:
        public_key, fingerprint = normalize_adb_public_key(data.public_key, data.client_name)
        token_record = EnrollmentStore().consume_token(data.token, device_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    result = await ADBKeyProvisioner().install(device.ip, device.adb_port, public_key)
    if not result.get("success"):
        raise HTTPException(502, result.get("error", "Falha ao provisionar chave no TV Box"))

    client = EnrollmentStore().register(
        device_id=device_id,
        client_name=data.client_name,
        public_key=public_key,
        fingerprint=fingerprint,
        issued_by=token_record.get("issued_by", "panel"),
    )
    return {
        "success": True,
        "client_id": client["id"],
        "fingerprint": fingerprint,
        "device_id": device_id,
        "enrolled_at": time.time(),
        "source_ip": request.client.host if request.client else "",
    }


@router.get("/enrollments")
async def list_enrollments():
    """Lista estações matriculadas sem expor o conteúdo das chaves."""
    clients = []
    for client in EnrollmentStore().list_clients():
        clients.append({key: value for key, value in client.items() if key != "public_key"})
    return {"clients": clients}


@router.delete("/enrollments/{client_id}/{device_id}")
async def revoke_enrollment(client_id: str, device_id: str):
    """Revoga uma estação em um TV Box e mantém os demais vínculos."""
    if not is_safe_id(client_id) or not is_safe_id(device_id):
        raise HTTPException(400, "Identificador inválido")

    import app.main

    cfg = getattr(app.main, "config", None)
    device = cfg.get_device(device_id) if cfg else None
    client = EnrollmentStore().get_client(client_id)
    if not device or not client or device_id not in client.get("devices", []):
        raise HTTPException(404, "Matrícula não encontrada")

    result = await ADBKeyProvisioner().revoke(device.ip, device.adb_port, client["public_key"])
    if not result.get("success"):
        raise HTTPException(502, result.get("error", "Falha ao revogar chave no TV Box"))
    EnrollmentStore().remove_device(client_id, device_id)
    return {"success": True, "client_id": client_id, "device_id": device_id}


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
