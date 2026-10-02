@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM Run all GCUID smoke tests in sequence.
REM
REM Wraps scripts\run-smokes.js (the cross-platform dispatcher). Passes through
REM all arguments. Use this from the repository root the same way you use
REM start-dev.bat / stop-dev.bat.
REM
REM Usage:
REM     run-smokes.bat                  default -- live-stack-compatible smokes
REM     run-smokes.bat --list           show all available smokes
REM     run-smokes.bat --all            include destructive smokes (no stack)
REM     run-smokes.bat invariants       run smokes matching "invariants"
REM
REM Exit codes:
REM   0  - all smokes passed
REM   1  - one or more smokes failed
REM   2  - orchestrator crashed
REM ============================================================================

set REPO_ROOT=%~dp0
set DISPATCHER=%REPO_ROOT%scripts\run-smokes.js

if not exist "%DISPATCHER%" (
    echo ERROR: dispatcher not found at %DISPATCHER% 1>&2
    exit /b 2
)

REM Ensure dependencies are installed (tsx may live at staging\node_modules\.bin\tsx.cmd
REM OR at root node_modules\.bin\tsx.cmd when staging/ is a root workspace and deps hoist)
set TSX_CMD=%REPO_ROOT%staging\node_modules\.bin\tsx.cmd
if not exist "%TSX_CMD%" (
    set TSX_CMD=%REPO_ROOT%node_modules\.bin\tsx.cmd
)
if not exist "%TSX_CMD%" (
    echo Installing staging dependencies ^(one-time^)...
    pushd "%REPO_ROOT%staging"
    call npm install --silent
    popd
)

REM Forward all args to the dispatcher
node "%DISPATCHER%" %*
exit /b %ERRORLEVEL%
