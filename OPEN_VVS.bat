@echo off
setlocal enabledelayedexpansion
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
:wait_services
timeout /t 1 /nobreak >nul
set "A=0" & set "M=0"
netstat -an 2>nul | findstr /C:":80 " | findstr /C:"LISTENING" >nul 2>&1 && set "A=1"
netstat -an 2>nul | findstr /C:":3306 " | findstr /C:"LISTENING" >nul 2>&1 && set "M=1"
if "!A!"=="0" goto wait_services
if "!M!"=="0" goto wait_services

echo  [OK] Apache  - Running!
echo  [OK] MySQL   - Running!
echo.

:: -------------------------------------------------------
:: STEP 3: Find Node.js
:: -------------------------------------------------------
echo  [2/4] Checking Node.js...
set "NODE="
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

if not exist "%BACKEND%\node_modules" (
    echo  [INFO] First time setup - installing packages...
    pushd "%BACKEND%"
    call npm ci --no-audit --no-fund
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

start "MTVTMS Backend - DO NOT CLOSE" /min cmd /k "cd /d ""%BACKEND%"" && ""%NODE%"" server.js"

set "B=0"
for /l %%i in (1,1,15) do (
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
    echo          Open the backend command window and review the error message.
    pause & exit /b 1
)
echo.

:: -------------------------------------------------------
:: STEP 5: Open Browser
:: -------------------------------------------------------
:open_browser
echo  [4/4] Opening browser...
start "" "%URL%"

echo.
echo  ============================================================
echo   LOCAL SERVICES READY!
echo   Municipal Traffic Violation Ticketing and Management System
echo  ============================================================
echo.
timeout /t 5 /nobreak >nul
endlocal
