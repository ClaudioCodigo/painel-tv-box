"""API routes para geração e download do bundle scrcpy client-side."""

import base64
import io
import logging
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

logger = logging.getLogger("scrcpy-client")

router = APIRouter(prefix="/api/scrcpy/client", tags=["scrcpy-client"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class EnrollmentRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    client_name: str = Field(min_length=1, max_length=80)
    public_key: str = Field(min_length=100, max_length=4096)


class LaunchRequest(BaseModel):
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
set "ADB_VENDOR_KEYS=%~dp0credencial\adbkey"
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
scrcpy\\adb.exe -s {ip}:{port} get-state 2>nul | findstr /x /c:"device" >nul
if errorlevel 1 (
    echo.
    echo [ERRO] O TV Box nao aceitou a chave ADB deste computador.
    echo A matricula local sera renovada no proximo pacote.
    del /q "credencial\\.matriculado" >nul 2>&1
    echo Baixe novamente o pacote no painel e tente outra vez.
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


def _generate_station_launcher(panel_url: str) -> str:
    """Launcher instalado que resolve um ticket ou conecta diretamente via protocolo."""
    endpoint = f"{panel_url.rstrip('/')}/api/scrcpy/client/launch/resolve"
    return f"""param([Parameter(Mandatory=$true)][string]$ProtocolUri)
$ErrorActionPreference = 'Stop'

try {{
    $CleanUri = $ProtocolUri.Trim().Trim('"').Trim("'")
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
    $Adb = Join-Path $Root 'scrcpy\\adb.exe'
    $Scrcpy = Join-Path $Root 'scrcpy\\scrcpy.exe'
    $KeyPath = Join-Path $Root 'credencial\\adbkey'
    if (-not (Test-Path $Adb) -or -not (Test-Path $Scrcpy)) {{
        throw 'Cliente incompleto. Execute novamente o instalador do Painel TV Box.'
    }}

    $Serial = ''
    $BoxTitle = 'TV Box'

    # 1. Modo Direto: paineltvbox://IP:PORT/?name=... ou ip=...
    if ($CleanUri -match '^paineltvbox://([0-9]{{1,3}}\\.[0-9]{{1,3}}\\.[0-9]{{1,3}}\\.[0-9]{{1,3}}):?([0-9]*)/?(?:\\?.*name=([^&]+))?') {{
        $Ip = $Matches[1]
        $Port = if ($Matches[2]) {{ $Matches[2] }} else {{ '5555' }}
        $Serial = $Ip + ':' + $Port
        if ($Matches[3]) {{ $BoxTitle = [System.Uri]::UnescapeDataString($Matches[3]) }} else {{ $BoxTitle = $Serial }}
    }} elseif ($CleanUri -match 'ip=([0-9]{{1,3}}\\.[0-9]{{1,3}}\\.[0-9]{{1,3}}\\.[0-9]{{1,3}})') {{
        $Ip = $Matches[1]
        $Port = if ($CleanUri -match 'port=([0-9]+)') {{ $Matches[1] }} else {{ '5555' }}
        $Serial = $Ip + ':' + $Port
        if ($CleanUri -match 'name=([^&]+)') {{ $BoxTitle = [System.Uri]::UnescapeDataString($Matches[1]) }} else {{ $BoxTitle = $Serial }}
    }} elseif ($CleanUri -match '^paineltvbox://scrcpy/?\\?ticket=([A-Za-z0-9_-]{{20,200}})/?') {{
        # 2. Modo legado com ticket
        $Ticket = $Matches[1]
        if (-not (Test-Path $KeyPath)) {{
            throw 'Chave do cliente nao encontrada. Reinstale o cliente.'
        }}
        $Endpoint = {_ps_literal(endpoint)}
        if ($CleanUri -match 'server=([^&]+)') {{
            $Base = [System.Uri]::UnescapeDataString($Matches[1]).TrimEnd('/')
            $Endpoint = $Base + '/api/scrcpy/client/launch/resolve'
        }}
        $Payload = @{{
            token = $Ticket
            client_name = $(if ($env:COMPUTERNAME) {{ $env:COMPUTERNAME }} else {{ 'Windows-PC' }})
            public_key = (Get-Content -Raw -Encoding UTF8 ($KeyPath + '.pub')).Trim()
        }} | ConvertTo-Json
        $Target = Invoke-RestMethod -Method Post -Uri $Endpoint -ContentType 'application/json' -Body $Payload
        $Serial = $Target.ip + ':' + $Target.adb_port
        $BoxTitle = if ($Target.name) {{ $Target.name }} else {{ $Serial }}
        $env:ADB_VENDOR_KEYS = $KeyPath
    }} else {{
        throw 'Link de abertura invalido.'
    }}

    if (Test-Path $KeyPath) {{
        $env:ADB_VENDOR_KEYS = $KeyPath
    }}

    $env:ADB_SERVER_PORT = '5037'
    # Windows PowerShell 5.1 transforma stderr de executáveis nativos em
    # ErrorRecord. O ADB escreve mensagens normais do daemon em stderr.
    $ErrorActionPreference = 'Continue'
    & $Adb kill-server 2>$null | Out-Null
    $Connected = $false
    $LastConnect = ''
    for ($Attempt = 1; $Attempt -le 8; $Attempt++) {{
        Write-Host ('Conectando ao TV Box - tentativa ' + $Attempt + '/8...')
        $LastConnect = (& $Adb connect $Serial 2>&1 | Out-String).Trim()
        Start-Sleep -Milliseconds 750
        $State = (& $Adb -s $Serial get-state 2>$null | Out-String).Trim()
        if ($State -eq 'device') {{
            $Connected = $true
            break
        }}
        Start-Sleep -Seconds 2
    }}
    $ErrorActionPreference = 'Stop'
    if (-not $Connected) {{
        throw ('Nao foi possivel autenticar o TV Box apos 8 tentativas. Ultimo retorno: ' + $LastConnect)
    }}

    $ErrorActionPreference = 'Continue'
    & $Scrcpy -s $Serial --window-title ('Painel TV Box: ' + $BoxTitle) --max-size=1280
    $ScrcpyExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($ScrcpyExit -ne 0) {{ throw ('scrcpy encerrou com codigo ' + $ScrcpyExit) }}
}} catch {{
    Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Painel TV Box - scrcpy', 'OK', 'Error') | Out-Null
    exit 1
}}
"""


def _generate_station_installer() -> str:
    """Instala o cliente no perfil atual e registra paineltvbox:// em HKCU."""
    return r"""$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot
$Dest = Join-Path $env:LOCALAPPDATA 'PainelTVBox\ScrcpyClient'
$ScrcpyDest = Join-Path $Dest 'scrcpy'
$KeyDir = Join-Path $Dest 'credencial'
$KeyPath = Join-Path $KeyDir 'adbkey'

New-Item -ItemType Directory -Force -Path $ScrcpyDest, $KeyDir | Out-Null

# Reinstalar com o cliente em uso (daemon adb da porta 5037 ou uma sessao
# scrcpy aberta) deixa os arquivos travados no Windows e o Copy-Item falha
# com IOException. Encerramos apenas os processos que rodam a partir desta
# pasta (%LOCALAPPDATA%\PainelTVBox\ScrcpyClient).
function Stop-ClientProcess {
    param([string]$Root)
    $Stopped = 0
    foreach ($Proc in @(Get-Process -ErrorAction SilentlyContinue)) {
        $ExePath = $null
        try { $ExePath = $Proc.Path } catch { $ExePath = $null }
        if ($ExePath -and $ExePath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
            $Stopped++
        }
    }
    # O launcher roda por 'powershell.exe -File' e mantem o .ps1 aberto.
    $Launchers = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 })
    foreach ($Launcher in $Launchers) {
        if ($Launcher.ProcessId -ne $PID) {
            Stop-Process -Id $Launcher.ProcessId -Force -ErrorAction SilentlyContinue
            $Stopped++
        }
    }
    if ($Stopped -gt 0) { Start-Sleep -Milliseconds 800 }
    return $Stopped
}

$InstalledAdb = Join-Path $ScrcpyDest 'adb.exe'
if (Test-Path $InstalledAdb) {
    # Derruba somente o daemon do cliente (porta padrao 5037). O servidor ADB
    # do painel usa PANEL_ADB_SERVER_PORT e nao e afetado.
    $PreviousPort = $env:ADB_SERVER_PORT
    $env:ADB_SERVER_PORT = '5037'
    & $InstalledAdb kill-server 2>$null | Out-Null
    if ($PreviousPort) { $env:ADB_SERVER_PORT = $PreviousPort }
    else { Remove-Item Env:\ADB_SERVER_PORT -ErrorAction SilentlyContinue }
}

$Attempt = 0
while ($true) {
    $Attempt++
    try {
        Copy-Item -Path (Join-Path $Source 'scrcpy\*') -Destination $ScrcpyDest -Recurse -Force -ErrorAction Stop
        Copy-Item -Path (Join-Path $Source 'PainelScrcpy.ps1') -Destination $Dest -Force -ErrorAction Stop
        Copy-Item -Path (Join-Path $Source 'README.txt') -Destination $Dest -Force -ErrorAction Stop
        break
    } catch {
        if ($Attempt -ge 5) { throw }
        Write-Host ('Arquivos do cliente em uso: ' + $_.Exception.Message) -ForegroundColor Yellow
        Write-Host ('Encerrando scrcpy/adb desta pasta e tentando novamente ' + $Attempt + '/5...') -ForegroundColor Yellow
        Stop-ClientProcess -Root $Dest | Out-Null
        Start-Sleep -Seconds 1
    }
}

$Adb = Join-Path $ScrcpyDest 'adb.exe'
if (-not (Test-Path $KeyPath) -or -not (Test-Path ($KeyPath + '.pub'))) {
    & $Adb keygen $KeyPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar a chave ADB desta estacao.' }
}

$Protocol = 'HKCU:\Software\Classes\paineltvbox'
$CommandKey = Join-Path $Protocol 'shell\open\command'
$Launcher = Join-Path $Dest 'PainelScrcpy.ps1'
New-Item -Path $CommandKey -Force | Out-Null
Set-Item -Path $Protocol -Value 'URL:Painel TV Box scrcpy Protocol'
New-ItemProperty -Path $Protocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$Command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $Launcher + '" "%1"'
Set-Item -Path $CommandKey -Value $Command

Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
[System.Windows.MessageBox]::Show('Cliente instalado. Agora use o botao Start no painel.', 'Painel TV Box - scrcpy', 'OK', 'Information') | Out-Null
"""


def _generate_station_readme() -> str:
    return """PAINEL TV BOX - CLIENTE SCRCPY

INSTALACAO RECOMENDADA (SEM ADMINISTRADOR / SEM UAC)
1. Extraia todo o conteudo deste arquivo ZIP em uma pasta do seu computador.
2. De um duplo-clique no arquivo "INSTALAR-1-CLIQUE.bat" (ou "instalar-cliente.bat").
3. Pronto! O protocolo paineltvbox:// sera registrado no seu usuario local.
4. Volte ao painel web e clique no botao "Scrcpy" ou "1-Clique" de qualquer TV Box.

DETALHES TECNICOS:
- O cliente fica em %LOCALAPPDATA%\\PainelTVBox\\ScrcpyClient.
- Registrado em HKCU (HKEY_CURRENT_USER) — 100% livre de privilegios de Administrador.
- A chave privada permanece somente nesse computador.
- Nao ha servico ou processo residente em segundo plano.

SOLUCAO DE PROBLEMAS:
- Se o navegador perguntar, permita abrir o protocolo paineltvbox://.
- Se aparecer "Link de abertura invalido", execute "INSTALAR-1-CLIQUE.bat" novamente
  para atualizar o launcher local para a versao mais recente.
- A pasta Atalhos/ contem arquivos .bat para conexao direta sem navegador.
"""


def _generate_station_bootstrap() -> str:
    """Atalho de duplo clique para o instalador PowerShell com fallback seguro."""
    return r"""@echo off
chcp 65001 >nul
title Painel TV Box - Instalar cliente scrcpy
cd /d "%~dp0"
echo ========================================================
echo    Painel TV Box - Instalando Cliente Scrcpy
echo    (Instalacao 100%% sem necessidade de Administrador)
echo ========================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-cliente.ps1"
if errorlevel 1 (
    echo.
    echo [AVISO] Falha ao executar via PowerShell. Tentando instalacao direta...
    if not exist "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy" mkdir "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy"
    if exist "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy\adb.exe" "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy\adb.exe" kill-server >nul 2>&1
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($env:LOCALAPPDATA + '\PainelTVBox\ScrcpyClient*') } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
    xcopy "%~dp0scrcpy\*" "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy\" /E /I /Y /Q >nul 2>&1
    if errorlevel 1 (
        echo Encerrando processos do cliente e tentando novamente...
        timeout /t 1 >nul 2>&1
        xcopy "%~dp0scrcpy\*" "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\scrcpy\" /E /I /Y /Q >nul 2>&1
    )
    copy /Y "%~dp0PainelScrcpy.ps1" "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\" >nul 2>&1
    copy /Y "%~dp0README.txt" "%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\" >nul 2>&1
    reg add "HKCU\Software\Classes\paineltvbox" /ve /t REG_SZ /d "URL:Painel TV Box Protocol" /f >nul 2>&1
    reg add "HKCU\Software\Classes\paineltvbox" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
    reg add "HKCU\Software\Classes\paineltvbox\shell\open\command" /ve /t REG_SZ /d "\"powershell.exe\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%LOCALAPPDATA%\PainelTVBox\ScrcpyClient\PainelScrcpy.ps1\" \"%%1\"" /f >nul 2>&1
    echo Protocolo registrado com sucesso!
    pause
) else (
    echo.
    echo ========================================================
    echo    Instalacao concluida com sucesso!
    echo    Agora voce ja pode abrir os TV Boxes no painel.
    echo ========================================================
    echo.
    timeout /t 5 >nul 2>&1
)
"""


def _add_scrcpy_files(zf: zipfile.ZipFile, scrcpy_dir: Path):
    """Adiciona o runtime scrcpy e garante adb.exe/DLLs no ZIP."""
    for file in scrcpy_dir.rglob("*"):
        if file.is_file():
            zf.write(file, f"scrcpy/{file.relative_to(scrcpy_dir)}")
    if not (scrcpy_dir / "adb.exe").is_file():
        adb_sys = shutil.which("adb")
        if adb_sys:
            adb_path = Path(adb_sys)
            zf.write(adb_path, "scrcpy/adb.exe")
            for dll in adb_path.parent.glob("*.dll"):
                zf.write(dll, f"scrcpy/{dll.name}")


def _build_station_bundle(scrcpy_dir: Path, panel_url: str) -> bytes:
    """Monta o pacote completo consumido pelo instalador bootstrap."""
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        _add_scrcpy_files(zf, scrcpy_dir)
        zf.writestr("PainelScrcpy.ps1", _generate_station_launcher(panel_url).encode("utf-8-sig"))
        zf.writestr("instalar-cliente.ps1", _generate_station_installer().encode("utf-8-sig"))
        zf.writestr("instalar-cliente.bat", _generate_station_bootstrap().encode("utf-8"))
        zf.writestr("INSTALAR-1-CLIQUE.bat", _generate_station_bootstrap().encode("utf-8"))
        zf.writestr("README.txt", _generate_station_readme().encode("utf-8"))

        # Atalhos rápidos de duplo clique para cada TV Box cadastrado
        try:
            import app.main
            cfg = getattr(app.main, "config", None)
            if cfg:
                devices = cfg.list_devices()
                for dev in devices:
                    if dev.ip:
                        safe_name = _safe_filename(dev.name or dev.id)
                        bat_shortcut = f"""@echo off
chcp 65001 >nul
title Conectando a {dev.name or dev.id}...
cd /d "%~dp0"
echo Conectando ao TV Box {dev.name or dev.id} ({dev.ip}:{dev.adb_port})...
scrcpy\\adb.exe connect {dev.ip}:{dev.adb_port}
scrcpy\\scrcpy.exe -s {dev.ip}:{dev.adb_port} --window-title "Painel TV Box: {dev.name or dev.id}" --max-size=1280
"""
                        zf.writestr(f"Atalhos/Conectar - {safe_name}.bat", bat_shortcut.encode("utf-8"))
        except Exception:
            pass

    return zip_buffer.getvalue()


def _generate_online_installer(panel_url: str, token: str) -> str:
    """Gera .cmd pequeno que baixa e instala o cliente atual do painel."""
    package_url = f"{panel_url.rstrip('/')}/api/scrcpy/client/station-bundle-download/{token}"
    powershell = f"""$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Work = Join-Path $env:TEMP ('PainelTVBox-' + [guid]::NewGuid().ToString('N'))
$Zip = $Work + '.zip'
try {{
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    Write-Host '[1/3] Baixando pacote do Scrcpy...' -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri {_ps_literal(package_url)} -OutFile $Zip
    Write-Host '[2/3] Extraindo arquivos...' -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try {{
        [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Work)
    }} catch {{
        Expand-Archive -Path $Zip -DestinationPath $Work -Force
    }}
    Write-Host '[3/3] Registrando protocolo no Windows...' -ForegroundColor Cyan
    & (Join-Path $Work 'instalar-cliente.ps1')
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ throw 'O instalador retornou erro.' }}
}} finally {{
    Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}}
"""
    encoded = base64.b64encode(powershell.encode("utf-16le")).decode("ascii")
    return f"""@echo off
chcp 65001 >nul
title Painel TV Box - Instalar cliente scrcpy
echo ========================================================
echo    Painel TV Box - Instalando Cliente Scrcpy
echo    (Instalacao 100%% sem necessidade de Administrador)
echo ========================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {encoded}
if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel baixar ou instalar o cliente pelo painel.
    echo Feche as janelas do scrcpy abertas neste computador e tente novamente.
    pause
)
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
        _add_scrcpy_files(zf, scrcpy_dir)

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


@router.get("/station-bundle")
async def get_station_bundle(request: Request):
    """Entrega o cliente que é instalado uma única vez no perfil Windows."""
    mgr = ScrcpyManager()
    scrcpy_dir = mgr.get_active_dir()
    if not scrcpy_dir or not scrcpy_dir.is_dir():
        raise HTTPException(500, "scrcpy não instalado no servidor")

    return StreamingResponse(
        io.BytesIO(_build_station_bundle(scrcpy_dir, str(request.base_url))),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="PainelTVBox-Scrcpy-Cliente.zip"'},
    )


@router.get("/installer")
async def get_online_installer(request: Request):
    """Entrega um .cmd que baixa o cliente atual usando token descartável."""
    token = EnrollmentStore().issue_token(
        "station-client", issued_by="panel", ttl=10 * 60, purpose="install",
    )["token"]
    content = _generate_online_installer(str(request.base_url), token)
    return Response(
        content=content.encode("utf-8"),
        media_type="application/x-bat",
        headers={"Content-Disposition": 'attachment; filename="instalar-scrcpy.cmd"'},
    )


@router.get("/station-bundle-download/{token}")
async def download_station_bundle(token: str, request: Request):
    """Entrega uma vez o pacote ao instalador gerado pelo painel."""
    try:
        EnrollmentStore().consume_install_token(token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    scrcpy_dir = ScrcpyManager().get_active_dir()
    if not scrcpy_dir or not scrcpy_dir.is_dir():
        raise HTTPException(500, "scrcpy não instalado no servidor")
    return StreamingResponse(
        io.BytesIO(_build_station_bundle(scrcpy_dir, str(request.base_url))),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="PainelTVBox-Scrcpy-Cliente.zip"'},
    )


@router.post("/launch-ticket/{device_id}")
async def create_launch_ticket(device_id: str, request: Request):
    """Cria ticket curto usado pelo botão Start no protocolo Windows."""
    if not is_safe_id(device_id):
        raise HTTPException(400, "ID de dispositivo inválido")
    import app.main

    cfg = getattr(app.main, "config", None)
    if not cfg or not cfg.get_device(device_id):
        raise HTTPException(404, "Dispositivo não encontrado")
    raw_session = request.headers.get("Authorization", "")
    username = verify_session_token(raw_session[7:].strip()) if raw_session.startswith("Bearer ") else None
    ticket = EnrollmentStore().issue_token(
        device_id, issued_by=username or "panel", ttl=60, purpose="launch",
    )
    return {
        "protocol_url": f"paineltvbox://scrcpy?ticket={ticket['token']}",
        "expires_at": ticket["expires_at"],
    }


@router.post("/launch/resolve")
async def resolve_launch(data: LaunchRequest):
    """Resolve o ticket e autoriza a estação no box sob demanda."""
    try:
        public_key, fingerprint = normalize_adb_public_key(data.public_key, data.client_name)
        ticket = EnrollmentStore().consume_launch_token(data.token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    import app.main

    cfg = getattr(app.main, "config", None)
    device = cfg.get_device(ticket["device_id"]) if cfg else None
    if not device:
        raise HTTPException(404, "Dispositivo não encontrado")

    store = EnrollmentStore()
    client = store.get_by_fingerprint(fingerprint)
    newly_authorized = not client or device.id not in client.get("devices", [])
    if newly_authorized:
        result = await ADBKeyProvisioner().install(device.ip, device.adb_port, public_key)
        if not result.get("success"):
            raise HTTPException(502, result.get("error", "Falha ao autorizar estação"))
        client = store.register(
            device.id, data.client_name, public_key, fingerprint, ticket.get("issued_by", "panel"),
        )

    return {
        "success": True,
        "client_id": client["id"],
        "device_id": device.id,
        "name": device.name or device.id,
        "ip": device.ip,
        "adb_port": device.adb_port,
        "newly_authorized": newly_authorized,
    }


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
    src_ip = request.client.host if request.client else ""
    logger.info("Estação matriculada: client=%s (id=%s) device=%s ip=%s fingerprint=%s", data.client_name, client["id"], device_id, src_ip, fingerprint)
    return {
        "success": True,
        "client_id": client["id"],
        "fingerprint": fingerprint,
        "device_id": device_id,
        "enrolled_at": time.time(),
        "source_ip": src_ip,
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
    logger.info("Matrícula de estação revogada: client_id=%s device_id=%s", client_id, device_id)
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
