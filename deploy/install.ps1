<#
.SYNOPSIS
  Instalador Windows do Painel TV Box (Windows 10+ / Windows Server 2019+).
  Um duplo clique em instalar.bat (na raiz) executa este script.

.DESCRIPTION
  Baixa automaticamente os binarios (ffmpeg, ADB/platform-tools, MediaMTX, NSSM),
  copia o codigo para C:\PanelTVBox preservando .git, cria venv Python, registra
  painel (panel-tvbox) e MediaMTX (mediamtx) como servicos NSSM com auto-restart
  e libera o firewall do Windows somente para a LAN (LocalSubnet).

  O instalador NAO pergunta nada: e totalmente automatico no duplo clique.
  Opcoes avancadas ficam como flags (abaixo).

.PARAMETER AllowAdb
  Abre a porta ADB 5555 na rede local (Private) e cria regra de BLOQUEIO
  explicita em Public/Domain (defesa em profundidade). Default: fechada.

.PARAMETER NoMediamtx
  Nao baixa/registra o servico MediaMTX (use se ja tiver um na maquina).

.PARAMETER SkipVenv
  Nao recria o virtualenv Python (usa o existente em C:\PanelTVBox\.venv).

.PARAMETER RepoUrl
  URL do repositorio git (default: https://github.com/ClaudioCodigo/painel-tv-box.git).
  So usado quando a pasta de origem nao e um repositorio git valido.

.PARAMETER Help
  Mostra a ajuda e sai.

.EXAMPLE
  .\deploy\install.ps1
  .\deploy\install.ps1 -AllowAdb
  .\deploy\install.ps1 -NoMediamtx -SkipVenv
#>
param(
    [switch]$AllowAdb,
    [switch]$NoMediamtx,
    [switch]$SkipVenv,
    [string]$RepoUrl = "https://github.com/ClaudioCodigo/painel-tv-box.git",
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------------------------------------
# Ajuda
# -----------------------------------------------------------------------------
if ($Help) {
    Get-Help $PSCommandPath -Full
    exit 0
}

# -----------------------------------------------------------------------------
# Constantes / caminhos
# -----------------------------------------------------------------------------
$Dest        = "C:\PanelTVBox"
$DataDir     = Join-Path $env:LOCALAPPDATA "PanelTVBox"
$BinDir      = Join-Path $Dest "bin"
$LogDir      = Join-Path $DataDir "logs"
$SrcRoot     = Split-Path $PSScriptRoot -Parent   # raiz do repo (deploy/..)
$NssmExe     = Join-Path $BinDir "nssm.exe"
$PlatformToolsDir = Join-Path $BinDir "platform-tools"
$FfmpegBin   = Join-Path $BinDir "ffmpeg"
$MediamtxDir = Join-Path $BinDir "mediamtx"
$MediamtxExe = Join-Path $MediamtxDir "mediamtx.exe"
$MediamtxCfg = Join-Path $Dest "config\mediamtx.generated.yml"
$PythonExe   = Join-Path $Dest ".venv\Scripts\python.exe"

function Info  { Write-Host "  $args" -ForegroundColor Cyan }
function Step  { param([string]$s) Write-Host "`n[$($script:step)/7] $s" -ForegroundColor Yellow; $script:step++ }
function Warn  { Write-Host "  AVISO: $args" -ForegroundColor Yellow }
function Fail  { Write-Host "  ERRO: $args" -ForegroundColor Red }
$script:step = 1

# -----------------------------------------------------------------------------
# Elevacao (UAC) - NSSM e firewall exigem Administrador
# -----------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Elevando para Administrador (UAC)..."
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($AllowAdb)   { $argList += "-AllowAdb" }
    if ($NoMediamtx) { $argList += "-NoMediamtx" }
    if ($SkipVenv)   { $argList += "-SkipVenv" }
    if ($RepoUrl)    { $argList += "-RepoUrl"; $argList += "`"$RepoUrl`"" }
    Start-Process powershell.exe -Verb RunAs -WorkingDirectory (Split-Path $PSCommandPath) -ArgumentList $argList
    exit 0
}

Write-Host "+==============================================================+"
Write-Host "|        Instalador do Painel TV Box (Windows 10+)             |"
Write-Host "+==============================================================+"
Info "Destino: $Dest"
Info "Dados  : $DataDir"
New-Item -ItemType Directory -Force -Path $BinDir, $LogDir | Out-Null

# -----------------------------------------------------------------------------
# PASSO 1 - Baixar binarios (ffmpeg, ADB, NSSM, MediaMTX) - sem winget
# -----------------------------------------------------------------------------
Step "Baixando binarios (ffmpeg, ADB, NSSM, MediaMTX) - sem winget"

function Invoke-Download {
    param([string]$Url, [string]$OutFile, [string]$Label)
    if (Test-Path $OutFile) { Info "$Label ja baixado."; return $true }
    Info "Baixando $Label ..."
    try {
        for ($i = 1; $i -le 3; $i++) {
            try {
                Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 600
                return $true
            } catch {
                if ($i -eq 3) { throw }
                Warn "Tentativa $i/3 falhou ($($_.Exception.Message)). Tentando de novo..."
                Start-Sleep -Seconds 3
            }
        }
    } catch {
        Fail "Nao consegui baixar $Label : $($_.Exception.Message)"
        return $false
    }
    return $false
}

$ok = $true

# NSSM 2.24 (gestor de servicos)
$nssmZip = Join-Path $BinDir "nssm-2.24.zip"
if (-not (Test-Path $NssmExe)) {
    if (Invoke-Download "https://nssm.cc/release/nssm-2.24.zip" $nssmZip "NSSM 2.24") {
        Expand-Archive -Path $nssmZip -DestinationPath $BinDir -Force
        $cand = Get-ChildItem -Path $BinDir -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
        if ($cand) { Copy-Item $cand.FullName $NssmExe -Force }
        Remove-Item $nssmZip -Force -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path $NssmExe)) { Fail "NSSM ausente - abortando."; exit 1 }

# ADB / platform-tools
$ptZip = Join-Path $BinDir "platform-tools-latest-windows.zip"
if (-not (Test-Path (Join-Path $PlatformToolsDir "adb.exe"))) {
    if (Invoke-Download "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" $ptZip "ADB/platform-tools") {
        Expand-Archive -Path $ptZip -DestinationPath $BinDir -Force
        Remove-Item $ptZip -Force -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path (Join-Path $PlatformToolsDir "adb.exe"))) { Warn "ADB ausente - instalacao continua, mas acoes ADB dependem dele." }

# ffmpeg (essentials do gyan.dev)
$ffZip = Join-Path $BinDir "ffmpeg-release-essentials.zip"
if (-not (Test-Path (Join-Path $FfmpegBin "bin\ffmpeg.exe"))) {
    if (Invoke-Download "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" $ffZip "ffmpeg") {
        Expand-Archive -Path $ffZip -DestinationPath $BinDir -Force
        $ffDir = Get-ChildItem $BinDir -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
        if ($ffDir -and -not (Test-Path $FfmpegBin)) { Move-Item $ffDir.FullName $FfmpegBin }
        Remove-Item $ffZip -Force -ErrorAction SilentlyContinue
    }
}
if (-not (Test-Path (Join-Path $FfmpegBin "bin\ffmpeg.exe"))) { Warn "ffmpeg ausente - streaming/scrcpy dependem dele." }

# MediaMTX (resolve asset real windows_amd64 via GitHub API)
if (-not $NoMediamtx -and -not (Test-Path $MediamtxExe)) {
    $mtxTgz = Join-Path $BinDir "mediamtx.tar.gz"
    $asset = $null
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/bluenviron/mediamtx/releases/latest" -Headers @{ "User-Agent" = "panel-tvbox/1.0" } -TimeoutSec 60
        $asset = $rel.assets | Where-Object { $_.name -match "windows_amd64.*\.tar\.gz$" } | Select-Object -First 1
    } catch { Warn "Nao resolvi o asset do MediaMTX: $($_.Exception.Message)" }
    if ($asset) {
        if (Invoke-Download $asset.browser_download_url $mtxTgz "MediaMTX ($($asset.name))") {
            New-Item -ItemType Directory -Force -Path $MediamtxDir | Out-Null
            tar.exe -xzf $mtxTgz -C $MediamtxDir
            Remove-Item $mtxTgz -Force -ErrorAction SilentlyContinue
        }
    }
}
if (-not $NoMediamtx -and -not (Test-Path $MediamtxExe)) { Warn "MediaMTX ausente - use -NoMediamtx para pular o passo." }

# -----------------------------------------------------------------------------
# PASSO 2 - Copiar codigo para C:\PanelTVBox preservando .git
# -----------------------------------------------------------------------------
Step "Copiando codigo para $Dest (preservando .git)"

$isGit = Test-Path (Join-Path $SrcRoot ".git")
if (-not $isGit) {
    Warn "Origem nao e um repositorio git - clonando de $RepoUrl"
    if (Test-Path $Dest) { Warn "$Dest ja existe; git clone sera feito em subpasta temporaria e mesclado." }
    git clone --depth 1 $RepoUrl (Join-Path $Dest ".clone-tmp")
    if (-not (Test-Path (Join-Path $Dest ".clone-tmp"))) { Fail "Clone falhou."; exit 1 }
    robocopy (Join-Path $Dest ".clone-tmp") $Dest /E /MOVE /NFL /NDL /NJH /NJS | Out-Null
    Remove-Item (Join-Path $Dest ".clone-tmp") -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    # Exclui runtime/venv/estado local; MANTER .git (UpdateManager faz git pull)
    robocopy $SrcRoot $Dest /E /XD ".venv" "__pycache__" "logs" "backups" "scrcpy" ".reasonix" ".planning" /XF "*.pyc" /NFL /NDL /NJH /NJS | Out-Null
}

# -----------------------------------------------------------------------------
# PASSO 3 - Virtualenv + dependencias Python
# -----------------------------------------------------------------------------
Step "Configurando virtualenv Python"

if (-not $SkipVenv -or -not (Test-Path $PythonExe)) {
    if (-not (Test-Path $PythonExe)) {
        $py = $null
        foreach ($cand in @("py", "python")) {
            try { $v = & $cand -3 -c "import sys; print(sys.version.split()[0])" 2>$null; if ($LASTEXITCODE -eq 0 -and $v) { $py = $cand; break } } catch {}
        }
        if (-not $py) { Fail "Python 3 nao encontrado - instale o Python 3.10+ (python.org) e rode de novo."; exit 1 }
        Info "Criando venv com $py ..."
        & $py -3 -m venv (Join-Path $Dest ".venv")
    }
} else {
    Info "Pulando criacao do venv (-SkipVenv)."
}

if (Test-Path $PythonExe) {
    & $PythonExe -m pip install --quiet --upgrade pip
    & $PythonExe -m pip install --quiet $Dest
    if ($LASTEXITCODE -ne 0) {
        Warn "pip install . falhou - instalando dependencias explicitamente"
        & $PythonExe -m pip install --quiet "fastapi>=0.115.0" "uvicorn[standard]>=0.30.0" "pydantic>=2.0" "pyyaml>=6.0" "httpx>=0.27.0" "psutil>=6.0" "python-multipart>=0.0.9"
    }
    Info "Dependencias instaladas."
} else {
    Fail "Python do venv nao encontrado em $PythonExe - instalacao incompleta."
    exit 1
}

# -----------------------------------------------------------------------------
# PASSO 4 - Config local: adb.binary (so se o usuario nao configurou)
# -----------------------------------------------------------------------------
Step "Sincronizando config local (gitignored)"

$sysCfg = Join-Path $Dest "config\system.yml"
if (Test-Path $sysCfg) {
    $content = Get-Content $sysCfg -Raw
    if ($content -match "(?m)^\s*binary:\s*adb\s*$") {
        $adbe = Join-Path $PlatformToolsDir "adb.exe"
        if (Test-Path $adbe) {
            $content = $content -replace "(?m)^(\s*binary:\s*)(adb)(\s*)$", "`$1$($adbe -replace '\\','\\\\')`$3"
            Set-Content -Path $sysCfg -Value $content -Encoding UTF8
            Info "adb.binary apontado para $adbe"
        }
    } else {
        Info "adb.binary ja configurado manualmente - mantendo."
    }
} else {
    Info "config/system.yml ainda nao existe - o painel cria no 1o boot (a partir do .example)."
}

# -----------------------------------------------------------------------------
# PASSO 5 - Registrar servicos NSSM (painel + MediaMTX) com auto-restart
# -----------------------------------------------------------------------------
Step "Registrando servicos NSSM (auto-restart)"

function Set-NssmService {
    param([string]$Name, [string]$Cmd, [string]$Params, [string]$Dir, [string[]]$EnvExtra, [string]$LogBase)
    $existing = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Info "Servico $Name ja existe - atualizando config."
    } else {
        & $NssmExe install $Name $Cmd | Out-Null
    }
    & $NssmExe set $Name AppDirectory $Dir | Out-Null
    & $NssmExe set $Name AppParameters $Params | Out-Null
    & $NssmExe set $Name AppStdout (Join-Path $LogDir "$LogBase.out.log") | Out-Null
    & $NssmExe set $Name AppStderr (Join-Path $LogDir "$LogBase.err.log") | Out-Null
    & $NssmExe set $Name AppRotateFiles 1 | Out-Null
    & $NssmExe set $Name AppRotateBytes 10485760 | Out-Null
    & $NssmExe set $Name AppExit Default Restart | Out-Null
    & $NssmExe set $Name AppRestartDelay 5000 | Out-Null
    & $NssmExe set $Name Start SERVICE_AUTO_START | Out-Null
    if ($EnvExtra) {
        # NSSM anexa PATH a partir de AppEnvironmentExtra (nao substitui)
        & $NssmExe set $Name AppEnvironmentExtra $EnvExtra | Out-Null
    }
    & $NssmExe start $Name | Out-Null
    Info "Servico $Name registrado e iniciado."
}

$pathExtra = @(
    "PATH=$FfmpegBin\bin;$PlatformToolsDir",
    "PYTHONUNBUFFERED=1",
    "PANEL_DATA_DIR=$DataDir",
    "PANEL_ADB_SERVER_PORT=5038",
    "PANEL_MEDIAMTX_CONFIG=$MediamtxCfg"
)

if (Test-Path $PythonExe) {
    Set-NssmService -Name "panel-tvbox" -Cmd $PythonExe -Params "-m uvicorn app.main:app --host 0.0.0.0 --port 8080" -Dir $Dest -EnvExtra $pathExtra -LogBase "panel"
} else {
    Fail "Servico do painel nao registrado (python ausente)."
}

if (-not $NoMediamtx -and (Test-Path $MediamtxExe)) {
    Set-NssmService -Name "mediamtx" -Cmd $MediamtxExe -Params "`"$MediamtxCfg`"" -Dir $MediamtxDir -LogBase "mediamtx"
}

# -----------------------------------------------------------------------------
# PASSO 6 - Firewall (somente LAN) + ADB opcional
# -----------------------------------------------------------------------------
Step "Configurando firewall do Windows (somente LAN)"

$fwEnabled = (Get-NetFirewallProfile | Where-Object { $_.Enabled -eq $true })
if (-not $fwEnabled) { Warn "Windows Firewall esta DESLIGADO - painel exposto na rede. Recomendado ligar." }

function Add-LanRule {
    param([string]$Name, [int]$Port)
    if (-not (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Private, Public | Out-Null
        Info "Regra criada: $Name (porta $Port, so LAN)"
    } else {
        Info "Regra ja existe: $Name"
    }
}

Add-LanRule "Painel TVBox HTTP (8080)" 8080
Add-LanRule "Painel TVBox RTSP (8554)" 8554
Add-LanRule "Painel TVBox RTMP (1935)" 1935
Add-LanRule "Painel TVBox API MediaMTX (9997)" 9997

if ($AllowAdb) {
    Add-LanRule "Painel TVBox ADB (5555)" 5555
    # Defesa em profundidade: bloqueia ADB em Public/Domain mesmo com -AllowAdb
    if (-not (Get-NetFirewallRule -DisplayName "Painel TVBox ADB BLOQUEIO Public" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "Painel TVBox ADB BLOQUEIO Public" -Direction Inbound -Action Block -Protocol TCP -LocalPort 5555 -Profile Public, Domain | Out-Null
        Info "Regra de BLOQUEIO criada para ADB em Public/Domain"
    }
} else {
    Info "Porta ADB 5555 permanece FECHADA (use -AllowAdb para abrir so na LAN)."
}

# -----------------------------------------------------------------------------
# PASSO 7 - Validacao (config limpa) + resumo
# -----------------------------------------------------------------------------
Step "Validando instalacao"

# D-15: garantir que nenhuma config real fique rastreada no .git de $Dest
$tracked = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
    $tracked = & git -C $Dest ls-files 2>$null | Where-Object { $_ -match "^(config|devices|groups)/.*\.yml$" }
} else {
    Warn "Git nao encontrado - pulando validacao do indice (instale o Git p/ atualizar pelo painel)."
}
if ($tracked) {
    Warn "CONFIG LOCAL RASTREADA no git de $Dest - remova do indice:"
    $tracked | ForEach-Object { Fail "  $_" }
} else {
    Info "Config local fora do git: OK (apenas templates .example no indice)."
}

$svcPanel = Get-Service -Name "panel-tvbox" -ErrorAction SilentlyContinue
$svcMtx   = Get-Service -Name "mediamtx" -ErrorAction SilentlyContinue

Write-Host "`n=============================================================="
Write-Host "  INSTALACAO CONCLUIDA"
Write-Host "=============================================================="
Write-Host "  Painel   : $($svcPanel.Status) (servico panel-tvbox)"
if ($svcMtx) { Write-Host "  MediaMTX : $($svcMtx.Status) (servico mediamtx)" }
Write-Host "  URL      : http://localhost:8080"
Write-Host "  Dados    : $DataDir (backups, logs, screenshots - fora do repo)"
Write-Host ""
Write-Host "  Proximo passo: abra a URL acima e conclua o WIZARD"
Write-Host "  (criar admin/configs). Configs ficam somente nesta maquina."
Write-Host "=============================================================="

Start-Process "http://localhost:8080"
