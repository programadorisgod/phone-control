@echo off
setlocal

echo [Compilando Driver de Windows para Phone Control...]

set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC_PATH%" set "CSC_PATH=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

where gcc >nul 2>&1
if not errorlevel 1 goto compile_gcc

if exist "%CSC_PATH%" goto compile_csc

echo [ERROR] No se pudo encontrar csc.exe ni gcc para compilar el driver de Windows.
exit /b 1

:compile_gcc
echo Compilando con GCC...
gcc -O2 -Wall -Wextra -o "%~dp0windows_driver.exe" "%~dp0windows_driver.c"
if errorlevel 1 goto compile_csc
echo [OK] windows_driver.exe compilado exitosamente con GCC.
exit /b 0

:compile_csc
echo Compilando con C# nativo de Windows...
"%CSC_PATH%" /nologo /optimize+ /platform:anycpu /out:"%~dp0windows_driver.exe" "%~dp0windows_driver.cs"
if errorlevel 1 (
    echo [ERROR] Fallo la compilacion con csc.exe.
    exit /b 1
)
echo [OK] windows_driver.exe compilado exitosamente.
exit /b 0
