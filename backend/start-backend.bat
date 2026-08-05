
@echo off
rem Start-backend wrapper for Scheduled Task with debug logging
cd /d "%~dp0"
set "LOGS=%~dp0logs"
if not exist "%LOGS%" mkdir "%LOGS%"

echo ========== START %DATE% %TIME% ==========%~n0 >> "%LOGS%\start.log"
echo CURRENT DIR: %CD% >> "%LOGS%\start.log"
echo PATH: %PATH% >> "%LOGS%\start.log"
echo ---- where node ---- >> "%LOGS%\start.log"
where node >> "%LOGS%\start.log" 2>>&1 || echo where returned non-zero >> "%LOGS%\start.log"

rem try to capture node full path
set "NODE="
for /f "delims=" %%N in ('where node 2^>nul') do set "NODE=%%~N"
if not defined NODE (
	echo Node not found in PATH >> "%LOGS%\start.log"
) else (
	echo Node resolved to: %NODE% >> "%LOGS%\start.log"
)

rem Wait up to 2 minutes for MySQL (port 3306) to be available (PowerShell)
powershell -NoProfile -Command "$max=60; for ($i=0;$i -lt $max; $i++) { $r=Test-NetConnection -ComputerName 'localhost' -Port 3306 -WarningAction SilentlyContinue; if ($r.TcpTestSucceeded) { exit 0 }; Start-Sleep -Seconds 2 }; exit 0" >> "%LOGS%\start.log" 2>>&1

rem Start the Node backend and redirect output to logs
if defined NODE (
    "%NODE%" server.js >> "%LOGS%\out.log" 2>> "%LOGS%\err.log"
) else (
    echo Cannot start server; node not found >> "%LOGS%\err.log"
)

echo ========== END %DATE% %TIME% ==========%~n0 >> "%LOGS%\start.log"
