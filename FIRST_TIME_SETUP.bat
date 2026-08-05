@echo off
setlocal
cd /d "%~dp0"
title VVS First-Time Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIRST_TIME_SETUP.ps1"
set "SETUP_EXIT=%ERRORLEVEL%"
if not "%SETUP_EXIT%"=="0" (
  echo.
  echo Setup did not finish. Review the message above.
  pause
)
endlocal & exit /b %SETUP_EXIT%
