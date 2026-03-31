[CmdletBinding()]
param(
    [ValidateSet('all', 'backend', 'frontend')]
    [string]$Target = 'all',

    [string[]]$PytestArgs = @(),
    [string[]]$FrontendArgs = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $repoRoot 'web'
$recoveryRoot = Join-Path $repoRoot '.tmp\recovery-test-runtime'
$pythonTmp = Join-Path $recoveryRoot 'tmp'
$pytestTmp = Join-Path $recoveryRoot 'pytest'
$frontendTmp = Join-Path $recoveryRoot 'frontend'

New-Item -ItemType Directory -Path $pythonTmp, $pytestTmp, $frontendTmp -Force | Out-Null

$originalTmp = $env:TMP
$originalTemp = $env:TEMP
$originalTmpDir = $env:TMPDIR
$originalPytestAddopts = $env:PYTEST_ADDOPTS

function Set-RecoveryEnvironment {
    $env:TMP = $pythonTmp
    $env:TEMP = $pythonTmp
    $env:TMPDIR = $pythonTmp

    $baseline = if ([string]::IsNullOrWhiteSpace($originalPytestAddopts)) {
        "--basetemp=`"$pytestTmp`""
    } else {
        if ($originalPytestAddopts -match '--basetemp=') {
            $originalPytestAddopts
        } else {
            "$originalPytestAddopts --basetemp=`"$pytestTmp`""
        }
    }
    $env:PYTEST_ADDOPTS = $baseline

    $esbuildCandidates = @(
        (Join-Path $webDir 'node_modules\@esbuild\win32-x64\esbuild.exe'),
        (Join-Path $webDir 'node_modules\esbuild\bin\esbuild.exe'),
        (Join-Path $webDir 'node_modules\esbuild\bin\esbuild')
    )
    $selectedEsbuildBinary = $null
    foreach ($candidate in $esbuildCandidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        if (Test-Path -LiteralPath $candidate) {
            $selectedEsbuildBinary = $candidate
            break
        }
    }
    if ($null -ne $selectedEsbuildBinary) {
        $env:ESBUILD_BINARY_PATH = $selectedEsbuildBinary
    }

    $env:TMPDIR = $frontendTmp
    $env:VITEST_TMPDIR = $frontendTmp
}

function Restore-RecoveryEnvironment {
    if ($null -ne $originalTmp) { $env:TMP = $originalTmp } else { Remove-Item Env:TMP -ErrorAction SilentlyContinue }
    if ($null -ne $originalTemp) { $env:TEMP = $originalTemp } else { Remove-Item Env:TEMP -ErrorAction SilentlyContinue }
    if ($null -ne $originalTmpDir) { $env:TMPDIR = $originalTmpDir } else { Remove-Item Env:TMPDIR -ErrorAction SilentlyContinue }
    if ($null -ne $originalPytestAddopts) { $env:PYTEST_ADDOPTS = $originalPytestAddopts } else { Remove-Item Env:PYTEST_ADDOPTS -ErrorAction SilentlyContinue }
    Remove-Item Env:ESBUILD_BINARY_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:VITEST_TMPDIR -ErrorAction SilentlyContinue
}

function Invoke-Captured {
    param(
        [string]$Name,
        [scriptblock]$Script
    )

    Write-Host ("{0}..." -f $Name) -ForegroundColor Cyan
    try {
        $output = & $Script 2>&1
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            throw "$Name failed (exit=$code)`n$($output -join "`n")"
        }
    } catch {
        throw $_
    }
}

function Run-BackendTests {
    $venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
    $pythonExe = if (Test-Path -LiteralPath $venvPython) {
        $venvPython
    } else {
        $pythonCommand = (Get-Command python -ErrorAction SilentlyContinue)
        if (-not $pythonCommand) {
            throw "Python executable not found in PATH. Please ensure .venv is initialized or python is available."
        }
        $pythonCommand.Source
    }

    $run = {
        Set-Location -LiteralPath $repoRoot
        if ($PytestArgs.Count -gt 0) {
            & $pythonExe -m pytest @PytestArgs
        } else {
            & $pythonExe -m pytest
        }
    }
    Invoke-Captured -Name 'Backend pytest' -Script $run
}

function Run-FrontendTests {
    $npmCommand = {
        Set-Location -LiteralPath $webDir
        $npmCmd = $env:NPM_CMD
        if ([string]::IsNullOrWhiteSpace($npmCmd)) {
            $npmCommandFromPath = (Get-Command npm -ErrorAction SilentlyContinue)
            if ($npmCommandFromPath) {
                $npmCmd = $npmCommandFromPath.Source
            } else {
                $npmLocal = Join-Path $webDir 'node_modules\.bin\npm.cmd'
                if (Test-Path -LiteralPath $npmLocal) {
                    $npmCmd = $npmLocal
                } else {
                    throw "npm executable not found in PATH and web/node_modules/.bin\\npm.cmd is missing."
                }
            }
        }

        if ($FrontendArgs.Count -gt 0) {
            & $npmCmd run test -- @FrontendArgs
        } else {
            & $npmCmd run test
        }
    }

    try {
        Invoke-Captured -Name 'Frontend npm test' -Script $npmCommand
        return
    } catch {
        $raw = $_ | Out-String
        Write-Warning ("npm test failed. detail:`n{0}" -f $raw)

        $shouldFallback = $raw -match 'spawn EPERM' -or
            $raw -match 'npm.cmd' -or
            $raw -match 'CommandNotFoundException' -or
            $raw -match 'not recognized' -or
            $raw -match 'The system cannot find the file'

        if (-not $shouldFallback) {
            throw $_
        }
        Write-Warning 'Detected EPERM when spawning esbuild via npm test. Falling back to direct vitest invocation.'
    }

    $vitestFallback = Join-Path $webDir 'node_modules\vitest\vitest.mjs'
    if (-not (Test-Path -LiteralPath $vitestFallback)) {
        throw "Fallback vitest entrypoint not found at $vitestFallback. Please verify npm install in web/ and rerun."
    }

    $fallback = {
        Set-Location -LiteralPath $webDir
        if ($FrontendArgs.Count -gt 0) {
            & node $vitestFallback run @FrontendArgs
        } else {
            & node $vitestFallback run
        }
    }
    try {
        Invoke-Captured -Name 'Frontend vitest fallback' -Script $fallback
    } catch {
        $raw = $_ | Out-String
        Write-Warning ("Fallback vitest execution failed:`n{0}" -f $raw)
        throw "Frontend fallback still failed. In this environment Node child-process spawn may be denied (EPERM). Re-run in a non-sandboxed shell."
    }
}

function Show-FrontendPreconditions {
    Write-Host 'Frontend test preconditions:' -ForegroundColor Yellow
    Write-Host '1) Run .\\scripts\\run-recovery-tests.ps1 -Target frontend from repository root.'
    Write-Host ('2) Ensure writable temp root: {0}' -f $frontendTmp)
    Write-Host '3) If EPERM persists, lock down antivirus/sandbox or run under a shell with Node child-process execution permission.'
    Write-Host '4) Confirm Node can spawn child process: node -e "const cp=require('child_process'); cp.spawn(process.execPath,[''-v''])"'
}

try {
    Set-RecoveryEnvironment
    switch ($Target) {
        'backend' {
            Run-BackendTests
            break
        }
        'frontend' {
            Run-FrontendTests
            break
        }
        default {
            Run-BackendTests
            Run-FrontendTests
        }
    }
} finally {
    Restore-RecoveryEnvironment
    Show-FrontendPreconditions
}
