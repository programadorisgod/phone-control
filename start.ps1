# ==========================================================
#       Phone Control - Iniciar Servidor en Windows
# ==========================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$exeDriver = Join-Path $ScriptDir "backend\windows_driver.exe"
if (-not (Test-Path $exeDriver)) {
    Write-Host "Compilando driver de entrada para Windows..." -ForegroundColor Yellow
    & (Join-Path $ScriptDir "backend\build-windows.bat")
}

Write-Host "Iniciando servidor de Phone Control..." -ForegroundColor Cyan
Set-Location (Join-Path $ScriptDir "backend")
& node server.mjs
