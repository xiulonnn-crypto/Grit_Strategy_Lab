[CmdletBinding()]
param(
    [switch]$Quick,
    [string]$TaskSlug = 'factor-factory-lineage-sanity',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $repoRoot 'web'
$taskDir = Join-Path (Join-Path $repoRoot $OutputRoot) $TaskSlug
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonExe = if (Test-Path -LiteralPath $venvPython) { $venvPython } else { 'python' }
$steps = [System.Collections.Generic.List[object]]::new()
$script:StartedAt = (Get-Date).ToString('o')

New-Item -ItemType Directory -Force -Path $taskDir | Out-Null

function Write-Utf8Text {
    param(
        [string]$Path,
        [string]$Text
    )
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function ConvertTo-SafeName {
    param([string]$Name)
    return (($Name.ToLowerInvariant() -replace '[^a-z0-9_.-]+', '-') -replace '(^-+|-+$)', '')
}

function Add-Step {
    param(
        [string]$Name,
        [string]$Status,
        [int]$ExitCode,
        [double]$DurationSeconds,
        [string]$StdoutPath = '',
        [string]$StderrPath = '',
        [string[]]$Details = @()
    )
    [void]$steps.Add([pscustomobject][ordered]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        duration_seconds = [Math]::Round($DurationSeconds, 3)
        stdout = $StdoutPath
        stderr = $StderrPath
        details = $Details
    })
}

function Invoke-ExternalStep {
    param(
        [string]$Name,
        [string]$File,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot
    )
    $safeName = ConvertTo-SafeName $Name
    $stdoutPath = Join-Path $taskDir "$safeName.stdout.txt"
    $stderrPath = Join-Path $taskDir "$safeName.stderr.txt"
    $startedAt = Get-Date
    $exitCode = 1
    $stdoutText = ''
    $stderrText = ''

    Push-Location -LiteralPath $WorkingDirectory
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $File @Arguments 2>&1
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        $stdoutText = ($output | Out-String)
    } catch {
        $exitCode = 1
        $stderrText = $_.Exception.Message
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    $duration = (Get-Date) - $startedAt
    Write-Utf8Text -Path $stdoutPath -Text $stdoutText
    Write-Utf8Text -Path $stderrPath -Text $stderrText
    $status = if ($exitCode -eq 0) { 'ok' } else { 'failed' }
    Add-Step -Name $Name -Status $status -ExitCode $exitCode -DurationSeconds $duration.TotalSeconds -StdoutPath $stdoutPath -StderrPath $stderrPath
}

function Invoke-ContentSanity {
    $startedAt = Get-Date
    $issues = [System.Collections.Generic.List[string]]::new()
    $checks = @(
        @{ path = 'src\grit_backtest_platform\factor_factory_lineage.py'; text = 'build_factor_factory_artifact_manifest' },
        @{ path = 'src\grit_backtest_platform\factor_factory_lineage.py'; text = 'build_factor_factory_batch_lineage' },
        @{ path = 'src\grit_backtest_platform\factor_factory_lineage.py'; text = 'publish_blocker_reason_cn' },
        @{ path = 'src\grit_backtest_platform\operator_engine.py'; text = 'build_factor_factory_artifact_manifest' },
        @{ path = 'src\grit_backtest_platform\_real_service_rebuilt.py'; text = 'build_factor_factory_artifact_manifest' },
        @{ path = 'src\grit_backtest_platform\_real_service_rebuilt.py'; text = 'build_factor_factory_batch_lineage' },
        @{ path = 'src\grit_backtest_platform\api.py'; text = '/factor-factory/batch-lineage' },
        @{ path = 'src\grit_backtest_platform\models.py'; text = 'FactorFactoryBatchLineage' },
        @{ path = 'web\src\types.ts'; text = 'ApiFactorFactoryBatchLineage' },
        @{ path = 'web\src\pages\factor-factory-page.tsx'; text = 'batchLineage' },
        @{ path = 'web\src\factor.factory.test.tsx'; text = 'uses canonical batch lineage totals instead of preview and first-page counts' }
    )

    foreach ($check in $checks) {
        $path = Join-Path $repoRoot ([string]$check.path)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            [void]$issues.Add("missing file: $($check.path)")
            continue
        }
        $match = Select-String -LiteralPath $path -SimpleMatch -Pattern ([string]$check.text) -Quiet
        if (-not $match) {
            [void]$issues.Add("missing text in $($check.path): $($check.text)")
        }
    }

    $duration = (Get-Date) - $startedAt
    $outPath = Join-Path $taskDir 'content-sanity.txt'
    $text = if ($issues.Count -eq 0) { "ok`n" } else { ($issues -join "`n") + "`n" }
    Write-Utf8Text -Path $outPath -Text $text
    $status = if ($issues.Count -eq 0) { 'ok' } else { 'failed' }
    Add-Step -Name 'content sanity' -Status $status -ExitCode $issues.Count -DurationSeconds $duration.TotalSeconds -StdoutPath $outPath -Details @($issues)
}

function Invoke-WhitespaceSanity {
    $startedAt = Get-Date
    $issues = [System.Collections.Generic.List[string]]::new()
    $paths = @(
        'scripts\codex-factor-factory-lineage-sanity.ps1',
        'scripts\factor_factory_lineage_preflight.py',
        'src\grit_backtest_platform\factor_factory_lineage.py',
        'src\grit_backtest_platform\operator_engine.py',
        'src\grit_backtest_platform\_real_service_rebuilt.py',
        'src\grit_backtest_platform\api.py',
        'src\grit_backtest_platform\models.py',
        'tests\test_factor_factory_api.py',
        'tests\test_factor_quarantine_api.py',
        'web\src\factor.factory.test.tsx',
        'web\src\lib\demoStoreContext.tsx',
        'web\src\pages\factor-factory-page.tsx',
        'web\src\testApiMock.ts',
        'web\src\types.ts'
    )
    foreach ($relative in $paths) {
        $full = Join-Path $repoRoot $relative
        if (Test-Path -LiteralPath $full -PathType Leaf) {
            $matches = Select-String -LiteralPath $full -Pattern '[ \t]+$'
            foreach ($match in $matches) {
                [void]$issues.Add("${relative}:$($match.LineNumber): trailing whitespace")
            }
        }
    }
    $duration = (Get-Date) - $startedAt
    $outPath = Join-Path $taskDir 'whitespace-sanity.txt'
    $text = if ($issues.Count -eq 0) { "ok`n" } else { ($issues -join "`n") + "`n" }
    Write-Utf8Text -Path $outPath -Text $text
    $status = if ($issues.Count -eq 0) { 'ok' } else { 'failed' }
    Add-Step -Name 'owned whitespace sanity' -Status $status -ExitCode $issues.Count -DurationSeconds $duration.TotalSeconds -StdoutPath $outPath -Details @($issues)
}

function Write-Summary {
    $failed = @($steps | Where-Object { $_.status -ne 'ok' })
    $status = if ($failed.Count -eq 0) { 'ok' } else { 'failed' }
    $summary = [pscustomobject][ordered]@{
        status = $status
        quick = [bool]$Quick
        started_at = $script:StartedAt
        completed_at = (Get-Date).ToString('o')
        task_dir = $taskDir
        steps = @($steps)
    }
    $jsonPath = Join-Path $taskDir 'factor-factory-lineage-sanity-summary.json'
    $mdPath = Join-Path $taskDir 'factor-factory-lineage-sanity-summary.md'
    Write-Utf8Text -Path $jsonPath -Text (($summary | ConvertTo-Json -Depth 12) + "`n")

    $lines = [System.Collections.Generic.List[string]]::new()
    [void]$lines.Add('# Factor Factory Lineage Sanity')
    [void]$lines.Add('')
    [void]$lines.Add("status = $status")
    [void]$lines.Add("quick = $([bool]$Quick)")
    [void]$lines.Add('')
    [void]$lines.Add('## Steps')
    foreach ($step in $steps) {
        [void]$lines.Add("- [$($step.status)] $($step.name) (duration=$($step.duration_seconds)s)")
        if ($step.stdout) {
            [void]$lines.Add("  stdout=$($step.stdout)")
        }
        if ($step.stderr) {
            [void]$lines.Add("  stderr=$($step.stderr)")
        }
    }
    Write-Utf8Text -Path $mdPath -Text (($lines -join "`n") + "`n")

    if ($Json) {
        $summary | ConvertTo-Json -Depth 12
    } else {
        Write-Host "Factor Factory lineage sanity: $status"
        Write-Host "Summary: $mdPath"
    }
    if ($failed.Count -gt 0) {
        throw "Factor Factory lineage sanity failed. See $mdPath"
    }
}

Invoke-ExternalStep -Name 'py compile lineage files' -File $pythonExe -Arguments @(
    '-m', 'py_compile',
    'src/grit_backtest_platform/factor_factory_lineage.py',
    'src/grit_backtest_platform/operator_engine.py',
    'src/grit_backtest_platform/_real_service_rebuilt.py',
    'src/grit_backtest_platform/api.py',
    'src/grit_backtest_platform/models.py',
    'scripts/factor_factory_lineage_preflight.py'
)
Invoke-ExternalStep -Name 'lineage preflight strict' -File $pythonExe -Arguments @('scripts/factor_factory_lineage_preflight.py', '--strict')
Invoke-ContentSanity
Invoke-WhitespaceSanity
Invoke-ExternalStep -Name 'backend focused lineage tests' -File $pythonExe -Arguments @(
    '-m', 'pytest',
    'tests/test_factor_factory_api.py',
    'tests/test_factor_quarantine_api.py',
    '-q'
)
Invoke-ExternalStep -Name 'frontend focused factor factory vitest' -File 'node' -Arguments @('scripts/run-vitest-fixed.cjs', 'factor.factory.test.tsx') -WorkingDirectory $webDir

if (-not $Quick) {
    Invoke-ExternalStep -Name 'backend owner slice' -File $pythonExe -Arguments @(
        '-m', 'pytest',
        'tests/test_factor_research_api.py',
        'tests/test_backend_api.py',
        'tests/test_factor_mining_api.py',
        'tests/test_factor_factory_api.py',
        'tests/test_factor_quarantine_api.py',
        '-q'
    )
    Invoke-ExternalStep -Name 'frontend owner slice' -File 'node' -Arguments @(
        'scripts/run-vitest-fixed.cjs',
        'factors.phase0.f1.test.tsx',
        'factor.model-builder.test.tsx',
        'factor.factory.test.tsx',
        'app.routes.foundation.test.tsx'
    ) -WorkingDirectory $webDir
}

Write-Summary
