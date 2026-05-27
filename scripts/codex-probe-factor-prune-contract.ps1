[CmdletBinding()]
param(
    [string[]]$FactorId = @(),
    [string]$BackendBaseUrl = 'http://127.0.0.1:8000',
    [string]$DbPath = $(if ($env:GRIT_BACKTEST_DB) { $env:GRIT_BACKTEST_DB } else { '.grit_backtest_platform.sqlite3' }),
    [string]$TaskSlug = 'factor-prune-contract-probe',
    [string]$OutputRoot = 'output\logs\grit-coder',
    [int]$TimeoutSec = 10,
    [int]$MinSampleCount = 6,
    [switch]$AllowTargetPrune,
    [switch]$SkipApi,
    [switch]$UseServiceCopy,
    [switch]$KeepServiceCopy,
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
$probeScript = Join-Path $repoRoot 'scripts\factor_prune_contract_probe.py'
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$pythonExe = if (Test-Path $venvPython) { $venvPython } else { 'python' }

if (-not (Test-Path $probeScript)) {
    throw "Missing factor prune contract probe script: $probeScript"
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

$outPath = Join-Path $taskDir 'prune-contract.json'
$stdoutPath = Join-Path $taskDir 'prune-contract.stdout.txt'
$stderrPath = Join-Path $taskDir 'prune-contract.stderr.txt'
$serviceCopyDb = Join-Path $taskDir 'service-copy.sqlite3'

$probeArgs = @(
    '-X', 'utf8',
    $probeScript,
    '--api-base', $BackendBaseUrl,
    '--db', $DbPath,
    '--timeout', ([string]$TimeoutSec),
    '--min-sample-count', ([string]$MinSampleCount),
    '--out', $outPath
)
foreach ($factor in $FactorId) {
    if (-not [string]::IsNullOrWhiteSpace($factor)) {
        $probeArgs += @('--factor-id', $factor)
    }
}
if ($AllowTargetPrune) {
    $probeArgs += '--allow-target-prune'
}
if ($SkipApi) {
    $probeArgs += '--skip-api'
}
if ($UseServiceCopy) {
    $probeArgs += @('--service-copy-db', $serviceCopyDb)
}
if ($KeepServiceCopy) {
    $probeArgs += '--keep-service-copy'
}
if ($Strict) {
    $probeArgs += '--strict'
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

$payload = $null
if (Test-Path $outPath) {
    $payload = ConvertTo-JsonObject (Get-Content -Path $outPath -Raw -Encoding UTF8)
}

if ($null -eq $payload) {
    $payload = [pscustomobject][ordered]@{
        schema = 'grit.factor_prune_contract_harness.v1'
        ok = $false
        status = 'FAIL'
        output = $outPath
        stdout = $stdoutPath
        stderr = $stderrPath
        exit_code = $exitCode
        error = if ([string]::IsNullOrWhiteSpace($stderr)) { 'probe_output_missing' } else { $stderr }
    }
}

$counts = Get-Prop $payload 'action_counts'
$summary = [pscustomobject][ordered]@{
    schema = 'grit.factor_prune_contract_harness.v1'
    ok = [bool](Get-Prop $payload 'ok')
    status = [string](Get-Prop $payload 'status')
    output = $outPath
    stdout = $stdoutPath
    stderr = $stderrPath
    exit_code = $exitCode
    factor_ids = @(Get-Prop $payload 'factor_ids')
    allowed_evidence_sources = @(Get-Prop $payload 'allowed_evidence_sources')
    action_counts = $counts
    violations = @(Get-Prop $payload 'violations')
}

if ($Json) {
    $summary | ConvertTo-Json -Depth 24
} else {
    $total = Get-Prop $counts 'total_prune_action_count'
    $proxy = Get-Prop $counts 'proxy_prune_action_count'
    $unsupported = Get-Prop $counts 'unsupported_source_prune_action_count'
    $target = Get-Prop $counts 'target_prune_action_count'
    Write-Output ("status={0} ok={1} prune_total={2} proxy={3} unsupported={4} target={5} output={6}" -f $summary.status, $summary.ok, $total, $proxy, $unsupported, $target, $outPath)
}

if ($exitCode -ne 0) {
    exit $exitCode
}
if ($Strict -and -not [bool](Get-Prop $payload 'ok')) {
    exit 1
}
