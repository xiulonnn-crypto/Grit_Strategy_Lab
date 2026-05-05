[CmdletBinding()]
param(
    [string[]]$FrontendArgs = @(),
    [switch]$StrictGlobalTypes,
    [switch]$IncludeLiveAcceptance,
    [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $repoRoot 'web'
$reportDir = Join-Path $repoRoot 'harness\reports\smoke'
$focusedReportPath = Join-Path $reportDir 'latest-frontend-focused.txt'
$typesReportPath = Join-Path $reportDir 'latest-frontend-global-types.txt'
$liveAcceptanceReportPath = Join-Path $reportDir 'latest-live-acceptance.txt'
$uvicornLogDir = Join-Path $repoRoot '.tmp\live-acceptance'
$uvicornOutLog = Join-Path $uvicornLogDir 'uvicorn-8010.out.log'
$uvicornErrLog = Join-Path $uvicornLogDir 'uvicorn-8010.err.log'
$focusedTests = @(
    'app.routes.foundation.test.tsx'
    'creation-template.route.test.tsx'
    'runs.index.page.test.tsx'
    'composition.dashboard.test.tsx'
    'leg.inventory.test.tsx'
    'composition.workbench.test.tsx'
    'composition.detail.test.tsx'
    'composition.global-index.test.tsx'
    'composition.backtest.result.test.tsx'
    'composition.allocation.test.tsx'
    'creation.flow.test.tsx'
    'factor.sandbox.test.tsx'
    'factor.model-builder.test.tsx'
    'backtest.submit.test.tsx'
    'run-detail.page.test.tsx'
    'workspace.dashboard.test.tsx'
    'snapshots.page.test.tsx'
    'optimization.module.test.tsx'
    'App.phase3.test.tsx'
    'shell-frame.page-heading.test.tsx'
    'quickstart.preview.test.ts'
)
$resolvedTargetRoot = if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.tmp\codex-fixture'))
} else {
    [System.IO.Path]::GetFullPath($TargetRoot)
}

function Get-NodeExecutable {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw 'Node executable not found in PATH.'
    }
    return $nodeCommand.Source
}

function Get-PythonExecutable {
    $venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand) {
        return $pythonCommand.Source
    }

    throw 'Python executable not found. Initialize .venv or make python available in PATH.'
}

function Invoke-LoggedNodeCommand {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$ReportPath,
        [hashtable]$ExtraEnvironment = @{},
        [switch]$ThrowOnError
    )

    $environment = @{}
    foreach ($entry in [System.Environment]::GetEnvironmentVariables().GetEnumerator()) {
        $environment[$entry.Key] = [string]$entry.Value
    }
    foreach ($entry in $ExtraEnvironment.GetEnumerator()) {
        $environment[$entry.Key] = [string]$entry.Value
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $quotedArguments = $Arguments | ForEach-Object {
        $argument = [string]$_
        if ($argument -match '[\s"]') {
            '"' + ($argument -replace '"', '\"') + '"'
        } else {
            $argument
        }
    }
    $startInfo.Arguments = [string]::Join(' ', $quotedArguments)
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $startInfo.CreateNoWindow = $true
    $processEnvironment = $startInfo.Environment
    if ($null -eq $processEnvironment) {
        $processEnvironment = $startInfo.EnvironmentVariables
    }
    $processEnvironment.Clear()
    foreach ($key in $environment.Keys) {
        $processEnvironment[$key] = $environment[$key]
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    $combined = @(
        '# Command'
        "$Executable $($Arguments -join ' ')"
        ''
        '# Stdout'
        $stdout.TrimEnd()
        ''
        '# Stderr'
        $stderr.TrimEnd()
    )
    $combined | Set-Content -LiteralPath $ReportPath -Encoding utf8

    if ($stdout) {
        $stdout.TrimEnd().Split([Environment]::NewLine) | ForEach-Object {
            if ($_ -ne '') { Write-Host $_ }
        }
    }
    if ($stderr) {
        $stderr.TrimEnd().Split([Environment]::NewLine) | ForEach-Object {
            if ($_ -ne '') { Write-Host $_ }
        }
    }

    if ($ThrowOnError -and $process.ExitCode -ne 0) {
        throw "Frontend command failed. See $ReportPath"
    }

    return $process.ExitCode
}

function Wait-ForBackendReady {
    param(
        [string]$BaseUrl
    )

    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try {
            $null = Invoke-WebRequest -Uri "$BaseUrl/workspace/overview" -UseBasicParsing -TimeoutSec 2
            return
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timed out waiting for live acceptance backend at $BaseUrl"
}

New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
New-Item -ItemType Directory -Path $uvicornLogDir -Force | Out-Null

$nodeExe = Get-NodeExecutable
$pythonExe = Get-PythonExecutable
$vitestEntry = Join-Path $webDir 'node_modules\vitest\vitest.mjs'
$tscEntry = Join-Path $webDir 'node_modules\typescript\bin\tsc'
$liveAcceptanceRunner = Join-Path $webDir 'scripts\run-live-acceptance.cjs'

foreach ($requiredPath in @($vitestEntry, $tscEntry, $liveAcceptanceRunner)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required frontend tool is missing: $requiredPath"
    }
}

$focusedArguments = @($vitestEntry, 'run') + $focusedTests + $FrontendArgs
$focusedExitCode = Invoke-LoggedNodeCommand `
    -Executable $nodeExe `
    -Arguments $focusedArguments `
    -WorkingDirectory $webDir `
    -ReportPath $focusedReportPath `
    -ThrowOnError

$typesExitCode = Invoke-LoggedNodeCommand `
    -Executable $nodeExe `
    -Arguments @($tscEntry, '--noEmit') `
    -WorkingDirectory $webDir `
    -ReportPath $typesReportPath

if ($StrictGlobalTypes -and $typesExitCode -ne 0) {
    throw "Global TypeScript validation failed in strict mode. See $typesReportPath"
}

if ($IncludeLiveAcceptance) {
    $fixtureDbPath = & (Join-Path $PSScriptRoot 'codex-reset-fixture.ps1') -TargetRoot $resolvedTargetRoot
    $fixtureDbPath = ($fixtureDbPath | Select-Object -Last 1).Trim()
    $fixtureManifestPath = Join-Path $resolvedTargetRoot 'manifest.json'

    if (-not (Test-Path -LiteralPath $fixtureDbPath)) {
        throw "Live acceptance fixture database was not staged: $fixtureDbPath"
    }
    if (-not (Test-Path -LiteralPath $fixtureManifestPath)) {
        throw "Live acceptance manifest was not staged: $fixtureManifestPath"
    }

    $liveBaseUrl = 'http://127.0.0.1:8010'
    $originalDb = $env:GRIT_BACKTEST_DB
    $backendProcess = $null
    try {
        $env:GRIT_BACKTEST_DB = $fixtureDbPath
        if (Test-Path -LiteralPath $uvicornOutLog) { Remove-Item -LiteralPath $uvicornOutLog -Force }
        if (Test-Path -LiteralPath $uvicornErrLog) { Remove-Item -LiteralPath $uvicornErrLog -Force }
        $backendProcess = Start-Process `
            -FilePath $pythonExe `
            -ArgumentList @('-m', 'uvicorn', 'grit_backtest_platform.main:app', '--app-dir', 'src', '--host', '127.0.0.1', '--port', '8010') `
            -WorkingDirectory $repoRoot `
            -RedirectStandardOutput $uvicornOutLog `
            -RedirectStandardError $uvicornErrLog `
            -PassThru

        Wait-ForBackendReady -BaseUrl $liveBaseUrl

        Invoke-LoggedNodeCommand `
            -Executable $nodeExe `
            -Arguments @($liveAcceptanceRunner) `
            -WorkingDirectory $webDir `
            -ReportPath $liveAcceptanceReportPath `
            -ExtraEnvironment @{
                LIVE_API_BASE = $liveBaseUrl
                LIVE_FIXTURE_MANIFEST = $fixtureManifestPath
            } `
            -ThrowOnError | Out-Null
    } finally {
        if ($null -ne $backendProcess -and -not $backendProcess.HasExited) {
            Stop-Process -Id $backendProcess.Id -Force
        }
        if ($null -ne $originalDb) {
            $env:GRIT_BACKTEST_DB = $originalDb
        } else {
            Remove-Item Env:GRIT_BACKTEST_DB -ErrorAction SilentlyContinue
        }
    }
}

if ($focusedExitCode -ne 0) {
    throw "Focused frontend tests failed. See $focusedReportPath"
}
