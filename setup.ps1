# ==========================================================
#       Phone Control - Instalacion en Windows
# ==========================================================
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      Phone Control - Instalacion y Configuracion         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Compilar driver de Windows
Write-Host ""
Write-Host "[1/4] Compilando el driver de entrada en Windows (windows_driver.exe)..." -ForegroundColor Yellow
Stop-Process -Name "windows_driver" -Force -ErrorAction SilentlyContinue
$csc64 = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$csc32 = "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
$cscPath = if (Test-Path $csc64) { $csc64 } elseif (Test-Path $csc32) { $csc32 } else { $null }

$csFile = Join-Path $ScriptDir "backend\windows_driver.cs"
$exeOut = Join-Path $ScriptDir "backend\windows_driver.exe"

if (Get-Command gcc -ErrorAction SilentlyContinue) {
    Write-Host "Compilando con GCC..."
    gcc -O2 -Wall -Wextra -o $exeOut (Join-Path $ScriptDir "backend\windows_driver.c")
} elseif ($cscPath) {
    Write-Host "Compilando con C# nativo de Windows..."
    & $cscPath /nologo /optimize+ /platform:anycpu /out:$exeOut $csFile
} else {
    Write-Error "No se encontro csc.exe ni gcc para compilar windows_driver.exe."
}

if (Test-Path $exeOut) {
    Write-Host "[OK] windows_driver.exe compilado exitosamente." -ForegroundColor Green
} else {
    Write-Error "Fallo la compilacion de windows_driver.exe."
}

# 2. Instalar dependencias de Node.js
Write-Host ""
Write-Host "[2/4] Instalando dependencias de Node.js..." -ForegroundColor Yellow
Push-Location (Join-Path $ScriptDir "backend")
try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm install
    } else {
        Write-Error "Se requiere pnpm o npm para instalar las dependencias de Node.js."
    }
} finally {
    Pop-Location
}
Write-Host "[OK] Dependencias de Node.js instaladas correctamente." -ForegroundColor Green

# 3. Configurar Firewall
Write-Host ""
Write-Host "[3/4] Verificando Firewall de Windows (LAN Only)..." -ForegroundColor Yellow
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    & (Join-Path $ScriptDir "manage-firewall.ps1") allow-lan 5252
} else {
    Write-Host "Nota: Para permitir conexiones entrantes a traves del Firewall de Windows," -ForegroundColor DarkYellow
    Write-Host "ejecuta PowerShell como Administrador y corre:" -ForegroundColor DarkYellow
    Write-Host "manage-firewall.bat allow-lan 5252" -ForegroundColor Cyan
    Write-Host ""
}

# 4. Crear Acceso Directo en el Escritorio
Write-Host ""
Write-Host "[4/4] Creando acceso directo en el Escritorio..." -ForegroundColor Yellow
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "Phone Control.lnk"
    $wscript = New-Object -ComObject WScript.Shell
    $shortcut = $wscript.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $ScriptDir "start.bat"
    $shortcut.WorkingDirectory = $ScriptDir
    $shortcut.Description = "Phone Control - Control remoto para tu PC desde el smartphone"
    $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
    $shortcut.Save()
    Write-Host "[OK] Acceso directo creado en: $shortcutPath" -ForegroundColor Green
} catch {
    Write-Host "No se pudo crear el acceso directo en el escritorio: $_" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Instalacion completa! Inicia con:                       " -ForegroundColor Green
Write-Host "        .\start.ps1  (o start.bat)                        " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
