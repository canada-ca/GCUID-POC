<#
.SYNOPSIS
    Run all GCUID smoke tests in sequence.

.DESCRIPTION
    Wraps scripts/run-smokes.js (the cross-platform dispatcher). Passes through
    all arguments. Use this from the repository root the same way you use
    start-dev.ps1 / stop-dev.bat.

.PARAMETER Args
    Any arguments to forward to run-smokes.js (e.g. --list, --all, invariants).

.EXAMPLE
    .\run-smokes.ps1                  # default: live-stack-compatible smokes
    .\run-smokes.ps1 --list           # show all available smokes
    .\run-smokes.ps1 --all            # include destructive smokes (no stack running)
    .\run-smokes.ps1 invariants       # run smokes matching "invariants"

.NOTES
    Exit codes:
        0  - all smokes passed
        1  - one or more smokes failed
        2  - orchestrator crashed
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args = @()
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -Path (Join-Path $PSScriptRoot '.')).Path
$Dispatcher = Join-Path $RepoRoot 'scripts/run-smokes.js'

if (-not (Test-Path -Path $Dispatcher)) {
    Write-Error "Dispatcher not found at $Dispatcher"
    exit 2
}

# Ensure dependencies are installed (tsx may live at staging/node_modules/.bin/tsx.cmd
# OR at root node_modules/.bin/tsx.cmd when staging/ is a root workspace and deps hoist)
$StagingDir = Join-Path $RepoRoot 'staging'
$TsxCmd = Join-Path $StagingDir 'node_modules/.bin/tsx.cmd'
if (-not (Test-Path -Path $TsxCmd)) {
    $TsxCmd = Join-Path $RepoRoot 'node_modules/.bin/tsx.cmd'
}
if (-not (Test-Path -Path $TsxCmd)) {
    Write-Host "Installing staging dependencies (one-time)..." -ForegroundColor Yellow
    Push-Location $StagingDir
    try { npm install --silent } finally { Pop-Location }
}

# Forward all args to the dispatcher via node
$ArgList = @($Dispatcher) + $Args
& node @ArgList
exit $LASTEXITCODE
