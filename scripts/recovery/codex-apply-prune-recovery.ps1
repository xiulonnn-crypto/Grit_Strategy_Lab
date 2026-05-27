[CmdletBinding()]
param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [string]$TaskSlug = "factor-prune-recovery",
    [switch]$PreviewOnly,
    [switch]$Apply,
    [string]$Reason = "Restore factors pruned without measured redundancy evidence.",
    [string]$RepoRoot = "",
    [switch]$SkipRuntimePreflight
)

$ErrorActionPreference = "Stop"

if ($PreviewOnly -and $Apply) {
    throw "Use either -PreviewOnly or -Apply, not both."
}
if (-not $PreviewOnly -and -not $Apply) {
    $PreviewOnly = $true
}

if (-not $RepoRoot.Trim()) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
    $RepoRoot = (Resolve-Path $RepoRoot).Path
}

$ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
$safeSlug = ($TaskSlug -replace "[^A-Za-z0-9_.-]", "-").Trim("-")
if (-not $safeSlug) {
    $safeSlug = "factor-prune-recovery"
}

$logDir = Join-Path $RepoRoot (Join-Path "output\logs\grit-coder" $safeSlug)
$backupDir = Join-Path $RepoRoot "artifacts\recovery"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)] [object]$Value,
        [Parameter(Mandatory = $true)] [string]$Path
    )
    $Value | ConvertTo-Json -Depth 80 | Set-Content -Path $Path -Encoding UTF8
}

function Invoke-ApiJson {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [string]$Method = "Get",
        [object]$Body = $null,
        [int]$TimeoutSec = 120
    )
    $uri = "$ApiBaseUrl$Path"
    if ($null -eq $Body) {
        return Invoke-RestMethod -Uri $uri -Method $Method -TimeoutSec $TimeoutSec
    }
    $json = $Body | ConvertTo-Json -Depth 20
    return Invoke-RestMethod -Uri $uri -Method $Method -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec $TimeoutSec
}

function Get-SummaryObject {
    param([object]$Value)
    if ($null -eq $Value) {
        return $null
    }
    if ($Value.PSObject.Properties.Name -contains "summary") {
        return $Value.summary
    }
    return $Value
}

if (-not $SkipRuntimePreflight) {
    $preflightScript = Join-Path $RepoRoot "scripts\codex-grit-runtime-preflight.ps1"
    if (Test-Path $preflightScript) {
        $preflightPath = Join-Path $logDir "runtime-preflight-prune-recovery.json"
        & $preflightScript -Json | Set-Content -Path $preflightPath -Encoding UTF8
        $preflight = Get-Content -Path $preflightPath -Raw | ConvertFrom-Json
        if ($preflight.quickstartOverall -ne "ready" -or $preflight.decision -ne "reuse") {
            throw "Runtime preflight is not ready/reuse. See $preflightPath. nextAction=$($preflight.nextAction)"
        }
    }
}

$preview = Invoke-ApiJson -Path "/factor-governance/prune-recovery/preview" -TimeoutSec 180
$previewSummary = Get-SummaryObject $preview
$recoverableIds = @($preview.items | Where-Object { $_.recoverable } | ForEach-Object { [string]$_.factor_id })
$keepPrunedIds = @($preview.items | Where-Object { -not $_.recoverable } | ForEach-Object { [string]$_.factor_id })

$overviewBefore = Invoke-ApiJson -Path "/factor-governance/overview" -TimeoutSec 180
$factoryBefore = Invoke-ApiJson -Path "/factor-factory/overview" -TimeoutSec 180

$summary = [ordered]@{
    status = if ($Apply) { "PREVIEW_BEFORE_APPLY" } else { "PREVIEW_ONLY" }
    api_base_url = $ApiBaseUrl
    task_slug = $safeSlug
    preview = [ordered]@{
        pruned_count = $previewSummary.pruned_count
        recoverable_count = $previewSummary.recoverable_count
        keep_pruned_count = $previewSummary.keep_pruned_count
        recoverable_factor_ids = $recoverableIds
        keep_pruned_factor_ids = $keepPrunedIds
    }
    governance_overview = Get-SummaryObject $overviewBefore
    factor_factory_redundancy_pruning = $factoryBefore.redundancy_pruning
    backup_path = $null
    apply = $null
}

if ($Apply) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $backupDir "$stamp-$safeSlug-before-prune-recovery.sqlite3"
    $dbPath = Join-Path $RepoRoot ".grit_backtest_platform.sqlite3"
    if (-not (Test-Path $dbPath)) {
        throw "Cannot find active DB at $dbPath"
    }
    Copy-Item -LiteralPath $dbPath -Destination $backupPath -Force

    $applyResult = Invoke-ApiJson -Path "/factor-governance/prune-recovery/apply" -Method "Post" -Body @{
        confirm = $true
        reason = $Reason
    } -TimeoutSec 180

    $previewAfter = Invoke-ApiJson -Path "/factor-governance/prune-recovery/preview" -TimeoutSec 180
    $overviewAfter = Invoke-ApiJson -Path "/factor-governance/overview" -TimeoutSec 180
    $factoryAfter = Invoke-ApiJson -Path "/factor-factory/overview" -TimeoutSec 180

    $summary.status = "APPLIED"
    $summary.backup_path = $backupPath
    $summary.apply = [ordered]@{
        command = $applyResult.command
        recovered_count = $applyResult.recovered_count
        skipped_count = $applyResult.skipped_count
        recovered_factor_ids = @($applyResult.recovered_factor_ids | ForEach-Object { [string]$_ })
        reason = $Reason
        recovery_preview_after = Get-SummaryObject $previewAfter
        governance_overview_after = Get-SummaryObject $overviewAfter
        factor_factory_redundancy_pruning_after = $factoryAfter.redundancy_pruning
    }
}

$summaryPath = Join-Path $logDir "prune-recovery-summary.json"
Write-JsonFile -Value $summary -Path $summaryPath
$summary
