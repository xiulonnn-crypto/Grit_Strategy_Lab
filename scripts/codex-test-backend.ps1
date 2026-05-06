[CmdletBinding()]
param(
    [string[]]$PytestArgs = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$reportPath = Join-Path $reportDir 'latest-backend.txt'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

function Get-PythonExecutable {
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return $pythonCommand.Source
    }

    throw 'Python executable not found. Initialize .venv or make python available in PATH.'
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

$pythonExe = Get-PythonExecutable
$defaultTests = @(
    'tests\test_backend_api.py'
    'tests\test_composition_api.py'
    'tests\test_creation_session_refresh.py'
    'tests\test_real_backtest_api.py'
    'tests\test_factor_research_api.py'
    'tests\test_factor_expression_engine.py'
    'tests\test_factor_mining_api.py'
    'tests\test_multi_factor_strategy_api.py'
    'tests\test_optimization_execution_resume.py'
    'tests\test_optimization_resume_api.py'
    'tests\test_strategies_smoke.py'
)

Set-Location -LiteralPath $repoRoot

if ($PytestArgs | Where-Object { $_ -eq '--basetemp' -or $_ -like '--basetemp=*' }) {
    throw 'scripts/codex-test-backend.ps1 owns pytest --basetemp. Use the default .tmp\pytest location instead of passing a root-level temp path.'
}

$pytestTempRoot = Join-Path $repoRoot '.tmp\pytest-runtime'
$pythonTemp = Join-Path $pytestTempRoot 'python-temp'
$baseTemp = Join-Path $pytestTempRoot ("codex-backend-{0}" -f (Get-Date -Format 'yyyyMMddHHmmssfff'))
New-Item -ItemType Directory -Path $pythonTemp -Force | Out-Null
New-Item -ItemType Directory -Path $baseTemp -Force | Out-Null

$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalTmpDir = $env:TMPDIR
$exitCode = 1

try {
    $env:TEMP = $pythonTemp
    $env:TMP = $pythonTemp
    $env:TMPDIR = $pythonTemp

    $pytestArgsWithTemp = @('--basetemp', $baseTemp) + $PytestArgs
    $output = & $pythonExe -m pytest @defaultTests @pytestArgsWithTemp 2>&1
    $exitCode = $LASTEXITCODE

    @(
        '# Codex Backend'
        "started_at = $(Get-Date -Format o)"
        "command = $pythonExe -m pytest $($defaultTests -join ' ') $($pytestArgsWithTemp -join ' ')"
        ''
    ) + $output | Set-Content -LiteralPath $reportPath -Encoding utf8

    $output | ForEach-Object { Write-Host $_ }
} finally {
    if ($null -ne $originalTemp) { $env:TEMP = $originalTemp } else { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
    if ($null -ne $originalTmp) { $env:TMP = $originalTmp } else { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
    if ($null -ne $originalTmpDir) { $env:TMPDIR = $originalTmpDir } else { Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue }
}

if ($exitCode -ne 0) {
    throw "Backend codex test failed. See $reportPath"
}
