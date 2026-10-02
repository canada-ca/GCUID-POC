@echo off
setlocal enabledelayedexpansion

:: ======================================================
::  GCUID Development Environment — Stop Script
::  Kills processes listening on API, Web UI, and
::  connector ports.
::
::  Usage:
::    stop-dev.bat
:: ======================================================

echo.
echo ======================================================
echo   GCUID Development Environment — Stopping
echo ======================================================
echo.

:: Ports to kill: API, Web UI, Connectors
for %%P in (5182 5181 5183 5184 5185 5186) do (
    call :kill_port %%P
)

echo.
echo ======================================================
echo   All services stopped.
echo ======================================================
echo.
goto :eof

:: ── Subroutine: kill_port ────────────────────────────
:: Finds and kills the process listening on %~1
:kill_port
set _port=%~1
set _killed=0

for /f "tokens=5" %%A in ('netstat -ano 2^>nul ^| findstr /r "\<0\.0\.0\.0:%_port%\> \<\[::\]:%_port%\>"') do (
    if "%%A" NEQ "0" (
        if "%%A" NEQ "" (
            taskkill /F /PID %%A >nul 2>&1
            if not errorlevel 1 (
                echo   STOP  Port %_port%  (PID %%A)
                set _killed=1
            )
        )
    )
)

if "!_killed!"=="0" (
    echo   SKIP  Port %_port%  (nothing listening)
)
goto :eof
