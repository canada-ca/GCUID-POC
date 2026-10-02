#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start all GCUID development servers
.DESCRIPTION
    Launches the API server, Web UI, and connector services in separate terminal
    windows. Run this from the repository root.
.PARAMETER SkipConnectors
    Skip starting the four connector services (HR, LDAP, Engineering, Finance)
.PARAMETER SkipSources
    Skip starting the four source servers (5188-5191)
.PARAMETER SkipWebUI
    Skip starting the Vite dev server
.EXAMPLE
    .\start-dev.ps1
.EXAMPLE
    .\start-dev.ps1 -SkipConnectors
#>

[CmdletBinding()]
param(
    [switch]$SkipConnectors,
    [switch]$SkipSources,
    [switch]$SkipWebUI
)

$ErrorActionPreference = "Stop"

$REPO_ROOT   = $PSScriptRoot
$STAGING_DIR = Join-Path $REPO_ROOT "staging"

$API_PORT        = 5182
$WEB_PORT        = 5181
$CONNECTOR_PORTS = @(5183, 5184, 5185, 5186)
# Source servers own their own SQLite files; connectors HTTP-proxy to them.
# Ports 5188-5191 (5187 reserved for ea-mcp-bridge — see /e/github/.dev-ports.json).
$SOURCE_PORTS = @(5188, 5189, 5190, 5191)

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  GCUID Development Environment" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# ── Preflight ─────────────────────────────────────────────────────────────────

if (-not (Test-Path (Join-Path $STAGING_DIR "package.json"))) {
    Write-Host "ERROR: staging/package.json not found. Run this script from the repo root." -ForegroundColor Red
    exit 1
}

# Seed databases if they don't exist yet
if (-not (Test-Path (Join-Path $STAGING_DIR "data\registry.db"))) {
    Write-Host "No database found — running seed-data..." -ForegroundColor Yellow
    Push-Location $STAGING_DIR
    npm run seed-data
    Pop-Location
    Write-Host "Databases created." -ForegroundColor Green
    Write-Host ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────

function Test-PortInUse([int]$Port) {
    $null -ne (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
               Where-Object { $_.LocalPort -eq $Port })
}

function Start-Service([string]$Label, [string]$Command, [int]$Port) {
    if (Test-PortInUse $Port) {
        Write-Host "  SKIP  $Label — port $Port already in use" -ForegroundColor Yellow
        return $false
    }
    Write-Host "  START $Label on port $Port" -ForegroundColor Green
    Start-Process pwsh -ArgumentList @(
        "-NoExit",
        "-Command",
        "& { `$host.UI.RawUI.WindowTitle = '$Label'; Set-Location '$STAGING_DIR'; $Command }"
    )
    return $true
}

# ── API Server ─────────────────────────────────────────────────────────────────

Write-Host "API Server" -ForegroundColor Cyan
$apiStarted = Start-Service "API Server" "npm run start-api" $API_PORT
if ($apiStarted) { Start-Sleep -Seconds 2 }

# ── Web UI ─────────────────────────────────────────────────────────────────────

if (-not $SkipWebUI) {
    Write-Host ""
    Write-Host "Web UI" -ForegroundColor Cyan
    $webStarted = Start-Service "Web UI" "npm run start-web" $WEB_PORT
    if ($webStarted) { Start-Sleep -Seconds 1 }
}

# ── Source Servers ─────────────────────────────────────────────────────────────
# Connectors HTTP-proxy to these. Launch first so they're ready when
# connectors try to dial them.

if (-not $SkipSources) {
    Write-Host ""
    Write-Host "Source Servers" -ForegroundColor Cyan
    $anySourceInUse = $SOURCE_PORTS | Where-Object { Test-PortInUse $_ }
    if ($anySourceInUse) {
        Write-Host "  SKIP  Sources — ports already in use ($($anySourceInUse -join ', '))" -ForegroundColor Yellow
    } else {
        Write-Host "  START All source servers (ports 5188, 5189, 5190, 5191)" -ForegroundColor Green
        Start-Process pwsh -ArgumentList @(
            "-NoExit",
            "-Command",
            "& { `$host.UI.RawUI.WindowTitle = 'Sources'; Set-Location '$STAGING_DIR'; npx tsx scripts/start-sources-all.ts }"
        )
    }
}

# ── Connectors ─────────────────────────────────────────────────────────────────

if (-not $SkipConnectors) {
    Write-Host ""
    Write-Host "Connector Services" -ForegroundColor Cyan
    $anyInUse = $CONNECTOR_PORTS | Where-Object { Test-PortInUse $_ }
    if ($anyInUse) {
        Write-Host "  SKIP  Connectors — ports already in use ($($anyInUse -join ', '))" -ForegroundColor Yellow
    } else {
        Write-Host "  START All connectors (ports 5183, 5184, 5185, 5186)" -ForegroundColor Green
        Start-Process pwsh -ArgumentList @(
            "-NoExit",
            "-Command",
            "& { `$host.UI.RawUI.WindowTitle = 'Connectors'; Set-Location '$STAGING_DIR'; npm run start-connectors }"
        )
    }
}

# ── Summary ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Ready" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Web UI      http://localhost:$WEB_PORT" -ForegroundColor White
Write-Host "  API         http://localhost:$API_PORT" -ForegroundColor White
Write-Host "  API health  http://localhost:$API_PORT/health" -ForegroundColor Gray
if (-not $SkipConnectors) {
    Write-Host "  HR          http://localhost:5183" -ForegroundColor White
            Write-Host "  LDAP        http://localhost:5184" -ForegroundColor White
            Write-Host "  Engineering http://localhost:5185" -ForegroundColor White
            Write-Host "  Finance     http://localhost:5186" -ForegroundColor White
}
if (-not $SkipSources) {
    Write-Host "  HR source     http://localhost:5188" -ForegroundColor White
    Write-Host "  LDAP source   http://localhost:5189" -ForegroundColor White
    Write-Host "  Eng source    http://localhost:5190" -ForegroundColor White
    Write-Host "  Fin source    http://localhost:5191" -ForegroundColor White
}
Write-Host ""
Write-Host "  Close each terminal window (or Ctrl+C) to stop a service." -ForegroundColor Gray
Write-Host ""
