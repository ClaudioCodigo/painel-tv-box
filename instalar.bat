@echo off
setlocal
rem Instalador do Painel TV Box (Windows 10+) — duplo clique e pronto.
rem Executa deploy\install.ps1 com ExecutionPolicy Bypass (sem depender de politica local).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\install.ps1" %*
if errorlevel 1 (
    echo.
    echo Falha na instalacao. Veja as mensagens acima.
    pause
)
endlocal
