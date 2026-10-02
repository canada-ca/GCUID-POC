@echo off
setlocal enabledelayedexpansion

:: ======================================================
::  GCUID Development Environment
::  Starts: API server, Web UI, source servers, connector services
::
::  Usage:
::    start-dev.bat               — start everything
::    start-dev.bat /no-connectors — skip connectors
::    start-dev.bat /no-web        — skip Web UI
::    start-dev.bat /no-sources    — skip source servers
:: ======================================================

set REPO_ROOT=%~dp0
set STAGING_DIR=%REPO_ROOT%staging

set API_PORT=5182
set WEB_PORT=5181

set SKIP_CONNECTORS=0
set SKIP_WEB=0
set SKIP_SOURCES=0

:: Parse arguments
:parse_args
if "%~1"=="" goto done_args
if /i "%~1"=="/no-connectors" set SKIP_CONNECTORS=1
if /i "%~1"=="/no-web"        set SKIP_WEB=1
if /i "%~1"=="/no-sources"    set SKIP_SOURCES=1
shift
goto parse_args
:done_args

echo.
echo ======================================================
echo   GCUID Development Environment
echo ======================================================
echo.

:: ── Preflight ─────────────────────────────────────────

if not exist "%STAGING_DIR%\package.json" (
    echo ERROR: staging\package.json not found.
    echo Run this script from the repository root.
    pause
    exit /b 1
)

if not exist "%STAGING_DIR%\data\registry.db" (
    echo No database found -- running seed-data...
    pushd "%STAGING_DIR%"
    call npm run seed-data
    popd
    echo Databases created.
    echo.
)

:: Check that the runtime npm packages are installed. Without these,
:: npm run start-api / start-web / start-connectors all fail silently
:: inside their `cmd /k` wrappers (tsx / vite are not on PATH and the
:: launcher returns success immediately, so the dev scenario looks
:: started but no service ever binds a port).
::
:: After staging/ was added as a root workspace (commit 4cb2da7), npm
:: hoists staging's deps to root node_modules. We accept either
:: location for the runtime packages.
::
:: Implementation note - cmd.exe has a subtle scoping rule: a `set` inside
:: a parenthesised block runs in a subshell and its writes do not propagate
:: back to the outer scope. The original script had the for loop inside
:: an `else (...)` block, so the loop's flag updates were discarded - it
:: worked only because the directory check above the loop always set the
:: flag in the outer scope first. Now that we accept either
:: staging/node_modules or root/node_modules, the per-package loop is the
:: only way the flag can flip, so the loop must run at the top level (no
:: else-parenthesised wrapper) for its `set` writes to be visible.
set STAGING_NODE_MODULES=%STAGING_DIR%\node_modules
set ROOT_NODE_MODULES=%REPO_ROOT%node_modules
set WEBUI_NODE_MODULES=%STAGING_DIR%\web-ui\node_modules
set NPM_INSTALL_FAILED=0

if not exist "%STAGING_NODE_MODULES%" if not exist "%ROOT_NODE_MODULES%" (
    echo   MISSING  %STAGING_NODE_MODULES%
    echo           Run: cd staging ^&^& npm install
    set NPM_INSTALL_FAILED=1
)

for %%P in (jexl better-sqlite3 tsx) do (
    if not exist "%STAGING_NODE_MODULES%\%%P" if not exist "%ROOT_NODE_MODULES%\%%P" (
        echo   MISSING  staging\node_modules\%%P  ^(or root node_modules\%%P^)
        echo           Run: cd staging ^&^& npm install
        set NPM_INSTALL_FAILED=1
    )
)

if "%SKIP_WEB%"=="0" if not exist "%WEBUI_NODE_MODULES%" (
    echo   MISSING  %WEBUI_NODE_MODULES%
    echo           Run: cd staging\web-ui ^&^& npm install
    set NPM_INSTALL_FAILED=1
)

if "!NPM_INSTALL_FAILED!"=="1" (
    echo.
    echo Install the missing packages and re-run start-dev.bat.
    exit /b 1
)

:: ── API Server ────────────────────────────────────────

call :check_port %API_PORT% api_in_use
if "%api_in_use%"=="1" (
    echo   SKIP  API Server -- port %API_PORT% already in use
) else (
    echo   START API Server on port %API_PORT%
    start "API Server" cmd /k "cd /d "%STAGING_DIR%" && npm run start-api"
    timeout /t 2 /nobreak >nul
)

:: ── Web UI ────────────────────────────────────────────

if "%SKIP_WEB%"=="1" goto skip_web

call :check_port %WEB_PORT% web_in_use
if "%web_in_use%"=="1" (
    echo   SKIP  Web UI -- port %WEB_PORT% already in use
) else (
    echo   START Web UI on port %WEB_PORT%
    start "Web UI" cmd /k "cd /d "%STAGING_DIR%" && npm run start-web"
    timeout /t 1 /nobreak >nul
)

:skip_web

:: ── Source Servers ────────────────────────────────────
:: Connectors HTTP-proxy to these. Launch first.

if "%SKIP_SOURCES%"=="1" goto skip_sources

set SRC_BLOCKED=0
for %%P in (5188 5189 5190 5191) do (
    call :check_port %%P _tmp
    if "!_tmp!"=="1" set SRC_BLOCKED=1
)

if "%SRC_BLOCKED%"=="1" (
    echo   SKIP  Sources -- one or more ports already in use
) else (
    echo   START Sources on ports 5188, 5189, 5190, 5191
    start "Sources" cmd /k "cd /d "%STAGING_DIR%" && npx tsx scripts/start-sources-all.ts"
)

:skip_sources

:: ── Connectors ────────────────────────────────────────

if "%SKIP_CONNECTORS%"=="1" goto skip_connectors

set CONN_BLOCKED=0
for %%P in (5183 5184 5185 5186) do (
    call :check_port %%P _tmp
    if "!_tmp!"=="1" set CONN_BLOCKED=1
)

if "%CONN_BLOCKED%"=="1" (
    echo   SKIP  Connectors -- one or more ports already in use
) else (
    echo   START Connectors on ports 5183, 5184, 5185, 5186
    start "Connectors" cmd /k "cd /d "%STAGING_DIR%" && npm run start-connectors"
)

:skip_connectors

:: ── Summary ───────────────────────────────────────────

echo.
echo ======================================================
echo   Ready
echo ======================================================
echo.
echo   Web UI      http://localhost:%WEB_PORT%
echo   API         http://localhost:%API_PORT%
echo   API health  http://localhost:%API_PORT%/health
if "%SKIP_CONNECTORS%"=="0" (
    echo   HR          http://localhost:5183
    echo   LDAP        http://localhost:5184
    echo   Engineering http://localhost:5185
    echo   Finance     http://localhost:5186
)
if "%SKIP_SOURCES%"=="0" (
    echo   HR source     http://localhost:5188
    echo   LDAP source   http://localhost:5189
    echo   Eng source    http://localhost:5190
    echo   Fin source    http://localhost:5191
)
echo.
echo   Close each terminal window to stop a service.
echo.
goto :eof

:: ── Subroutine: check_port ────────────────────────────
:: Sets %~2 to 1 if the port is in use, 0 otherwise
:check_port
set %~2=0
netstat -ano 2>nul | findstr /r "\<0\.0\.0\.0:%~1\> \<\[::\]:%~1\>" >nul 2>&1
if not errorlevel 1 set %~2=1
goto :eof
