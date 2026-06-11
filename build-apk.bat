@echo off
REM ============================================================
REM  Space Defender Pro — Script para generar APK
REM  Ejecutar desde la carpeta raiz del proyecto (JUEGOS-main)
REM ============================================================

echo.
echo ============================================
echo  SPACE DEFENDER PRO - Generador de APK
echo ============================================
echo.

REM 1. Buscar y forzar JAVA_HOME para Java 21
set "JAVA_HOME="
for /d %%D in ("C:\Program Files\Eclipse Adoptium\jdk-21*") do set "JAVA_HOME=%%~D"

if not defined JAVA_HOME (
    echo [ERROR] Java 21 no encontrado.
    echo Por favor instala JDK 21 desde Adoptium.
    echo URL: https://adoptium.net/temurin/releases/?version=21
    pause
    exit /b 1
)
set "PATH=%JAVA_HOME%\bin;%PATH%"

REM 2. Verificar que Java esta disponible
java -version >nul 2>&1

REM 2. Copiar archivos web al directorio www
echo [1/4] Empaquetando archivos web...
if not exist www mkdir www
copy /y juego.html www\index.html >nul
copy /y *.css www\ >nul
copy /y *.js www\ >nul
copy /y *.png www\ >nul
copy /y *.svg www\ >nul
copy /y manifest.json www\ >nul
echo       OK

REM 3. Sincronizar Capacitor
echo [2/4] Sincronizando Capacitor...
call npx.cmd @capacitor/cli sync
if errorlevel 1 (
    echo [ERROR] Fallo al sincronizar Capacitor.
    pause
    exit /b 1
)
echo       OK

REM 4. Compilar APK con Gradle
echo [3/4] Compilando APK (esto puede tomar unos minutos)...
cd android
call gradlew.bat assembleDebug -Dorg.gradle.java.home="%JAVA_HOME%"
if errorlevel 1 (
    echo [ERROR] Fallo la compilacion. Revisa los errores arriba.
    cd ..
    pause
    exit /b 1
)
cd ..
echo       OK

REM 5. Copiar APK a la carpeta raiz
echo [4/4] Copiando APK a la carpeta del proyecto...
copy /y android\app\build\outputs\apk\debug\app-debug.apk SpaceDefenderPro.apk >nul
if exist SpaceDefenderPro.apk (
    echo.
    echo ============================================
    echo  APK GENERADO EXITOSAMENTE!
    echo  Archivo: SpaceDefenderPro.apk
    echo  Ubicacion: %CD%\SpaceDefenderPro.apk
    echo ============================================
) else (
    echo [ERROR] No se pudo copiar el APK.
)

echo.
pause
