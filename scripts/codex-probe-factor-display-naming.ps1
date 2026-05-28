[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$FactorId,

    [string[]]$ExpectedName = @(),
    [string[]]$RejectName = @(),
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$DbPath = $(if ($env:GRIT_BACKTEST_DB) { $env:GRIT_BACKTEST_DB } else { '.grit_backtest_platform.sqlite3' }),
    [string]$TaskSlug = 'factor-display-naming-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [int]$TimeoutSec = 10,
    [switch]$SkipPreflight,
    [switch]$SkipApi,
    [ValidateSet('all', 'factory')]
    [string]$AcceptanceSurface = 'all',
    [switch]$DryRunBackfill,
    [switch]$ApplyBackfill,
    [switch]$Strict,
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
$taskDir = Join-Path (Join-Path $repoRoot $OutputRoot) $TaskSlug
$probeScript = Join-Path $repoRoot 'scripts\factor_naming_probe.py'
$preflightScript = Join-Path $repoRoot 'scripts\codex-grit-runtime-preflight.ps1'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { 'python' }

if (-not (Test-Path $probeScript)) {
    throw "Missing factor naming probe script: $probeScript"
}

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

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value,
        [int]$Depth = 16
    )
    Write-Utf8Text -Path $Path -Text (($Value | ConvertTo-Json -Depth $Depth) + "`n")
}

function Get-Prop {
    param(
        [object]$Object,
        [string]$Name
    )
    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function ConvertTo-Array {
    param([object]$Value)
    if ($null -eq $Value) {
        return @()
    }
    if ($Value -is [array]) {
        return @($Value)
    }
    return @($Value)
}

function Get-IndexedArgument {
    param(
        [string[]]$Values,
        [int]$Index
    )
    if ($Values.Count -eq 0) {
        return ''
    }
    if ($Values.Count -eq 1) {
        return [string]$Values[0]
    }
    if ($Index -lt $Values.Count) {
        return [string]$Values[$Index]
    }
    return ''
}

function ConvertTo-JsonObject {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }
    try {
        return $Text | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Invoke-Preflight {
    $outPath = Join-Path $taskDir 'runtime-preflight.json'
    $errPath = Join-Path $taskDir 'runtime-preflight.stderr.txt'
    $stdout = ''
    $stderr = ''
    $exitCode = 0
    try {
        $stdout = (& powershell -NoProfile -ExecutionPolicy Bypass -File $preflightScript -Json 2>$errPath) | Out-String
        $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
        if (Test-Path $errPath) {
            $stderr = Get-Content -Path $errPath -Raw -Encoding UTF8
        }
        Write-Utf8Text -Path $outPath -Text $stdout
    } catch {
        $exitCode = 1
        $stderr = $_.Exception.Message
        Write-Utf8Text -Path $errPath -Text ($stderr + "`n")
    }
    $payload = ConvertTo-JsonObject $stdout
    return [pscustomobject][ordered]@{
        ok = ($exitCode -eq 0 -and $null -ne $payload)
        exitCode = $exitCode
        output = $outPath
        stderr = $errPath
        quickstartOverall = Get-Prop $payload 'quickstartOverall'
        decision = Get-Prop $payload 'decision'
        nextAction = Get-Prop $payload 'nextAction'
        backendHealthy = Get-Prop $payload 'backendHealthy'
        frontendHealthy = Get-Prop $payload 'frontendHealthy'
        portProbeStatus = Get-Prop $payload 'portProbeStatus'
        parseOk = ($null -ne $payload)
        error = if ($exitCode -eq 0) { $null } else { $stderr }
    }
}

function Invoke-Backfill {
    param([bool]$DryRun)
    $phase = if ($DryRun) { 'dry-run' } else { 'apply' }
    $outPath = Join-Path $taskDir "display-name-v4-backfill-$phase.json"
    $body = @{ dry_run = $DryRun } | ConvertTo-Json -Compress
    $result = $null
    $ok = $false
    $errorText = $null
    try {
        $result = Invoke-RestMethod `
            -Uri (($BackendBaseUrl.TrimEnd('/')) + '/factors/display-name-v4-backfill') `
            -Method Post `
            -ContentType 'application/json; charset=utf-8' `
            -Body $body `
            -TimeoutSec $TimeoutSec
        $ok = $true
    } catch {
        $errorText = $_.Exception.Message
        $result = [pscustomobject][ordered]@{
            ok = $false
            error = $errorText
        }
    }
    Write-JsonFile -Path $outPath -Value $result -Depth 24
    return [pscustomobject][ordered]@{
        ok = $ok
        dryRun = $DryRun
        output = $outPath
        error = $errorText
        result = $result
    }
}

function Invoke-FactorProbeSet {
    param([string]$Phase)

    $items = New-Object System.Collections.Generic.List[object]
    for ($index = 0; $index -lt $FactorId.Count; $index++) {
        $factor = [string]$FactorId[$index]
        $safeFactor = ($factor -replace '[^A-Za-z0-9_.-]', '_')
        $outPath = Join-Path $taskDir "probe-$safeFactor-$Phase.json"
        $tracePath = Join-Path $taskDir "trace-$safeFactor-$Phase.md"
        $stdoutPath = Join-Path $taskDir "probe-$safeFactor-$Phase.stdout.txt"
        $stderrPath = Join-Path $taskDir "probe-$safeFactor-$Phase.stderr.txt"
        $expected = Get-IndexedArgument -Values $ExpectedName -Index $index
        $reject = Get-IndexedArgument -Values $RejectName -Index $index

        $probeArgs = @(
            '-X', 'utf8',
            $probeScript,
            '--factor-id', $factor,
            '--db', $DbPath,
            '--api-base', $BackendBaseUrl,
            '--timeout', ([string]$TimeoutSec),
            '--acceptance-surface', $AcceptanceSurface,
            '--out', $outPath,
            '--trace-matrix', $tracePath
        )
        if ($SkipApi) {
            $probeArgs += '--skip-api'
        }
        if (-not [string]::IsNullOrWhiteSpace($expected)) {
            $probeArgs += @('--expected-name', $expected)
        }
        if (-not [string]::IsNullOrWhiteSpace($reject)) {
            $probeArgs += @('--reject-name', $reject)
        }

        $stdout = ''
        $stderr = ''
        $exitCode = 0
        try {
            $stdout = (& $pythonExe @probeArgs 2>$stderrPath) | Out-String
            $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
            if (Test-Path $stderrPath) {
                $stderr = Get-Content -Path $stderrPath -Raw -Encoding UTF8
            }
            Write-Utf8Text -Path $stdoutPath -Text $stdout
        } catch {
            $exitCode = 1
            $stderr = $_.Exception.Message
            Write-Utf8Text -Path $stderrPath -Text ($stderr + "`n")
        }

        $probePayload = $null
        if (Test-Path $outPath) {
            $probePayload = ConvertTo-JsonObject (Get-Content -Path $outPath -Raw -Encoding UTF8)
        }
        $rawWarnings = @(ConvertTo-Array (Get-Prop $probePayload 'warnings'))
        $warnings = @($rawWarnings)
        if ([string]::IsNullOrWhiteSpace($expected) -and -not [string]::IsNullOrWhiteSpace($reject)) {
            $warnings = @($warnings | Where-Object { [string]$_ -ne 'surface_name_divergence' })
        }
        [void]$items.Add([pscustomobject][ordered]@{
            factorId = $factor
            phase = $Phase
            ok = ($exitCode -eq 0 -and $null -ne $probePayload -and $warnings.Count -eq 0)
            exitCode = $exitCode
            warnings = $warnings
            rawWarnings = $rawWarnings
            output = $outPath
            traceMatrix = $tracePath
            stdout = $stdoutPath
            stderr = $stderrPath
            expectedName = $expected
            rejectName = $reject
        })
    }
    return @($items.ToArray())
}

function Get-FactorDisplayFactTable {
    if ($SkipApi) {
        return [pscustomobject][ordered]@{
            ok = $false
            skipped = $true
            reason = 'SkipApi was supplied.'
        }
    }

    $outPath = Join-Path $taskDir 'online-f2-f3-name-fact-table.json'
    $items = @()
    $errors = New-Object System.Collections.Generic.List[string]
    try {
        $payload = Invoke-RestMethod -Uri (($BackendBaseUrl.TrimEnd('/')) + '/factors?lifecycle=all') -TimeoutSec $TimeoutSec
        $items = @(ConvertTo-Array (Get-Prop $payload 'items'))
    } catch {
        [void]$errors.Add($_.Exception.Message)
    }

    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($item in $items) {
        $tierProjection = Get-Prop $item 'factor_level_projection'
        $tier = [string](Get-Prop $item 'tier_level')
        if ([string]::IsNullOrWhiteSpace($tier)) {
            $tier = [string](Get-Prop $tierProjection 'key')
        }
        if (@('F2', 'F3') -notcontains $tier) {
            continue
        }

        $opStatus = Get-Prop $item 'op_status'
        $completed = @(ConvertTo-Array (Get-Prop $opStatus 'completed') | ForEach-Object { [string]$_ })
        $completedUpper = @($completed | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ })
        $nameAudit = Get-Prop $item 'name_audit'
        $lineageSummary = Get-Prop $item 'lineage_summary'
        $displayName = [string](Get-Prop $item 'display_name_cn')
        if ([string]::IsNullOrWhiteSpace($displayName)) {
            $displayName = [string](Get-Prop $item 'name')
        }
        $baseName = [string](Get-Prop $item 'base_display_name_cn')
        if ([string]::IsNullOrWhiteSpace($baseName)) {
            $baseName = [string](Get-Prop $nameAudit 'base_display_name_cn')
        }
        $fullWnzt = @('W', 'N', 'Z', 'T') | ForEach-Object { $completedUpper -contains $_ }
        $hasFullWnzt = -not ($fullWnzt -contains $false)
        $hasRaw = $displayName.Contains('[Raw]') -or $baseName.Contains('[Raw]')

        [void]$rows.Add([pscustomobject][ordered]@{
            factor_id = [string](Get-Prop $item 'id')
            stored_name = [string](Get-Prop $item 'name')
            projected_name = $displayName
            base_display_name_cn = $baseName
            tier_level = $tier
            lifecycle_status = [string](Get-Prop $item 'lifecycle_status')
            expression = [string](Get-Prop $item 'expression')
            parent_factor_ids = @(ConvertTo-Array (Get-Prop $lineageSummary 'parent_factor_ids'))
            op_status = $opStatus
            benchmark = Get-Prop (Get-Prop $nameAudit 'structured_components') 'benchmark_label'
            residual_control = Get-Prop $item 'residual_control'
            name_collision_group = @(ConvertTo-Array (Get-Prop $item 'name_collision_group'))
            completed_ops = $completedUpper
            has_raw = $hasRaw
            full_wnzt = $hasFullWnzt
        })
    }

    $rawWithFullWnzt = @($rows.ToArray() | Where-Object { $_.has_raw -and $_.full_wnzt })
    $factTable = [pscustomobject][ordered]@{
        ok = ($errors.Count -eq 0)
        skipped = $false
        row_count = $rows.Count
        raw_with_full_wnzt_count = $rawWithFullWnzt.Count
        raw_with_full_wnzt = @($rawWithFullWnzt | Select-Object factor_id, projected_name, base_display_name_cn, lifecycle_status, completed_ops)
        rows = @($rows.ToArray())
        errors = @($errors.ToArray())
    }
    Write-JsonFile -Path $outPath -Value $factTable -Depth 24
    $factTable | Add-Member -NotePropertyName output -NotePropertyValue $outPath
    return $factTable
}

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$preflight = if ($SkipPreflight) {
    [pscustomobject][ordered]@{ ok = $false; skipped = $true; reason = 'SkipPreflight was supplied.' }
} else {
    Invoke-Preflight
}

$probePhases = New-Object System.Collections.Generic.List[object]
$beforeProbes = Invoke-FactorProbeSet -Phase 'before'
[void]$probePhases.Add([pscustomobject][ordered]@{ phase = 'before'; items = @($beforeProbes) })

$backfills = New-Object System.Collections.Generic.List[object]
if ($DryRunBackfill -or $ApplyBackfill) {
    [void]$backfills.Add((Invoke-Backfill -DryRun $true))
}
if ($ApplyBackfill) {
    [void]$backfills.Add((Invoke-Backfill -DryRun $false))
    $afterProbes = Invoke-FactorProbeSet -Phase 'after-backfill'
    [void]$probePhases.Add([pscustomobject][ordered]@{ phase = 'after-backfill'; items = @($afterProbes) })
}

$factTable = Get-FactorDisplayFactTable
$finalProbePhase = @($probePhases.ToArray())[-1]
$finalProbeItems = @(ConvertTo-Array (Get-Prop $finalProbePhase 'items'))
$probeWarnings = @($finalProbeItems | ForEach-Object { ConvertTo-Array (Get-Prop $_ 'warnings') } | Where-Object { $_ })
$probeFailures = @($finalProbeItems | Where-Object { -not (Get-Prop $_ 'ok') })
$backfillFailures = @($backfills.ToArray() | Where-Object { -not (Get-Prop $_ 'ok') })
$rawWithFullWnztCount = [int](Get-Prop $factTable 'raw_with_full_wnzt_count')
$errors = New-Object System.Collections.Generic.List[string]
if ($probeFailures.Count -gt 0) {
    [void]$errors.Add('factor_probe_failed')
}
if ($backfillFailures.Count -gt 0) {
    [void]$errors.Add('backfill_api_failed')
}
if ($rawWithFullWnztCount -gt 0) {
    [void]$errors.Add('raw_name_with_full_wnzt')
}

$status = if ($errors.Count -gt 0 -or $probeWarnings.Count -gt 0) { 'WARN' } else { 'OK' }
$completedAt = (Get-Date).ToUniversalTime().ToString('o')
$summary = [pscustomobject][ordered]@{
    schema = 'grit.factor_display_naming_harness.v1'
    status = $status
    started_at = $startedAt
    completed_at = $completedAt
    repo_root = $repoRoot
    task_slug = $TaskSlug
    output_dir = $taskDir
    inputs = [pscustomobject][ordered]@{
        factor_ids = $FactorId
        expected_names = $ExpectedName
        reject_names = $RejectName
        backend_base_url = $BackendBaseUrl
        db_path = $DbPath
        skip_preflight = [bool]$SkipPreflight
        skip_api = [bool]$SkipApi
        acceptance_surface = $AcceptanceSurface
        dry_run_backfill = [bool]$DryRunBackfill
        apply_backfill = [bool]$ApplyBackfill
    }
    preflight = $preflight
    probes = @($probePhases.ToArray())
    backfill = @($backfills.ToArray())
    fact_table = [pscustomobject][ordered]@{
        ok = Get-Prop $factTable 'ok'
        skipped = Get-Prop $factTable 'skipped'
        output = Get-Prop $factTable 'output'
        row_count = Get-Prop $factTable 'row_count'
        raw_with_full_wnzt_count = $rawWithFullWnztCount
        errors = @(ConvertTo-Array (Get-Prop $factTable 'errors'))
    }
    gates = [pscustomobject][ordered]@{
        final_probe_phase = Get-Prop $finalProbePhase 'phase'
        final_probe_failures = $probeFailures.Count
        final_probe_warnings = @($probeWarnings)
        raw_with_full_wnzt_count = $rawWithFullWnztCount
        backfill_failures = $backfillFailures.Count
    }
    errors = @($errors.ToArray())
    browser_followup = 'If a visible route check is still needed, use system Chrome with --headless=new --no-sandbox --disable-gpu and verify visible Raw rows do not have all W/N/Z/T lights active.'
}

$summaryPath = Join-Path $taskDir 'summary.json'
Write-JsonFile -Path $summaryPath -Value $summary -Depth 28

if ($Json) {
    $summary | ConvertTo-Json -Depth 28
} else {
    $summary | Format-List
}

if ($Strict -and $status -ne 'OK') {
    exit 2
}
