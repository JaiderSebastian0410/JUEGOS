@echo off
REM ============================================================
REM  Space Defender Pro — Script para generar EXE (Windows)
REM  Ejecutar desde la carpeta raiz del proyecto (JUEGOS-main)
REM ============================================================

echo.
echo ============================================
echo  SPACE DEFENDER PRO - Generador de EXE
echo ============================================
echo.

REM 1. Verificar que Node.js esta disponible
node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no encontrado. Instala Node.js desde:
    echo   https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js detectado

REM 2. Preparar package.json para Electron
echo [1/4] Preparando configuracion de Electron...
copy /y package.json package-backup.json >nul
copy /y package-electron.json package.json >nul
echo       OK

REM 3. Instalar dependencias de Electron
echo [2/4] Instalando Electron y empaquetador (puede tardar unos minutos)...
call npm install --save-dev electron@latest electron-builder@latest
if errorlevel 1 (
    echo [ERROR] Fallo al instalar dependencias.
    copy /y package-backup.json package.json >nul
    pause
    exit /b 1
)
echo       OK

REM 4. Compilar EXE portable
echo [3/4] Compilando EXE (esto puede tomar unos minutos)...
call npx electron-builder --win portable --config.win.icon=icon-512.png
if errorlevel 1 (
    echo [ERROR] Fallo la compilacion del EXE. Revisa los errores arriba.
    copy /y package-backup.json package.json >nul
    pause
    exit /b 1
)
echo       OK

REM 5. Copiar EXE a la carpeta raiz
echo [4/4] Copiando EXE a la carpeta del proyecto...
copy /y dist-electron\SpaceDefenderPro.exe SpaceDefenderPro.exe >nul
if not exist SpaceDefenderPro.exe (
    REM Buscar en caso de que el nombre sea distinto
    for %%F in (dist-electron\*.exe) do (
        copy /y "%%F" SpaceDefenderPro.exe >nul
        goto :found
    )
)
:found

REM 6. Restaurar el package.json original
copy /y package-backup.json package.json >nul
del package-backup.json >nul 2>&1

if exist SpaceDefenderPro.exe (
    echo.
    echo ============================================
    echo  EXE GENERADO EXITOSAMENTE!
    echo  Archivo: SpaceDefenderPro.exe
    echo  Ubicacion: %CD%\SpaceDefenderPro.exe
    echo ============================================
) else (
    echo [ERROR] No se pudo encontrar el EXE generado.
    echo Revisa la carpeta dist-electron manualmente.
)

echo.
pause
