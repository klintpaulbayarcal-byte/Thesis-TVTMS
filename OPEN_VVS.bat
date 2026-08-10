@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Municipal Traffic Violation Ticketing and Management System

:: -------------------------------------------------------
:: Auto-detect this project's own folder so it works no
:: matter what it's named or renamed to under htdocs.
:: -------------------------------------------------------
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "BACKEND=%SCRIPT_DIR%\backend"

set "HTDOCS=C:\xampp\htdocs\"
set "RELDIR=%SCRIPT_DIR%"
call set "RELDIR=%%RELDIR:%HTDOCS%=%%"
set "RELURL=%RELDIR:\=/%"
set "URL=http://localhost/%RELURL%/frontend/pages/landing.html"
set "WAIT_SECONDS=120"

echo.
echo  ============================================================
echo   Municipal Traffic Violation Ticketing and Management System
echo   BISU Calape ^| Capstone Deployment Candidate
echo  ============================================================
echo.

:: -------------------------------------------------------
:: STEP 1: Open XAMPP
:: -------------------------------------------------------
echo  [1/4] Opening XAMPP Control Panel...
if not exist "C:\xampp\xampp-control.exe" (
    echo  [ERROR] XAMPP not found at C:\xampp
    pause & exit /b 1
)
start "" "C:\xampp\xampp-control.exe"

echo.
echo  ============================================================
echo   In XAMPP - click [Start] next to Apache and MySQL
echo   Waiting... do NOT close this window.
echo  ============================================================
echo.

:: -------------------------------------------------------
:: STEP 2: Wait for Apache + MySQL using netstat (fast)
:: -------------------------------------------------------
set /a "WAITED=0"
:wait_services
set "A=0" & set "M=0"
powershell.exe -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 80 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1 && set "A=1"
powershell.exe -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1 && set "M=1"
if "!A!!M!"=="11" goto services_ready
if !WAITED! geq %WAIT_SECONDS% goto services_timeout
if "!A!"=="0" echo  [WAIT] Apache is not reachable on port 80.
if "!M!"=="0" echo  [WAIT] MySQL is not reachable on port 3306.
timeout /t 2 /nobreak >nul
set /a "WAITED+=2"
goto wait_services

:services_timeout
echo.
echo  [ERROR] Apache and MySQL were not both ready after %WAIT_SECONDS% seconds.
echo          In XAMPP, confirm Apache uses port 80 and MySQL uses port 3306.
echo          The browser was not opened because the local site is not ready.
pause & exit /b 1

:services_ready

echo  [OK] Apache  - Running!
echo  [OK] MySQL   - Running!
echo.

:: -------------------------------------------------------
:: STEP 3: Find Node.js
:: -------------------------------------------------------
echo  [2/4] Checking Node.js...
set "NODE="
set "NPM="
for /f "delims=" %%N in ('where node 2^>nul') do (
    if not defined NODE set "NODE=%%N"
)

if not defined NODE (
    for %%P in (
        "C:\Program Files\nodejs\node.exe"
        "C:\Program Files (x86)\nodejs\node.exe"
    ) do (
        if not defined NODE (
            if exist %%P set "NODE=%%~P"
        )
    )
)

if not defined NODE (
    echo  [ERROR] Node.js not found!
    echo          Please install from https://nodejs.org/
    pause & exit /b 1
)
echo  [OK] Node.js found.

:: npm.cmd lives beside node.exe in the standard Windows installation.
for %%N in ("%NODE%") do if exist "%%~dpNnpm.cmd" set "NPM=%%~dpNnpm.cmd"
if not defined NPM (
    for /f "delims=" %%N in ('where npm.cmd 2^>nul') do (
        if not defined NPM set "NPM=%%N"
    )
)

if not exist "%BACKEND%\node_modules" (
    if not defined NPM (
        echo  [ERROR] npm.cmd was not found beside Node.js or in PATH.
        echo          Repair or reinstall Node.js, then run this launcher again.
        pause & exit /b 1
    )
    echo  [INFO] First time setup - installing packages...
    pushd "%BACKEND%"
    call "%NPM%" ci --no-audit --no-fund
    if errorlevel 1 (
        popd
        echo  [ERROR] Package installation failed. Review the npm error above.
        pause & exit /b 1
    )
    popd
    echo  [OK] Packages installed.
)

:: Validate required environment and project files before starting.
pushd "%BACKEND%"
"%NODE%" scripts\preflight.js
if errorlevel 1 (
    popd
    echo.
    echo  [ERROR] Deployment preflight failed.
    echo          Configure backend\.env using backend\.env.example, then run again.
    pause & exit /b 1
)
popd

:: -------------------------------------------------------
:: STEP 4: Start Backend
:: -------------------------------------------------------
echo  [3/4] Starting Backend...

netstat -an 2>nul | findstr /C:":5000 " | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo  [OK] Backend - Already running!
    goto :open_browser
)

if not exist "%BACKEND%\logs" mkdir "%BACKEND%\logs"
set "STARTUP_LOG=%BACKEND%\logs\launcher-startup.log"
>"%STARTUP_LOG%" echo Backend startup log - %DATE% %TIME%
:: START handles the working directory, avoiding a fragile nested "cd && node"
:: command. The extra opening quote is required by cmd.exe when NODE is quoted.
start "MTVTMS Backend - DO NOT CLOSE" /min /D "%BACKEND%" "%ComSpec%" /d /c ""%NODE%" server.js 1>>"%STARTUP_LOG%" 2>&1"

set "B=0"
for /l %%i in (1,1,120) do (
    if "!B!"=="0" (
        timeout /t 1 /nobreak >nul
        netstat -an 2>nul | findstr /C:":5000 " | findstr /C:"LISTENING" >nul 2>&1
        if not errorlevel 1 set "B=1"
    )
)

if "!B!"=="1" (
    echo  [OK] Backend  - Running on port 5000!
) else (
    echo  [ERROR] Backend did not start on port 5000.
    echo.
    echo  ---------------- BACKEND STARTUP LOG ----------------
    type "%STARTUP_LOG%"
    echo  -----------------------------------------------------
    echo.
    echo          Send a screenshot of the log above if you need help.
    pause & exit /b 1
)
echo.

:: -------------------------------------------------------
:: STEP 5: Open Browser
:: -------------------------------------------------------
:open_browser
echo  [4/4] Opening browser...
powershell.exe -NoProfile -Command "try { Start-Process -FilePath '%URL%' -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    start "" "%URL%"
)
if errorlevel 1 (
    echo  [WARNING] Windows could not open the default browser automatically.
    echo            Copy and open this address manually:
    echo            %URL%
    pause
) else (
    echo  [OK] Browser launch requested: %URL%
)

echo.
echo  ============================================================
echo   LOCAL SERVICES READY!
echo   Municipal Traffic Violation Ticketing and Management System
echo  ============================================================
echo.
timeout /t 5 /nobreak >nul
endlocal
